import * as vscode from "vscode";
import { BridgeMessage } from "./types";

/**
 * BridgeChannel — typed message relay between the webview panel and the
 * extension host. Forwards BridgeMessage objects bidirectionally and
 * monitors inspector liveness via a heartbeat mechanism.
 */
export class BridgeChannel {
  private readonly panel: vscode.WebviewPanel;
  private readonly messageCallbacks: Array<(msg: BridgeMessage) => void> = [];
  private readonly connectionLostCallbacks: Array<() => void> = [];
  private readonly connectionRestoredCallbacks: Array<() => void> = [];

  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;
  private disposed = false;

  private static readonly HEARTBEAT_TIMEOUT_MS = 5_000;

  private readonly disposable: vscode.Disposable;

  constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;

    this.disposable = panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (this.disposed) return;
      const msg = raw as BridgeMessage;
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;

      if (msg.type === "inspector_ready") {
        this.handleInspectorReady();
      }

      for (const cb of this.messageCallbacks) {
        cb(msg);
      }
    });

    panel.onDidDispose(() => {
      this.dispose();
    });
  }

  /** Send a typed message to the webview (and ultimately the page). */
  sendToPage(msg: BridgeMessage): void {
    if (this.disposed) return;
    this.panel.webview.postMessage(msg);
  }

  /** Register a callback for every incoming BridgeMessage. */
  onMessage(callback: (msg: BridgeMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  /** Register a callback fired when the inspector connection is lost. */
  onConnectionLost(callback: () => void): void {
    this.connectionLostCallbacks.push(callback);
  }

  /** Register a callback fired when the inspector connection is restored. */
  onConnectionRestored(callback: () => void): void {
    this.connectionRestoredCallbacks.push(callback);
  }

  /** Whether the inspector is currently connected. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Clean up timers and listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHeartbeatTimer();
    this.disposable.dispose();
  }

  // ── Heartbeat internals ──────────────────────────────────────────────

  private handleInspectorReady(): void {
    const wasDisconnected = !this.connected;
    this.connected = true;
    this.resetHeartbeatTimer();

    if (wasDisconnected && this.connectionRestoredCallbacks.length > 0) {
      for (const cb of this.connectionRestoredCallbacks) {
        cb();
      }
    }
  }

  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.onHeartbeatTimeout();
    }, BridgeChannel.HEARTBEAT_TIMEOUT_MS);
  }

  private onHeartbeatTimeout(): void {
    if (this.disposed || !this.connected) return;
    this.connected = false;
    for (const cb of this.connectionLostCallbacks) {
      cb();
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== undefined) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
