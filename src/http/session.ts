/**
 * receiptkit — ReceiptKitSession (HTTP-only transport)
 *
 * HTTP-only implementation of ReceiptKitSession. Has exactly the same
 * interface as the MQTT version but sends all print jobs via fetch() to
 * the /api/bridge/print endpoint. Contains ZERO mqtt package dependency.
 *
 * Imported via "receiptkit/http".
 * For MQTT transport, import "receiptkit/mqtt" instead.
 */

import type {
  SessionConfig,
  PrintCallOptions,
  SessionPrintResult,
} from "../types";

const DEFAULT_BASE_URL = "https://www.receiptkit.io";

export class ReceiptKitSession {
  private readonly config: Required<Pick<SessionConfig, "apiKey" | "transport">> &
    Omit<SessionConfig, "apiKey" | "transport">;

  constructor(config: SessionConfig) {
    if (config.transport === "mqtt") {
      throw new Error(
        '[ReceiptKitSession] Cannot use transport "mqtt" in the HTTP-only build. ' +
          'Import from "receiptkit/mqtt" instead.'
      );
    }
    this.config = {
      ...config,
      transport: "http",
    };
  }

  /** No-op — HTTP sessions require no connection setup. */
  async connect(): Promise<void> {}

  /** No-op — HTTP sessions have no persistent connection to tear down. */
  disconnect(): void {}

  /**
   * Print a receipt via HTTP to /api/bridge/print.
   *
   * Per-call options override session defaults. `data` and `drawer` are
   * always required at the call site.
   *
   * @example
   * const result = await session.print({
   *   data: { order: { total: "$12.99" } },
   *   drawer: "START",
   * });
   */
  async print(options: PrintCallOptions): Promise<SessionPrintResult> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}/api/bridge/print`;

    const templateId = options.templateId ?? this.config.templateId;
    const printerEndpoint = options.printerEndpoint ?? this.config.printerEndpoint;
    const dotWidth = options.dotWidth ?? this.config.dotWidth;
    const bridgeId = options.bridgeId ?? this.config.bridgeId;

    const body: Record<string, unknown> = {
      data: options.data,
      drawer: options.drawer,
      waitForResult: true,
    };

    if (printerEndpoint) body.printerEndpoint = printerEndpoint;
    if (templateId) body.templateId = templateId;
    if (dotWidth !== undefined) body.dotWidth = dotWidth;
    if (bridgeId) body.bridgeId = bridgeId;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (this.config.orgId) {
      headers["x-org-id"] = this.config.orgId;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      return {
        jobToken: "",
        status: "failed",
        error: `HTTP ${response.status}: ${text}`,
        transport: "http",
      };
    }

    const json = (await response.json()) as {
      jobToken?: string;
      status?: string;
      duration?: number;
      error?: string;
    };

    const status = json.status as SessionPrintResult["status"] | undefined;

    return {
      jobToken: json.jobToken ?? "",
      status: status ?? "failed",
      duration: json.duration,
      error: json.error,
      transport: "http",
    };
  }
}
