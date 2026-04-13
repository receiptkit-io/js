/**
 * receiptkit — Status Cache
 *
 * In-memory cache for bridge and printer status. Updated from MQTT messages
 * in real-time. All reads are synchronous — zero async overhead for status checks.
 */

import type {
  CachedBridgeStatus,
  LivePrinterStatus,
  LivePrinter,
  BridgeStatusResponse,
} from "./types";

export type StatusChangeHandler = () => void;

/**
 * Global in-memory status cache.
 *
 * Stores bridge and printer status keyed by bridgeId and MAC.
 * Updated automatically by the ReceiptKitClient when status-response
 * messages arrive. All reads are synchronous.
 */
export class StatusCache {
  private bridges = new Map<string, CachedBridgeStatus>();
  private printers = new Map<string, { status: LivePrinterStatus; bridgeId: string; lastUpdated: number }>();
  private listeners = new Set<StatusChangeHandler>();

  // ─── Reads (synchronous) ────────────────────────────────────────────

  /** Get all cached bridge statuses. */
  getAllBridges(): Map<string, CachedBridgeStatus> {
    return new Map(this.bridges);
  }

  /** Get cached status for a specific bridge. */
  getBridge(bridgeId: string): CachedBridgeStatus | null {
    return this.bridges.get(bridgeId) ?? null;
  }

  /** Get cached printer status by MAC (normalized comparison). */
  getPrinter(mac: string): { status: LivePrinterStatus; bridgeId: string; lastUpdated: number } | null {
    const normalized = mac.replace(/[:-]/g, "").toLowerCase();
    // Try exact match first, then normalized
    const direct = this.printers.get(normalized);
    if (direct) return direct;
    // Fallback: scan keys
    for (const [key, value] of this.printers) {
      if (key === normalized) return value;
    }
    return null;
  }

  /** Check if a specific printer is online (from cache). */
  isPrinterOnline(mac: string): boolean {
    const cached = this.getPrinter(mac);
    return cached?.status.online ?? false;
  }

  /** Check if a specific bridge has responded recently (within staleness window). */
  isBridgeOnline(bridgeId: string, stalenessMs: number = 90_000): boolean {
    const cached = this.bridges.get(bridgeId);
    if (!cached) return false;
    // LWT explicitly marked it offline
    if (cached.online === false) return false;
    // Staleness fallback: with retained LWT, this is a secondary safety net
    // in case a retained death message is missed (e.g. first subscription race)
    return Date.now() - cached.lastUpdated < stalenessMs;
  }

  /** Get all cached printer statuses. */
  getAllPrinters(): Map<string, { status: LivePrinterStatus; bridgeId: string; lastUpdated: number }> {
    return new Map(this.printers);
  }

  // ─── Writes (called by ReceiptKitClient) ──────────────────────────────

  /** Update cache from a bridge status-response message. */
  updateFromBridgeResponse(response: BridgeStatusResponse): void {
    const now = Date.now();

    // Update bridge entry
    const cached: CachedBridgeStatus = {
      ...response,
      lastUpdated: now,
    };
    this.bridges.set(response.bridgeId, cached);

    // Update individual printer entries
    if (response.printers) {
      for (const printer of response.printers) {
        const normalizedMac = printer.mac.replace(/[:-]/g, "").toLowerCase();
        this.printers.set(normalizedMac, {
          status: printer.status,
          bridgeId: response.bridgeId,
          lastUpdated: now,
        });
      }
    }

    this.notifyListeners();
  }

  /**
   * Mark a bridge as offline (e.g. from an LWT presence message).
   * Updates the bridge entry and marks all printers from that bridge as offline.
   */
  markBridgeOffline(bridgeId: string): void {
    const now = Date.now();
    const existing = this.bridges.get(bridgeId);

    if (existing) {
      existing.online = false;
      existing.lastUpdated = now;
      // Mark all printers on this bridge as offline — both the
      // individual printer cache AND the embedded printers array
      // (the devices page reads from both).
      for (const printer of existing.printers) {
        // Update embedded printer object
        printer.status = { ...printer.status, online: false };

        // Update individual printer cache entry
        const normalizedMac = printer.mac.replace(/[:-]/g, "").toLowerCase();
        const cached = this.printers.get(normalizedMac);
        if (cached && cached.bridgeId === bridgeId) {
          cached.status = { ...cached.status, online: false };
          cached.lastUpdated = now;
        }
      }
    } else {
      // No prior entry — create a minimal offline entry
      this.bridges.set(bridgeId, {
        online: false,
        timestamp: new Date(now).toISOString(),
        bridgeId,
        type: "unknown",
        printers: [],
        stats: null,
        software: null,
        updateInfo: null,
        lastUpdated: now,
      });
    }

    this.notifyListeners();
  }

  /** Clear all cached data. */
  clear(): void {
    this.bridges.clear();
    this.printers.clear();
    this.notifyListeners();
  }

  // ─── Change Listeners ───────────────────────────────────────────────

  /** Subscribe to cache changes. Returns unsubscribe function. */
  onChange(handler: StatusChangeHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Don't let a listener error break other listeners
      }
    }
  }
}
