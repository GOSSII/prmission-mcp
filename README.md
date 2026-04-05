# Prmission MCP Server

A remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes the [Prmission Protocol](https://github.com/GOSSII/Prmission-Protocol) as AI-callable tools — so Claude (and any MCP client) can read permissions, check escrow state, and optionally submit on-chain USDC transactions on Base.

**Live contract:** [`0x0c8B16a57524f4009581B748356E01e1a969223d`](https://basescan.org/address/0x0c8B16a57524f4009581B748356E01e1a969223d) on Base mainnet.

---

## What is MCP?

Model Context Protocol is an open standard that lets AI assistants call external tools over HTTP. This server implements **Streamable HTTP** transport — Claude connects to a single `/mcp` endpoint and can call any of the Prmission tools below.

## What does this server do?

Prmission is a consent-gated data exchange protocol: users grant AI agents permission to access their data, agents lock USDC in escrow, report an outcome, and the protocol distributes payment after a 24-hour dispute window.

This MCP server makes all of that accessible to Claude:

| Mode | What's available |
|---|---|
| **Read-only** (default) | Inspect permissions, escrows, balances, settlement previews |
| **Write** (set `AGENT_PRIVATE_KEY`) | Approve USDC, deposit escrow, report outcomes, dispute, settle, refund |

---

## Quick Start (local)

```bash
# 1. Clone
git clone https://github.com/marcosbenaim-hub/prmission-mcp.git
cd prmission-mcp

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — the defaults work for Base mainnet read-only mode

# 4. Start dev server
npm run dev
```

The server starts at `http://localhost:3000`.

```bash
# Verify it's running
curl http://localhost:3000/healthz

# List all MCP tools
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq .

# Call a read tool
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"prmission_get_contract_info","arguments":{}}}' | jq .
```

---

## Connecting in Claude Pro

1. Open Claude at [claude.ai](https://claude.ai)
2. Go to **Settings → Connectors**
3. Click **Add custom connector**
4. Paste your MCP URL: `https://prmission-mcp.onrender.com/mcp`
   - If you set `MCP_AUTH_TOKEN`, add it as a Bearer token header
5. Click **Connect** — Claude will discover all tools automatically
6. In any Claude chat, click **"+"** → enable the Prmission connector

Claude can now answer questions like:
- *"Check permission #42 on Prmission"*
- *"What's the USDC balance of 0x...?"*
- *"Preview the settlement for escrow #7"*

---

## Tools Reference

### Read-only tools

| Tool | Description |
|---|---|
| `prmission_get_contract_info` | Network, chain ID, contract address, write mode status |
| `prmission_get_permission` | Full permission details (user, category, compensation, expiry) |
| `prmission_get_escrow` | Escrow details (amount, outcome, dispute window, settleable flag) |
| `prmission_preview_settlement` | Calculate user share / protocol fee / agent refund before settling |
| `prmission_check_access` | Check if an agent address has access under a permission |
| `prmission_get_balance` | USDC balance of any address on Base |
| `prmission_get_total_protocol_fees` | Lifetime fees collected by the protocol |
| `prmission_get_treasury` | Treasury address |
| `prmission_check_agent_trust` | ERC-8004 trust profile (registered, authorized, reputable, score) |

### Write tools (requires `AGENT_PRIVATE_KEY`)

| Tool | Description |
|---|---|
| `prmission_ensure_allowance` | Approve USDC spend (safe to call before deposits) |
| `prmission_deposit_escrow` | Lock USDC in escrow under a permission |
| `prmission_report_outcome` | Report value generated, starts 24h dispute window |
| `prmission_dispute_settlement` | File a dispute during the dispute window |
| `prmission_settle` | Settle after dispute window — **refuses early with exact time remaining** |
| `prmission_refund_escrow` | Refund escrow on revoked permissions |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (Render uses `10000`) |
| `HOST` | `0.0.0.0` | Bind address |
| `PRMISSION_NETWORK` | `base-mainnet` | `base-mainnet` or `base-sepolia` |
| `PRMISSION_RPC_URL` | `https://mainnet.base.org` | Override RPC endpoint |
| `PRMISSION_CONTRACT_ADDRESS` | mainnet address | Override contract address |
| `AGENT_PRIVATE_KEY` | _(unset)_ | Enables write tools; uses this wallet to sign txs |
| `MCP_AUTH_TOKEN` | _(unset)_ | Requires `Authorization: Bearer <token>` on all `/mcp` calls |

---

## Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo (`prmission-mcp`)
4. Render auto-detects `render.yaml` — click **Deploy**
5. In the **Environment** tab, add secrets:
   - `AGENT_PRIVATE_KEY` (if you want write tools)
   - `MCP_AUTH_TOKEN` (recommended — protects the endpoint)
6. Your live URL will be: `https://prmission-mcp.onrender.com/mcp`

> **Note:** The free Render tier sleeps after 15 minutes of inactivity. Upgrade to Starter ($7/mo) for always-on service.

## Deploy with Docker

```bash
# Build
docker build -t prmission-mcp .

# Run
docker run -p 3000:3000 \
  -e PRMISSION_NETWORK=base-mainnet \
  -e MCP_AUTH_TOKEN=my-secret-token \
  prmission-mcp
```

---

## Security

- **Never commit `AGENT_PRIVATE_KEY`** to git. Use environment variables or a secrets manager.
- **Keep agent wallet balance low** — only fund it with what you need for current operations.
- **Always set `MCP_AUTH_TOKEN`** when deploying publicly. Without it, anyone can call your endpoint.
- **Private keys are never accepted as tool inputs** — the server only uses the key configured at startup.
- All write transactions are serialized through a single queue — no nonce collisions.

---

## Known Limitations

- **Settlement cannot happen before the 24-hour dispute window ends.** `prmission_settle` will return a structured "not ready" response with the exact time remaining. This is by design in the Prmission Protocol.
- The free Render tier may have cold-start latency (~30s). Use the paid tier for production.
- Write tools use a single shared agent wallet — not suitable for multi-user scenarios without additional auth logic.

---

## Development

```bash
npm run dev       # Start with hot-reload (tsx watch)
npm run build     # Compile TypeScript to dist/
npm run start     # Run compiled server
npm test          # Run unit tests (validation + parsing)
```

---

## Architecture

```
src/
├── index.ts        Express server + MCP Streamable HTTP transport
├── config.ts       Env var parsing with typed defaults
├── prmission.ts    SDK client factory + nonce-safe write queue
└── tools/
    ├── read.ts     9 read-only MCP tools
    └── write.ts    6 write MCP tools (agent wallet)
```

Transport: **Streamable HTTP** (stateless mode) — each POST to `/mcp` gets a fresh transport. Compatible with Claude Pro custom connectors.

---

## License

Apache-2.0 — see [LICENSE](./LICENSE) for details.

Built on top of the [Prmission SDK](https://github.com/GOSSII/prmission-ts-sdk) and [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
