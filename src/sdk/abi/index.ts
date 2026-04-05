/**
 * Prmission Protocol ABI — extracted from Prmission.sol v2.0.0
 * Only includes the functions/events the SDK needs to call.
 */
export const PRMISSION_ABI = [
  // ─── Constants ───
  "function PROTOCOL_FEE_BPS() view returns (uint256)",
  "function BPS_DENOMINATOR() view returns (uint256)",
  "function DISPUTE_WINDOW() view returns (uint256)",
  "function REVOCATION_GRACE() view returns (uint256)",

  // ─── State ───
  "function paymentToken() view returns (address)",
  "function treasury() view returns (address)",
  "function identityRegistry() view returns (address)",
  "function reputationRegistry() view returns (address)",
  "function minReputationScore() view returns (int128)",
  "function reputationDecimals() view returns (uint8)",
  "function identityEnforced() view returns (bool)",
  "function reputationEnforced() view returns (bool)",
  "function nextPermissionId() view returns (uint256)",
  "function nextEscrowId() view returns (uint256)",
  "function totalProtocolFees() view returns (uint256)",

  // ─── Permission Management ───
  "function grantPermission(address merchant, string dataCategory, string purpose, uint256 compensationBps, uint256 upfrontFee, uint256 validityPeriod) returns (uint256 permissionId)",
  "function revokePermission(uint256 permissionId)",
  "function expirePermission(uint256 permissionId)",

  // ─── Escrow ───
  "function depositEscrow(uint256 permissionId, uint256 amount, uint256 agentId) returns (uint256 escrowId)",
  "function reportOutcome(uint256 escrowId, uint256 outcomeValue, string outcomeType, string outcomeDescription)",
  "function disputeSettlement(uint256 escrowId, string reason)",
  "function settle(uint256 escrowId)",
  "function refundEscrow(uint256 escrowId)",

  // ─── Views ───
  "function permissions(uint256) view returns (address user, address merchant, string dataCategory, string purpose, uint256 compensationBps, uint256 upfrontFee, uint256 validUntil, uint8 status, uint256 createdAt)",
  "function escrows(uint256) view returns (uint256 permissionId, address agent, uint256 agentId, uint256 amount, uint256 outcomeValue, string outcomeType, string outcomeDescription, uint256 reportedAt, uint8 status, uint256 createdAt)",
  "function getUserPermissions(address user) view returns (uint256[])",
  "function checkAccess(uint256 permissionId, address agent) view returns (bool permitted, uint256 compensationBps, uint256 upfrontFee, uint256 validUntil)",
  "function checkAgentTrust(uint256 agentId, address agentAddress) view returns (bool registered, bool authorized, bool reputable, int128 repScore, uint64 repCount)",
  "function previewSettlement(uint256 escrowId) view returns (uint256 userShare, uint256 protocolFee, uint256 agentRefund, uint256 disputeWindowEnd)",
  "function getTrustedReviewers() view returns (address[])",

  // ─── Admin ───
  "function setTreasury(address _treasury)",
  "function setIdentityRegistry(address _registry)",
  "function setReputationRegistry(address _registry)",
  "function setIdentityEnforcement(bool _enforced)",
  "function setReputationEnforcement(bool _enforced, int128 _minScore, uint8 _decimals)",
  "function setTrustedReviewers(address[] _reviewers)",
  "function resolveDisputeForUser(uint256 escrowId)",

  // ─── Events ───
  "event PermissionGranted(uint256 indexed permissionId, address indexed user, address indexed merchant, string dataCategory, string purpose, uint256 compensationBps, uint256 upfrontFee, uint256 validUntil)",
  "event PermissionRevoked(uint256 indexed permissionId, address indexed user, uint256 revokedAt, uint256 deleteBy)",
  "event EscrowDeposited(uint256 indexed escrowId, uint256 indexed permissionId, address indexed agent, uint256 agentId, uint256 amount)",
  "event OutcomeReported(uint256 indexed escrowId, uint256 outcomeValue, string outcomeType, uint256 disputeWindowEnd)",
  "event SettlementCompleted(uint256 indexed escrowId, uint256 userShare, uint256 protocolFee, uint256 agentRefund)",
  "event DisputeFiled(uint256 indexed escrowId, address indexed disputant, string reason)",
  "event EscrowRefunded(uint256 indexed escrowId, address indexed agent, uint256 amount)",
  "event IdentityRegistryUpdated(address indexed registry)",
  "event ReputationRegistryUpdated(address indexed registry)",
  "event IdentityEnforcementUpdated(bool enforced)",
  "event ReputationEnforcementUpdated(bool enforced, int128 minScore, uint8 decimals)",
  "event TrustedReviewersUpdated(address[] reviewers)",
] as const;

/** Standard ERC-20 ABI — only the methods the SDK needs for USDC approval flow */
export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;
