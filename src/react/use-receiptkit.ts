"use client";

/**
 * receiptkit/react — useReceiptKit
 *
 * Core React hook for the ReceiptKitClient. Provides connection status,
 * print method, and raw pub/sub access.
 */

import { useCallback } from "react";
import { useReceiptKitContext } from "./provider";
import type {
  MqttConnectionStatus,
  PrintOptions,
  PrintHandle,
  PrintAndWaitResult,
  BridgeStatusResponse,
} from "../types";
import type { TopicBuilders } from "../topics";

interface UseReceiptKitReturn {
  /** Current MQTT connection status. */
  status: MqttConnectionStatus;
  /** Whether the MQTT connection is active. */
  isConnected: boolean;
  /** Send a print job to a printer. Returns the jobToken. */
  print: (options: PrintOptions) => Promise<PrintHandle>;
  /** Send a print job and wait for the bridge's result. */
  printAndWait: (options: PrintOptions, timeoutMs?: number) => Promise<PrintAndWaitResult>;
  /** Publish a raw MQTT message. */
  publish: (topic: string, payload: object) => void;
  /** Subscribe to a topic. Returns an unsubscribe function. */
  subscribe: (
    topic: string,
    handler: (topic: string, payload: Record<string, unknown>) => void
  ) => () => void;
  /** Request a specific bridge's status. */
  requestBridgeStatus: (
    bridgeId: string,
    timeoutMs?: number
  ) => Promise<BridgeStatusResponse | null>;
  /** Discover all online bridges. */
  discoverBridges: (
    timeoutMs?: number
  ) => Promise<Map<string, BridgeStatusResponse>>;
  /** Get the org-scoped topic builders. */
  getTopics: () => TopicBuilders | null;
  /** Get the orgId this client was configured with. */
  getOrgId: () => string | null;
}

const noop = () => {};
const noopSubscribe = () => noop;
const noopPrint = async () => ({ jobToken: "" });
const noopPrintAndWait = async () => ({ jobToken: "", result: null, timedOut: true });
const noopAsyncNull = () => Promise.resolve(null);
const noopAsyncMap = () => Promise.resolve(new Map());

/**
 * Core hook for interacting with the ReceiptKit MQTT client.
 *
 * Must be used inside a <ReceiptKitProvider>.
 *
 * @example
 * const { isConnected, print } = useReceiptKit()
 *
 * if (isConnected) {
 *   await print({ printerEndpoint: 'tcp:00:11:62:32:5a:2a', data: { orderNumber: '1042' } })
 * }
 */
export function useReceiptKit(): UseReceiptKitReturn {
  const ctx = useReceiptKitContext();

  const print = useCallback(
    async (options: PrintOptions): Promise<PrintHandle> => {
      if (!ctx?.client) return { jobToken: "" };
      return ctx.client.print(options);
    },
    [ctx]
  );

  const printAndWait = useCallback(
    async (options: PrintOptions, timeoutMs?: number): Promise<PrintAndWaitResult> => {
      if (!ctx?.client) return { jobToken: "", result: null, timedOut: true };
      return ctx.client.printAndWait(options, timeoutMs);
    },
    [ctx]
  );

  const publish = useCallback(
    (topic: string, payload: object) => {
      if (!ctx?.client?.isConnected()) return;
      ctx.client.publish(topic, payload);
    },
    [ctx]
  );

  const subscribe = useCallback(
    (
      topic: string,
      handler: (topic: string, payload: Record<string, unknown>) => void
    ): (() => void) => {
      if (!ctx?.client) return noop;
      return ctx.client.subscribe(topic, handler);
    },
    [ctx]
  );

  const requestBridgeStatus = useCallback(
    async (bridgeId: string, timeoutMs?: number) => {
      if (!ctx?.client) return null;
      return ctx.client.requestBridgeStatus(bridgeId, timeoutMs);
    },
    [ctx]
  );

  const discoverBridges = useCallback(
    async (timeoutMs?: number) => {
      if (!ctx?.client) return new Map();
      return ctx.client.discoverBridges(timeoutMs);
    },
    [ctx]
  );

  const getTopics = useCallback(() => {
    if (!ctx?.client) return null;
    return ctx.client.getTopics();
  }, [ctx]);

  const getOrgId = useCallback(() => {
    if (!ctx?.client) return null;
    return ctx.client.getOrgId();
  }, [ctx]);

  if (!ctx) {
    return {
      status: "disconnected",
      isConnected: false,
      print: noopPrint as UseReceiptKitReturn["print"],
      printAndWait: noopPrintAndWait as UseReceiptKitReturn["printAndWait"],
      publish: noop as UseReceiptKitReturn["publish"],
      subscribe: noopSubscribe as UseReceiptKitReturn["subscribe"],
      requestBridgeStatus:
        noopAsyncNull as UseReceiptKitReturn["requestBridgeStatus"],
      discoverBridges: noopAsyncMap as UseReceiptKitReturn["discoverBridges"],
      getTopics: () => null,
      getOrgId: () => null,
    };
  }

  return {
    status: ctx.status,
    isConnected: ctx.status === "connected",
    print,
    printAndWait,
    publish,
    subscribe,
    requestBridgeStatus,
    discoverBridges,
    getTopics,
    getOrgId,
  };
}
