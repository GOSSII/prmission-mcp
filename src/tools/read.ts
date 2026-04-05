import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import {
  getReadClient,
  parseId,
  parseAddress,
  formatUsdc,
  serializeBigInts,
} from "../prmission.js";
import { PermissionStatus, EscrowStatus } from "prmission-sdk";
import type { PrmissionError } from "prmission-sdk";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function permissionStatusLabel(s: PermissionStatus): string {
  return ["INACTIVE", "ACTIVE", "REVOKED", "EXPIRED"][s] ?? String(s);
}

function escrowStatusLabel(s: EscrowStatus): string {
  return ["NONE", "FUNDED", "OUTCOME_REPORTED", "DISPUTED", "SETTLED", "REFUNDED"][s] ?? String(s);
}

function formatTs(ts: bigint): string {
  if (ts === 0n) return "N/A";
  return new Date(Number(ts) * 1000).toISOString();
}

function errorResponse(error: PrmissionError) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error [${error.code}]: ${error.message}`,
      },
    ],
    structuredContent: {
      error: error.code,
      message: error.message,
    } as Record<string, unknown>,
    isError: true,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerReadTools(server: McpServer): void {
  // ── prmission_get_contract_info ──────────────────────────────────────────
  server.tool(
    "prmission_get_contract_info",
    "Returns the current network configuration: contract address, chain ID, RPC URL, USDC address, and whether write tools are enabled.",
    {},
    { readOnlyHint: true },
    async () => {
      const data = {
        network: config.network,
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        rpcUrl: config.rpcUrl,
        usdcAddress: config.usdcAddress,
        basescanBase: config.basescanBase,
        writeEnabled: config.writeEnabled,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Network:   ${data.network} (chainId ${data.chainId})`,
              `Contract:  ${data.contractAddress}`,
              `RPC:       ${data.rpcUrl}`,
              `USDC:      ${data.usdcAddress}`,
              `BaseScan:  ${data.basescanBase}`,
              `Write:     ${data.writeEnabled ? "ENABLED (agent wallet connected)" : "DISABLED (read-only mode)"}`,
            ].join("\n"),
          },
        ],
        structuredContent: data as unknown as Record<string, unknown>,
      };
    }
  );

  // ── prmission_get_permission ─────────────────────────────────────────────
  server.tool(
    "prmission_get_permission",
    "Fetch full details for a Prmission permission by its ID. Returns the user address, data category, purpose, compensation rate, expiry, and current status.",
    { permissionId: z.string().describe("The numeric permission ID (e.g. '1')") },
    { readOnlyHint: true },
    async ({ permissionId }) => {
      const id = parseId(permissionId);
      const client = getReadClient();
      const result = await client.getPermission(id);
      if (!result.ok) return errorResponse(result.error);
      const p = result.value;

      const structured = serializeBigInts({
        permissionId: p.permissionId.toString(),
        user: p.user,
        merchant: p.merchant,
        dataCategory: p.dataCategory,
        purpose: p.purpose,
        compensationBps: Number(p.compensationBps),
        compensationPercent: `${(Number(p.compensationBps) / 100).toFixed(2)}%`,
        upfrontFee: formatUsdc(p.upfrontFee),
        validUntil: formatTs(p.validUntil),
        status: permissionStatusLabel(p.status),
        isActive: p.isActive,
        isExpired: p.isExpired,
        expiresInSeconds: p.expiresIn,
        createdAt: formatTs(p.createdAt),
      });

      const text = [
        `Permission #${id}`,
        `  Status:       ${permissionStatusLabel(p.status)}${p.isActive ? " ✓" : ""}`,
        `  User:         ${p.user}`,
        `  Merchant:     ${p.merchant}`,
        `  Category:     ${p.dataCategory}`,
        `  Purpose:      ${p.purpose}`,
        `  Compensation: ${(Number(p.compensationBps) / 100).toFixed(2)}%`,
        `  Upfront fee:  ${formatUsdc(p.upfrontFee)} USDC`,
        `  Expires:      ${formatTs(p.validUntil)}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: structured,
      };
    }
  );

  // ── prmission_get_escrow ─────────────────────────────────────────────────
  server.tool(
    "prmission_get_escrow",
    "Fetch escrow details by escrow ID. Shows the locked USDC amount, outcome details, dispute window, and whether the escrow is currently settleable.",
    { escrowId: z.string().describe("The numeric escrow ID (e.g. '1')") },
    { readOnlyHint: true },
    async ({ escrowId }) => {
      const id = parseId(escrowId);
      const client = getReadClient();
      const result = await client.getEscrow(id);
      if (!result.ok) return errorResponse(result.error);
      const e = result.value;

      const structured = serializeBigInts({
        escrowId: e.escrowId.toString(),
        permissionId: e.permissionId.toString(),
        agent: e.agent,
        agentId: e.agentId.toString(),
        amount: formatUsdc(e.amount),
        outcomeValue: formatUsdc(e.outcomeValue),
        outcomeType: e.outcomeType,
        outcomeDescription: e.outcomeDescription,
        reportedAt: formatTs(e.reportedAt),
        status: escrowStatusLabel(e.status),
        disputeWindowEnd: formatTs(e.disputeWindowEnd),
        isDisputable: e.isDisputable,
        isSettleable: e.isSettleable,
        createdAt: formatTs(e.createdAt),
      });

      const text = [
        `Escrow #${id}`,
        `  Status:         ${escrowStatusLabel(e.status)}`,
        `  Permission:     #${e.permissionId}`,
        `  Agent:          ${e.agent}`,
        `  Amount:         ${formatUsdc(e.amount)} USDC`,
        `  Outcome value:  ${formatUsdc(e.outcomeValue)} USDC`,
        `  Outcome type:   ${e.outcomeType || "not reported yet"}`,
        `  Reported at:    ${formatTs(e.reportedAt)}`,
        `  Dispute ends:   ${formatTs(e.disputeWindowEnd)}`,
        `  Disputable:     ${e.isDisputable}`,
        `  Settleable:     ${e.isSettleable}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: structured,
      };
    }
  );

  // ── prmission_preview_settlement ─────────────────────────────────────────
  server.tool(
    "prmission_preview_settlement",
    "Preview how USDC will be distributed when an escrow is settled: user share, protocol fee (3%), and agent refund. Does not submit any transaction.",
    { escrowId: z.string().describe("The numeric escrow ID") },
    { readOnlyHint: true },
    async ({ escrowId }) => {
      const id = parseId(escrowId);
      const client = getReadClient();
      const result = await client.previewSettlement(id);
      if (!result.ok) return errorResponse(result.error);
      const preview = result.value;

      const structured = serializeBigInts({
        escrowId: id.toString(),
        userShare: preview.formatted.userShare,
        protocolFee: preview.formatted.protocolFee,
        agentRefund: preview.formatted.agentRefund,
        disputeWindowEnd: formatTs(preview.disputeWindowEnd),
      });

      const text = [
        `Settlement Preview for Escrow #${id}`,
        `  User share:    ${preview.formatted.userShare} USDC`,
        `  Protocol fee:  ${preview.formatted.protocolFee} USDC (3%)`,
        `  Agent refund:  ${preview.formatted.agentRefund} USDC`,
        `  Dispute ends:  ${formatTs(preview.disputeWindowEnd)}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: structured,
      };
    }
  );

  // ── prmission_check_access ───────────────────────────────────────────────
  server.tool(
    "prmission_check_access",
    "Check whether a specific agent address has access under a given permission ID. Returns permitted flag, compensation rate, upfront fee, and expiry.",
    {
      permissionId: z.string().describe("The numeric permission ID"),
      agentAddress: z.string().describe("The agent's Ethereum address"),
    },
    { readOnlyHint: true },
    async ({ permissionId, agentAddress }) => {
      const id = parseId(permissionId);
      const addr = parseAddress(agentAddress);
      const client = getReadClient();
      const result = await client.checkAccess(id, addr);
      if (!result.ok) return errorResponse(result.error);
      const access = result.value;

      const structured = serializeBigInts({
        permissionId: id.toString(),
        agentAddress: addr,
        permitted: access.permitted,
        compensationBps: Number(access.compensationBps),
        compensationPercent: `${(Number(access.compensationBps) / 100).toFixed(2)}%`,
        upfrontFee: formatUsdc(access.upfrontFee),
        validUntil: formatTs(access.validUntil),
      });

      const text = [
        `Access Check — Permission #${id} / Agent ${addr}`,
        `  Permitted:    ${access.permitted ? "YES" : "NO"}`,
        `  Compensation: ${(Number(access.compensationBps) / 100).toFixed(2)}%`,
        `  Upfront fee:  ${formatUsdc(access.upfrontFee)} USDC`,
        `  Valid until:  ${formatTs(access.validUntil)}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: structured,
      };
    }
  );

  // ── prmission_get_balance ────────────────────────────────────────────────
  server.tool(
    "prmission_get_balance",
    "Get the USDC balance of any Ethereum address on Base.",
    { address: z.string().describe("Ethereum address to check") },
    { readOnlyHint: true },
    async ({ address }) => {
      const addr = parseAddress(address);
      const client = getReadClient();
      const result = await client.getBalance(addr);
      if (!result.ok) return errorResponse(result.error);
      const formatted = formatUsdc(result.value);

      return {
        content: [{ type: "text" as const, text: `USDC balance of ${addr}: ${formatted} USDC` }],
        structuredContent: {
          address: addr,
          balanceUsdc: formatted,
          balanceRaw: result.value.toString(),
        },
      };
    }
  );

  // ── prmission_get_total_protocol_fees ────────────────────────────────────
  server.tool(
    "prmission_get_total_protocol_fees",
    "Returns the total lifetime protocol fees collected by the Prmission contract (in USDC).",
    {},
    { readOnlyHint: true },
    async () => {
      const client = getReadClient();
      const result = await client.getTotalProtocolFees();
      if (!result.ok) return errorResponse(result.error);
      const fees = result.value;

      return {
        content: [{ type: "text" as const, text: `Total protocol fees collected: ${fees.formatted} USDC` }],
        structuredContent: { totalFeesUsdc: fees.formatted, totalFeesRaw: fees.raw.toString() },
      };
    }
  );

  // ── prmission_get_treasury ───────────────────────────────────────────────
  server.tool(
    "prmission_get_treasury",
    "Returns the treasury address that receives protocol fees.",
    {},
    { readOnlyHint: true },
    async () => {
      const client = getReadClient();
      const result = await client.getTreasury();
      if (!result.ok) return errorResponse(result.error);

      return {
        content: [{ type: "text" as const, text: `Treasury address: ${result.value}` }],
        structuredContent: { treasury: result.value },
      };
    }
  );

  // ── prmission_check_agent_trust ──────────────────────────────────────────
  server.tool(
    "prmission_check_agent_trust",
    "Check an agent's ERC-8004 trust profile: whether they are registered, authorized, and reputable. Returns reputation score and review count.",
    {
      agentId: z.string().describe("The ERC-8004 agent token ID (e.g. '1')"),
      agentAddress: z.string().describe("The agent's Ethereum address"),
    },
    { readOnlyHint: true },
    async ({ agentId, agentAddress }) => {
      const id = parseId(agentId);
      const addr = parseAddress(agentAddress);
      const client = getReadClient();
      const result = await client.checkAgentTrust(id, addr);
      if (!result.ok) return errorResponse(result.error);
      const trust = result.value;

      const structured = serializeBigInts({
        agentId: id.toString(),
        agentAddress: addr,
        registered: trust.registered,
        authorized: trust.authorized,
        reputable: trust.reputable,
        repScore: trust.repScore.toString(),
        repCount: trust.repCount.toString(),
      });

      const text = [
        `Agent Trust Profile — ID #${id} / ${addr}`,
        `  Registered:  ${trust.registered}`,
        `  Authorized:  ${trust.authorized}`,
        `  Reputable:   ${trust.reputable}`,
        `  Rep score:   ${trust.repScore}`,
        `  Reviews:     ${trust.repCount}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: structured,
      };
    }
  );
}
