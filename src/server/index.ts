/**
 * receiptkit/server
 *
 * Server-side MQTT client for Vercel API routes / Node.js.
 *
 * Maintains a persistent module-scoped singleton that survives across
 * Vercel warm starts. The singleton is lazily initialized on the first
 * call to `getServerClient(config)` — the caller provides the API key
 * and orgId (typically extracted from the incoming request's auth).
 *
 * Subsequent calls reuse the existing connection. If the orgId changes
 * (different org calling), the client is re-initialized.
 */

import { ReceiptKitClient } from "../client";
import type { ReceiptKitConfig } from "../types";

// Track the orgId the singleton was initialized with
let _currentOrgId: string | null = null;

// ─── Server Singleton ──────────────────────────────────────────────────

/**
 * Get the server-side ReceiptKitClient singleton.
 *
 * On first call (cold start), initializes with the provided config and connects.
 * On subsequent calls, reuses the existing connection if the orgId matches.
 * If orgId changes, tears down and reconnects with the new credentials.
 */
export async function getServerClient(config: {
  apiKey: string;
  orgId: string;
}): Promise<ReceiptKitClient> {
  // Re-initialize if org changed (multi-tenant future-proofing)
  if (ReceiptKitClient.isInitialized() && _currentOrgId !== config.orgId) {
    ReceiptKitClient.destroy();
    _currentOrgId = null;
  }

  if (!ReceiptKitClient.isInitialized()) {
    ReceiptKitClient.init({
      apiKey: config.apiKey,
      orgId: config.orgId,
      environment: "server",
      endpoint: process.env.MQTT_ENDPOINT ?? undefined,
      authorizer: process.env.MQTT_AUTHORIZER ?? undefined,
      clientIdPrefix: "receiptkit-server",
      autoSubscribeStatus: false,
    });
    _currentOrgId = config.orgId;
  }

  const client = ReceiptKitClient.getInstance();
  if (!client.isConnected()) {
    await client.connect();
  }
  return client;
}

/**
 * Publish a message using the server singleton.
 * Handles connection reuse, QoS 1 acknowledgment, and 5s timeout.
 */
export async function serverPublish(
  config: { apiKey: string; orgId: string },
  topic: string,
  payload: object
): Promise<void> {
  const client = await getServerClient(config);
  await client.publish(topic, payload);
}

/**
 * Subscribe, publish, and collect responses with a timeout.
 * Used for request/response patterns like bridge discovery.
 */
export async function serverRequestResponse<T>(
  config: { apiKey: string; orgId: string },
  opts: {
    subscribeTopic: string;
    publishTopic: string | string[];
    publishPayload: object | object[];
    timeoutMs: number;
    onMessage: (topic: string, payload: Buffer) => T | null;
    shouldResolveEarly?: (results: T[]) => boolean;
  }
): Promise<T[]> {
  const client = await getServerClient(config);
  const results: T[] = [];

  return new Promise<T[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve(results);
    }, opts.timeoutMs);

    const unsub = client.subscribe(
      opts.subscribeTopic,
      (topic: string, payload: Record<string, unknown>) => {
        // Convert payload back to Buffer for backward compatibility
        const buf = Buffer.from(JSON.stringify(payload));
        const result = opts.onMessage(topic, buf);
        if (result !== null) {
          results.push(result);
          if (opts.shouldResolveEarly?.(results)) {
            clearTimeout(timeout);
            unsub();
            resolve(results);
          }
        }
      }
    );

    // Publish request(s)
    const topics = Array.isArray(opts.publishTopic)
      ? opts.publishTopic
      : [opts.publishTopic];
    const payloads = Array.isArray(opts.publishPayload)
      ? opts.publishPayload
      : [opts.publishPayload];

    for (let i = 0; i < topics.length; i++) {
      const payload = payloads[i] || payloads[0];
      client.publish(topics[i], payload).catch((err) => {
        clearTimeout(timeout);
        unsub();
        reject(err);
      });
    }
  });
}

// ─── Re-export for convenience ─────────────────────────────────────────

export { ReceiptKitClient } from "../client";
export { createTopicBuilders, createInternalTopicBuilders } from "../topics";
export type { ReceiptKitConfig, PrintOptions, PrintHandle, PrintAndWaitResult, PrintJobResult } from "../types";

/**
 * Send a print job and wait for the bridge's result (server-side).
 *
 * Since the server client has autoSubscribeStatus: false (no auto-subscription
 * to to-client messages), this function subscribes to the print-result topic
 * with a handler that emits the `printJobResult` event. Then calls
 * `printAndWait()` which listens for that event.
 */
export async function serverPrintAndWait(
  config: { apiKey: string; orgId: string },
  options: import("../types").PrintOptions,
  timeoutMs: number = 10000
): Promise<import("../types").PrintAndWaitResult> {
  const client = await getServerClient(config);

  // Subscribe to print-result messages from all bridges.
  // This enables printAndWait() to receive the printJobResult event
  // even without autoSubscribeStatus.
  const printResultTopic = `receiptkit/org/${config.orgId}/to-client/+/print-result`;
  const unsub = client.subscribe(printResultTopic, (_topic: string, payload: Record<string, unknown>) => {
    const jobToken = payload.jobToken as string | undefined;
    if (!jobToken) return;

    const success = payload.success as boolean | undefined;
    const errorMsg = payload.error as string | null | undefined;
    let status: "success" | "queued" | "failed" = "failed";
    if (success) status = "success";
    else if (typeof errorMsg === "string" && errorMsg.toLowerCase().includes("queued")) status = "queued";

    const result = {
      jobToken,
      status,
      printerMac: (payload.printerMac as string) ?? "",
      bridgeId: (payload.bridgeId as string) ?? "",
      error: errorMsg ?? undefined,
      duration: (payload.duration as number) ?? undefined,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
    // Emit directly — printAndWait is listening for this event
    (client as any).emit("printJobResult", result);
  });

  try {
    const result = await client.printAndWait(options, timeoutMs);
    return result;
  } finally {
    unsub();
  }
}
