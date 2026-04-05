import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "prmission-mcp",
    version: "1.0.0",
  });

  registerReadTools(server);

  if (config.writeEnabled) {
    registerWriteTools(server);
    console.log("[prmission-mcp] Write tools enabled (agent wallet connected).");
  } else {
    console.log("[prmission-mcp] Read-only mode (no AGENT_PRIVATE_KEY set).");
  }

  return server;
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────────
// Applied only to /mcp routes when MCP_AUTH_TOKEN is configured.
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcpAuthToken) {
    next();
    return;
  }
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization: Bearer <token> header." });
    return;
  }
  const token = authHeader.slice(7);
  if (token !== config.mcpAuthToken) {
    res.status(403).json({ error: "Invalid token." });
    return;
  }
  next();
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    network: config.network,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    writeEnabled: config.writeEnabled,
    timestamp: new Date().toISOString(),
  });
});

// ── MCP endpoint (Streamable HTTP) ────────────────────────────────────────────
// We use stateless mode (sessionIdGenerator: undefined) — each POST request
// gets a fresh transport. This is the recommended pattern for remote MCP servers
// that don't need server-initiated pushes.

const mcpServer = createMcpServer();

app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] POST error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// GET /mcp — used by SSE-capable clients and for the MCP handshake
app.get("/mcp", authMiddleware, async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[mcp] GET error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// DELETE /mcp — session teardown (no-op in stateless mode, but required by spec)
app.delete("/mcp", authMiddleware, async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[mcp] DELETE error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, config.host, () => {
  console.log(`[prmission-mcp] Server running on http://${config.host}:${config.port}`);
  console.log(`[prmission-mcp] MCP endpoint: http://${config.host}:${config.port}/mcp`);
  console.log(`[prmission-mcp] Health check: http://${config.host}:${config.port}/healthz`);
  console.log(`[prmission-mcp] Network: ${config.network} | Contract: ${config.contractAddress}`);
  if (config.mcpAuthToken) {
    console.log("[prmission-mcp] Auth: Bearer token required.");
  }
});

export { app };
