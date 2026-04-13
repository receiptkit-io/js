"use client";

/**
 * receiptkit/react — useBridgeDiscover
 *
 * React hook that discovers bridges via MQTT and optionally polls for
 * live printer hardware status.
 *
 * Two modes:
 *
 * **Discover-only** (default) — one-shot discover on connect, then LWT
 * handles online/offline. Use this in the POS / fh-admin where you just
 * need to know which bridges are reachable.
 *
 * **With printer polling** (`pollPrinterStatus: true`) — after the
 * initial discover, polls each bridge once on connect, then every 15s
 * with `requestPrinterStatus: true` so the bridge queries each printer's
 * ASB status before responding. Use this on the dashboard devices page
 * where you need live paper/cover/error status.
 */

import { useEffect, useCallback, useRef, useState } from "react";
import { useReceiptKitContext } from "./provider";
import type { CachedBridgeStatus } from "../types";

interface UseBridgeDiscoverOptions {
  /**
   * When true, polls each bridge every 15s asking it to query its
   * printers' ASB hardware status before responding.
   * Gives live paper-empty, cover-open, cutter-error, etc.
   *
   * When false (default), just discovers bridges on connect and relies
   * on LWT for online/offline — no recurring polls.
   */
  pollPrinterStatus?: boolean;
}

interface UseBridgeDiscoverReturn {
  /** Map of bridgeId → cached bridge status (includes printer list). */
  bridges: Map<string, CachedBridgeStatus>;
  /** Whether a discover/poll request is in-flight. */
  discovering: boolean;
  /** Manually trigger a fresh discover broadcast. */
  refresh: () => void;
  /** Current MQTT connection status. */
  mqttStatus: string;
}

/** Steady-state poll interval — one poll every 15s. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Discover bridges and optionally poll for live printer status via MQTT.
 *
 * On connect, broadcasts a discover request so all online bridges respond
 * with their printer list. Bridge online/offline is handled by MQTT LWT.
 *
 * When `pollPrinterStatus` is true, sends one status poll on connect
 * then repeats every 15s, triggering live ASB hardware queries on each
 * bridge for real-time printer health.
 *
 * @example
 * // Discover-only (POS / fh-admin)
 * const { bridges } = useBridgeDiscover()
 *
 * // With live printer polling (dashboard devices page)
 * const { bridges } = useBridgeDiscover({ pollPrinterStatus: true })
 */
export function useBridgeDiscover(
  options?: UseBridgeDiscoverOptions
): UseBridgeDiscoverReturn {
  const pollPrinterStatus = options?.pollPrinterStatus ?? false;
  const ctx = useReceiptKitContext();

  // Seed from the global StatusCache so bridges discovered by a previous
  // page (e.g. devices) appear instantly — no round-trip required.
  const [bridges, setBridges] = useState<Map<string, CachedBridgeStatus>>(
    () => ctx?.client?.getStatusCache().getAllBridges() ?? new Map()
  );
  const [discovering, setDiscovering] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  /** Tracks whether we've fired the first reactive status poll after discover. */
  const initialPollFired = useRef(false);

  // ── Broadcast discover ───────────────────────────────────────────────
  const sendDiscover = useCallback(() => {
    if (!ctx?.client?.isConnected()) return;
    const topics = ctx.client.getTopics();
    const ts = new Date().toISOString();

    ctx.client.publish(topics.bridgeDiscover(), {
      type: "discover",
      timestamp: ts,
    }).catch(() => {});

    setDiscovering(true);
    if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
    discoverTimerRef.current = setTimeout(() => setDiscovering(false), 3_000);
  }, [ctx]);

  // ── Targeted status-poll with live ASB ───────────────────────────────
  const sendStatusPoll = useCallback(() => {
    if (!ctx?.client?.isConnected()) return;
    const cache = ctx.client.getStatusCache();
    const allBridges = cache.getAllBridges();
    const topics = ctx.client.getTopics();
    const ts = new Date().toISOString();

    for (const [bridgeId] of allBridges) {
      ctx.client.publish(topics.bridgeStatusPoll(bridgeId), {
        command: "status-poll",
        requestPrinterStatus: true,
        timestamp: ts,
      }).catch(() => {});
    }

    // If no bridges in cache yet, fall back to broadcast discover.
    if (allBridges.size === 0) {
      sendDiscover();
    }
  }, [ctx, sendDiscover]);

  // ── Simple polling: interval only — first poll is reactive (see below) ──
  const startPolling = useCallback(() => {
    if (!mountedRef.current) return;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    // Don't fire immediately — the reactive cache-watch effect fires the
    // first status poll as soon as bridges appear in the cache (from the
    // discover response). This avoids the old problem where the first
    // sendStatusPoll() found an empty cache and fell back to a plain
    // discover, delaying the real status poll (with rawStatus) by 15s.

    // Steady-state interval only — repeat every 15s.
    pollTimerRef.current = setInterval(() => {
      if (mountedRef.current) sendStatusPoll();
    }, POLL_INTERVAL_MS);
  }, [sendStatusPoll]);

  // ── Subscribe to cache changes ───────────────────────────────────────
  useEffect(() => {
    if (!ctx?.client) return;
    const cache = ctx.client.getStatusCache();

    const existing = cache.getAllBridges();
    if (existing.size > 0) setBridges(existing);

    const unsub = cache.onChange(() => {
      setBridges(cache.getAllBridges());
    });
    return unsub;
  }, [ctx]);

  // ── Reactive first status poll ─────────────────────────────────────
  // When pollPrinterStatus is enabled, fire the first status poll as
  // soon as bridges appear in the cache (from the discover response).
  // This ensures the rawStatus-bearing status-poll response arrives
  // ~1-2s after page load instead of waiting for the 15s interval.
  useEffect(() => {
    if (!ctx?.client || !pollPrinterStatus) return;
    const cache = ctx.client.getStatusCache();

    const tryFirstPoll = () => {
      if (!initialPollFired.current && cache.getAllBridges().size > 0) {
        initialPollFired.current = true;
        sendStatusPoll();
      }
    };

    // Bridges may already be in cache (singleton client / navigation)
    tryFirstPoll();

    const unsub = cache.onChange(tryFirstPoll);
    return unsub;
  }, [ctx, pollPrinterStatus, sendStatusPoll]);

  // ── Main effect: discover + optional polling ─────────────────────────
  useEffect(() => {
    if (ctx?.status !== "connected") return;

    mountedRef.current = true;

    // Reset reactive poll tracker on each new connection so the first
    // status poll fires promptly after discover populates the cache.
    initialPollFired.current = false;

    // 1. Broadcast discover immediately
    sendDiscover();

    // 2. Retry after 2s (SUBACK race)
    const retryTimeout = setTimeout(sendDiscover, 2_000);

    // 3. Start simple 15s polling if printer status polling is enabled
    if (pollPrinterStatus) {
      startPolling();
    }

    return () => {
      mountedRef.current = false;
      clearTimeout(retryTimeout);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
    };
  }, [ctx?.status, sendDiscover, startPolling, pollPrinterStatus]);

  const refresh = useCallback(() => {
    sendDiscover();
    if (pollPrinterStatus) {
      // Restart polling cycle so the next poll is a full 15s away
      startPolling();
    }
  }, [sendDiscover, startPolling, pollPrinterStatus]);

  return {
    bridges,
    discovering,
    refresh,
    mqttStatus: ctx?.status ?? "disconnected",
  };
}
