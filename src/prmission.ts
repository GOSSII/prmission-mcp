import { ethers } from "ethers";
import {
  PrmissionClient,
  PrmissionWriteClient,
  parseUsdc,
  formatUsdc,
} from "prmission-sdk";
import { config } from "./config.js";

// ─── Client singletons ────────────────────────────────────────────────────────

let _readClient: PrmissionClient | null = null;
let _writeClient: PrmissionWriteClient | null = null;

/** Returns a singleton read-only client. */
export function getReadClient(): PrmissionClient {
  if (!_readClient) {
    const result = PrmissionClient.create(config.sdkConfig);
    if (!result.ok) {
      throw new Error(
        `Failed to initialize Prmission client: [${result.error.code}] ${result.error.message}`
      );
    }
    _readClient = result.value;
  }
  return _readClient;
}

/**
 * Returns a singleton write client (signer attached).
 * Throws if AGENT_PRIVATE_KEY is not set.
 */
export function getWriteClient(): PrmissionWriteClient {
  if (!config.agentPrivateKey) {
    throw new Error("Write tools are disabled: AGENT_PRIVATE_KEY is not set.");
  }
  if (!_writeClient) {
    const rpcUrl =
      "rpcUrl" in config.sdkConfig && config.sdkConfig.rpcUrl
        ? config.sdkConfig.rpcUrl
        : "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(config.agentPrivateKey, provider);
    _writeClient = getReadClient().withSigner(wallet);
  }
  return _writeClient;
}

// ─── Write queue (nonce serialization) ───────────────────────────────────────
// All write operations are serialized through this queue to prevent nonce
// collisions when multiple concurrent MCP tool calls hit the server.

let _writeQueueTail: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeQueueTail.then(fn);
  _writeQueueTail = next.catch(() => {});
  return next;
}

// ─── Input helpers ────────────────────────────────────────────────────────────

/** Parse a decimal-string ID to bigint. Throws a clear error on bad input. */
export function parseId(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid ID "${value}": must be a non-negative integer string.`
    );
  }
  return BigInt(trimmed);
}

/** Validate and checksum an Ethereum address. */
export function parseAddress(value: string): string {
  if (!ethers.isAddress(value)) {
    throw new Error(`Invalid Ethereum address: "${value}"`);
  }
  return ethers.getAddress(value);
}

export { parseUsdc, formatUsdc };

// ─── Response helpers ─────────────────────────────────────────────────────────

/** Build a BaseScan transaction URL. */
export function txUrl(hash: string): string {
  return `${config.basescanBase}/${hash}`;
}

/** Recursively convert bigints to strings for JSON serialization. */
export function serializeBigInts(
  obj: Record<string, unknown>
): Record<string, unknown> {
  function serialize(val: unknown): unknown {
    if (typeof val === "bigint") return val.toString();
    if (Array.isArray(val)) return val.map(serialize);
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).map(([k, v]) => [
          k,
          serialize(v),
        ])
      );
    }
    return val;
  }
  return serialize(obj) as Record<string, unknown>;
}
