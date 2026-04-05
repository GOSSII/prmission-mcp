/**
 * Smoke test — starts the Express server and exercises the MCP protocol
 * without any blockchain calls.
 *
 * Run: npm test
 *
 * For integration tests against a real node, set PRMISSION_NETWORK and
 * PRMISSION_RPC_URL in your environment. The contract_info tool will
 * read from Base mainnet by default.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";

// We can't import the ESM app directly in vitest without extra setup,
// so we test the MCP protocol via HTTP against a running server.
// This smoke test uses fetch() (Node 20+ built-in).

const BASE_URL = "http://localhost:13579";
const MCP_URL = `${BASE_URL}/mcp`;

let server: Server;

// Helper: minimal JSON-RPC 2.0 MCP call
async function mcpCall(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  return res.json() as Promise<{
    jsonrpc: string;
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
  }>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MCP smoke tests", () => {
  describe("tools/list", () => {
    it("returns a list of tools", async () => {
      const res = await mcpCall("tools/list");
      expect(res.error).toBeUndefined();
      const result = res.result as { tools: Array<{ name: string }> };
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);

      const toolNames = result.tools.map((t) => t.name);
      // Read tools should always be present
      expect(toolNames).toContain("prmission_get_contract_info");
      expect(toolNames).toContain("prmission_get_permission");
      expect(toolNames).toContain("prmission_get_escrow");
      expect(toolNames).toContain("prmission_preview_settlement");
      expect(toolNames).toContain("prmission_check_access");
      expect(toolNames).toContain("prmission_get_balance");
      expect(toolNames).toContain("prmission_get_total_protocol_fees");
      expect(toolNames).toContain("prmission_get_treasury");
      expect(toolNames).toContain("prmission_check_agent_trust");
    });
  });

  describe("prmission_get_contract_info", () => {
    it("returns contract info without errors", async () => {
      const res = await mcpCall("tools/call", {
        name: "prmission_get_contract_info",
        arguments: {},
      });
      expect(res.error).toBeUndefined();
      const result = res.result as {
        content: Array<{ type: string; text: string }>;
        structuredContent: {
          network: string;
          chainId: number;
          contractAddress: string;
        };
      };
      expect(result.content[0].type).toBe("text");
      expect(result.structuredContent.network).toMatch(/base/);
      expect(result.structuredContent.chainId).toBeTypeOf("number");
      expect(result.structuredContent.contractAddress).toMatch(/^0x/);
    });
  });

  describe("/healthz", () => {
    it("returns 200 with status ok", async () => {
      const res = await fetch(`${BASE_URL}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    });
  });

  describe("input validation", () => {
    it("returns error for invalid permission ID", async () => {
      const res = await mcpCall("tools/call", {
        name: "prmission_get_permission",
        arguments: { permissionId: "not-a-number" },
      });
      // Should return an error result (isError: true) or JSON-RPC error
      const hasError =
        res.error !== undefined ||
        (res.result as { isError?: boolean })?.isError === true;
      expect(hasError).toBe(true);
    });

    it("returns error for invalid address in check_access", async () => {
      const res = await mcpCall("tools/call", {
        name: "prmission_check_access",
        arguments: { permissionId: "1", agentAddress: "not-an-address" },
      });
      const hasError =
        res.error !== undefined ||
        (res.result as { isError?: boolean })?.isError === true;
      expect(hasError).toBe(true);
    });
  });
});
