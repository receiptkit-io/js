/**
 * receiptkit — ReceiptKitClient
 *
 * Framework-agnostic MQTT client for ReceiptKit.
 * Designed as a global singleton with auto-reconnect, status caching,
 * and synchronous status checks.
 */

import mqtt, { type MqttClient } from "mqtt";
import { StatusCache } from "./status-cache";
import { createTopicBuilders, type TopicBuilders } from "./topics";
import type {
  ReceiptKitConfig,
  ReceiptKitEvents,
  ReceiptKitEventName,
  MqttConnectionStatus,
  PrintOptions,
  PrintJobMessage,
  PrintHandle,
  PrintAndWaitResult,
  PrintJobResult,
  PrintJobStatus,
  BridgeStatusResponse,
  LivePrinterStatus,
  CachedBridgeStatus,
  LivePrinter,
} from "./types";
import { topicMatchesFilter, normalizePrinterEndpoint, printerEndpointToLegacyId, printerEndpointToMac } from "./types";
import { parseRawAsb } from "./asb-parser";

// ─── Defaults ──────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "a3cdv9umpaq1po-ats.iot.us-east-1.amazonaws.com";
const DEFAULT_AUTHORIZER = "CpAuthorizer";

/** Presence message payload for LWT birth/death. */
interface PresencePayload {
  online: boolean;
  bridgeId: string;
  timestamp: string;
}

// ─── Singleton ─────────────────────────────────────────────────────────

let _instance: ReceiptKitClient | null = null;

// ─── Types for internal subscription tracking ──────────────────────────

type MessageHandler = (topic: string, payload: Record<string, unknown>) => void;

interface InternalSubscription {
  topic: string;
  handler: MessageHandler;
}

// ─── Client ────────────────────────────────────────────────────────────

export class ReceiptKitClient {
  private client: MqttClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private config: Required<
    Pick<ReceiptKitConfig, "environment" | "autoSubscribeStatus" | "keepalive" | "reconnectPeriod" | "connectTimeout">
  > & ReceiptKitConfig;
  private topics: TopicBuilders;
  private statusCache: StatusCache;
  private subscriptions: InternalSubscription[] = [];
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private _status: MqttConnectionStatus = "disconnected";
  private visibilityHandler: (() => void) | null = null;
  private reconnectAttempts = 0;
  private connectTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private defaultSource: string;
  private maxConnectRetries = 3;
  private connectRetryDelay = 3000;

  // Debug logging — enabled by default in development
  private debug: boolean;

  // ─── Constructor ────────────────────────────────────────────────────

  private constructor(config: ReceiptKitConfig) {
    this.config = {
      ...config,
      environment: config.environment ?? (typeof window !== "undefined" ? "browser" : "server"),
      autoSubscribeStatus: config.autoSubscribeStatus ?? true,
      keepalive: config.keepalive ?? 60,
      reconnectPeriod: config.reconnectPeriod ?? 5000,
      connectTimeout: config.connectTimeout ?? 10000,
    };
    this.topics = createTopicBuilders(this.config);
    this.statusCache = new StatusCache();

    // Enable debug logging by default in development
    this.debug = config.debug ?? (typeof window !== "undefined" 
      ? window.location.hostname === "localhost" 
      : process.env.NODE_ENV !== "production");

    // Resolve default source: explicit config > auto-detect from environment
    this.defaultSource = config.defaultSource
      ?? (this.config.environment === "browser" && typeof window !== "undefined"
        ? window.location.hostname || "browser"
        : "server");
  }

  // ─── Debug Logging ──────────────────────────────────────────────────

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[ReceiptKitClient]", ...args);
    }
  }

  private logWarn(...args: unknown[]): void {
    if (this.debug) {
      console.warn("[ReceiptKitClient]", ...args);
    }
  }

  // ─── Singleton Management ───────────────────────────────────────────

  /**
   * Initialize the global ReceiptKitClient singleton.
   * Call this once at app startup (or in a React provider).
   * **Always destroys** the previous instance — use `getOrInit` for
   * re-entrant contexts (React Strict Mode).
   *
   * @example
   * ReceiptKitClient.init({ apiKey: 'rk_pub_...', orgId: 'org_abc' })
   */
  static init(config: ReceiptKitConfig): ReceiptKitClient {
    if (_instance) {
      _instance.disconnect();
    }
    _instance = new ReceiptKitClient(config);
    return _instance;
  }

  /**
   * Get the existing singleton or create a new one.
   *
   * Unlike `init()`, this does **not** destroy an existing connected instance.
   * Designed for React providers that may re-mount due to Strict Mode or
   * hot-module replacement — the live MQTT connection and cached data survive.
   */
  static getOrInit(config: ReceiptKitConfig): ReceiptKitClient {
    if (!_instance) {
      _instance = new ReceiptKitClient(config);
    }
    return _instance;
  }

  /** Get the global singleton. Throws if not initialized. */
  static getInstance(): ReceiptKitClient {
    if (!_instance) {
      throw new Error(
        "[receiptkit] Not initialized. Call ReceiptKitClient.init() first."
      );
    }
    return _instance;
  }

  /** Check if the singleton has been initialized. */
  static isInitialized(): boolean {
    return _instance !== null;
  }

  /** Destroy the singleton (disconnect + cleanup). */
  static destroy(): void {
    if (_instance) {
      _instance.disconnect();
      _instance = null;
    }
  }

  // ─── Connection ─────────────────────────────────────────────────────

  /** Connect to AWS IoT Core via WebSocket. Resolves when connected. */
  async connect(): Promise<void> {
    if (this.client?.connected) {
      this.log("Already connected, skipping connect()");
      return;
    }

    // If already connecting, wait for it
    if (this.connectPromise) {
      this.log("Connection already in-flight, waiting...");
      return this.connectPromise;
    }

    this.connectPromise = this._connectWithRetry();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Internal connect with retry logic.
   * On failure, retries up to maxConnectRetries times before giving up.
   */
  private async _connectWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxConnectRetries; attempt++) {
      try {
        this.log(`Connection attempt ${attempt}/${this.maxConnectRetries}`);
        await this._connect();
        return; // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logWarn(`Connection attempt ${attempt} failed: ${msg}`);

        if (attempt < this.maxConnectRetries) {
          this.log(`Retrying in ${this.connectRetryDelay}ms...`);
          await new Promise((r) => setTimeout(r, this.connectRetryDelay));
        }
      }
    }

    // All retries exhausted — leave mqtt.js running if it exists so its
    // built-in reconnect can still succeed (events will fire).
    this.logWarn("All connection attempts failed, mqtt.js auto-reconnect still active");
    throw new Error("MQTT connection failed after retries");
  }

  private async _connect(): Promise<void> {
    // Clean up stale client
    if (this.client) {
      this.log("Cleaning up previous client");
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
      this.client = null;
    }

    const endpoint = this.config.endpoint ?? DEFAULT_ENDPOINT;
    const authorizer = this.config.authorizer ?? DEFAULT_AUTHORIZER;

    // MQTT auth: orgId as username (identity), apiKey as password (secret)
    const username = this.config.orgId;
    const password = this.config.apiKey;

    const wsUrl = `wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`;

    const prefix = this.config.clientIdPrefix ?? "receiptkit";
    const envTag = this.config.environment === "server" ? "server" : "browser";
    const uniqueId =
      this.config.environment === "server"
        ? `${process.pid}-${Date.now()}`
        : `${Math.random().toString(36).slice(2, 8)}-${Date.now()}`;
    const clientId = `${prefix}-${envTag}-${uniqueId}`;

    this.setStatus("connecting");
    this.log("Connecting to", wsUrl.split("?")[0], "as", clientId);

    // Build LWT will for bridge-mode clients.
    // When the bridge disconnects, the broker publishes this death message
    // as a retained message so any future subscriber instantly knows
    // the bridge is offline.
    const willOptions = this.config.bridgeId
      ? {
          will: {
            topic: this.topics.bridgePresence(this.config.bridgeId),
            payload: JSON.stringify({
              online: false,
              bridgeId: this.config.bridgeId,
              timestamp: new Date().toISOString(),
            } satisfies PresencePayload),
            qos: 1 as const,
            retain: true,
          },
        }
      : {};

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const client = mqtt.connect(wsUrl, {
        protocol: "wss",
        protocolVersion: 4,
        clean: true,
        clientId,
        username,
        password,
        connectTimeout: this.config.connectTimeout,
        reconnectPeriod: this.config.reconnectPeriod,
        keepalive: this.config.keepalive,
        ...willOptions,
      });

      // Timeout for the initial connection promise only.
      // IMPORTANT: Do NOT call client.end() on timeout — let mqtt.js
      // continue reconnecting in the background.  The `connect` event
      // handlers are attached to the client instance and will still fire
      // if/when mqtt.js succeeds later, keeping the React status in sync.
      const timeout = setTimeout(() => {
        this.connectTimeoutHandle = null;
        if (!settled) {
          settled = true;
          this.logWarn(`Initial connect timed out after ${this.config.connectTimeout}ms (mqtt.js still reconnecting)`);
          // Don't kill the client — let mqtt.js keep trying.
          // The event handlers below will still fire on success/failure.
          reject(new Error("MQTT connection timed out"));
        }
      }, this.config.connectTimeout);
      this.connectTimeoutHandle = timeout;

      client.on("connect", () => {
        clearTimeout(timeout);
        this.connectTimeoutHandle = null;
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        this.log("Connected!");
        this.emit("connect");

        // Re-subscribe all tracked subscriptions
        for (const sub of this.subscriptions) {
          client.subscribe(sub.topic, { qos: 1 });
        }

        // Auto-subscribe to all to-client messages (status, print-result, presence)
        if (this.config.autoSubscribeStatus) {
          const toClientTopic = this.topics.allToClient();
          const alreadySubscribed = this.subscriptions.some(
            (s) => s.topic === toClientTopic
          );
          if (!alreadySubscribed) {
            this._internalSubscribe(toClientTopic, this.handleToClientMessage.bind(this));
          }
          client.subscribe(toClientTopic, { qos: 1 });
        }

        // Bridge-mode: publish retained birth message.
        // Any future subscriber to the presence topic will immediately
        // receive this message, giving instant online/offline awareness.
        if (this.config.bridgeId) {
          const birthTopic = this.topics.bridgePresence(this.config.bridgeId);
          const birthPayload: PresencePayload = {
            online: true,
            bridgeId: this.config.bridgeId,
            timestamp: new Date().toISOString(),
          };
          client.publish(birthTopic, JSON.stringify(birthPayload), {
            qos: 1,
            retain: true,
          });
        }

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      client.on("message", (topic: string, message: Buffer) => {
        try {
          const payload = JSON.parse(message.toString());
          for (const sub of this.subscriptions) {
            if (topicMatchesFilter(topic, sub.topic)) {
              sub.handler(topic, payload);
            }
          }
          this.emit("message", topic, payload);
        } catch {
          // Ignore non-JSON messages
        }
      });

      client.on("error", (err: Error) => {
        this.logWarn("MQTT error:", err.message);
        this.setStatus("error");
        this.emit("error", err);
        if (!settled && !client.connected) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      client.on("close", () => {
        this.log("Connection closed");
        this.setStatus("disconnected");
        this.emit("disconnect");
      });

      client.on("reconnect", () => {
        this.reconnectAttempts++;
        this.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
        this.setStatus("connecting");
        this.emit("reconnect");
      });

      this.client = client;

      // Browser: setup visibility handling
      if (this.config.environment === "browser") {
        this.setupVisibilityHandling();
      }
    });
  }

  /** Disconnect and clean up. */
  disconnect(): void {
    this.teardownVisibilityHandling();

    // Clear the connect timeout so a stale timeout from a previous
    // _connect() call cannot fire after destruction (React Strict Mode).
    if (this.connectTimeoutHandle) {
      clearTimeout(this.connectTimeoutHandle);
      this.connectTimeoutHandle = null;
    }

    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.connectPromise = null;
    this.setStatus("disconnected");
  }

  // ─── Synchronous Status Checks ──────────────────────────────────────

  /** Check if the MQTT connection is currently active. */
  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /** Get current connection status. */
  get status(): MqttConnectionStatus {
    return this._status;
  }

  /** Check if a printer is online (from status cache). Returns false if unknown. */
  isPrinterOnline(mac: string): boolean {
    return this.statusCache.isPrinterOnline(mac);
  }

  /** Get full printer status from cache. */
  getPrinterStatus(mac: string): LivePrinterStatus | null {
    return this.statusCache.getPrinter(mac)?.status ?? null;
  }

  /** Get full bridge status from cache. */
  getBridgeStatus(bridgeId: string): CachedBridgeStatus | null {
    return this.statusCache.getBridge(bridgeId);
  }

  /** Check if a bridge is online (from cache). */
  isBridgeOnline(bridgeId: string): boolean {
    return this.statusCache.isBridgeOnline(bridgeId);
  }

  /** Get all cached bridge statuses. */
  getAllBridges(): Map<string, CachedBridgeStatus> {
    return this.statusCache.getAllBridges();
  }

  /** Get the status cache instance (for subscribing to changes). */
  getStatusCache(): StatusCache {
    return this.statusCache;
  }

  /** Get the topic builders (for advanced use). */
  getTopics(): TopicBuilders {
    return this.topics;
  }

  /** Get the orgId this client was configured with. */
  getOrgId(): string {
    return this.config.orgId;
  }

  // ─── Print ──────────────────────────────────────────────────────────

  /**
   * Send a print job to a printer.
   * Connects if not already connected, publishes with QoS 1.
   */
  async print(options: PrintOptions): Promise<PrintHandle> {
    const printerIdentity = options.printerEndpoint ?? options.printerId;
    if (!printerIdentity) {
      throw new Error("[ReceiptKitClient] printerEndpoint or printerId is required.");
    }

    const printerEndpoint = normalizePrinterEndpoint(printerIdentity);
    const topic = this.topics.print(options.bridgeId);

    const jobToken = options.jobToken ?? `receiptkit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const message: PrintJobMessage = {
      title: "print-job",
      jobToken,
      printerEndpoint,
      printerId: printerEndpointToLegacyId(printerEndpoint),
      data: options.data,
      dotWidth: options.dotWidth,  // omit → bridge uses printer's native width
      drawer: options.drawer ?? "NONE",
      source: options.source ?? this.defaultSource,
      publishedAt: options.publishedAt ?? new Date().toISOString(),
    };

    if (options.templateId) {
      message.templateId = options.templateId;
    }
    if (options.template) {
      message.template = options.template;
    }
    if (options.templateVersion != null) {
      message.templateVersion = options.templateVersion;
    }

    await this.publish(topic, message);
    return { jobToken };
  }

  /**
   * Send a print job and wait for the bridge's result.
   *
   * Combines `print()` with listening for the `printJobResult` event.
   * Resolves when the bridge reports back, or when the timeout expires.
   *
   * Eager retry: re-publishes the same jobToken every `retryIntervalMs`
   * until a result is received or `timeoutMs` is reached.  The bridge's
   * jobToken deduplication ensures only the first delivery is processed;
   * subsequent publishes are silently ignored.
   *
   * @param options  Print options (same as `print()`).
   * @param timeoutMs  Max time to wait for a result (default: 10000ms).
   * @param retryIntervalMs  Interval between retry publishes (default: 2000ms).
   * @returns  The print result, or a timeout indicator.
   */
  async printAndWait(
    options: PrintOptions,
    timeoutMs: number = 10000,
    retryIntervalMs: number = 2000
  ): Promise<PrintAndWaitResult> {
    // Generate jobToken up front so we can listen BEFORE publishing.
    // This eliminates any race where the bridge responds before the
    // handler is registered (bridge pipeline can be <30ms).
    const jobToken = options.jobToken ?? `receiptkit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const resultPromise = new Promise<PrintAndWaitResult>((resolve) => {
      const timeout = setTimeout(() => {
        clearInterval(retryInterval);
        this.off("printJobResult", handler);
        resolve({ jobToken, result: null, timedOut: true });
      }, timeoutMs);

      const handler = (result: PrintJobResult) => {
        if (result.jobToken === jobToken) {
          clearTimeout(timeout);
          clearInterval(retryInterval);
          this.off("printJobResult", handler);
          resolve({ jobToken, result, timedOut: false });
        }
      };

      this.on("printJobResult", handler as any);

      // Eager retry: re-publish the same jobToken every retryIntervalMs.
      // Bridge-side dedup discards duplicates, so only the first delivery
      // that reaches the bridge is actually processed.
      const retryInterval = setInterval(() => {
        this.print({ ...options, jobToken }).catch(() => {});
      }, retryIntervalMs);
    });

    // Now publish — the listener is already active
    await this.print({ ...options, jobToken });

    return resultPromise;
  }

  // ─── Request/Response Patterns ──────────────────────────────────────

  /**
   * Request a specific bridge's status and wait for the response.
   * Returns the parsed response or null if timed out.
   *
   * Uses the already-subscribed wildcard topic to listen for the response
   * rather than subscribing to a bridge-specific topic — this avoids
   * IoT policy violations under the restricted rk_pub_ policy.
   */
  async requestBridgeStatus(
    bridgeId: string,
    timeoutMs: number = 3000
  ): Promise<BridgeStatusResponse | null> {
    const pollTopic = this.topics.bridgeStatusPoll(bridgeId);

    return new Promise<BridgeStatusResponse | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.off("bridgeStatus", handler);
        resolve(null);
      }, timeoutMs);

      // Listen on the "bridgeStatus" event (fired by handleToClientMessage
      // which is subscribed to the wildcard allToClient topic)
      const handler = (eventBridgeId: string, response: BridgeStatusResponse) => {
        if (eventBridgeId === bridgeId) {
          clearTimeout(timeout);
          this.off("bridgeStatus", handler);
          resolve(response);
        }
      };

      this.on("bridgeStatus", handler as any);

      this.publish(pollTopic, {
        command: "status-poll",
        requestPrinterStatus: true,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    });
  }

  /**
   * Discover all online bridges. Broadcasts a discover message and
   * collects responses for the specified duration.
   *
   * Uses the already-subscribed wildcard topic (via autoSubscribeStatus)
   * to collect responses, avoiding extra subscriptions that could
   * violate the restricted IoT policy.
   */
  async discoverBridges(
    timeoutMs: number = 5000
  ): Promise<Map<string, BridgeStatusResponse>> {
    const results = new Map<string, BridgeStatusResponse>();
    const discoverTopic = this.topics.bridgeDiscover();

    return new Promise<Map<string, BridgeStatusResponse>>((resolve) => {
      const timeout = setTimeout(() => {
        this.off("bridgeStatus", handler);
        resolve(results);
      }, timeoutMs);

      // Listen on the "bridgeStatus" event (fired by handleToClientMessage
      // which is subscribed to the wildcard allToClient topic)
      const handler = (bridgeId: string, response: BridgeStatusResponse) => {
        results.set(bridgeId, response);
      };

      this.on("bridgeStatus", handler as any);

      const ts = new Date().toISOString();
      this.publish(discoverTopic, { type: "discover", timestamp: ts }).catch(() => {});
    });
  }

  // ─── Raw Pub/Sub ────────────────────────────────────────────────────

  /**
   * Publish a message. Auto-connects if needed.
   * Returns a promise that resolves on QoS 1 PUBACK.
   */
  async publish(topic: string, payload: object): Promise<void> {
    await this.ensureConnected();
    const client = this.client!;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MQTT publish timed out"));
      }, 5000);

      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Publish a raw string payload with full control over QoS and retain.
   * Used by bridge adapters that need retained presence messages.
   */
  async publishRaw(
    topic: string,
    payload: string,
    opts: { qos?: 0 | 1; retain?: boolean },
  ): Promise<void> {
    await this.ensureConnected();
    const client = this.client!;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MQTT publish timed out"));
      }, 5000);

      client.publish(
        topic,
        payload,
        { qos: opts.qos ?? 1, retain: opts.retain ?? false },
        (err) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  /**
   * Subscribe to a topic with a message handler.
   * Returns an unsubscribe function.
   */
  subscribe(topic: string, handler: MessageHandler): () => void {
    const sub: InternalSubscription = { topic, handler };
    this.subscriptions.push(sub);

    // Subscribe on the wire if connected
    if (this.client?.connected) {
      this.client.subscribe(topic, { qos: 1 });
    }

    // Return unsubscribe function
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
      const stillUsed = this.subscriptions.some((s) => s.topic === topic);
      if (!stillUsed && this.client?.connected) {
        this.client.unsubscribe(topic);
      }
    };
  }

  // ─── Events ─────────────────────────────────────────────────────────

  /** Subscribe to client events. */
  on<K extends ReceiptKitEventName>(event: K, handler: ReceiptKitEvents[K]): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /** Unsubscribe from client events. */
  off<K extends ReceiptKitEventName>(event: K, handler: ReceiptKitEvents[K]): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.client?.connected) return;
    await this.connect();
  }

  private _internalSubscribe(topic: string, handler: MessageHandler): void {
    const sub: InternalSubscription = { topic, handler };
    this.subscriptions.push(sub);
  }

  private handleToClientMessage(topic: string, payload: Record<string, unknown>): void {
    // Determine message type from the last segment of the topic:
    //   to-client/{bridgeId}/status       → bridge status response
    //   to-client/{bridgeId}/print-result  → print job result
    //   to-client/{bridgeId}/presence      → LWT birth/death
    const lastSegment = topic.split("/").pop();

    if (lastSegment === "status") {
      this.handleBridgeStatus(topic, payload);
    } else if (lastSegment === "print-result") {
      this.handlePrintResult(payload);
    } else if (lastSegment === "presence") {
      this.handlePresenceMessage(topic, payload);
    }
  }

  private handleBridgeStatus(_topic: string, payload: Record<string, unknown>): void {
    const response = this.parseBridgeResponse(payload);
    if (response) {
      this.statusCache.updateFromBridgeResponse(response);
      this.emit("bridgeStatus", response.bridgeId, response);

      // Emit individual printer status events
      if (response.printers) {
        for (const printer of response.printers) {
          this.emit("printerStatus", printer.printerEndpoint ?? printer.mac, printer.status, response.bridgeId);
        }
      }
    }
  }

  /**
   * Handle a print-result message from the bridge.
   * Parses the result and emits the `printJobResult` event.
   */
  private handlePrintResult(payload: Record<string, unknown>): void {
    const jobToken = payload.jobToken as string | undefined;
    if (!jobToken) return;

    const success = payload.success as boolean | undefined;
    const errorMsg = payload.error as string | null | undefined;

    // Derive status: success=true → "success", error contains "queued" → "queued", else → "failed"
    let status: PrintJobStatus = "failed";
    if (success) {
      status = "success";
    } else if (typeof errorMsg === "string" && errorMsg.toLowerCase().includes("queued")) {
      status = "queued";
    }

    const result: PrintJobResult = {
      jobToken,
      status,
      printerEndpoint: (payload.printerEndpoint as string) ?? (payload.printerId as string) ?? (payload.printerMac as string) ?? "",
      printerMac: (payload.printerMac as string) ?? printerEndpointToMac((payload.printerEndpoint as string) ?? "") ?? "",
      bridgeId: (payload.bridgeId as string) ?? "",
      error: errorMsg ?? undefined,
      duration: (payload.duration as number) ?? undefined,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };

    this.log(`Print result: status=${status}, jobToken=${jobToken}`);
    this.emit("printJobResult", result);
  }

  /**
   * Handle bridge presence (LWT) messages.
   * Birth: { online: true, bridgeId, timestamp }
   * Death (LWT): { online: false, bridgeId, timestamp }
   */
  private handlePresenceMessage(_topic: string, payload: Record<string, unknown>): void {
    const bridgeId = payload.bridgeId as string | undefined;
    if (!bridgeId) return;

    const online = payload.online as boolean | undefined;

    if (online === false) {
      // LWT death message — bridge disconnected
      this.statusCache.markBridgeOffline(bridgeId);
      this.emit("bridgeStatus", bridgeId, {
        online: false,
        bridgeId,
        timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
        type: "unknown",
        printers: [],
        stats: null,
        software: null,
        updateInfo: null,
        lastUpdated: Date.now(),
      } as CachedBridgeStatus);
    } else if (online === true) {
      // Birth message — bridge just connected. Mark online in cache.
      const existing = this.statusCache.getBridge(bridgeId);
      if (existing) {
        // Restore online flag, keep existing printer data
        this.statusCache.updateFromBridgeResponse({
          ...existing,
          online: true,
          timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
        });
      } else {
        this.statusCache.updateFromBridgeResponse({
          online: true,
          bridgeId,
          timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
          type: "unknown",
          printers: [],
          stats: null,
          software: null,
          updateInfo: null,
        });
      }

      // Immediately poll the bridge for its full printer list.
      // The presence birth only signals online — it has no printer data.
      // Without this, we'd wait for the next discover interval (5 min).
      if (this.client?.connected) {
        const pollTopic = this.topics.bridgeStatusPoll(bridgeId);
        this.client.publish(
          pollTopic,
          JSON.stringify({
            command: "status-poll",
            requestPrinterStatus: true,
            timestamp: new Date().toISOString(),
          }),
          { qos: 1 },
        );
      }
    }
  }

  private parseBridgeResponse(
    payload: Record<string, unknown>
  ): BridgeStatusResponse | null {
    if (!payload || typeof payload !== "object") return null;

    const bridgeId = payload.bridgeId as string | undefined;
    if (!bridgeId) return null;

    // Cast the raw printer list from the bridge payload
    const rawPrinters = (payload.printers as LivePrinter[]) ?? [];

    // Re-parse status from raw ASB bytes when available.
    // This decouples status accuracy from bridge software version —
    // fixes to the ASB parser deployed to the dashboard take effect
    // immediately without requiring a bridge update.
    const printers = rawPrinters.map((p) => {
      const rawHex = (p.status as unknown as Record<string, unknown>)?.rawStatus as string | undefined;
      if (rawHex) {
        const parsed = parseRawAsb(rawHex);
        if (parsed) {
          // Preserve the bridge-provided lastCheck timestamp and online state
          parsed.lastCheck = p.status?.lastCheck ?? null;
          return { ...p, status: parsed };
        }
      }
      return p;
    });

    return {
      online: true,
      timestamp:
        (payload.timestamp as string) ?? new Date().toISOString(),
      bridgeId,
      type: (payload.type as string) ?? "unknown",
      printers,
      stats: (payload.stats as BridgeStatusResponse["stats"]) ?? null,
      software: (payload.software as BridgeStatusResponse["software"]) ?? null,
      updateInfo: (payload.updateInfo as BridgeStatusResponse["updateInfo"]) ?? null,
    };
  }

  private setStatus(status: MqttConnectionStatus): void {
    this._status = status;
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as Function)(...args);
      } catch {
        // Don't let listener errors break the client
      }
    }
  }

  // ─── Visibility Handling (Browser) ──────────────────────────────────

  private setupVisibilityHandling(): void {
    if (typeof document === "undefined") return;

    this.visibilityHandler = () => {
      if (!document.hidden) {
        // Tab became visible: reconnect if needed.
        // We intentionally do NOT disconnect on tab hide — the MQTT
        // keep-alive handles idle connections, and disconnecting causes
        // missed LWT birth/death messages during brief tab switches.
        if (!this.client?.connected) {
          this.connect().catch(() => {
            // Reconnect errors handled by event handlers
          });
        }
      }
    };

    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private teardownVisibilityHandling(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
