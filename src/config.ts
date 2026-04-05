// ─── Configuration ────────────────────────────────────────────────────────────
// All env vars are read once at startup. Missing required values throw early.

const MAINNET_DEFAULTS = {
  rpcUrl: "https://mainnet.base.org",
  contractAddress: "0x0c8B16a57524f4009581B748356E01e1a969223d",
  chainId: 8453,
  basescanBase: "https://basescan.org/tx",
} as const;

const SEPOLIA_DEFAULTS = {
  rpcUrl: "https://sepolia.base.org",
  contractAddress: "0x0c8B16a57524f4009581B748356E01e1a969223d", // update if different on testnet
  chainId: 84532,
  basescanBase: "https://sepolia.basescan.org/tx",
} as const;

function resolveNetworkDefaults(network: string) {
  if (network === "base-sepolia") return SEPOLIA_DEFAULTS;
  return MAINNET_DEFAULTS;
}

const network = process.env.PRMISSION_NETWORK ?? "base-mainnet";
const defaults = resolveNetworkDefaults(network);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development",

  network,
  rpcUrl: process.env.PRMISSION_RPC_URL ?? defaults.rpcUrl,
  contractAddress: process.env.PRMISSION_CONTRACT_ADDRESS ?? defaults.contractAddress,
  chainId: defaults.chainId,
  basescanBase: defaults.basescanBase,

  /** If set, write tools are registered and transactions are signed with this key */
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY || undefined,

  /** If set, all /mcp requests must include Authorization: Bearer <token> */
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || undefined,

  writeEnabled: Boolean(process.env.AGENT_PRIVATE_KEY),
} as const;

export type Config = typeof config;
