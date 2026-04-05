import { ethers } from "ethers";
import { PrmissionClient, parseUsdc, formatUsdc } from "@prmission/sdk";
import { config } from "./config.js";

// ─── Client Factory ───────────────────────────────────────────────────────────

let _readClient: PrmissionClient | null = null;
let _writeClient: PrmissionClient | null = null;

/** Returns a singleton read-only client (no signer). */
export function getReadClient(): PrmissionClient {
  if (!_readClient) {
    _readClient = new PrmissionClient({
      contractAddress: config.contractAddress,
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
    });
  }
  return _readClient;
}

/**
 * Returns a singleton write client (signer attached).
 * Throws if AGENT_PRIVATE_KEY is not set.
 */
export function getWriteClient(): PrmissionClient {
  if (!config.agentPrivateKey) {
    throw new Error("Write tools are disabled: AGENT_PRIVATE_KEY is not set.");
  }
  if (!_writeClient) {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.agentPrivateKey, provider);
    _writeClient = new PrmissionClient({
      contractAddress: config.contractAddress,
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
    });
    _writeClient.connect(wallet);
  }
  return _writeClient;
}

// ─── Write Queue (nonce serialization) ───────────────────────────────────────
// All write operations are serialized through this queue to prevent nonce
// collisions when multiple concurrent MCP tool calls hit the server.

let _writeQueueTail: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeQueueTail.then(fn);
  // Swallow errors on the tail so the queue never permanently stalls
  _writeQueueTail = next.catch(() => {});
  return next;
}

// ─── Input Helpers ────────────────────────────────────────────────────────────

/** Parse a string or number ID to bigint. Throws on invalid input. */
export function parseId(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ID "${value}": must be a non-negative integer string.`);
  }
  return BigInt(trimmed);
}

/**
 * Validate and checksum an Ethereum address.
 * Throws a user-friendly error on invalid input.
 */
export function parseAddress(value: string): string {
  if (!ethers.isAddress(value)) {
    throw new Error(`Invalid Ethereum address: "${value}"`);
  }
  return ethers.getAddress(value);
}

/** Parse a human-readable USDC amount like "1.50" to raw bigint (6 decimals). */
export { parseUsdc, formatUsdc };

// ─── Response Helpers ─────────────────────────────────────────────────────────

/** Build a BaseScan transaction URL */
export function txUrl(hash: string): string {
  return `${config.basescanBase}/${hash}`;
}

/** Serialize bigint values for JSON (converts to string).
 * Always call this on objects you pass as `structuredContent`.
 */
export function serializeBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  function serialize(val: unknown): unknown {
    if (typeof val === "bigint") return val.toString();
    if (Array.isArray(val)) return val.map(serialize);
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
      );
    }
    return val;
  }
  return serialize(obj) as Record<string, unknown>;
}
