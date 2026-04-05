import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getReadClient,
  getWriteClient,
  enqueueWrite,
  parseId,
  parseUsdc,
  formatUsdc,
  serializeBigInts,
} from "../prmission.js";
import { EscrowStatus } from "prmission-sdk";
import type { PrmissionError } from "prmission-sdk";

// ─── Tool Registration ────────────────────────────────────────────────────────
// These tools are only registered when AGENT_PRIVATE_KEY is configured.
// All writes go through enqueueWrite() to serialize transactions and
// prevent nonce collisions.

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

export function registerWriteTools(server: McpServer): void {
  // ── prmission_ensure_allowance ────────────────────────────────────────────
  server.tool(
    "prmission_ensure_allowance",
    "Approve the Prmission contract to spend USDC on behalf of the agent wallet. Safe to call before deposits — does nothing if the allowance is already sufficient.",
    {
      amountUsdc: z.string().describe("USDC amount to approve (e.g. '10.00')"),
    },
    { destructiveHint: false },
    async ({ amountUsdc }) => {
      const amount = parseUsdc(amountUsdc);
      const result = await enqueueWrite(() => getWriteClient().ensureAllowance(amount));
      if (!result.ok) return errorResponse(result.error);

      const text = result.value
        ? `Allowance approved: ${amountUsdc} USDC`
        : `Allowance already sufficient for ${amountUsdc} USDC — no transaction needed.`;

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { approved: result.value, amountUsdc },
      };
    }
  );

  // ── prmission_deposit_escrow ──────────────────────────────────────────────
  server.tool(
    "prmission_deposit_escrow",
    "Deposit USDC into escrow to access user data under a given permission. Automatically handles USDC approval. Returns the new escrow ID and transaction hash.",
    {
      permissionId: z.string().describe("The permission ID to escrow funds under"),
      amountUsdc: z.string().describe("USDC amount to lock in escrow (e.g. '1.00')"),
      agentId: z.string().optional().describe("ERC-8004 agent token ID (use '0' or omit if identity not enforced)"),
    },
    { destructiveHint: true },
    async ({ permissionId, amountUsdc, agentId }) => {
      const pid = parseId(permissionId);
      const amount = parseUsdc(amountUsdc);
      const aid = agentId ? parseId(agentId) : 0n;

      const result = await enqueueWrite(() =>
        getWriteClient().depositEscrow(pid, amount, aid)
      );
      if (!result.ok) return errorResponse(result.error);
      const escrowId = result.value;

      const text = [
        `Escrow deposited successfully.`,
        `  Escrow ID:    #${escrowId}`,
        `  Permission:   #${pid}`,
        `  Amount:       ${amountUsdc} USDC`,
        ``,
        `Use prmission_report_outcome to report results, then prmission_settle after the 24h dispute window.`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: serializeBigInts({
          escrowId: escrowId.toString(),
          permissionId: pid.toString(),
          amountUsdc,
        }),
      };
    }
  );

  // ── prmission_report_outcome ──────────────────────────────────────────────
  server.tool(
    "prmission_report_outcome",
    "Report the outcome of a data access session. Starts the 24-hour dispute window. The outcome value must not exceed the escrowed amount.",
    {
      escrowId: z.string().describe("The escrow ID to report on"),
      outcomeValueUsdc: z.string().describe("Value generated (USDC), e.g. '0.50'. Cannot exceed escrowed amount."),
      outcomeType: z.string().describe("Short outcome category, e.g. 'purchase', 'click', 'signup'"),
      outcomeDescription: z.string().describe("Human-readable description of the outcome"),
    },
    { destructiveHint: true },
    async ({ escrowId, outcomeValueUsdc, outcomeType, outcomeDescription }) => {
      const eid = parseId(escrowId);
      const outcomeValue = parseUsdc(outcomeValueUsdc);

      const result = await enqueueWrite(() =>
        getWriteClient().reportOutcome({
          escrowId: eid,
          outcomeValue,
          outcomeType,
          outcomeDescription,
        })
      );
      if (!result.ok) return errorResponse(result.error);

      const disputeWindowEnd = new Date(Date.now() + 86_400_000).toISOString();

      const text = [
        `Outcome reported for Escrow #${eid}.`,
        `  Value:         ${outcomeValueUsdc} USDC`,
        `  Type:          ${outcomeType}`,
        `  Description:   ${outcomeDescription}`,
        ``,
        `24-hour dispute window started. Earliest settlement: ~${disputeWindowEnd}`,
        `Use prmission_settle after the window closes.`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          escrowId: eid.toString(),
          outcomeValueUsdc,
          outcomeType,
          outcomeDescription,
          disputeWindowEndApprox: disputeWindowEnd,
        },
      };
    }
  );

  // ── prmission_dispute_settlement ──────────────────────────────────────────
  server.tool(
    "prmission_dispute_settlement",
    "File a dispute against a reported outcome during the 24-hour dispute window. After disputing, the contract owner can resolve with a custom split.",
    {
      escrowId: z.string().describe("The escrow ID to dispute"),
      reason: z.string().describe("Reason for the dispute"),
    },
    { destructiveHint: true },
    async ({ escrowId, reason }) => {
      const eid = parseId(escrowId);
      const result = await enqueueWrite(() => getWriteClient().disputeSettlement(eid, reason));
      if (!result.ok) return errorResponse(result.error);

      const text = [
        `Dispute filed for Escrow #${eid}.`,
        `  Reason: ${reason}`,
        `The contract owner will review and resolve the dispute.`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { escrowId: eid.toString(), reason, disputed: true },
      };
    }
  );

  // ── prmission_settle ──────────────────────────────────────────────────────
  server.tool(
    "prmission_settle",
    "Settle an escrow after the 24-hour dispute window. Distributes USDC to the user (their compensation %), the protocol (3% fee), and returns the remainder to the agent. Will refuse early settlement with a 'not yet' response including the exact time remaining.",
    {
      escrowId: z.string().describe("The escrow ID to settle"),
    },
    { destructiveHint: true },
    async ({ escrowId }) => {
      const eid = parseId(escrowId);

      // Guard: check settlement eligibility before sending any tx
      const escrowResult = await getReadClient().getEscrow(eid);
      if (!escrowResult.ok) return errorResponse(escrowResult.error);
      const escrow = escrowResult.value;

      if (escrow.status === EscrowStatus.SETTLED) {
        return {
          content: [{ type: "text" as const, text: `Escrow #${eid} is already settled.` }],
          structuredContent: { escrowId: eid.toString(), alreadySettled: true } as Record<string, unknown>,
        };
      }

      if (!escrow.isSettleable) {
        const nowSec = Math.floor(Date.now() / 1000);
        const endSec = Number(escrow.disputeWindowEnd);
        const secondsRemaining = Math.max(0, endSec - nowSec);
        const hoursRemaining = (secondsRemaining / 3600).toFixed(1);
        const endsAt = new Date(endSec * 1000).toISOString();

        const text = [
          `Cannot settle Escrow #${eid} yet — dispute window is still open.`,
          `  Status:              ${escrowStatusLabel(escrow.status)}`,
          `  Dispute window ends: ${endsAt}`,
          `  Time remaining:      ~${hoursRemaining} hours (${secondsRemaining} seconds)`,
          ``,
          `Try again after the dispute window closes.`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            escrowId: eid.toString(),
            settleable: false,
            disputeWindowEnd: endsAt,
            disputeWindowEndUnix: endSec,
            secondsRemaining,
            currentTimeUnix: nowSec,
          } as Record<string, unknown>,
          isError: true,
        };
      }

      // Preview before settling so we can show the breakdown
      const previewResult = await getReadClient().previewSettlement(eid);
      if (!previewResult.ok) return errorResponse(previewResult.error);
      const preview = previewResult.value;

      const settleResult = await enqueueWrite(() => getWriteClient().settle(eid));
      if (!settleResult.ok) return errorResponse(settleResult.error);

      const text = [
        `Escrow #${eid} settled successfully.`,
        `  User received:    ${preview.formatted.userShare} USDC`,
        `  Protocol fee:     ${preview.formatted.protocolFee} USDC (3%)`,
        `  Agent refund:     ${preview.formatted.agentRefund} USDC`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: serializeBigInts({
          escrowId: eid.toString(),
          settled: true,
          userShare: preview.formatted.userShare,
          protocolFee: preview.formatted.protocolFee,
          agentRefund: preview.formatted.agentRefund,
        }),
      };
    }
  );

  // ── prmission_refund_escrow ───────────────────────────────────────────────
  server.tool(
    "prmission_refund_escrow",
    "Refund an escrow back to the agent. Only valid when the underlying permission has been revoked (and the 60-second grace period has passed).",
    {
      escrowId: z.string().describe("The escrow ID to refund"),
    },
    { destructiveHint: true },
    async ({ escrowId }) => {
      const eid = parseId(escrowId);
      const result = await enqueueWrite(() => getWriteClient().refundEscrow(eid));
      if (!result.ok) return errorResponse(result.error);

      const text = `Escrow #${eid} refunded to agent wallet.`;

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { escrowId: eid.toString(), refunded: true },
      };
    }
  );
}

// ─── Internal helper (used by prmission_settle) ───────────────────────────────

function escrowStatusLabel(s: EscrowStatus): string {
  return ["NONE", "FUNDED", "OUTCOME_REPORTED", "DISPUTED", "SETTLED", "REFUNDED"][s] ?? String(s);
}
