"use client";

/**
 * receiptkit/react — usePrinterStatus
 *
 * React hook that provides real-time printer status from the status cache.
 * Re-renders only when the specific printer's status changes.
 */

import { useState, useEffect, useCallback } from "react";
import { useReceiptKitContext } from "./provider";
import type { LivePrinterStatus, PrinterStatusLevel } from "../types";
import { derivePrinterStatusLevel } from "../types";

interface UsePrinterStatusReturn {
  /** Full ASB printer status, or null if unknown. */
  status: LivePrinterStatus | null;
  /** Derived display-friendly status level. */
  level: PrinterStatusLevel;
  /** Whether the printer is online. */
  isOnline: boolean;
  /** When the status was last updated (Date.now() timestamp). */
  lastUpdated: number | null;
  /** Which bridge reported this printer. */
  bridgeId: string | null;
}

/**
 * Get real-time status for a specific printer by MAC address.
 *
 * Reads from the in-memory status cache (populated by auto-subscribed
 * bridge status responses). Re-renders only when this printer's status
 * changes — no additional MQTT subscriptions needed.
 *
 * @param mac - Printer MAC address (any format: "00:11:62:xx:xx:xx" or "001162xxxxxx")
 *
 * @example
 * const { isOnline, level, status } = usePrinterStatus('00:11:62:1A:2B:3C')
 *
 * if (!isOnline) {
 *   showWarning('Printer is offline')
 * }
 */
export function usePrinterStatus(mac: string | null): UsePrinterStatusReturn {
  const ctx = useReceiptKitContext();
  const [, forceRender] = useState(0);

  // Subscribe to cache changes and force re-render when our printer changes
  useEffect(() => {
    if (!ctx?.client || !mac) return;

    const cache = ctx.client.getStatusCache();
    let lastStatus: LivePrinterStatus | null = cache.getPrinter(mac)?.status ?? null;

    const unsub = cache.onChange(() => {
      const current = cache.getPrinter(mac)?.status ?? null;
      // Only re-render if this printer's status actually changed
      if (current !== lastStatus) {
        lastStatus = current;
        forceRender((n) => n + 1);
      }
    });

    return unsub;
  }, [ctx, mac]);

  if (!ctx?.client || !mac) {
    return {
      status: null,
      level: "unknown",
      isOnline: false,
      lastUpdated: null,
      bridgeId: null,
    };
  }

  const cached = ctx.client.getStatusCache().getPrinter(mac);

  if (!cached) {
    return {
      status: null,
      level: "unknown",
      isOnline: false,
      lastUpdated: null,
      bridgeId: null,
    };
  }

  return {
    status: cached.status,
    level: derivePrinterStatusLevel(cached.status),
    isOnline: cached.status.online,
    lastUpdated: cached.lastUpdated,
    bridgeId: cached.bridgeId,
  };
}
