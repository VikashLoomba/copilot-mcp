import * as vscode from "vscode";
import { cloudMcpTelemetrySender } from "./sender";

// TelemetryLogger gives us telemetry.telemetryLevel compliance and built-in
// PII scrubbing for free; the sender behind it batches events to the public
// CloudMCP telemetry endpoint. Built-in common properties are skipped: they
// include machine/session identifiers we never want to send, and they would
// blow the endpoint's 12-property budget.
export const logger = vscode.env.createTelemetryLogger(cloudMcpTelemetrySender, {
	ignoreBuiltInCommonProperties: true,
	ignoreUnhandledErrors: true,
});

export function getLogger() {
	return logger;
}

export { flushTelemetry } from "./sender";
