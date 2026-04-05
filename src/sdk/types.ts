// ─── On-chain enums ───────────────────────────────────────────────────

export enum PermissionStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  REVOKED = 2,
  EXPIRED = 3,
}

export enum EscrowStatus {
  NONE = 0,
  FUNDED = 1,
  OUTCOME_REPORTED = 2,
  DISPUTED = 3,
  SETTLED = 4,
  REFUNDED = 5,
}

// ─── On-chain structs (decoded from contract reads) ───────────────────

export interface Permission {
  user: string;
  merchant: string;
  dataCategory: string;
  purpose: string;
  compensationBps: bigint;
  upfrontFee: bigint;
  validUntil: bigint;
  status: PermissionStatus;
  createdAt: bigint;
}

export interface Escrow {
  permissionId: bigint;
  agent: string;
  agentId: bigint;
  amount: bigint;
  outcomeValue: bigint;
  outcomeType: string;
  outcomeDescription: string;
  reportedAt: bigint;
  status: EscrowStatus;
  createdAt: bigint;
}

// ─── SDK-level types (enriched for UI/skill consumption) ──────────────

export interface PermissionDetails extends Permission {
  permissionId: bigint;
  isActive: boolean;
  isExpired: boolean;
  expiresIn: number; // seconds until expiry, negative if expired
}

export interface EscrowDetails extends Escrow {
  escrowId: bigint;
  disputeWindowEnd: bigint;
  isDisputable: boolean;
  isSettleable: boolean;
}

export interface SettlementPreview {
  userShare: bigint;
  protocolFee: bigint;
  agentRefund: bigint;
  disputeWindowEnd: bigint;
  /** Human-readable formatted amounts (USDC, 6 decimals) */
  formatted: {
    userShare: string;
    protocolFee: string;
    agentRefund: string;
  };
}

export interface AgentTrustProfile {
  registered: boolean;
  authorized: boolean;
  reputable: boolean;
  repScore: bigint;
  repCount: bigint;
}

export interface AccessCheck {
  permitted: boolean;
  compensationBps: bigint;
  upfrontFee: bigint;
  validUntil: bigint;
}

// ─── SDK configuration ───────────────────────────────────────────────

export interface PrmissionConfig {
  /** Prmission contract address on Base */
  contractAddress: string;
  /** RPC URL or ethers provider */
  rpcUrl?: string;
  /** Chain ID (8453 for Base mainnet, 84532 for Base Sepolia) */
  chainId?: number;
}

// ─── Data categories (matches SKILL.md) ──────────────────────────────

export const DATA_CATEGORIES = [
  "purchase_intent",
  "browsing",
  "location",
  "demographics",
  "health",
  "financial",
  "preferences",
] as const;

export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** Typical price ranges per category in USD (from SKILL.md) */
export const PRICE_RANGES: Record<DataCategory, { min: number; max: number }> = {
  purchase_intent: { min: 0.25, max: 2.0 },
  browsing: { min: 0.10, max: 0.50 },
  location: { min: 0.50, max: 3.0 },
  demographics: { min: 0.15, max: 0.75 },
  health: { min: 1.0, max: 5.0 },
  financial: { min: 0.50, max: 3.0 },
  preferences: { min: 0.10, max: 0.40 },
};

// ─── Protocol constants (must match Prmission.sol) ──────────────────

/** 3% protocol fee = 300 basis points. Non-negotiable. */
export const PROTOCOL_FEE_BPS = 300n;
export const BPS_DENOMINATOR = 10_000n;
export const DISPUTE_WINDOW_SECONDS = 86_400; // 24 hours
export const REVOCATION_GRACE_SECONDS = 60;
export const USDC_DECIMALS = 6;

// ─── Known addresses ─────────────────────────────────────────────────

export const ADDRESSES = {
  /** USDC on Base mainnet */
  USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  /** USDC on Base Sepolia testnet */
  USDC_BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;
