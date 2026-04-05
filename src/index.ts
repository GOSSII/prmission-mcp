import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

// ─── MCP Server Factory ───────────────────────────────────────────────────────
// In stateless Streamable HTTP mode each request gets its own McpServer +
// transport pair. McpServer does not support being connected to multiple
// transports simultaneously, so we create a fresh one per request.

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "prmission-mcp",
    version: "1.0.0",
  });

  registerReadTools(server);

  if (config.writeEnabled) {
    registerWriteTools(server);
  }

  return server;
}

// Log mode once at startup
if (config.writeEnabled) {
  console.log("[prmission-mcp] Write tools enabled (agent wallet connected).");
} else {
  console.log("[prmission-mcp] Read-only mode (no AGENT_PRIVATE_KEY set).");
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────────
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
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    network: config.network,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    writeEnabled: config.writeEnabled,
    timestamp: new Date().toISOString(),
  });
});

// ── MCP endpoint (Streamable HTTP, stateless) ─────────────────────────────────
// Each request: new McpServer + new transport → connect → handle → close.
// This is the correct pattern for stateless remote MCP servers.

async function handleMcp(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session IDs
  });

  // Clean up when the response finishes
  res.on("finish", () => {
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

app.post("/mcp", authMiddleware, handleMcp);
app.get("/mcp", authMiddleware, handleMcp);
app.delete("/mcp", authMiddleware, handleMcp);

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
