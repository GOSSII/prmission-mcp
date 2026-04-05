/**
 * Smoke test — starts the Express server in-process and exercises the
 * MCP protocol without any blockchain calls.
 *
 * Run: npm test (excluded from default vitest run; use `vitest run tests/smoke.test.ts`)
 *
 * The server binds to a random port to avoid conflicts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerReadTools } from "../src/tools/read.js";

// ─── Minimal test server (read-only, no blockchain) ──────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", network: "base-mainnet", writeEnabled: false });
  });

  app.post("/mcp", async (req, res) => {
    const server = new McpServer({ name: "prmission-mcp-test", version: "1.0.0" });
    registerReadTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("finish", () => { server.close().catch(() => {}); });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function mcpPost(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  // Streamable HTTP may return SSE or JSON — read as text and parse first JSON object
  const text = await res.text();
  const firstLine = text.split("\n").find((l) => l.startsWith("{") || l.startsWith("data:"));
  const jsonStr = firstLine?.startsWith("data:") ? firstLine.slice(5).trim() : firstLine ?? "{}";
  return JSON.parse(jsonStr) as {
    jsonrpc: string;
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("smoke: /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("smoke: tools/list", () => {
  it("returns all 9 read tools", async () => {
    const res = await mcpPost("tools/list");
    expect(res.error).toBeUndefined();
    const result = res.result as { tools: Array<{ name: string }> };
    expect(Array.isArray(result.tools)).toBe(true);
    const names = result.tools.map((t) => t.name);
    const expected = [
      "prmission_get_contract_info",
      "prmission_get_permission",
      "prmission_get_escrow",
      "prmission_preview_settlement",
      "prmission_check_access",
      "prmission_get_balance",
      "prmission_get_total_protocol_fees",
      "prmission_get_treasury",
      "prmission_check_agent_trust",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});

describe("smoke: prmission_get_contract_info", () => {
  it("returns structured contract info", async () => {
    const res = await mcpPost("tools/call", {
      name: "prmission_get_contract_info",
      arguments: {},
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
      structuredContent: { network: string; contractAddress: string };
    };
    expect(result.content[0].type).toBe("text");
    expect(result.structuredContent.network).toMatch(/base/);
    expect(result.structuredContent.contractAddress).toMatch(/^0x/);
  });
});

describe("smoke: input validation", () => {
  it("returns isError for invalid permission ID", async () => {
    const res = await mcpPost("tools/call", {
      name: "prmission_get_permission",
      arguments: { permissionId: "not-a-number" },
    });
    const hasError =
      res.error !== undefined ||
      (res.result as { isError?: boolean })?.isError === true;
    expect(hasError).toBe(true);
  });

  it("returns isError for invalid address in check_access", async () => {
    const res = await mcpPost("tools/call", {
      name: "prmission_check_access",
      arguments: { permissionId: "1", agentAddress: "not-an-address" },
    });
    const hasError =
      res.error !== undefined ||
      (res.result as { isError?: boolean })?.isError === true;
    expect(hasError).toBe(true);
  });
});
