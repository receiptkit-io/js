/**
 * receiptkit
 *
 * Shared MQTT client library for ReceiptKit. Provides:
 * - ReceiptKitClient: Global singleton MQTT client with auto-reconnect
 * - ReceiptKitSession: Session wrapper with per-session defaults + transport selection
 * - Status caching: Synchronous isPrinterOnline() / isBridgeOnline()
 * - Topic builders: Single source of truth for all MQTT topic strings
 * - Types: All message, status, and config types
 *
 * Subpath exports:
 * - "receiptkit"        → Core client (this file)
 * - "receiptkit/http"   → ReceiptKitSession (HTTP only, zero mqtt dep)
 * - "receiptkit/mqtt"   → ReceiptKitSession + full client (includes mqtt dep)
 * - "receiptkit/react"  → React hooks & provider
 * - "receiptkit/server" → Server-side singleton for Vercel
 */

// ─── Client ────────────────────────────────────────────────────────────
export { ReceiptKitClient } from "./client";

// ─── Session ───────────────────────────────────────────────────────────
export { ReceiptKitSession } from "./session";

// ─── Status Cache ──────────────────────────────────────────────────────
export { StatusCache } from "./status-cache";

// ─── Topics ────────────────────────────────────────────────────────────
export { createTopicBuilders } from "./topics";
export type { TopicBuilders } from "./topics";

// ─── ASB Parser (client-side raw status re-parsing) ────────────────────
export { parseRawAsb } from "./asb-parser";

// ─── Types ─────────────────────────────────────────────────────────────
export type {
  ReceiptKitConfig,
  MqttConnectionStatus,
  LivePrinterStatus,
  LivePrinter,
  PrinterStatusLevel,
  StatusLevelMeta,
  BridgeStats,
  BridgeStatusResponse,
  BridgeSoftwareInfo,
  BridgeUpdateInfo,
  CachedBridgeStatus,
  BridgeConnectionLevel,
  PrintOptions,
  PrintJobMessage,
  PrintJobStatus,
  PrintJobResult,
  PrintHandle,
  PrintAndWaitResult,
  ReceiptKitEvents,
  ReceiptKitEventName,
  SessionConfig,
  PrintCallOptions,
  SessionPrintResult,
  Transport,
} from "./types";

export {
  derivePrinterStatusLevel,
  derivePrinterStatusLevelSimple,
  statusLevelMeta,
  deriveBridgeConnectionLevel,
  bridgeConnectionMeta,
  formatRelativeTime,
  normalizeMac,
  formatMac,
  macMatch,
  topicMatchesFilter,
} from "./types";
