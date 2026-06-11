// src/telemetry/sender.ts
//
// Fail-safe TelemetrySender backing vscode.env.createTelemetryLogger.
// Batches events in memory and POSTs them to the public CloudMCP telemetry
// endpoint (https://cloudmcp.run/api/telemetry). Designed so it can never
// break the extension:
//   - enqueue is synchronous and non-throwing; all network I/O is async
//   - a single send attempt per batch; failures are swallowed and dropped
//   - flush() races a 2s timeout so dispose()/deactivate() can never hang
//   - requires global fetch (VS Code >= 1.104 ships Node 20, which has it);
//     if fetch is ever unavailable, events are dropped silently
import type * as vscode from "vscode";

const ENDPOINT = "https://cloudmcp.run/api/telemetry";
const FLUSH_AT = 10; // queued events that trigger an immediate flush
const FLUSH_INTERVAL_MS = 30_000;
const MAX_EVENTS_PER_POST = 20; // endpoint contract
const MAX_PROPS = 12; // endpoint contract
const MAX_STRING = 200; // endpoint contract (server truncates too)
const MAX_QUERY = 100; // search queries are truncated harder at source
const FLUSH_TIMEOUT_MS = 2_000;
const POST_TIMEOUT_MS = 5_000;
const EVENT_NAME_RE = /^ext\.[a-z0-9_.]{1,56}$/;
const PROP_KEY_RE = /^[a-z0-9_]{1,32}$/;
// Scrub PII-ish keys at source even though the server drops them as well:
// account identifiers, auth labels, emails, and tokens must never be sent.
const PII_KEY_RE =
	/(^|_)(user|session|account|email|token|secret|password|auth|key)(_|$)/;

type PropValue = string | number | boolean;

interface BeaconEvent {
	name: string;
	props: Record<string, PropValue>;
	ts: number;
}

/** camelCase → snake_case (dots are preserved for event names). */
function toSnakeCase(value: string): string {
	return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Deterministically maps a TelemetryLogger event name into the `ext.`
 * namespace, e.g. "AutomataLabs.copilot-mcp/webview.aiSetup.success"
 * → "ext.webview.ai_setup.success". Returns undefined (event dropped)
 * when nothing valid remains.
 */
function sanitizeEventName(eventName: string): string | undefined {
	// vscode's TelemetryLogger prefixes event names with "<extension id>/".
	const bare = eventName.slice(eventName.lastIndexOf("/") + 1);
	const suffix = toSnakeCase(bare)
		.replace(/[^a-z0-9_.]/g, "_")
		.slice(0, 56);
	const name = `ext.${suffix}`;
	return EVENT_NAME_RE.test(name) ? name : undefined;
}

function sanitizeProps(
	data?: Record<string, unknown>,
): Record<string, PropValue> {
	const props: Record<string, PropValue> = {};
	if (!data) {
		return props;
	}
	let count = 0;
	for (const [rawKey, value] of Object.entries(data)) {
		if (count >= MAX_PROPS) {
			break;
		}
		const key = toSnakeCase(rawKey)
			.replace(/[^a-z0-9_]/g, "_")
			.slice(0, 32);
		if (!PROP_KEY_RE.test(key) || key in props || PII_KEY_RE.test(key)) {
			continue;
		}
		if (value === null || value === undefined) {
			continue;
		}
		if (typeof value === "number") {
			if (!Number.isFinite(value)) {
				continue;
			}
			props[key] = value;
		} else if (typeof value === "boolean") {
			props[key] = value;
		} else {
			props[key] = String(value).slice(
				0,
				key === "query" ? MAX_QUERY : MAX_STRING,
			);
		}
		count++;
	}
	return props;
}

class CloudMcpTelemetrySender implements vscode.TelemetrySender {
	private queue: BeaconEvent[] = [];
	private timer: NodeJS.Timeout | undefined;

	sendEventData(eventName: string, data?: Record<string, any>): void {
		this.enqueue(eventName, data);
	}

	sendErrorData(error: Error, data?: Record<string, any>): void {
		this.enqueue("error", {
			...data,
			errorName: error?.name ?? "Error",
			errorMessage: error?.message ?? "",
		});
	}

	/**
	 * Called by vscode when the TelemetryLogger is disposed, and by
	 * deactivate(). Races an internal 2s timeout so shutdown can never
	 * hang on the network, and never rejects.
	 */
	flush(): Promise<void> {
		try {
			this.clearTimer();
			const send = this.queue.length
				? this.post(this.queue.splice(0))
				: Promise.resolve();
			const timeout = new Promise<void>((resolve) => {
				const handle = setTimeout(resolve, FLUSH_TIMEOUT_MS);
				handle.unref?.();
			});
			return Promise.race([send, timeout]).catch(() => undefined);
		} catch {
			return Promise.resolve();
		}
	}

	private enqueue(eventName: string, data?: Record<string, unknown>): void {
		try {
			if (typeof fetch !== "function") {
				return; // no transport available — drop silently
			}
			const name = sanitizeEventName(eventName);
			if (!name) {
				return;
			}
			this.queue.push({ name, props: sanitizeProps(data), ts: Date.now() });
			if (this.queue.length >= FLUSH_AT) {
				this.clearTimer();
				void this.post(this.queue.splice(0));
			} else if (!this.timer) {
				this.timer = setTimeout(() => {
					this.timer = undefined;
					if (this.queue.length) {
						void this.post(this.queue.splice(0));
					}
				}, FLUSH_INTERVAL_MS);
				this.timer.unref?.();
			}
		} catch {
			// Telemetry must never throw into callers.
		}
	}

	private clearTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	/** One attempt per batch; every failure is swallowed and the batch dropped. */
	private async post(events: BeaconEvent[]): Promise<void> {
		for (let i = 0; i < events.length; i += MAX_EVENTS_PER_POST) {
			try {
				await fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						events: events.slice(i, i + MAX_EVENTS_PER_POST),
					}),
					signal:
						typeof AbortSignal !== "undefined" &&
						typeof AbortSignal.timeout === "function"
							? AbortSignal.timeout(POST_TIMEOUT_MS)
							: undefined,
				});
			} catch {
				// Drop on failure — no retries, no logging loops.
			}
		}
	}
}

export const cloudMcpTelemetrySender = new CloudMcpTelemetrySender();

/** Flush pending telemetry; bounded by a 2s internal timeout and never throws. */
export function flushTelemetry(): Promise<void> {
	return cloudMcpTelemetrySender.flush();
}
