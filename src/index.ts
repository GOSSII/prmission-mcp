import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

// ─── MCP Server Factory ───────────────────────────────────────────────────────

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

if (config.writeEnabled) {
  console.log("[prmission-mcp] Write tools enabled (agent wallet connected).");
} else {
  console.log("[prmission-mcp] Read-only mode (no AGENT_PRIVATE_KEY set).");
}

// ─── OAuth 2.0 + PKCE (required by Claude.ai MCP connector) ──────────────────
// In-memory short-lived code store (codes expire in 5 minutes).

interface AuthCode {
  challenge: string;
  method: string;
  redirectUri: string;
  expiry: number;
}
const authCodes = new Map<string, AuthCode>();

// Clean up expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes) {
    if (data.expiry < now) authCodes.delete(code);
  }
}, 60_000);

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── OAuth discovery ───────────────────────────────────────────────────────────
app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
  const base = config.publicUrl;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

// ── OAuth authorize ───────────────────────────────────────────────────────────
app.get("/authorize", (req: Request, res: Response) => {
  const { redirect_uri, code_challenge, code_challenge_method, state } = req.query as Record<string, string>;

  if (!redirect_uri || !code_challenge) {
    res.status(400).send("Missing required OAuth parameters.");
    return;
  }

  // Generate a one-time code and store it with the PKCE challenge
  const code = crypto.randomBytes(32).toString("hex");
  authCodes.set(code, {
    challenge: code_challenge,
    method: code_challenge_method ?? "S256",
    redirectUri: redirect_uri,
    expiry: Date.now() + 5 * 60 * 1000,
  });

  const callback = new URL(redirect_uri);
  callback.searchParams.set("code", code);
  if (state) callback.searchParams.set("state", state);

  res.redirect(callback.toString());
});

// ── OAuth token ───────────────────────────────────────────────────────────────
app.post("/token", (req: Request, res: Response) => {
  const { code, code_verifier } = req.body as Record<string, string>;

  if (!code || !code_verifier) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing code or code_verifier." });
    return;
  }

  const stored = authCodes.get(code);
  if (!stored || stored.expiry < Date.now()) {
    res.status(400).json({ error: "invalid_grant", error_description: "Code expired or not found." });
    return;
  }

  // Verify PKCE S256: BASE64URL(SHA256(code_verifier)) must equal code_challenge
  const digest = crypto.createHash("sha256").update(code_verifier).digest("base64url");
  if (digest !== stored.challenge) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed." });
    return;
  }

  authCodes.delete(code);

  // The access token IS the MCP bearer token (or a placeholder if auth is disabled)
  res.json({
    access_token: config.mcpAuthToken ?? "open",
    token_type: "Bearer",
    expires_in: 86400,
  });
});

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
async function handleMcp(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

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
    console.log("[prmission-mcp] Auth: OAuth 2.0 + PKCE enabled.");
  }
});

export { app };
