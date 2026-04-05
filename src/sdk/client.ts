import { ethers } from "ethers";
import { PRMISSION_ABI, ERC20_ABI } from "./abi/index.js";
import {
  type PrmissionConfig,
  type Permission,
  type Escrow,
  type PermissionDetails,
  type EscrowDetails,
  type SettlementPreview,
  type AgentTrustProfile,
  type AccessCheck,
  PermissionStatus,
  EscrowStatus,
  PROTOCOL_FEE_BPS,
  BPS_DENOMINATOR,
  DISPUTE_WINDOW_SECONDS,
  USDC_DECIMALS,
} from "./types.js";

/**
 * PrmissionClient — TypeScript SDK for the Prmission Protocol.
 *
 * Wraps all Prmission.sol contract interactions with typed interfaces,
 * automatic USDC approval handling, and human-readable formatting.
 *
 * Usage:
 * ```ts
 * const client = new PrmissionClient({
 *   contractAddress: "0x...",
 *   rpcUrl: "https://mainnet.base.org",
 * });
 *
 * // Read-only (no signer needed)
 * const perms = await client.getUserPermissions("0xUser...");
 *
 * // Write operations (connect a signer first)
 * client.connect(signer);
 * const id = await client.grantPermission({ ... });
 * ```
 */
export class PrmissionClient {
  readonly contract: ethers.Contract;
  readonly provider: ethers.Provider;
  private _paymentToken: ethers.Contract | null = null;
  private _paymentTokenAddress: string | null = null;
  private _signer: ethers.Signer | null = null;

  constructor(config: PrmissionConfig) {
    const provider = config.rpcUrl
      ? new ethers.JsonRpcProvider(config.rpcUrl)
      : ethers.getDefaultProvider("base");

    this.provider = provider;
    this.contract = new ethers.Contract(
      config.contractAddress,
      PRMISSION_ABI,
      provider
    );
  }

  // ─── Signer Management ─────────────────────────────────────────────

  /**
   * Connect a signer for write operations.
   * Call this before any state-changing methods.
   */
  connect(signer: ethers.Signer): PrmissionClient {
    this._signer = signer;
    this.contract.connect(signer);
    return this;
  }

  private get signer(): ethers.Signer {
    if (!this._signer) {
      throw new Error(
        "No signer connected. Call client.connect(signer) before write operations."
      );
    }
    return this._signer;
  }

  private get writableContract(): ethers.Contract {
    return this.contract.connect(this.signer) as ethers.Contract;
  }

  // ─── Payment Token (USDC) ──────────────────────────────────────────

  /** Lazily resolve the payment token contract */
  private async getPaymentToken(): Promise<ethers.Contract> {
    if (!this._paymentToken) {
      this._paymentTokenAddress = await this.contract.paymentToken();
      this._paymentToken = new ethers.Contract(
        this._paymentTokenAddress!,
        ERC20_ABI,
        this.provider
      );
    }
    return this._paymentToken;
  }

  /**
   * Ensure the contract has sufficient USDC allowance.
   * Approves if current allowance is below the required amount.
   * Returns true if an approval tx was sent.
   */
  async ensureAllowance(amount: bigint): Promise<boolean> {
    const token = await this.getPaymentToken();
    const signerAddress = await this.signer.getAddress();
    const contractAddress = await this.contract.getAddress();

    const currentAllowance: bigint = await token.allowance(
      signerAddress,
      contractAddress
    );

    if (currentAllowance >= amount) {
      return false; // already approved
    }

    const writableToken = token.connect(this.signer) as ethers.Contract;
    const tx = await writableToken.approve(contractAddress, amount);
    await tx.wait();
    return true;
  }

  /** Get USDC balance for an address */
  async getBalance(address: string): Promise<bigint> {
    const token = await this.getPaymentToken();
    return token.balanceOf(address);
  }

  // ─── Permission Management ─────────────────────────────────────────

  /**
   * Grant a new data-sharing permission.
   *
   * @param merchant - Restrict to a specific buyer (address(0) = open to all)
   * @param dataCategory - e.g. "browsing", "location", "health"
   * @param purpose - Why the data is being shared
   * @param compensationBps - User's cut in basis points (max 5000 = 50%)
   * @param upfrontFee - USDC amount paid to user when escrow is deposited (raw, 6 decimals)
   * @param validityPeriod - Duration in seconds
   * @returns The new permissionId
   */
  async grantPermission(params: {
    merchant?: string;
    dataCategory: string;
    purpose: string;
    compensationBps: number;
    upfrontFee?: bigint;
    validityPeriod: number;
  }): Promise<bigint> {
    const tx = await this.writableContract.grantPermission(
      params.merchant ?? ethers.ZeroAddress,
      params.dataCategory,
      params.purpose,
      params.compensationBps,
      params.upfrontFee ?? 0n,
      params.validityPeriod
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(
      (l: ethers.Log) =>
        l.topics[0] ===
        ethers.id(
          "PermissionGranted(uint256,address,address,string,string,uint256,uint256,uint256)"
        )
    );
    if (!log) throw new Error("PermissionGranted event not found in receipt");
    const parsed = this.contract.interface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    return parsed!.args.permissionId;
  }

  /** Revoke an active permission. Only the permission owner can call this. */
  async revokePermission(permissionId: bigint): Promise<void> {
    const tx = await this.writableContract.revokePermission(permissionId);
    await tx.wait();
  }

  /** Expire a permission that has passed its validUntil. Anyone can call. */
  async expirePermission(permissionId: bigint): Promise<void> {
    const tx = await this.writableContract.expirePermission(permissionId);
    await tx.wait();
  }

  // ─── Permission Reads ──────────────────────────────────────────────

  /** Get a single permission with enriched metadata */
  async getPermission(permissionId: bigint): Promise<PermissionDetails> {
    const raw = await this.contract.permissions(permissionId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    return {
      permissionId,
      user: raw.user,
      merchant: raw.merchant,
      dataCategory: raw.dataCategory,
      purpose: raw.purpose,
      compensationBps: raw.compensationBps,
      upfrontFee: raw.upfrontFee,
      validUntil: raw.validUntil,
      status: Number(raw.status) as PermissionStatus,
      createdAt: raw.createdAt,
      isActive: Number(raw.status) === PermissionStatus.ACTIVE && raw.validUntil > now,
      isExpired: raw.validUntil <= now,
      expiresIn: Number(raw.validUntil - now),
    };
  }

  /** Get all permission IDs for a user */
  async getUserPermissionIds(user: string): Promise<bigint[]> {
    return this.contract.getUserPermissions(user);
  }

  /** Get all permissions for a user, fully resolved */
  async getUserPermissions(user: string): Promise<PermissionDetails[]> {
    const ids: bigint[] = await this.contract.getUserPermissions(user);
    return Promise.all(ids.map((id) => this.getPermission(id)));
  }

  /** Get only active permissions for a user */
  async getActivePermissions(user: string): Promise<PermissionDetails[]> {
    const all = await this.getUserPermissions(user);
    return all.filter((p) => p.isActive);
  }

  /** Check access for an agent on a permission */
  async checkAccess(
    permissionId: bigint,
    agent: string
  ): Promise<AccessCheck> {
    const result = await this.contract.checkAccess(permissionId, agent);
    return {
      permitted: result.permitted,
      compensationBps: result.compensationBps,
      upfrontFee: result.upfrontFee,
      validUntil: result.validUntil,
    };
  }

  // ─── Escrow Operations ─────────────────────────────────────────────

  /**
   * Deposit escrow to access user data.
   * Automatically handles USDC approval if needed.
   *
   * @param permissionId - The permission being exercised
   * @param amount - USDC escrow amount (raw, 6 decimals)
   * @param agentId - ERC-8004 agent ID (0 if identity not enforced)
   * @returns The new escrowId
   */
  async depositEscrow(
    permissionId: bigint,
    amount: bigint,
    agentId?: bigint
  ): Promise<bigint> {
    // Get the permission to check for upfront fee
    const perm = await this.getPermission(permissionId);
    const totalNeeded = amount + perm.upfrontFee;

    // Ensure USDC approval covers escrow + upfront fee
    await this.ensureAllowance(totalNeeded);

    const tx = await this.writableContract.depositEscrow(
      permissionId,
      amount,
      agentId ?? 0n
    );
    const receipt = await tx.wait();

    const log = receipt.logs.find(
      (l: ethers.Log) =>
        l.topics[0] ===
        ethers.id(
          "EscrowDeposited(uint256,uint256,address,uint256,uint256)"
        )
    );
    if (!log) throw new Error("EscrowDeposited event not found in receipt");
    const parsed = this.contract.interface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    return parsed!.args.escrowId;
  }

  /** Report the outcome of a data access (agent only) */
  async reportOutcome(params: {
    escrowId: bigint;
    outcomeValue: bigint;
    outcomeType: string;
    outcomeDescription: string;
  }): Promise<void> {
    const tx = await this.writableContract.reportOutcome(
      params.escrowId,
      params.outcomeValue,
      params.outcomeType,
      params.outcomeDescription
    );
    await tx.wait();
  }

  /** File a dispute during the 24-hour window */
  async disputeSettlement(
    escrowId: bigint,
    reason: string
  ): Promise<void> {
    const tx = await this.writableContract.disputeSettlement(escrowId, reason);
    await tx.wait();
  }

  /** Settle an escrow after the dispute window closes */
  async settle(escrowId: bigint): Promise<void> {
    const tx = await this.writableContract.settle(escrowId);
    await tx.wait();
  }

  /** Refund escrow (revoked permissions or resolved disputes) */
  async refundEscrow(escrowId: bigint): Promise<void> {
    const tx = await this.writableContract.refundEscrow(escrowId);
    await tx.wait();
  }

  // ─── Escrow Reads ──────────────────────────────────────────────────

  /** Get escrow details with enriched metadata */
  async getEscrow(escrowId: bigint): Promise<EscrowDetails> {
    const raw = await this.contract.escrows(escrowId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const disputeEnd = raw.reportedAt + BigInt(DISPUTE_WINDOW_SECONDS);

    return {
      escrowId,
      permissionId: raw.permissionId,
      agent: raw.agent,
      agentId: raw.agentId,
      amount: raw.amount,
      outcomeValue: raw.outcomeValue,
      outcomeType: raw.outcomeType,
      outcomeDescription: raw.outcomeDescription,
      reportedAt: raw.reportedAt,
      status: Number(raw.status) as EscrowStatus,
      createdAt: raw.createdAt,
      disputeWindowEnd: disputeEnd,
      isDisputable:
        Number(raw.status) === EscrowStatus.OUTCOME_REPORTED &&
        now < disputeEnd,
      isSettleable:
        Number(raw.status) === EscrowStatus.OUTCOME_REPORTED &&
        now >= disputeEnd,
    };
  }

  /** Preview settlement amounts before settling */
  async previewSettlement(escrowId: bigint): Promise<SettlementPreview> {
    const result = await this.contract.previewSettlement(escrowId);
    return {
      userShare: result.userShare,
      protocolFee: result.protocolFee,
      agentRefund: result.agentRefund,
      disputeWindowEnd: result.disputeWindowEnd,
      formatted: {
        userShare: formatUsdc(result.userShare),
        protocolFee: formatUsdc(result.protocolFee),
        agentRefund: formatUsdc(result.agentRefund),
      },
    };
  }

  // ─── ERC-8004 Trust ────────────────────────────────────────────────

  /** Check an agent's ERC-8004 trust profile */
  async checkAgentTrust(
    agentId: bigint,
    agentAddress: string
  ): Promise<AgentTrustProfile> {
    const result = await this.contract.checkAgentTrust(agentId, agentAddress);
    return {
      registered: result.registered,
      authorized: result.authorized,
      reputable: result.reputable,
      repScore: result.repScore,
      repCount: result.repCount,
    };
  }

  /** Get the list of trusted reviewer addresses */
  async getTrustedReviewers(): Promise<string[]> {
    return this.contract.getTrustedReviewers();
  }

  /** Check whether identity enforcement is currently active */
  async isIdentityEnforced(): Promise<boolean> {
    return this.contract.identityEnforced();
  }

  /** Check whether reputation gating is currently active */
  async isReputationEnforced(): Promise<boolean> {
    return this.contract.reputationEnforced();
  }

  // ─── Protocol Info ─────────────────────────────────────────────────

  /** Get total protocol fees collected (lifetime) */
  async getTotalProtocolFees(): Promise<{ raw: bigint; formatted: string }> {
    const raw: bigint = await this.contract.totalProtocolFees();
    return { raw, formatted: formatUsdc(raw) };
  }

  /** Get treasury address */
  async getTreasury(): Promise<string> {
    return this.contract.treasury();
  }

  // ─── Utility: Settlement Math ──────────────────────────────────────

  /**
   * Calculate settlement split locally (no RPC call needed).
   * Matches the exact math in Prmission.sol settle().
   */
  static calculateSettlement(
    outcomeValue: bigint,
    compensationBps: bigint,
    escrowAmount: bigint
  ): {
    userShare: bigint;
    protocolFee: bigint;
    agentRefund: bigint;
    sufficient: boolean;
  } {
    const userShare = (outcomeValue * compensationBps) / BPS_DENOMINATOR;
    const protocolFee = (outcomeValue * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
    const totalDeductions = userShare + protocolFee;
    const sufficient = escrowAmount >= totalDeductions;
    const agentRefund = sufficient ? escrowAmount - totalDeductions : 0n;

    return { userShare, protocolFee, agentRefund, sufficient };
  }

  // ─── Event Listeners ───────────────────────────────────────────────

  /** Subscribe to PermissionGranted events */
  onPermissionGranted(
    callback: (
      permissionId: bigint,
      user: string,
      merchant: string,
      dataCategory: string,
      purpose: string,
      compensationBps: bigint,
      upfrontFee: bigint,
      validUntil: bigint,
      event: ethers.EventLog
    ) => void
  ): void {
    this.contract.on("PermissionGranted", callback);
  }

  /** Subscribe to EscrowDeposited events */
  onEscrowDeposited(
    callback: (
      escrowId: bigint,
      permissionId: bigint,
      agent: string,
      agentId: bigint,
      amount: bigint,
      event: ethers.EventLog
    ) => void
  ): void {
    this.contract.on("EscrowDeposited", callback);
  }

  /** Subscribe to SettlementCompleted events */
  onSettlementCompleted(
    callback: (
      escrowId: bigint,
      userShare: bigint,
      protocolFee: bigint,
      agentRefund: bigint,
      event: ethers.EventLog
    ) => void
  ): void {
    this.contract.on("SettlementCompleted", callback);
  }

  /** Subscribe to PermissionRevoked events */
  onPermissionRevoked(
    callback: (
      permissionId: bigint,
      user: string,
      revokedAt: bigint,
      deleteBy: bigint,
      event: ethers.EventLog
    ) => void
  ): void {
    this.contract.on("PermissionRevoked", callback);
  }

  /** Subscribe to DisputeFiled events */
  onDisputeFiled(
    callback: (
      escrowId: bigint,
      disputant: string,
      reason: string,
      event: ethers.EventLog
    ) => void
  ): void {
    this.contract.on("DisputeFiled", callback);
  }

  /** Remove all event listeners */
  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }
}

// ─── Formatting Helpers ──────────────────────────────────────────────

/** Format a raw USDC amount (6 decimals) to a human-readable string */
export function formatUsdc(amount: bigint): string {
  return ethers.formatUnits(amount, USDC_DECIMALS);
}

/** Parse a human-readable USDC string to raw amount (6 decimals) */
export function parseUsdc(amount: string | number): bigint {
  return ethers.parseUnits(amount.toString(), USDC_DECIMALS);
}
