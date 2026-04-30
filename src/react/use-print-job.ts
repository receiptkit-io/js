"use client";

/**
 * receiptkit/react — usePrintJob
 *
 * React hook for sending print jobs with real-time status feedback.
 * Provides a state machine: idle → sending → waitingForResult → success / queued / failed / timeout
 *
 * Uses the client's `printAndWait()` method to listen for the bridge's
 * print result via the `printJobResult` event.
 */

import { useState, useCallback, useRef } from "react";
import { useReceiptKitContext } from "./provider";
import type { PrintOptions, PrintJobResult, PrintJobStatus } from "../types";

// ─── Types ─────────────────────────────────────────────────────────────

export type PrintJobPhase =
  | "idle"
  | "sending"
  | "waitingForResult"
  | "success"
  | "queued"
  | "failed"
  | "timeout";

export interface UsePrintJobReturn {
  /** Current phase of the print job lifecycle. */
  phase: PrintJobPhase;
  /** The print result from the bridge (available in success/queued/failed phases). */
  result: PrintJobResult | null;
  /** Error message (set in failed/timeout phases). */
  error: string | null;
  /** Whether a print operation is in progress (sending or waiting). */
  isPending: boolean;
  /** Human-readable status message for UI display. */
  statusMessage: string;
  /** Send a print job and wait for the result. */
  printAndWait: (options: PrintOptions, timeoutMs?: number) => Promise<PrintJobResult | null>;
  /** Reset back to idle state. */
  reset: () => void;
}

// ─── Status Messages ───────────────────────────────────────────────────

function getStatusMessage(phase: PrintJobPhase, result: PrintJobResult | null): string {
  switch (phase) {
    case "idle":
      return "";
    case "sending":
      return "Sending print job...";
    case "waitingForResult":
      return "Waiting for print result...";
    case "success":
      return result?.duration
        ? `Printed successfully (${result.duration}ms)`
        : "Printed successfully";
    case "queued":
      return "Print queued — printer offline, will retry when reconnected";
    case "failed":
      return result?.error
        ? `Print failed: ${result.error}`
        : "Print failed";
    case "timeout":
      return "Print sent but no confirmation received — the bridge may be offline";
    default:
      return "";
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────

/**
 * Hook for sending print jobs with real-time status feedback.
 *
 * @param defaultTimeoutMs  Default timeout for waiting (default: 15000ms).
 *
 * @example
 * const { printAndWait, phase, statusMessage, isPending, reset } = usePrintJob();
 *
 * const handlePrint = async () => {
 *   const result = await printAndWait({
 *     printerEndpoint: 'tcp:001162xxxxxx',
 *     templateId: 'tmpl_abc',
 *     data: { orderNumber: '1042' },
 *   });
 *   // result is the PrintJobResult or null (timeout)
 * };
 */
export function usePrintJob(defaultTimeoutMs: number = 15000): UsePrintJobReturn {
  const ctx = useReceiptKitContext();
  const [phase, setPhase] = useState<PrintJobPhase>("idle");
  const [result, setResult] = useState<PrintJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(false);

  const reset = useCallback(() => {
    activeRef.current = false;
    setPhase("idle");
    setResult(null);
    setError(null);
  }, []);

  const printAndWait = useCallback(
    async (options: PrintOptions, timeoutMs?: number): Promise<PrintJobResult | null> => {
      if (!ctx?.client) {
        setPhase("failed");
        setError("MQTT client not available");
        return null;
      }

      activeRef.current = true;
      setPhase("sending");
      setResult(null);
      setError(null);

      try {
        // Generate jobToken BEFORE publishing so we can register the listener first.
        // This eliminates the race where the bridge responds before our handler is ready.
        const jobToken = `receiptkit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalTimeout = timeoutMs ?? defaultTimeoutMs;

        // Phase 1: Register result listener BEFORE publishing (race-free)
        const resultPromise = new Promise<PrintJobResult | null>((resolve) => {
          const timeout = setTimeout(() => {
            ctx.client.off("printJobResult", handler);
            if (activeRef.current) {
              setPhase("timeout");
              setError("No response from bridge");
            }
            resolve(null);
          }, finalTimeout);

          const handler = (r: PrintJobResult) => {
            if (r.jobToken === jobToken) {
              clearTimeout(timeout);
              ctx.client.off("printJobResult", handler);
              if (activeRef.current) {
                setResult(r);
                setPhase(r.status);
                if (r.status === "failed") {
                  setError(r.error ?? "Print failed");
                }
              }
              resolve(r);
            }
          };

          ctx.client.on("printJobResult", handler as any);
        });

        // Phase 2: Now publish the print job (listener is already active)
        await ctx.client.print({ ...options, jobToken });

        if (!activeRef.current) return null;

        setPhase("waitingForResult");

        return await resultPromise;
      } catch (err) {
        if (!activeRef.current) return null;
        const msg = err instanceof Error ? err.message : "Print failed";
        setPhase("failed");
        setError(msg);
        return null;
      }
    },
    [ctx, defaultTimeoutMs]
  );

  const isPending = phase === "sending" || phase === "waitingForResult";
  const statusMessage = getStatusMessage(phase, result);

  return {
    phase,
    result,
    error,
    isPending,
    statusMessage,
    printAndWait,
    reset,
  };
}
