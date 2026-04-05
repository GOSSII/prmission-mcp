// @prmission/sdk — TypeScript SDK for Prmission Protocol v2
//
// Usage:
//   import { PrmissionClient, parseUsdc, formatUsdc } from "@prmission/sdk";
//
//   const client = new PrmissionClient({
//     contractAddress: "0x...",
//     rpcUrl: "https://mainnet.base.org",
//   });

export { PrmissionClient, formatUsdc, parseUsdc } from "./client.js";
export { PRMISSION_ABI, ERC20_ABI } from "./abi/index.js";
export {
  // Enums
  PermissionStatus,
  EscrowStatus,
  // Types
  type Permission,
  type Escrow,
  type PermissionDetails,
  type EscrowDetails,
  type SettlementPreview,
  type AgentTrustProfile,
  type AccessCheck,
  type PrmissionConfig,
  type DataCategory,
  // Constants
  DATA_CATEGORIES,
  PRICE_RANGES,
  PROTOCOL_FEE_BPS,
  BPS_DENOMINATOR,
  DISPUTE_WINDOW_SECONDS,
  REVOCATION_GRACE_SECONDS,
  USDC_DECIMALS,
  ADDRESSES,
} from "./types.js";
