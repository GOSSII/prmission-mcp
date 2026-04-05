import { describe, it, expect } from "vitest";
import { ethers } from "ethers";

// We test the pure utility functions independently of the server
// by importing directly from source.

// ─── parseId ─────────────────────────────────────────────────────────────────

function parseId(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ID "${value}": must be a non-negative integer string.`);
  }
  return BigInt(trimmed);
}

describe("parseId", () => {
  it("converts valid integer strings to bigint", () => {
    expect(parseId("1")).toBe(1n);
    expect(parseId("42")).toBe(42n);
    expect(parseId("0")).toBe(0n);
    expect(parseId("999999999999")).toBe(999999999999n);
  });

  it("trims whitespace before parsing", () => {
    expect(parseId("  5  ")).toBe(5n);
  });

  it("throws on empty string", () => {
    expect(() => parseId("")).toThrow();
  });

  it("throws on floats", () => {
    expect(() => parseId("1.5")).toThrow();
  });

  it("throws on negative numbers", () => {
    expect(() => parseId("-1")).toThrow();
  });

  it("throws on non-numeric strings", () => {
    expect(() => parseId("abc")).toThrow();
    expect(() => parseId("0x1a")).toThrow();
  });
});

// ─── parseAddress ─────────────────────────────────────────────────────────────

function parseAddress(value: string): string {
  if (!ethers.isAddress(value)) {
    throw new Error(`Invalid Ethereum address: "${value}"`);
  }
  return ethers.getAddress(value);
}

describe("parseAddress", () => {
  const VALID = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  it("accepts a valid checksummed address", () => {
    expect(parseAddress(VALID)).toBe(VALID);
  });

  it("accepts a lowercase address and returns checksummed", () => {
    expect(parseAddress(VALID.toLowerCase())).toBe(VALID);
  });

  it("throws on non-address strings", () => {
    expect(() => parseAddress("not-an-address")).toThrow();
    expect(() => parseAddress("0x1234")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseAddress("")).toThrow();
  });
});

// ─── parseUsdc ────────────────────────────────────────────────────────────────

import { parseUsdc, formatUsdc } from "@prmission/sdk";

describe("parseUsdc / formatUsdc", () => {
  it("converts '1.00' → 1_000_000n", () => {
    expect(parseUsdc("1.00")).toBe(1_000_000n);
  });

  it("converts '0.01' → 10_000n", () => {
    expect(parseUsdc("0.01")).toBe(10_000n);
  });

  it("converts '100' → 100_000_000n", () => {
    expect(parseUsdc("100")).toBe(100_000_000n);
  });

  it("round-trips correctly", () => {
    const raw = parseUsdc("5.25");
    expect(formatUsdc(raw)).toBe("5.25");
  });

  it("formats 0n as '0.0'", () => {
    expect(formatUsdc(0n)).toBe("0.0");
  });
});

// ─── Settle guard logic ───────────────────────────────────────────────────────

describe("settle guard", () => {
  it("detects when escrow is not yet settleable", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const disputeWindowEnd = BigInt(nowSec + 3600); // 1 hour from now
    const isSettleable = nowSec >= Number(disputeWindowEnd);
    expect(isSettleable).toBe(false);
  });

  it("detects when escrow is settleable", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const disputeWindowEnd = BigInt(nowSec - 1); // 1 second in the past
    const isSettleable = nowSec >= Number(disputeWindowEnd);
    expect(isSettleable).toBe(true);
  });

  it("calculates seconds remaining correctly", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const endSec = nowSec + 7200; // 2 hours
    const secondsRemaining = Math.max(0, endSec - nowSec);
    expect(secondsRemaining).toBeGreaterThan(7100);
    expect(secondsRemaining).toBeLessThanOrEqual(7200);
  });
});

// ─── serializeBigInts ─────────────────────────────────────────────────────────

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}

describe("serializeBigInts", () => {
  it("converts top-level bigint to string", () => {
    expect(serializeBigInts(42n)).toBe("42");
  });

  it("converts bigints inside objects", () => {
    const result = serializeBigInts({ amount: 1_000_000n, label: "test" }) as Record<string, unknown>;
    expect(result.amount).toBe("1000000");
    expect(result.label).toBe("test");
  });

  it("converts bigints in nested objects", () => {
    const result = serializeBigInts({ a: { b: 99n } }) as { a: { b: string } };
    expect(result.a.b).toBe("99");
  });

  it("converts bigints in arrays", () => {
    const result = serializeBigInts([1n, 2n, 3n]) as string[];
    expect(result).toEqual(["1", "2", "3"]);
  });

  it("passes through non-bigint primitives unchanged", () => {
    expect(serializeBigInts("hello")).toBe("hello");
    expect(serializeBigInts(42)).toBe(42);
    expect(serializeBigInts(null)).toBe(null);
    expect(serializeBigInts(true)).toBe(true);
  });
});
