// src/utilities/signoz.ts
import type * as vscode from "vscode";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const otelLogger = logs.getLogger("copilot-mcp");

// shared attributes you want on every record (can be filled later)
let common: Record<string, any> = {};

/** Call once – after any async look-ups – to set global attributes */
export function setCommonLogAttributes(attrs: Record<string, any>) {
	common = { ...common, ...attrs };
}

export const signozTelemetry: vscode.TelemetrySender = {
	sendEventData(event, data) {
		otelLogger.emit({
			body: event,
			severityNumber: SeverityNumber.INFO,
			severityText: "INFO",
			attributes: { ...common, ...data },
		});
	},

	sendErrorData(error, data) {
		otelLogger.emit({
			body: error.message,
			severityNumber: SeverityNumber.ERROR,
			severityText: "ERROR",
			attributes: {
				...common,
				...data,
				errorName: error.name,
				stack: error.stack ?? "",
			},
		});
	},
};
