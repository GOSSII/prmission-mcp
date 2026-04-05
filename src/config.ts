import "dotenv/config";
import {
  PrmissionNetwork,
  PRMISSION_CONTRACT_BASE_MAINNET,
} from "prmission-sdk";
import type { PrmissionClientConfig } from "prmission-sdk";

// ─── Network defaults ─────────────────────────────────────────────────────────

const USDC_ADDRESSES: Record<string, string> = {
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const BASESCAN_BASES: Record<string, string> = {
  "base-mainnet": "https://basescan.org/tx",
  "base-sepolia": "https://sepolia.basescan.org/tx",
};

// ─── SDK config builder ───────────────────────────────────────────────────────

const networkEnv = process.env.PRMISSION_NETWORK ?? "base-mainnet";
const rpcOverride = process.env.PRMISSION_RPC_URL || undefined;
const contractOverride = process.env.PRMISSION_CONTRACT_ADDRESS || undefined;

function buildSdkConfig(): PrmissionClientConfig {
  if (networkEnv === "base-sepolia") {
    if (!contractOverride) {
      throw new Error(
        "PRMISSION_CONTRACT_ADDRESS is required when PRMISSION_NETWORK=base-sepolia. " +
          "There is no default contract address for testnet."
      );
    }
    return {
      network: PrmissionNetwork.BaseSepolia,
      rpcUrl: rpcOverride ?? "https://sepolia.base.org",
      contractAddress: contractOverride,
    };
  }

  // base-mainnet (default)
  return {
    network: PrmissionNetwork.BaseMainnet,
    rpcUrl: rpcOverride,
    contractAddress: contractOverride, // optional — SDK falls back to known address
  };
}

const sdkConfig = buildSdkConfig();

// Derive effective display address (mirrors the SDK's internal normalizeConfig logic)
const effectiveContractAddress =
  sdkConfig.network === PrmissionNetwork.BaseMainnet
    ? ((sdkConfig as { contractAddress?: string }).contractAddress ??
      PRMISSION_CONTRACT_BASE_MAINNET)
    : (sdkConfig as { contractAddress: string }).contractAddress;

// Derive chain ID and display RPC URL from network
const CHAIN_IDS: Record<string, number> = {
  "base-mainnet": 8453,
  "base-sepolia": 84532,
};
const DEFAULT_RPC_URLS: Record<string, string> = {
  "base-mainnet": "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
};
const effectiveChainId = CHAIN_IDS[networkEnv];
const effectiveRpcUrl =
  (sdkConfig as { rpcUrl?: string }).rpcUrl ??
  DEFAULT_RPC_URLS[networkEnv] ??
  "https://mainnet.base.org";

// ─── Exported config ──────────────────────────────────────────────────────────

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** Network name for display / logging */
  network: networkEnv,
  /** Chain ID derived from network */
  chainId: effectiveChainId,
  /** Typed config object passed directly to PrmissionClient.create() */
  sdkConfig,
  /** Effective contract address (for display in /healthz and tools) */
  contractAddress: effectiveContractAddress,
  /** RPC URL for display */
  rpcUrl: effectiveRpcUrl,
  /** USDC token address on the target network */
  usdcAddress: USDC_ADDRESSES[networkEnv] ?? USDC_ADDRESSES["base-mainnet"],
  /** Block explorer tx base URL */
  basescanBase: BASESCAN_BASES[networkEnv] ?? BASESCAN_BASES["base-mainnet"],

  /** Public base URL (used in OAuth discovery metadata) */
  publicUrl: (process.env.PUBLIC_URL ?? "https://prmission-mcp.onrender.com").replace(/\/$/, ""),

  /** If set, write tools are enabled and txs are signed with this key */
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY || undefined,
  /** If set, all /mcp requests must include: Authorization: Bearer <token> */
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || undefined,

  writeEnabled: Boolean(process.env.AGENT_PRIVATE_KEY),
} as const;

export type Config = typeof config;
