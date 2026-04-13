/**
 * receiptkit — Types
 *
 * All shared types for MQTT configuration, messages, printer/bridge status,
 * and events. Consolidates types from src/lib/types/bridge-status.ts,
 * src/hooks/use-bridge-discover.ts, and src/hooks/use-bridge-status-poll.ts.
 */

// ─── Configuration ─────────────────────────────────────────────────────

/**
 * Configuration for ReceiptKitClient.
 *
 * All connections use org-scoped topics (`receiptkit/org/{orgId}/...`)
 * and API key authentication.
 */
export interface ReceiptKitConfig {
  // ── Auth (required) ─────────────────────────────────────────────────

  /** API key (`rk_pub_...` or `rk_live_...`). Used as MQTT username. */
  apiKey: string;

  /** Organization ID. Used for org-scoped topics and as MQTT password. */
  orgId: string;

  // ── Connection options ──────────────────────────────────────────────

  /** Override the default AWS IoT Core MQTT endpoint. */
  endpoint?: string;

  /** Override the custom authorizer name (default: "CpAuthorizer"). */
  authorizer?: string;

  /** Environment hint. Auto-detected if omitted. */
  environment?: "browser" | "server";

  /** Client ID prefix for debuggability (e.g. "fh-admin", "receiptkit-dashboard"). */
  clientIdPrefix?: string;

  /**
   * Auto-subscribe to bridge status responses on connect.
   * Keeps the status cache warm without manual subscription.
   * Default: true
   */
  autoSubscribeStatus?: boolean;

  /**
   * Bridge ID for bridge-mode clients.
   *
   * When set, the client configures an MQTT Last Will and Testament (LWT)
   * that publishes `{ online: false, bridgeId }` (retained) to the bridge
   * presence topic on disconnect. A birth message `{ online: true, bridgeId }`
   * is published (retained) immediately after connecting.
   *
   * This enables instant offline detection for clean disconnects and
   * ~1.5× keepalive detection for abrupt disconnects.
   *
   * Only set this for bridge/device clients — not for browser dashboard clients.
   */
  bridgeId?: string;

  /**
   * Default source identifier for print jobs.
   *
   * If set, this is used as the `source` field on all print jobs
   * unless overridden per-call via `PrintOptions.source`.
   *
   * If omitted, auto-detected at init time:
   *   - Browser: `window.location.hostname` (e.g. "localhost", "app.example.com")
   *   - Server: `"server"`
   */
  defaultSource?: string;

  /** MQTT keepalive in seconds (default: 60). */
  keepalive?: number;

  /** Initial reconnect period in ms (default: 5000). */
  reconnectPeriod?: number;

  /** Connection timeout in ms (default: 10000). */
  connectTimeout?: number;

  /** Enable debug logging to console (default: auto-detect based on hostname). */
  debug?: boolean;
}

// ─── MQTT Connection Status ────────────────────────────────────────────

export type MqttConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ─── Printer Status ────────────────────────────────────────────────────

/** Full ASB-level printer status from Star printer protocol. */
export interface LivePrinterStatus {
  online: boolean;
  coverOpen: boolean;
  paperEmpty: boolean;
  paperNearEnd: boolean;
  cutterError: boolean;
  mechError: boolean;
  jamError: boolean;
  overTemp: boolean;
  headUpError: boolean;
  voltageError: boolean;
  etbCounter: number;
  lastCheck: string | null;
  // Presenter status — only populated on models with a receipt presenter
  hasPresenter?: boolean;
  presenterCoverOpen?: boolean;
  presenterPaperJam?: boolean;
  receiptHeld?: boolean;
}

/** A printer reported in a live bridge status response. */
export interface LivePrinter {
  mac: string;
  name: string;
  ip: string;
  port: number;
  model: string | null;
  dotWidth: number;
  status: LivePrinterStatus;
  lastPrint: string | null;
  printing: boolean;
}

/** Derived status level — priority ordered for display. */
export type PrinterStatusLevel =
  | "error"
  | "cover_open"
  | "paper_empty"
  | "paper_near_end"
  | "printing"
  | "online"
  | "offline"
  | "unknown";

/** Derive a single status level from full ASB status. */
export function derivePrinterStatusLevel(
  status: LivePrinterStatus,
  printing?: boolean
): PrinterStatusLevel {
  if (!status.online) return "offline";
  if (
    status.cutterError ||
    status.mechError ||
    status.jamError ||
    status.overTemp ||
    status.headUpError ||
    status.voltageError ||
    status.presenterPaperJam
  )
    return "error";
  if (status.coverOpen || status.presenterCoverOpen) return "cover_open";
  if (status.paperEmpty) return "paper_empty";
  if (status.paperNearEnd) return "paper_near_end";
  if (printing) return "printing";
  return "online";
}

/** Derive status level from simple legacy status fields. */
export function derivePrinterStatusLevelSimple(status: {
  online: boolean;
  paperEmpty?: boolean;
  coverOpen?: boolean;
}): PrinterStatusLevel {
  if (!status.online) return "offline";
  if (status.coverOpen) return "cover_open";
  if (status.paperEmpty) return "paper_empty";
  return "online";
}

// ─── Status Display Metadata ───────────────────────────────────────────

/** Display metadata for each printer status level. */
export interface StatusLevelMeta {
  label: string;
  color: string;
  badgeVariant: "success" | "destructive" | "warning" | "secondary" | "default";
  dotColor: string;
  description: string;
}

const STATUS_META: Record<PrinterStatusLevel, StatusLevelMeta> = {
  online: {
    label: "Online",
    color: "success",
    badgeVariant: "success",
    dotColor: "bg-emerald-500",
    description: "Printer is online and ready",
  },
  printing: {
    label: "Printing",
    color: "blue",
    badgeVariant: "default",
    dotColor: "bg-blue-500",
    description: "Printer is currently printing",
  },
  paper_near_end: {
    label: "Paper Low",
    color: "warning",
    badgeVariant: "warning",
    dotColor: "bg-yellow-500",
    description: "Paper roll is running low",
  },
  paper_empty: {
    label: "Paper Empty",
    color: "destructive",
    badgeVariant: "destructive",
    dotColor: "bg-orange-500",
    description: "Paper roll is empty — replace immediately",
  },
  cover_open: {
    label: "Cover Open",
    color: "warning",
    badgeVariant: "warning",
    dotColor: "bg-amber-500",
    description: "Printer cover is open",
  },
  error: {
    label: "Error",
    color: "destructive",
    badgeVariant: "destructive",
    dotColor: "bg-red-500",
    description: "Hardware error detected",
  },
  offline: {
    label: "Offline",
    color: "muted",
    badgeVariant: "secondary",
    dotColor: "bg-gray-400",
    description: "Printer is not responding",
  },
  unknown: {
    label: "Unknown",
    color: "warning",
    badgeVariant: "warning",
    dotColor: "bg-orange-400",
    description: "Bridge is offline — printer status unknown",
  },
};

export function statusLevelMeta(level: PrinterStatusLevel): StatusLevelMeta {
  return STATUS_META[level];
}

// ─── Bridge Status ─────────────────────────────────────────────────────

/** Bridge-level stats included in status-poll response. */
export interface BridgeStats {
  jobsCompleted: number;
  jobsFailed: number;
  avgPrintTimeMs: number;
  avgRenderTimeMs: number;
  uptimeSeconds: number;
}

/** Software version & install info reported by the bridge. */
export interface BridgeSoftwareInfo {
  /** Compiled binary version (e.g. "0.2.64"). */
  binaryVersion: string;
  /** Install mode: "currentUser" | "perMachine" | "unknown". */
  installMode: string;
  /** Whether the bridge allows remote-triggered updates (default: true). */
  allowRemoteUpdates?: boolean;
}

/** Real-time update progress reported by the bridge via MQTT. */
export interface BridgeUpdateInfo {
  /** Whether an update is available. */
  available: boolean;
  /** Version currently running. */
  currentVersion: string;
  /** Version available for update. */
  latestVersion?: string;
  /** Download progress 0-100. */
  downloadProgress?: number;
  /** Current phase of the update pipeline. */
  downloadState?: "idle" | "downloading" | "extracting" | "ready" | "applying" | "error";
}

/** Full response from an MQTT status-poll / discovery broadcast. */
export interface BridgeStatusResponse {
  /** Whether the bridge responded (always true when received from MQTT). */
  online: boolean;
  /** ISO timestamp of the response. */
  timestamp: string | null;
  /** Bridge's self-reported ID. */
  bridgeId: string;
  /** User-configurable display name (e.g. "Cape Coral Store"). */
  name?: string;
  /** Bridge type (e.g. "receipt-bridge", "pi-bridge"). */
  type: string;
  /** Printers reported by the bridge. */
  printers: LivePrinter[];
  /** Bridge-level stats (may be null for older bridges). */
  stats: BridgeStats | null;
  /** Software version info (null for older bridges that don't report it). */
  software: BridgeSoftwareInfo | null;
  /** Live update progress (null when no update is in progress). */
  updateInfo: BridgeUpdateInfo | null;
}

/** Cached bridge status stored in the status cache. */
export interface CachedBridgeStatus extends BridgeStatusResponse {
  /** When this entry was last updated (Date.now()). */
  lastUpdated: number;
}

// ─── Bridge Connection Level ───────────────────────────────────────────

export type BridgeConnectionLevel = "live" | "stale" | "offline";

export function deriveBridgeConnectionLevel(
  pollResponse: BridgeStatusResponse | null,
  lastSeenAt: string | null
): BridgeConnectionLevel {
  if (pollResponse?.online) return "live";
  if (lastSeenAt) {
    const age = Date.now() - new Date(lastSeenAt).getTime();
    if (age < 5 * 60 * 1000) return "stale";
  }
  return "offline";
}

export function bridgeConnectionMeta(level: BridgeConnectionLevel) {
  switch (level) {
    case "live":
      return {
        label: "Live",
        color: "text-emerald-500",
        dotColor: "bg-emerald-500",
        badgeVariant: "success" as const,
        description: "Responding to live polls",
      };
    case "stale":
      return {
        label: "Stale",
        color: "text-yellow-500",
        dotColor: "bg-yellow-500",
        badgeVariant: "warning" as const,
        description: "Seen recently but not responding to polls",
      };
    case "offline":
      return {
        label: "Offline",
        color: "text-gray-400",
        dotColor: "bg-gray-400",
        badgeVariant: "secondary" as const,
        description: "Not responding",
      };
  }
}

// ─── Print Job Messages ────────────────────────────────────────────────

/** Options for the `print()` method. */
export interface PrintOptions {
  /** Printer MAC address. */
  printerId: string;
  /**
   * Bridge ID that owns this printer.
   * Required — the print job is published to the bridge's `to-bridge/{bridgeId}/print` topic.
   */
  bridgeId: string;
  /** template ID (fetched by bridge from API). */
  templateId?: string;
  /** Inline template object (sent with the message). */
  template?: Record<string, unknown>;
  /** Template data to merge. */
  data: Record<string, unknown>;
  /** Cash drawer kick: START, END, BOTH, or NONE (default: NONE). */
  drawer?: "START" | "END" | "BOTH" | "NONE";
  /**
   * Override the raster output width in pixels.
   *
   * You almost never need this. The bridge auto-detects the printer's
   * physical dot width and uses it by default. Only set this if you
   * intentionally want to scale the receipt (e.g. render a 576px
   * template at 384px to produce a smaller image on wide paper).
   */
  dotWidth?: number;
  /** Print source identifier. */
  source?: string;
  /** Pre-generated job token (used by printAndWait to listen before publishing). */
  jobToken?: string;
  /**
   * ISO timestamp to embed as `publishedAt` in the MQTT message.
   * When omitted, `print()` uses `new Date().toISOString()` at call time.
   * Pass an explicit value when the caller (e.g. browser) is on a different
   * host than the MQTT publish path (e.g. API route on Vercel) so the
   * bridge can compute accurate end-to-end latency against its local clock.
   */
  publishedAt?: string;
  /**
   * Expected template version.
   *
   * When provided, the bridge compares this against its cached version.
   * If they differ, the bridge re-fetches the template from the cloud API
   * before rendering. Optional for backward compatibility — when omitted,
   * the bridge uses whatever version it has cached.
   */
  templateVersion?: number;
}

/** The MQTT message payload published for a print job. */
export interface PrintJobMessage {
  title: "print-job";
  jobToken: string;
  templateId?: string;
  template?: Record<string, unknown>;
  /** Expected template version — bridge re-fetches if cached version differs. */
  templateVersion?: number;
  data: Record<string, unknown>;
  printerId: string;
  /** Raster width override. Omit to let the bridge use the printer's native width. */
  dotWidth?: number;
  drawer: string;
  source: string;
  /** ISO timestamp when the message was published — used for end-to-end latency measurement. */
  publishedAt?: string;
}

// ─── Print Job Result Types ────────────────────────────────────────────

/** Status of a completed print job. */
export type PrintJobStatus = "success" | "queued" | "failed";

/** Result payload received from the bridge after a print job completes. */
export interface PrintJobResult {
  /** The job token that was sent with the print request. */
  jobToken: string;
  /** Whether the print was successful, queued for retry, or failed. */
  status: PrintJobStatus;
  /** The printer that handled the job. */
  printerMac: string;
  /** The bridge that processed the job. */
  bridgeId: string;
  /** Error message (set when status is "queued" or "failed"). */
  error?: string;
  /** Print duration in milliseconds (set on success). */
  duration?: number;
  /** ISO timestamp of when the result was generated. */
  timestamp: string;
}

/** Return type of `print()` — includes the jobToken for tracking. */
export interface PrintHandle {
  /** The unique token identifying this print job. */
  jobToken: string;
}

/** Return type of `printAndWait()`. */
export interface PrintAndWaitResult {
  /** The job token. */
  jobToken: string;
  /** The print result from the bridge, or null if timed out. */
  result: PrintJobResult | null;
  /** Whether the request timed out waiting for a result. */
  timedOut: boolean;
}

// ─── Event Types ───────────────────────────────────────────────────────

export interface ReceiptKitEvents {
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  error: (error: Error) => void;
  bridgeStatus: (bridgeId: string, status: CachedBridgeStatus) => void;
  printerStatus: (mac: string, status: LivePrinterStatus, bridgeId: string) => void;
  printJobResult: (result: PrintJobResult) => void;
  message: (topic: string, payload: Record<string, unknown>) => void;
}

export type ReceiptKitEventName = keyof ReceiptKitEvents;

// ─── Session Types ─────────────────────────────────────────────────────

/** Transport used by ReceiptKitSession. */
export type Transport = "mqtt" | "http";

/**
 * Session-level defaults for ReceiptKitSession.
 * Per-call overrides in PrintCallOptions take precedence over these.
 */
export interface SessionConfig {
  /** API key (`rk_pub_...` or `rk_live_...`). */
  apiKey: string;
  /**
   * Organization UUID. Required for MQTT transport (used to build topic strings).
   * Optional for HTTP transport — the server derives the org from the API key.
   */
  orgId?: string;
  /**
   * Transport to use for all print calls in this session.
   *
   * - `"http"` (default) — sends to `/api/bridge/print` via fetch. Works
   *   from anywhere with no WebSocket requirement.
   * - `"mqtt"` — publishes directly over WebSocket to AWS IoT. Lower
   *   latency from browser but requires an active MQTT connection.
   */
  transport?: Transport;
  /**
   * Base URL for HTTP transport. Default: `"https://www.receiptkit.io"`.
   * Override for local development or custom deployments.
   */
  baseUrl?: string;
  /** Default template ID. Overridden per-call via PrintCallOptions.templateId. */
  templateId?: string;
  /** Default printer MAC address. Overridden per-call. */
  printerId?: string;
  /** Default bridge ID. Overridden per-call. Auto-resolved from status cache or DB if omitted. */
  bridgeId?: string;
  /** Default raster output width in pixels. Overridden per-call. */
  dotWidth?: number;
}

/**
 * Options for a single `session.print()` call.
 * Per-call fields override the session-level defaults.
 */
export interface PrintCallOptions {
  /** Template data to render. Required every call. */
  data: Record<string, unknown>;
  /**
   * Cash drawer kick. Required every call — intentionally not a session default
   * because sale vs. reprint differ (sale: START, reprint: NONE).
   */
  drawer: "START" | "END" | "BOTH" | "NONE";
  /** Override template ID for this call. */
  templateId?: string;
  /** Override printer MAC for this call. */
  printerId?: string;
  /** Override bridge ID for this call. */
  bridgeId?: string;
  /** Override raster output width for this call. */
  dotWidth?: number;
}

/** Normalized result from a session.print() call regardless of transport used. */
export interface SessionPrintResult {
  /** Unique job token assigned to this print job. */
  jobToken: string;
  /** Outcome of the print job. */
  status: "success" | "queued" | "failed" | "timeout";
  /** Print duration in milliseconds (set on success). */
  duration?: number;
  /** Error message (set on failure). */
  error?: string;
  /** Which transport was used for this call. */
  transport: Transport;
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Format relative time (e.g. "2 min ago", "Just now"). */
export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "Just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "Just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

/** Normalize MAC: remove colons/hyphens, lowercase. Used for MQTT topics and internal comparison. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[:-]/g, "").toLowerCase();
}

/** Format MAC with colons: "00:11:62:34:16:12". Canonical storage/display format. */
export function formatMac(mac: string): string {
  const bare = mac.replace(/[:-]/g, "").toLowerCase();
  return bare.match(/.{1,2}/g)?.join(":") ?? bare;
}

/** Check if two MACs match (normalized comparison). */
export function macMatch(a: string, b: string): boolean {
  return normalizeMac(a) === normalizeMac(b);
}

/** Check if an MQTT topic matches a subscription filter (supports + and # wildcards). */
export function topicMatchesFilter(topic: string, filter: string): boolean {
  const topicParts = topic.split("/");
  const filterParts = filter.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    if (filterParts[i] === "#") return true;
    if (filterParts[i] === "+") continue;
    if (filterParts[i] !== topicParts[i]) return false;
  }

  return topicParts.length === filterParts.length;
}
