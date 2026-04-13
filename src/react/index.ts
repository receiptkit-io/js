"use client";

/**
 * receiptkit/react
 *
 * React hooks and provider for the ReceiptKit MQTT client.
 */

// ─── Provider ──────────────────────────────────────────────────────────
export { ReceiptKitProvider, useReceiptKitContext } from "./provider";

// ─── Hooks ─────────────────────────────────────────────────────────────
export { useReceiptKit } from "./use-receiptkit";
export { usePrinterStatus } from "./use-printer-status";
export { useBridgeStatus } from "./use-bridge-status";
export { useBridgeDiscover } from "./use-bridge-discover";
export { usePrintJob } from "./use-print-job";
export type { PrintJobPhase, UsePrintJobReturn } from "./use-print-job";

// ─── Re-export commonly used types ────────────────────────────────────
export type {
  ReceiptKitConfig,
  MqttConnectionStatus,
  PrintOptions,
  PrintJobStatus,
  PrintJobResult,
  PrintHandle,
  PrintAndWaitResult,
  LivePrinterStatus,
  LivePrinter,
  PrinterStatusLevel,
  CachedBridgeStatus,
  BridgeStatusResponse,
  BridgeSoftwareInfo,
  BridgeStats,
} from "../types";
