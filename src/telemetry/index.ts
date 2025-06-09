import * as vscode from "vscode";
import { signozTelemetry } from "../utilities/signoz";
// Filled asynchronously at activation time
export const logger = vscode.env.createTelemetryLogger(signozTelemetry, {
	ignoreBuiltInCommonProperties: false,
	ignoreUnhandledErrors: true,
});

export function getLogger() {
	return logger;
}
