// src/utilities/logging.ts
import { logs } from "@opentelemetry/api-logs";
import {
	LoggerProvider,
	BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const exporter = new OTLPLogExporter({
	// Explicit URL → the exporter will **not** append /v1/logs when this is set
	url: "https://events.automatalabs.io/v1/logs",
	headers: { "signoz-access-token": process.env.SIGNOZ_TOKEN ?? "" },
});

const provider = new LoggerProvider({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "copilot-mcp-extension",
	}),
});

provider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));

// Register globally
logs.setGlobalLoggerProvider(provider);

// Graceful shutdown on reload / quit
export async function shutdownLogs() {
	await provider.shutdown();
}
