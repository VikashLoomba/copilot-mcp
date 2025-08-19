import type { ExtensionContext } from "vscode";

export interface CloudMcpIndexResult {
  success: boolean;
  message?: string;
  error?: string;
  serverName?: string;
  details?: any;
}

// Types for CloudMCP API arguments
export interface CloudMcpArgument {
  type: 'positional' | 'named';
  name?: string;
  value?: string;
  value_hint?: string;
  description?: string;
  is_required?: boolean;
  format?: string;
  is_secret?: boolean;
  default?: string;
  is_repeated?: boolean;
  variables?: Record<string, {
    description?: string;
    is_required?: boolean;
    format?: string;
    is_secret?: boolean;
  }>;
}

export interface CloudMcpEnvironmentVariable {
  name: string;
  description?: string;
  is_required?: boolean;
  format?: string;
  is_secret?: boolean;
  value?: string;
}

export interface CloudMcpPackage {
  registry_name: string;
  name: string;
  version: string;
  runtime_hint?: string;
  runtime_arguments?: CloudMcpArgument[];
  package_arguments?: CloudMcpArgument[];
  environment_variables?: CloudMcpEnvironmentVariable[];
}

export interface CloudMcpSearchResult {
  id: string;
  name: string;
  description: string;
  repository: {
    url: string;
    source: string;
    id: string;
  };
  version_detail?: {
    version: string;
    release_date: string;
    is_latest: boolean;
  };
  packages?: CloudMcpPackage[];
  remotes?: any[];
  isSaved: boolean;
}

// Types for installation configuration (what openMcpInstallUri expects)
export interface InstallConfigInput {
  type: 'promptString';
  id: string;
  description: string;
  password: boolean;
}

export interface InstallConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  inputs: InstallConfigInput[];
}

// Result type for checkRepositories
export interface CloudMcpCheckResult {
  success: boolean;
  exists: boolean;
  installConfig?: InstallConfig;
  error?: string;
}


export class CloudMcpIndexer {
  private static instance: CloudMcpIndexer;
  private context: ExtensionContext | undefined;
  
  private constructor() {}

  static getInstance(): CloudMcpIndexer {
    if (!CloudMcpIndexer.instance) {
      CloudMcpIndexer.instance = new CloudMcpIndexer();
    }
    return CloudMcpIndexer.instance;
  }

  initialize(context: ExtensionContext) {
    this.context = context;
  }
















}

// Export singleton instance
export const cloudMcpIndexer = CloudMcpIndexer.getInstance();

// Need to import vscode for authentication


