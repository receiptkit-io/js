/**
 * receiptkit/mqtt
 *
 * MQTT-capable entry point. Re-exports everything from the main package
 * plus ReceiptKitSession with MQTT transport support.
 *
 * Importing this subpath bundles the mqtt package. For HTTP-only usage,
 * import from "receiptkit/http" to keep your bundle lean.
 */

export { ReceiptKitSession } from "../session";

// Re-export full client surface
export { ReceiptKitClient } from "../client";
export { StatusCache } from "../status-cache";
export { createTopicBuilders } from "../topics";
export type { TopicBuilders } from "../topics";
export { parseRawAsb } from "../asb-parser";

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
} from "../types";

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
  isMacAddress,
  normalizePrinterEndpoint,
  printerEndpointToMac,
  topicMatchesFilter,
} from "../types";
