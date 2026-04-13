"use client";

/**
 * receiptkit/react — useBridgeStatus
 *
 * React hook that provides real-time status for a specific bridge.
 * Reads from the status cache, re-renders on changes.
 */

import { useState, useEffect } from "react";
import { useReceiptKitContext } from "./provider";
import type { CachedBridgeStatus, LivePrinter } from "../types";

interface UseBridgeStatusReturn {
  /** Full cached bridge status, or null if unknown. */
  status: CachedBridgeStatus | null;
  /** Whether the bridge is online (responded recently). */
  isOnline: boolean;
  /** Printers reported by this bridge. */
  printers: LivePrinter[];
  /** When the status was last updated (Date.now() timestamp). */
  lastUpdated: number | null;
}

/**
 * Get real-time status for a specific bridge.
 *
 * @param bridgeId - The bridge's self-reported ID.
 *
 * @example
 * const { isOnline, printers } = useBridgeStatus('my-bridge-id')
 */
export function useBridgeStatus(
  bridgeId: string | null
): UseBridgeStatusReturn {
  const ctx = useReceiptKitContext();
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!ctx?.client || !bridgeId) return;

    const cache = ctx.client.getStatusCache();
    let lastUpdated = cache.getBridge(bridgeId)?.lastUpdated ?? null;

    const unsub = cache.onChange(() => {
      const current = cache.getBridge(bridgeId)?.lastUpdated ?? null;
      if (current !== lastUpdated) {
        lastUpdated = current;
        forceRender((n) => n + 1);
      }
    });

    return unsub;
  }, [ctx, bridgeId]);

  if (!ctx?.client || !bridgeId) {
    return {
      status: null,
      isOnline: false,
      printers: [],
      lastUpdated: null,
    };
  }

  const cached = ctx.client.getStatusCache().getBridge(bridgeId);

  if (!cached) {
    return {
      status: null,
      isOnline: false,
      printers: [],
      lastUpdated: null,
    };
  }

  return {
    status: cached,
    isOnline: ctx.client.isBridgeOnline(bridgeId),
    printers: cached.printers,
    lastUpdated: cached.lastUpdated,
  };
}
