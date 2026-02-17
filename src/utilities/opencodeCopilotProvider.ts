const VENDORED_PROVIDER_MODULE = "@copilot-mcp/opencode-copilot";

export type OpenaiCompatibleModelId = string;
export type OpenaiCompatibleLanguageModel = unknown;

export interface OpenaiCompatibleProviderSettings {
  apiKey?: string;
  baseURL?: string;
  name?: string;
  headers?: Record<string, string>;
  fetch?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
}

export interface OpenaiCompatibleProvider {
  (modelId: OpenaiCompatibleModelId): OpenaiCompatibleLanguageModel;
  chat(modelId: OpenaiCompatibleModelId): OpenaiCompatibleLanguageModel;
  responses(modelId: OpenaiCompatibleModelId): OpenaiCompatibleLanguageModel;
  languageModel(modelId: OpenaiCompatibleModelId): OpenaiCompatibleLanguageModel;
}

export interface VendoredOpencodeCopilotModule {
  createOpenaiCompatible(
    options?: OpenaiCompatibleProviderSettings,
  ): OpenaiCompatibleProvider;
  openaiCompatible: OpenaiCompatibleProvider;
}

// Intentionally loaded lazily so root TS checks do not pull vendor TS sources
// into the extension compilation graph.
export async function loadVendoredOpencodeCopilotModule(): Promise<VendoredOpencodeCopilotModule> {
  return (await import(VENDORED_PROVIDER_MODULE)) as VendoredOpencodeCopilotModule;
}

export async function createOpenaiCompatible(
  options?: OpenaiCompatibleProviderSettings,
): Promise<OpenaiCompatibleProvider> {
  const vendoredModule = await loadVendoredOpencodeCopilotModule();
  return vendoredModule.createOpenaiCompatible(options);
}

export async function openaiCompatible(): Promise<OpenaiCompatibleProvider> {
  const vendoredModule = await loadVendoredOpencodeCopilotModule();
  return vendoredModule.openaiCompatible;
}
