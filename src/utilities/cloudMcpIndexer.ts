import type { ExtensionContext } from "vscode";
import { logEvent, logError } from "../telemetry/standardizedTelemetry";
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "./const";
import { f, ax, AxGenerateError } from '@ax-llm/ax';
import { outputLogger } from "./outputLogger";

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
  private readonly baseUrl = "https://cloudmcp.run";
  private context: ExtensionContext | undefined;
  
  // Cache for CloudMCP check results
  private cache: Map<string, { result: CloudMcpCheckResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

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

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.CACHE_TTL;
  }

  /**
   * Get cache key for a repository
   */
  private getCacheKey(repo: { url: string; fullName?: string }): string {
    // Use fullName if available, otherwise use URL
    return repo.fullName || repo.url;
  }

  /**
   * Check a single repository against CloudMCP with caching
   */
  async checkSingleRepository(repo: { url: string; name: string; fullName?: string }): Promise<CloudMcpCheckResult> {
    const cacheKey = this.getCacheKey(repo);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp)) {
      outputLogger.debug(`[CloudMCP] Returning cached result for ${repo.name}`);
      return cached.result;
    }

    try {
      // Always attempt to index/update the repository
      outputLogger.debug(`[CloudMCP] Sending index request for ${repo.name}`);
      
      const indexResult = await this.sendIndexRequest({
        repositoryUrl: repo.url,
        serverName: repo.name
      }).catch(err => ({success: false, details: undefined, error: err instanceof Error ? err.message : 'Unknown error', serverName: repo.name}));
      
      // Check if repository is already indexed in CloudMCP
      const cloudMcpServer = await this.searchRepository(repo.url);
      
      if (cloudMcpServer && cloudMcpServer.packages && cloudMcpServer.packages.length > 0) {
        // Repository exists in CloudMCP
        const selectedPackage = this.selectBestPackage(cloudMcpServer.packages);
        
        if (selectedPackage) {
          const installConfig = this.transformPackageToInstallFormat(selectedPackage);
          
          const result: CloudMcpCheckResult = {
            success: true,
            exists: true,
            installConfig
          };
          
          // Cache the result
          this.cache.set(cacheKey, { result, timestamp: Date.now() });
          
          // Also cache by URL if we have a fullName
          if (repo.fullName) {
            this.cache.set(repo.url, { result, timestamp: Date.now() });
          }
          
          logEvent({
            name: "cloudmcp.check.found" as const,
            properties: {
              serverName: repo.name,
              repositoryUrl: repo.url,
              packageType: selectedPackage.registry_name,
              cached: false
            }
          });
          
          return result;
        }
      }
      
      // If indexing succeeded but no server found in search, use the extracted details
      if (indexResult.success && indexResult.details) {
        const installConfig = this.createInstallConfigFromExtractedDetails(repo.name, indexResult.details);
        
        const result: CloudMcpCheckResult = {
          success: true,
          exists: false,
          installConfig
        };
        
        // Cache the result
        this.cache.set(cacheKey, { result, timestamp: Date.now() });
        
        // Also cache by URL if we have a fullName
        if (repo.fullName) {
          this.cache.set(repo.url, { result, timestamp: Date.now() });
        }
        
        return result;
      } else {
        // Failed to index
        const result: CloudMcpCheckResult = {
          success: false,
          exists: false,
          error: indexResult.error
        };
        
        // Don't cache failures
        return result;
      }
    } catch (error) {
      outputLogger.error(`Error checking repository ${repo.name}`, error as Error);
      return {
        success: false,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Search CloudMCP for a repository to check if it's already indexed
   * @param repositoryUrl The GitHub repository URL to search for
   * @returns CloudMCP search result or null if not found
   */
  async searchRepository(repositoryUrl: string): Promise<CloudMcpSearchResult | null> {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        return null;
      }

      const searchUrl = `${this.baseUrl}/api/mcp/search?q=${encodeURIComponent(repositoryUrl)}`;
      const response = await fetch(searchUrl, {
        method: "GET",
        headers: {
          "x-github-token": githubToken
        }
      });

      if (!response.ok) {
        outputLogger.warn(`CloudMCP search failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      // Check if we have servers that match this repository URL
      if (data.servers && Array.isArray(data.servers)) {
        const matchingServer = data.servers.find((server: CloudMcpSearchResult) => 
          server.repository?.url === repositoryUrl
        );
        return matchingServer || null;
      }

      return null;
    } catch (error) {
      outputLogger.error("Error searching CloudMCP", error as Error);
      return null;
    }
  }

  /**
   * Transform CloudMCP package to the format expected by openMcpInstallUri
   */
  public transformPackageToInstallFormat(selectedPackage: CloudMcpPackage): InstallConfig {
    const result: InstallConfig = {
      name: selectedPackage.name,
      command: selectedPackage.runtime_hint || this.getCommandFromRegistry(selectedPackage.registry_name),
      args: [],
      env: {},
      inputs: []
    };

    // Build args array from runtime_arguments and package_arguments
    if (selectedPackage.runtime_arguments && Array.isArray(selectedPackage.runtime_arguments)) {
      for (const arg of selectedPackage.runtime_arguments) {
        if (arg.type === 'positional') {
          result.args.push(arg.value || arg.value_hint || '');
        } else if (arg.type === 'named' && arg.name) {
          result.args.push(arg.name);
          if (arg.value) {
            result.args.push(arg.value);
          }
        }
      }
    }


    // Add package arguments
    if (selectedPackage.package_arguments && Array.isArray(selectedPackage.package_arguments)) {
      for (const arg of selectedPackage.package_arguments) {
        if (arg.type === 'positional') {
          // Handle template variables in positional arguments
          const value = arg.value || arg.value_hint || '';
          if (value.includes('${input:')) {
            // Extract input variable name
            const match = value.match(/\$\{input:(\w+)\}/);
            if (match) {
              const inputId = match[1];
              result.args.push(`\${input:${inputId}}`);
              
              // Add to inputs if not already present
              if (!result.inputs.find(input => input.id === inputId)) {
                result.inputs.push({
                  type: "promptString",
                  id: inputId,
                  description: arg.description || inputId,
                  password: false
                });
              }
            }
          } else {
            result.args.push(value);
          }
        } else if (arg.type === 'named' && arg.name) {
          result.args.push(arg.name);
          if (arg.value) {
            result.args.push(arg.value);
          }
        }
      }
    }
    // Add package name as first argument after runtime arguments
    if (selectedPackage.name && !result.args.includes(selectedPackage.name)) {
      result.args.unshift(selectedPackage.name);
    }

    // Process environment variables
    if (selectedPackage.environment_variables && Array.isArray(selectedPackage.environment_variables)) {
      for (const envVar of selectedPackage.environment_variables) {
        const envValue = envVar.value || `\${input:${this.camelCase(envVar.name)}}`;
        result.env[envVar.name] = envValue;

        // If it references an input, add to inputs array
        if (envValue.includes('${input:')) {
          const match = envValue.match(/\$\{input:(\w+)\}/);
          if (match) {
            const inputId = match[1];
            if (!result.inputs.find(input => input.id === inputId)) {
              result.inputs.push({
                type: "promptString",
                id: inputId,
                description: envVar.description || envVar.name,
                password: envVar.is_secret || false
              });
            }
          }
        }
      }
    }

    return result;
  }

  private getCommandFromRegistry(registryName: string): string {
    switch (registryName) {
      case 'npm':
        return 'npx';
      case 'pypi':
        return 'uvx';
      case 'docker':
        return 'docker';
      default:
        return 'npx';
    }
  }

  private camelCase(str: string): string {
    return str.toLowerCase()
      .replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())
      .replace(/^([A-Z])/, (_match, letter) => letter.toLowerCase());
  }

  /**
   * Create InstallConfig from extracted details (from README parsing)
   * This handles the case where we had to extract details ourselves
   */
  private createInstallConfigFromExtractedDetails(serverName: string, details: any): InstallConfig {
    // Handle both array and single object formats
    const packages = Array.isArray(details) ? details : [details];
    
    if (packages.length === 0) {
      throw new Error('No package details available');
    }

    const pkg = packages[0];
    const installConfig: InstallConfig = {
      name: pkg.name || serverName,
      command: pkg.runtime_hint ? pkg.runtime_hint : this.getCommandFromRegistry(pkg.registry_name || 'npm'),
      args: [],
      env: {},
      inputs: []
    };

    // Add package name if available
    if (pkg.name) {
      installConfig.args.push(pkg.name);
    }

    // Process runtime arguments if available
    if (pkg.runtime_arguments && Array.isArray(pkg.runtime_arguments)) {
      for (const arg of pkg.runtime_arguments) {
        if (arg.value && !installConfig.args.includes(arg.value) && arg.is_required && !installConfig.args[0].includes(arg.value)) {
          installConfig.args.push(arg.value);
        }
      }
    }

    // Process package arguments if available
    if (pkg.package_arguments && Array.isArray(pkg.package_arguments)) {
      for (const arg of pkg.package_arguments) {
        if (arg.value && !installConfig.args.includes(arg.value) && arg.is_required && !installConfig.args[0].includes(arg.value)) {
          installConfig.args.push(arg.value);
        }
      }
    }

    // Process environment variables
    if (pkg.environment_variables && Array.isArray(pkg.environment_variables)) {
      for (const envVar of pkg.environment_variables) {
        const inputId = this.camelCase(envVar.name);
        installConfig.env[envVar.name] = `\${input:${inputId}}`;
        installConfig.inputs.push({
          type: "promptString",
          id: inputId,
          description: envVar.description || envVar.name,
          password: envVar.is_secret || false
        });
      }
    }

    return installConfig;
  }

  /**
   * Select the best package from available packages
   * Priority: npm/npx > pypi/uvx > docker > others
   */
  private selectBestPackage(packages: CloudMcpPackage[]): CloudMcpPackage | null {
    if (!packages || packages.length === 0) {
      return null;
    }

    // Priority order
    const priorityMap: Record<string, number> = {
      'npm': 1,
      'pypi': 2,
      'docker': 3
    };

    // Sort packages by priority
    const sortedPackages = packages.sort((a, b) => {
      const aPriority = priorityMap[a.registry_name] || 999;
      const bPriority = priorityMap[b.registry_name] || 999;
      return aPriority - bPriority;
    });

    return sortedPackages[0];
  }

  /**
   * Check repositories against CloudMCP and return installation details
   */
  async checkRepositories(repositories: Array<{ url: string; name: string; fullName?: string }>): Promise<Map<string, CloudMcpCheckResult>> {
    const resultsMap = new Map<string, CloudMcpCheckResult>();
    
    for (const repo of repositories) {
      try {
        // Always attempt to index/update the repository
        outputLogger.debug(`[CloudMCP] Sending index request for ${repo.name}`);
        
        const indexResult = await this.sendIndexRequest({
          repositoryUrl: repo.url,
          serverName: repo.name
        });
        
        // Check if repository is already indexed in CloudMCP
        const cloudMcpServer = await this.searchRepository(repo.url);
        
        if (cloudMcpServer && cloudMcpServer.packages && cloudMcpServer.packages.length > 0) {
          // Select the best package
          const selectedPackage = this.selectBestPackage(cloudMcpServer.packages);
          
          if (selectedPackage) {
            const installConfig = this.transformPackageToInstallFormat(indexResult.details);
            
            const resultObject = {
              success: true,
              exists: true,
              installConfig
            };
            
            // Store by both URL and fullName for easy lookup
            resultsMap.set(repo.url, resultObject);
            
            if (repo.fullName) {
              resultsMap.set(repo.fullName, resultObject);
            }
            
            logEvent({
              name: "cloudmcp.check.found" as const,
              properties: {
                serverName: repo.name,
                repositoryUrl: repo.url,
                packageType: selectedPackage.registry_name
              }
            });
          }
        } else if (indexResult.success && indexResult.details) {
          // If indexing succeeded but no server found in search, use the extracted details
          const installConfig = this.createInstallConfigFromExtractedDetails(repo.name, indexResult.details);

          resultsMap.set(repo.url, {
            success: true,
            exists: false,
            installConfig
          });
          
          if (repo.fullName) {
            resultsMap.set(repo.fullName, {
              success: true,
              exists: false,
              installConfig
            });
          }
        } else {
          // Failed to index
          resultsMap.set(repo.url, {
            success: false,
            exists: false,
            error: indexResult.error
          });
          
          if (repo.fullName) {
            resultsMap.set(repo.fullName, {
              success: false,
              exists: false,
              error: indexResult.error
            });
          }
        }
      } catch (error) {
        outputLogger.error(`Error checking repository ${repo.name}`, error as Error);
        resultsMap.set(repo.url, {
          success: false,
          exists: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (repo.fullName) {
          resultsMap.set(repo.fullName, {
            success: false,
            exists: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    return resultsMap;
  }


  async sendIndexRequest(request: { repositoryUrl: string; serverName: string }): Promise<CloudMcpIndexResult> {
    try {
      // Get GitHub token from context
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        return {
          success: false,
          error: "GitHub token not available",
          serverName: request.serverName
        };
      }

      // Extract owner and repo from URL
      const githubUrlPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/)?$/;
      const match = request.repositoryUrl.match(githubUrlPattern);
      
      if (!match) {
        return {
          success: false,
          error: "Invalid GitHub URL format",
          serverName: request.serverName
        };
      }
      
      const owner = match[1];
      const repo = match[2];

      const preExtractedDetails = await extractServerDetails(githubToken, request.repositoryUrl, repo, owner);
       outputLogger.warn("Pre-extracted server details", preExtractedDetails);
      if ('success' in preExtractedDetails && preExtractedDetails.success === false) {
        outputLogger.error("Error extracting server details", new Error(preExtractedDetails.error));
        return {
          success: false,
          error: preExtractedDetails.error,
          serverName: request.serverName
        };
      }


      

      const response = await fetch(`${this.baseUrl}/api/mcp/import-oss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-token": githubToken
        },
        body: JSON.stringify({
          repository_url: request.repositoryUrl,
          packages: preExtractedDetails,
          owner: owner,
          repository: repo
        })
      });

      
      const data = await response.json(); 
      if (response.ok) {
        
        outputLogger.debug("Successfully sent index request to CloudMCP", data);
        return {
          success: true,
          message: "Server published successfully",
          serverName: request.serverName,
          details: preExtractedDetails
        };
      } else {
        // const errorResponse = await response.text();
        outputLogger.warn("[sendIndexRequest]Failed to send index request to CloudMCP but axlm succeeded", {
          status: response.status,
          statusText: response.statusText,
          error: 'error' in data ? data.error : undefined,
          endpoint: response.url
        });
        // Handle specific error cases
        return {
            success: true,
            message: "Server already exists in CloudMCP",
            serverName: request.serverName,
            details: preExtractedDetails
        };
      }
    } catch (error) {
      outputLogger.error("Error sending index request to CloudMCP", error as Error);
      logError(error as Error, "cloudMcpIndexer.sendIndexRequest");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
        serverName: request.serverName
      };
    }
  }

  private async getGitHubToken(): Promise<string | undefined> {
    if (!this.context) {
      return undefined;
    }

    try {
      // Try to get GitHub token from VSCode authentication API using the same scopes as extension activation
      const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, { createIfNone: false });
      return session?.accessToken;
    } catch (error) {
      outputLogger.warn("Could not get GitHub token for CloudMCP indexing", error as Error);
      return undefined;
    }
  }
}

// Export singleton instance
export const cloudMcpIndexer = CloudMcpIndexer.getInstance();

// Need to import vscode for authentication
import * as vscode from "vscode";
import { CopilotChatProvider } from "./CopilotChat";


export const extractServerDetails = async (accessToken: string, repositoryUrl: string, repoName: string, repoOwner: string) => {
    // Initialize Octokit with the access token
    const { Octokit } = await import('@octokit/rest');
    console.log("Have token? ", accessToken);
    console.log("Repository URL: ", repositoryUrl);
    const octokit = new Octokit({
        auth: accessToken,
    });

    // Parse the repository URL to get owner and repo
    const [owner, repo] = repositoryUrl.split('/').slice(-2);
    outputLogger.info("Parsed owner and repo: ", owner, repo);
    // First, fetch the readme.md file of the repository
    try {
      // Get README directly using the getReadme function
      const readme = await getExampleReadme(accessToken, `${repoOwner}/${repoName}`);

      outputLogger.debug(`Fetched README.md from ${repositoryUrl}, length: ${readme.length}`);
  
      // Then, use the readme content to extract the server details
      const serverDetails = await extractServerDetailsFromReadme(accessToken, readme);
      return serverDetails;
    } catch (error) {
      return {
          success: false,
          error: `Failed to fetch README.md from ${repositoryUrl}: ${error instanceof Error ? error.message : error}`,
          serverName: repo
        };
    }
};

export const extractServerDetailsFromReadme = async (accessToken: string, readmeContent: string, asArray: boolean = true) => {
    const gen = ax`
        readmeContent:${f.string('README.md content from a GitHub repository')} ->
        registry_name:${f.optional(f.string('Registry name for the server (npm, docker, pypi, git)'))},
        name:${f.string('Package name')},
        version:${f.string('Version, e.g., 1.0.0, latest, main, stable, etc.')},
        runtime_hint:${f.optional(f.string('Runtime hint for execution (e.g., npx, uvx, pipx, docker)'))},
        runtime_arguments:${f.optional(f.array(f.json('Runtime argument objects with type, value, description, is_required, format, value_hint fields')))},
        package_arguments:${f.optional(f.array(f.json('Package argument objects with type, value, description, is_required, format, value_hint fields')))},
        environment_variables:${f.optional(f.array(f.json('Environment variable objects with name, description, is_required, format, is_secret fields')))}
    `;
    gen.setExamples(await exampleURLAndResponses(accessToken));

    try {
        const result = await gen.forward(CopilotChatProvider.getInstance().provider, {
            readmeContent: readmeContent
        }, {
            model: 'gpt-4.1',
            modelConfig: {
              maxTokens: 111452
            }
        });
        const details = {
            registry_name: result.registry_name,
            name: result.name,
            version: result.version || "latest",
            ...(result.runtime_hint && { runtime_hint: result.runtime_hint }),
            ...(result.runtime_arguments && { runtime_arguments: result.runtime_arguments }),
            ...(result.package_arguments && { package_arguments: result.package_arguments }),
            ...(result.environment_variables && { environment_variables: result.environment_variables })
        };
        if (!asArray) {
            return details as CloudMcpPackage;
        }
        // Return as an array of packages (API expects packages array)
        return [details];
    } catch (error) {
        if (error instanceof AxGenerateError) {
            return {
                error: error.message,
                stack: error.stack,
                response: error.name
            };
        } else {
            return {
                error: error
            };
        }
    }
};

const getExampleReadme = async (accessToken: string, repoOwnerAndName: string) => {
    // Initialize Octokit with the access token
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({
        auth: accessToken
    });

    // Parse the repository owner and name
    const [owner, repo] = repoOwnerAndName.split('/');

    // Get the readme.md file of the repository, using the access token as the credentials
    const { data: readmeData } = await octokit.repos.getReadme({
        owner,
        repo
    });
    const readmeContent = Buffer.from(readmeData.content, 'base64').toString('utf-8');
    return readmeContent;
};

const exampleURLAndResponses = async (accessToken: string) => [
    {
        readmeContent: await getExampleReadme(accessToken, 'mark3labs/mcp-filesystem-server'),
        registry_name: "docker",
        runtime_hint: "docker",
        name: "mark3labs/mcp-filesystem-server",
        version: "latest",
        package_arguments: [
            {
                type: "positional",
                value: "ghcr.io/mark3labs/mcp-filesystem-server:latest",
                description: "Run container image",
                is_required: true,
                format: "string",
                value_hint: "ghcr.io/mark3labs/mcp-filesystem-server:latest"
            },
            {
                type: "positional",
                value: "/path/to/allowed/directory",
                description: "Allowed directory path",
                is_required: true,
                format: "string",
                value_hint: "/path/to/allowed/directory"
            }
        ]
    },
    {
      readmeContent: await getExampleReadme(accessToken, "ppl-ai/modelcontextprotocol"),
      registry_name: "docker",
      name: "perplexity-ask",
      version: "latest",
      package_arguments: [
          {
              type: "positional",
              value: "run",
              description: "Docker run command",
              is_required: true,
              format: "string",
              value_hint: "run"
          },
          {
              type: "flag",
              value: "-i",
              description: "Keep STDIN open even if not attached",
              is_required: false,
              format: "string",
              value_hint: "-i"
          },
          {
              type: "flag",
              value: "--rm",
              description: "Automatically remove container when it exits",
              is_required: false,
              format: "string",
              value_hint: "--rm"
          },
          {
              type: "flag",
              value: "-e",
              description: "Set environment variable",
              is_required: true,
              format: "string",
              value_hint: "-e"
          },
          {
              type: "positional",
              value: "PERPLEXITY_API_KEY",
              description: "Environment variable name to pass to container",
              is_required: true,
              format: "string",
              value_hint: "PERPLEXITY_API_KEY"
          },
          {
              type: "positional",
              value: "mcp/perplexity-ask",
              description: "Docker container image",
              is_required: true,
              format: "string",
              value_hint: "mcp/perplexity-ask"
          }
      ],
      environment_variables: [
          {
              name: "PERPLEXITY_API_KEY",
              description: "YOUR_API_KEY_HERE",
              is_required: true,
              format: "string",
              is_secret: true
          }
      ]
  },
    {
        readmeContent: await getExampleReadme(accessToken, "microsoft/playwright-mcp"),
        registry_name: "npm",
        name: "playwright-mcp",
        version: "latest",
        package_arguments: [
            {
                type: "positional",
                value: "@microsoft/playwright-mcp@latest",
                description: "Microsoft Playwright MCP package",
                is_required: true,
                format: "string",
                value_hint: "@microsoft/playwright-mcp@latest"
            }
        ]
    },
    {
        readmeContent: await getExampleReadme(accessToken, "upstash/context7"),
        registry_name: "npm",
        name: "context7",
        version: "latest",
        package_arguments: [
            {
                type: "flag",
                value: "-y",
                description: "Auto-confirm installation",
                is_required: false,
                format: "string",
                value_hint: "-y"
            },
            {
                type: "positional",
                value: "@upstash/context7@latest",
                description: "Upstash Context7 package",
                is_required: true,
                format: "string",
                value_hint: "@upstash/context7@latest"
            }
        ]
    },
    {
        readmeContent: await getExampleReadme(accessToken, "21st-dev/magic-mcp"),
        registry_name: "npm",
        name: "@21st-dev/magic",
        version: "latest",
        package_arguments: [
            {
                type: "flag",
                value: "-y",
                description: "Auto-confirm installation",
                is_required: false,
                format: "string",
                value_hint: "-y"
            },
            {
                type: "positional",
                value: "@21st-dev/magic@latest",
                description: "21st.dev Magic MCP package",
                is_required: true,
                format: "string",
                value_hint: "@21st-dev/magic@latest"
            }
        ],
        environment_variables: [
            {
                name: "API_KEY",
                description: "21st.dev Magic API Key",
                is_required: true,
                format: "string",
                is_secret: true
            }
        ]
    },
    {
        readmeContent: await getExampleReadme(accessToken, "idosal/git-mcp"),
        registry_name: "npm",
        name: "gitmcp",
        version: "latest",
        package_arguments: [
            {
                type: "positional",
                value: "mcp-remote",
                description: "MCP remote command",
                is_required: true,
                format: "string",
                value_hint: "mcp-remote"
            },
            {
                type: "positional",
                value: "https://gitmcp.io/${input:owner}/${input:repo}",
                description: "Git MCP repository URL",
                is_required: true,
                format: "string",
                value_hint: "https://gitmcp.io/owner/repo"
            }
        ]
    },
    {
        readmeContent: await getExampleReadme(accessToken, "qdrant/mcp-server-qdrant"),
        registry_name: "pypi",
        name: "qdrant",
        version: "latest",
        package_arguments: [
            {
                type: "positional",
                value: "mcp-server-qdrant",
                description: "Qdrant MCP server package",
                is_required: true,
                format: "string",
                value_hint: "mcp-server-qdrant"
            }
        ],
        environment_variables: [
            {
                name: "QDRANT_URL",
                description: "Qdrant URL",
                is_required: true,
                format: "string",
                is_secret: false
            },
            {
                name: "QDRANT_API_KEY",
                description: "Qdrant API Key",
                is_required: true,
                format: "string",
                is_secret: true
            },
            {
                name: "COLLECTION_NAME",
                description: "Collection Name",
                is_required: true,
                format: "string",
                is_secret: false
            }
        ]
    }
];