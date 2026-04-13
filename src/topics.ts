/**
 * receiptkit — Topic Builders
 *
 * Single source of truth for all MQTT topic strings.
 * All topics are org-scoped: `receiptkit/org/{orgId}/...`
 *
 * Topics are split by direction:
 *   - `to-bridge/` — messages FROM the client/server TO the bridge
 *   - `to-client/` — messages FROM the bridge TO the client/dashboard
 *
 * This makes wildcard subscriptions clean:
 *   - Bridge subscribes to: `to-bridge/{bridgeId}/+` and `to-bridge/broadcast/+`
 *   - Client subscribes to: `to-client/+/+`
 *
 * Public topics are available from the main package export.
 * Internal topics (template sync, bridge management) are available
 * from "receiptkit/internal".
 */

import type { ReceiptKitConfig } from "./types";

// ─── Public Topics ──────────────────────────────────────────────────────

function buildPublicTopics(orgId: string) {
  return {
    // ── to-bridge (client/server → bridge) ────────────────────────────

    /** Send a print job to a bridge (printerMac in payload). */
    print: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/print`,

    /** Poll a specific bridge for status (with optional live ASB). */
    bridgeStatusPoll: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/status-poll`,

    /** Broadcast discover to all bridges. */
    bridgeDiscover: () =>
      `receiptkit/org/${orgId}/to-bridge/broadcast/discover`,

    // ── to-client (bridge → client/dashboard) ─────────────────────────

    /** Bridge status response (printers, stats). */
    bridgeStatus: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-client/${bridgeId}/status`,

    /** Print job result from a bridge. */
    bridgePrintResult: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-client/${bridgeId}/print-result`,

    /** Bridge presence (LWT birth/death). Retained. */
    bridgePresence: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-client/${bridgeId}/presence`,

    // ── Wildcard subscriptions ────────────────────────────────────────

    /** Wildcard: all to-client messages (status, print-result, presence). */
    allToClient: () =>
      `receiptkit/org/${orgId}/to-client/+/+`,

    /** Wildcard: all bridge status responses. */
    allBridgeStatus: () =>
      `receiptkit/org/${orgId}/to-client/+/status`,

    /** Wildcard: all print results. */
    allBridgePrintResults: () =>
      `receiptkit/org/${orgId}/to-client/+/print-result`,

    /** Wildcard: all bridge presence messages (LWT). */
    allBridgePresence: () =>
      `receiptkit/org/${orgId}/to-client/+/presence`,
  };
}

// ─── Internal Topics ────────────────────────────────────────────────────
// These are used by the dashboard and bridge app for management operations.
// Not exposed to external consumers.

function buildInternalTopics(orgId: string) {
  return {
    /** Sync template to a specific bridge. */
    bridgeSyncTemplate: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/sync-template`,

    /** Broadcast template sync to all bridges in the org. */
    broadcastSyncTemplate: () =>
      `receiptkit/org/${orgId}/to-bridge/broadcast/sync-template`,

    /** Push a name update to a specific bridge. */
    bridgeUpdateName: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/update-name`,

    /** Push a printer rename to a specific bridge. */
    bridgeRenamePrinter: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/rename-printer`,

    /** Push a printer delete to a specific bridge. */
    bridgeDeletePrinter: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/delete-printer`,

    /** Push a printer unlink to a specific bridge. */
    bridgeUnlinkPrinter: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/unlink-printer`,

    /** Trigger a binary update on a specific bridge. */
    bridgeUpdateBinary: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/update-binary`,

    /** Trigger an update check on a specific bridge. */
    bridgeCheckUpdate: (bridgeId: string) =>
      `receiptkit/org/${orgId}/to-bridge/${bridgeId}/check-update`,

    /** Tell all bridges to re-fetch org printer ownership from the cloud. */
    broadcastRefreshOrgPrinters: () =>
      `receiptkit/org/${orgId}/to-bridge/broadcast/refresh-org-printers`,
  };
}

// ─── Topic Types ───────────────────────────────────────────────────────

export type TopicBuilders = ReturnType<typeof buildPublicTopics>;
export type InternalTopicBuilders = ReturnType<typeof buildInternalTopics>;

// ─── Factories ─────────────────────────────────────────────────────────

/**
 * Create org-scoped topic builders for public use.
 *
 * Includes topics for printing, bridge discovery, and status monitoring.
 * For internal topics (template sync, bridge management), use
 * `createInternalTopicBuilders` from "receiptkit/internal".
 */
export function createTopicBuilders(config: ReceiptKitConfig): TopicBuilders {
  if (!config.orgId) {
    throw new Error(
      "[receiptkit] orgId is required. All connections must use org-scoped topics."
    );
  }
  return buildPublicTopics(config.orgId);
}

/**
 * Create org-scoped topic builders for internal/management use.
 *
 * Includes topics for template sync, bridge name updates, and
 * broadcast subscriptions. Only used by the dashboard and bridge app.
 *
 * @internal
 */
export function createInternalTopicBuilders(config: { orgId: string }): InternalTopicBuilders {
  if (!config.orgId) {
    throw new Error(
      "[receiptkit] orgId is required. All connections must use org-scoped topics."
    );
  }
  return buildInternalTopics(config.orgId);
}
