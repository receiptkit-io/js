/**
 * receiptkit/http
 *
 * HTTP-only entry point. Exports ReceiptKitSession (HTTP transport only)
 * and all shared session types. Contains ZERO mqtt package dependency —
 * safe for server-side or edge environments where bundle size matters.
 *
 * For MQTT transport, import from "receiptkit/mqtt" instead.
 */

export { ReceiptKitSession } from "./session";

export type {
  SessionConfig,
  PrintCallOptions,
  SessionPrintResult,
  Transport,
} from "../types";
