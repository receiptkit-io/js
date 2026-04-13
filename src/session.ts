/**
 * receiptkit — ReceiptKitSession (MQTT transport)
 *
 * Wraps ReceiptKitClient with session-level defaults (templateId, printerId,
 * bridgeId, dotWidth) so callers don't repeat config on every print call.
 *
 * Per-call options in PrintCallOptions take precedence over session defaults.
 * The bridgeId is resolved from the status cache when not supplied explicitly.
 *
 * Imported via "receiptkit/mqtt" — contains an MQTT dependency.
 * For HTTP-only usage, import "receiptkit/http" instead.
 */

import { ReceiptKitClient } from "./client";
import type {
  ReceiptKitConfig,
  PrintOptions,
  SessionConfig,
  PrintCallOptions,
  SessionPrintResult,
} from "./types";

const DEFAULT_BASE_URL = "https://www.receiptkit.io";

export class ReceiptKitSession {
  private readonly config: Required<Pick<SessionConfig, "apiKey" | "orgId" | "transport">> &
    Omit<SessionConfig, "apiKey" | "orgId" | "transport">;
  private client: ReceiptKitClient | null = null;

  constructor(config: SessionConfig) {
    this.config = {
      ...config,
      transport: config.transport ?? "mqtt",
    };

    if (this.config.transport === "mqtt") {
      // Initialize the MQTT client singleton eagerly so connect() can be called.
      const clientConfig: ReceiptKitConfig = {
        apiKey: config.apiKey,
        orgId: config.orgId,
      };
      this.client = ReceiptKitClient.getOrInit(clientConfig);
    }
  }

  /**
   * Connect to the MQTT broker. Must be called before print() when using
   * the "mqtt" transport. No-op for "http" transport.
   */
  async connect(): Promise<void> {
    if (this.config.transport === "mqtt") {
      if (!this.client) {
        const clientConfig: ReceiptKitConfig = {
          apiKey: this.config.apiKey,
          orgId: this.config.orgId,
        };
        this.client = ReceiptKitClient.getOrInit(clientConfig);
      }
      await this.client.connect();
    }
  }

  /**
   * Disconnect the MQTT client. No-op for "http" transport.
   */
  disconnect(): void {
    if (this.config.transport === "mqtt") {
      ReceiptKitClient.destroy();
      this.client = null;
    }
  }

  /**
   * Print a receipt using this session's transport and defaults.
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
    const templateId = options.templateId ?? this.config.templateId;
    const printerId = options.printerId ?? this.config.printerId;
    const dotWidth = options.dotWidth ?? this.config.dotWidth;

    if (this.config.transport === "mqtt") {
      return this._printViaMqtt(options, { templateId, printerId, dotWidth });
    } else {
      return this._printViaHttp(options, { templateId, printerId, dotWidth });
    }
  }

  // ─── MQTT Transport ─────────────────────────────────────────────────

  private async _printViaMqtt(
    options: PrintCallOptions,
    resolved: { templateId?: string; printerId?: string; dotWidth?: number }
  ): Promise<SessionPrintResult> {
    if (!this.client) {
      throw new Error(
        "[ReceiptKitSession] MQTT client not initialized. Call connect() first."
      );
    }

    const printerId = resolved.printerId;
    if (!printerId) {
      throw new Error(
        "[ReceiptKitSession] printerId is required for MQTT transport. " +
          "Set it in SessionConfig or pass it per-call."
      );
    }

    // Resolve bridgeId: per-call → session default → status cache lookup by MAC
    let bridgeId = options.bridgeId ?? this.config.bridgeId;
    if (!bridgeId) {
      const cached = this.client.getStatusCache().getPrinter(printerId);
      if (cached) {
        bridgeId = cached.bridgeId;
      }
    }

    if (!bridgeId) {
      throw new Error(
        "[ReceiptKitSession] bridgeId could not be resolved for MQTT transport. " +
          "Set it in SessionConfig, pass it per-call, or ensure the status cache is warm."
      );
    }

    const printOptions: PrintOptions = {
      printerId,
      bridgeId,
      data: options.data,
      drawer: options.drawer,
      ...(resolved.templateId && { templateId: resolved.templateId }),
      ...(resolved.dotWidth !== undefined && { dotWidth: resolved.dotWidth }),
    };

    const result = await this.client.printAndWait(printOptions);

    if (result.timedOut) {
      return {
        jobToken: result.jobToken,
        status: "timeout",
        transport: "mqtt",
      };
    }

    return {
      jobToken: result.jobToken,
      status: result.result!.status,
      duration: result.result!.duration,
      error: result.result!.error,
      transport: "mqtt",
    };
  }

  // ─── HTTP Transport ─────────────────────────────────────────────────

  private async _printViaHttp(
    options: PrintCallOptions,
    resolved: { templateId?: string; printerId?: string; dotWidth?: number }
  ): Promise<SessionPrintResult> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}/api/bridge/print`;

    const body: Record<string, unknown> = {
      data: options.data,
      drawer: options.drawer,
      waitForResult: true,
    };

    if (resolved.printerId) body.printerId = resolved.printerId;
    if (resolved.templateId) body.templateId = resolved.templateId;
    if (resolved.dotWidth !== undefined) body.dotWidth = resolved.dotWidth;

    const bridgeId = options.bridgeId ?? this.config.bridgeId;
    if (bridgeId) body.bridgeId = bridgeId;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        "x-org-id": this.config.orgId,
      },
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
