"use client";

/**
 * receiptkit/react — ReceiptKitProvider
 *
 * React context provider that manages the ReceiptKitClient singleton,
 * connects on mount, and provides the client instance + live status
 * to all child components via context.
 *
 * The underlying MQTT connection is a **page-lifetime singleton** — it
 * survives React Strict Mode double-effects, hot-module reloads, and
 * intra-SPA navigations.  The connection is only closed when the
 * browser tab closes or the user navigates away.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReceiptKitClient } from "../client";
import type { ReceiptKitConfig, MqttConnectionStatus } from "../types";

// ─── Context ───────────────────────────────────────────────────────────

interface ReceiptKitContextValue {
  client: ReceiptKitClient;
  status: MqttConnectionStatus;
}

const ReceiptKitContext = createContext<ReceiptKitContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────

interface ReceiptKitProviderProps {
  /** Configuration for the MQTT client. Requires apiKey and orgId. */
  config: ReceiptKitConfig;
  children: ReactNode;
}

/**
 * React provider that manages the ReceiptKitClient lifecycle.
 *
 * Uses the "ref-guard" pattern (React docs: avoiding recreating ref
 * contents) to create the client **synchronously** before the first
 * render, ensuring children always receive a valid context — never null.
 *
 * `getOrInit()` reuses an existing singleton so React 18 Strict Mode
 * double-effects and hot reloads don't kill the live MQTT connection.
 *
 * @example
 * <ReceiptKitProvider config={{ apiKey: 'rk_pub_...', orgId: '...' }}>
 *   <App />
 * </ReceiptKitProvider>
 */
export function ReceiptKitProvider({
  config,
  children,
}: ReceiptKitProviderProps) {
  // ─── Synchronous client creation (ref-guard) ──────────────────────
  // The client is created once, before any render or effect.  Children
  // always receive context — there is never a render pass without it.
  const clientRef = useRef<ReceiptKitClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = ReceiptKitClient.getOrInit({
      ...config,
      environment: "browser",
    });
  }
  const client = clientRef.current;

  // ─── Status tracking ─────────────────────────────────────────────
  // Seed from the client's current status (may already be "connected"
  // if the singleton survived a Strict Mode cycle or HMR).
  const [status, setStatus] = useState<MqttConnectionStatus>(
    () => client.isConnected() ? "connected" : client.status
  );

  useEffect(() => {
    let cancelled = false;

    // When mqtt.js's built-in reconnect succeeds (even after the initial
    // connect() promise timed out or rejected), this fires and updates status.
    const onConnect = () => { if (!cancelled) setStatus("connected"); };
    const onDisconnect = () => { if (!cancelled) setStatus("disconnected"); };
    const onReconnect = () => { if (!cancelled) setStatus("connecting"); };
    const onError = () => { if (!cancelled) setStatus("error"); };

    client.on("connect", onConnect);
    client.on("disconnect", onDisconnect);
    client.on("reconnect", onReconnect);
    client.on("error", onError);

    // Sync: the client may already be connected (Strict Mode re-mount,
    // HMR, or a very fast connection).  Read its authoritative status.
    if (client.isConnected()) {
      setStatus("connected");
    } else if (client.status === "connecting") {
      // Connection already in-flight from a previous mount — just wait.
      setStatus("connecting");
    } else {
      // Not connected — start the connection.
      // The client internally retries up to 3 times and then lets
      // mqtt.js continue reconnecting in the background.
      // If the initial promise rejects, keep status "connecting" rather
      // than "error" because mqtt.js is still trying.
      setStatus("connecting");
      client.connect().catch(() => {
        // Don't set "error" here — mqtt.js auto-reconnect is still running.
        // The "connect" event handler above will set "connected" when it succeeds.
        // Only show "error" if we explicitly get an error event from mqtt.js.
        if (!cancelled && !client.isConnected()) {
          // mqtt.js is still trying (reconnectPeriod > 0), show "connecting"
          setStatus("connecting");
        }
      });
    }

    return () => {
      cancelled = true;
      client.off("connect", onConnect);
      client.off("disconnect", onDisconnect);
      client.off("reconnect", onReconnect);
      client.off("error", onError);
      // Intentionally do NOT destroy the singleton.  It is a page-
      // lifetime resource — destroying it on every Strict Mode cycle
      // kills the MQTT connection and forces an expensive reconnect.
      // The MQTT library auto-closes on page unload.
    };
  }, [client]);

  return (
    <ReceiptKitContext.Provider value={{ client, status }}>
      {children}
    </ReceiptKitContext.Provider>
  );
}

// ─── Context Hook ──────────────────────────────────────────────────────

/**
 * Internal hook to access the ReceiptKit context.
 * Returns null if used outside a ReceiptKitProvider.
 */
export function useReceiptKitContext(): ReceiptKitContextValue | null {
  return useContext(ReceiptKitContext);
}
