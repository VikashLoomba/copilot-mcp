import * as vscode from "vscode";
import { sendChatParticipantRequest } from "@vscode/chat-extension-utils";
import {
	dspyExamples,
	GITHUB_AUTH_PROVIDER_ID,
	SCOPES,
} from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { AxAgent, AxFunction, ax, f, AxFunctionProcessor } from "@ax-llm/ax";
import { getReadme, searchMcpServers2 } from "./utilities/repoSearch";
import { cloudMcpIndexer, extractServerDetailsFromReadme } from "./utilities/cloudMcpIndexer";
import { 
	logChatSearch, 
	logChatInstall, 
	logChatUnknownIntent, 
	logChatInstallUriOpened,
	logError,
	startPerformanceTimer,
	endPerformanceTimer
} from "./telemetry/standardizedTelemetry";
import { TelemetryEvents } from "./telemetry/types";
import { outputLogger } from "./utilities/outputLogger";

const getRepoReadme: AxFunction = {
	func: getReadme,
	name: "getReadme",
	description:
		"Use this function to get a GitHub Repository's README.md to extract information from.",
	parameters: {
		type: "object",
		properties: {
			repoOwner: {
				type: "string",
				description: "The owner of the MCP server repository",
			},
			repoName: {
				type: "string",
				description:
					"The name of the repository i.e. '${repoOwner}/${repoName}'",
			},
		},
		required: ["repoOwner", "repoName"],
	},
};

// Create specialized agents for composition
export const createQueryGeneratorAgent = (): AxAgent<
	{ originalUserMessage: string },
	{ query: string }
> => {
	const agent = new AxAgent<
		{ originalUserMessage: string },
		{ query: string }
	>({
		name: "Query Generator Agent",
		description: "An AI Agent that generates search queries for finding MCP servers.",
		signature: `originalUserMessage:string "The original user message that was sent to the agent." -> query:string "A search query that can be used to find relevant MCP server repositories using the GitHub repository search API."`,
	});
	
	agent.setExamples([
		{
			originalUserMessage: "Find a MCP server for managing Kubernetes clusters",
			query: "mcp server kubernetes"
		},
		{
			originalUserMessage: "Search for a MCP server for mysql",
			query: "mcp server mysql",
		},
		{
			originalUserMessage: "Find a MCP server for managing Docker containers",
			query: "docker mcp server",
		},
		{
			originalUserMessage: "Search for a MCP server for managing PostgreSQL databases",
			query: "mcp server postgresql",
		},
		{
			originalUserMessage: "GitHub mcp server",
			query: "mcp server github"
		}
	]);
	
	return agent;
};

const createCloneIdentifierAgent = (): AxAgent<
	{ nameWithOwner: string },
	{ clone_required: boolean }
> => {
	return new AxAgent<
		{ nameWithOwner: string },
		{ clone_required: boolean }
	>({
		name: "Clone Identifier Agent",
		description: "An AI Agent that retrieves a repositories readme from the given nameWithOwner and identifies whether the MCP server must be cloned and built locally to be used.",
		signature: `"Identifies if the README.md for the given MCP server can be configured without building the code locally." nameWithOwner:string "GitHub repository name with owner" -> clone_required:boolean "Whether the repository must be cloned and built locally to use the MCP server."`,
		functions: [getRepoReadme],
	}, { debug: true }
	);
};

// Create function processor for managing MCP-related functions
const createMcpFunctionProcessor = (): AxFunctionProcessor => {
	const mcpFunctions: AxFunction[] = [
		{
			name: "searchMcpServers",
			description: "Search for MCP server repositories on GitHub",
			func: async (args: { query: string }) => {
				const searchResults = await searchMcpServers2({ query: args.query });
				
				return searchResults;
			},
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search query" }
				},
				required: ["query"]
			}
		},
		getRepoReadme
	];
	
	return new AxFunctionProcessor(mcpFunctions);
};

// Create MCP installer agent
const createMcpInstallerAgent = () => {
	return {
		name: "McpInstallerAgent",
		description: "Extracts the VSCode installation configuration for a given MCP server's README on GitHub and adds it to VSCode.",
		inputSchema: getRepoReadme.parameters,
		invoke: async (
			options: vscode.LanguageModelToolInvocationOptions<{
				repoName: string;
				repoOwner: string;
			}>
		) => {
			try {
				// Get README directly using the getReadme function
				const readme = await getReadme({
					repoName: options.input.repoName,
					repoOwner: options.input.repoOwner,
				});
				
				outputLogger.debug("Retrieved README", { length: readme.length });
				
				// Extract configuration from README
				const config = await readmeExtractionRequest(readme);
				
				// Open installation URI
				const cmdResponse = await openMcpInstallUri(config);
				if (cmdResponse && cmdResponse.uri) {
					// Log install URI opened with standardized telemetry
					logChatInstallUriOpened(cmdResponse.uri);
				}
				
				// Return result
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						JSON.stringify(config)
					),
				]);
			} catch (error) {
				outputLogger.error("MCP installation failed", error as Error);
				throw error;
			}
		},
	};
};

export const handler: vscode.ChatRequestHandler = async (
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<any> => {
	outputLogger.debug("MCP Agent handler invoked", { 
		command: request.command, 
		prompt: request.prompt 
	});
	
	const copilot = CopilotChatProvider.getInstance();
	const provider = copilot.provider;
	provider.setOptions({ debug: true });

	const session = await vscode.authentication.getSession(
		GITHUB_AUTH_PROVIDER_ID,
		SCOPES,
		{ createIfNone: true }
	);

	if (request.command === "search") {
		outputLogger.info("Processing search command", { query: request.prompt });
		// Log standardized chat search event
		logChatSearch(request.prompt, session.account);
		startPerformanceTimer('chat-search');
		const SearchTool = new GitHubSearchTool(
			request.prompt,
			stream
		);
		try {
			const libResult = sendChatParticipantRequest(
				request,
				context,
				{
					prompt: "Use the GitHub search tool with the users search query to get relevant MCP server repository results.",
					responseStreamOptions: {
						stream,
						references: false,
						responseText: true,
					},
					tools: [
						{
							name: SearchTool.name,
							description: SearchTool.description,
							inputSchema: SearchTool.inputSchema,
							invoke: SearchTool.invoke.bind(SearchTool),
						},
					],
				},
				token
			);
			const result = await libResult.result;
			
			// Log successful search completion
			endPerformanceTimer('chat-search', TelemetryEvents.PERFORMANCE_SEARCH, {
				success: true,
				query: request.prompt,
				queryLength: request.prompt.length,
			});
			
			return result;
		} catch (error) {
			// Log error with standardized error telemetry
			logError(error as Error, 'chat-search', {
				query: request.prompt,
				queryLength: request.prompt.length,
				command: request.command,
			});
			
			// Also end performance timer for failed operations
			endPerformanceTimer('chat-search', TelemetryEvents.PERFORMANCE_SEARCH, {
				success: false,
				query: request.prompt,
				queryLength: request.prompt.length,
			});
			
			outputLogger.error("Search command failed", error as Error);
			console.dir(error, { depth: null, colors: true });
		}
	} else if (request.command === "install") {
		outputLogger.info("Processing install command", { query: request.prompt });
		// Log standardized chat install event
		logChatInstall(request.prompt, session.account);
		startPerformanceTimer('chat-install');
		
		try {
			// Create an installer agent using composition
			const mcpInstallerAgent = createMcpInstallerAgent();
			
			const llmResponse = sendChatParticipantRequest(
				request,
				context,
				{
					prompt: "Use the McpInstallerAgent to facilitate the installation of the MCP server the user wishes to install.",
					responseStreamOptions: {
						stream,
						references: false,
						responseText: false,
					},
					tools: [
						{
							name: "McpInstallerAgent",
							description: mcpInstallerAgent.description,
							inputSchema: mcpInstallerAgent.inputSchema,
							invoke: mcpInstallerAgent.invoke.bind(mcpInstallerAgent),
						},
					],
				},
				token
			);
			const result = await llmResponse.result;
			
			// Log successful install completion
			endPerformanceTimer('chat-install', TelemetryEvents.PERFORMANCE_INSTALL, {
				success: true,
				query: request.prompt,
				queryLength: request.prompt.length,
			});
			
			return result;
		} catch (error) {
			// Log error with standardized error telemetry
			logError(error as Error, 'chat-install', {
				query: request.prompt,
				queryLength: request.prompt.length,
				command: request.command,
			});
			
			// Also end performance timer for failed operations
			endPerformanceTimer('chat-install', TelemetryEvents.PERFORMANCE_INSTALL, {
				success: false,
				query: request.prompt,
				queryLength: request.prompt.length,
			});
			
			outputLogger.error("Install command failed", error as Error);
			console.dir(error, { depth: null, colors: true });
		}
	} else {
		outputLogger.warn("Unknown command received", { command: request.command });
		// Log unknown intent with standardized telemetry
		logChatUnknownIntent(request.command || 'unknown');
	}
};

class GitHubSearchTool
	implements vscode.LanguageModelTool<{ userQuery: string; }> {
	private functionProcessor: AxFunctionProcessor;
	private searchCoordinatorAgent: AxAgent<
		{ originalUserMessage: string },
		{ relevantRepositoryResults: any[] }
	>;
	private cloneIdentifierAgent: AxAgent<
		{ nameWithOwner: string },
		{ clone_required: boolean }
	>;
	
	constructor(private readonly userQuery: string, private readonly stream: vscode.ChatResponseStream) {
		this.userQuery = userQuery;
		this.stream = stream;
		
		// Initialize function processor with MCP functions
		this.functionProcessor = createMcpFunctionProcessor();
		
		// Initialize reusable agents
		this.cloneIdentifierAgent = createCloneIdentifierAgent();
		
		// Create the search coordinator agent with composition
		this.searchCoordinatorAgent = this.createSearchCoordinatorAgent();
	}
	
	private createSearchCoordinatorAgent(): AxAgent<
		{ originalUserMessage: string },
		{ relevantRepositoryResults: any[] }
	> {
		// Create query generator agent
		const queryGeneratorAgent = createQueryGeneratorAgent();
		
		// Create the search and process function
		const generateAndSearchRepos: AxFunction = {
			name: "generateAndSearchRepos",
			description: "Generate a search query and search for MCP repositories",
			func: async (args: { originalUserMessage: string }) => {
				const copilot = CopilotChatProvider.getInstance();
				const provider = copilot.provider;
				
				// Use the query generator agent
				const queryResult = await queryGeneratorAgent.forward(
					provider,
					{ originalUserMessage: args.originalUserMessage },
					{ stream: false }
				);
				
				// Execute the search using the function processor
				const searchResult = await this.functionProcessor.execute({
					id: "search-" + Date.now(),
					name: "searchMcpServers",
					args: JSON.stringify({ query: queryResult.query })
				});
				
				return JSON.parse(searchResult);
			},
			parameters: {
				type: "object",
				properties: {
					originalUserMessage: {
						type: "string",
						description: "The original user message"
					}
				},
				required: ["originalUserMessage"]
			}
		};
		
		// Create the coordinator agent with composition
		return new AxAgent<
			{ originalUserMessage: string },
			{ relevantRepositoryResults: any[] }
		>({
			name: "Search Coordinator Agent",
			description: "An AI Agent that coordinates the search for MCP servers using composed agents and functions.",
			signature: `originalUserMessage:string "The original user message that was sent to the agent." -> relevantRepositoryResults:json[] "An array of repository results. Include all information in the response."`,
			functions: [generateAndSearchRepos]
			// Note: agents composition requires matching input/output types
		});
	}
	
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ userQuery: string; }>): Promise<vscode.LanguageModelToolResult> {
		this.stream.progress("Beginning search for installable MCP servers...");
		const copilot = CopilotChatProvider.getInstance();
		const provider = copilot.provider;
		provider.setOptions({ debug: true });
		outputLogger.debug("GitHubSearchTool invoked", { options });
		
		try {
			// Use the composed search coordinator agent
			const repositoryResponse = await this.searchCoordinatorAgent.forward(
				provider,
				{ originalUserMessage: this.userQuery },
				{ 
					stream: false, 
					modelConfig: { maxTokens: 111452 }
				}
			);
			
			this.stream.progress("Processing search results...");
			outputLogger.debug("Query Response", { results: repositoryResponse.relevantRepositoryResults });
			
			if (!repositoryResponse.relevantRepositoryResults || repositoryResponse.relevantRepositoryResults.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						"No relevant MCP server repositories found for your query."
					),
				]);
			}
			
			// Filter for installable repositories
			const installableRepositories = [];
			for (const repo of repositoryResponse.relevantRepositoryResults) {
				const cloneRequired = await this.cloneIdentifierAgent.forward(
					provider,
					{ nameWithOwner: (repo as any).fullName },
					{ stream: false }
				);
				if (!cloneRequired.clone_required) {
					installableRepositories.push(repo);
				}
			}
			
			outputLogger.debug("Installable Repositories", { 
				count: installableRepositories.length, 
				repositories: installableRepositories 
			});
			
			if (installableRepositories.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						"No installable MCP server repositories found for your query."
					),
				]);
			}
			
			// Return the results as a LanguageModelToolResult
			const results = installableRepositories.map(
				(result) => new vscode.LanguageModelTextPart(JSON.stringify(result))
			);
			
			return new vscode.LanguageModelToolResult(results);
		} catch (error) {
			outputLogger.error("Search failed", error as Error);
			throw error;
		}
	}
	
	public name: string = "github_search_agent";
	public description: string = "Tool to search repositories using the GitHub API.";
	public inputSchema: vscode.LanguageModelToolInformation["inputSchema"] = {
		type: "object",
		properties: {
			userQuery: {
				type: "string",
				description: "A search query to find relevant MCP server repositories on GitHub.",
			},
		},
	};
}

export async function readmeExtractionRequest(readme: string) {
	// Try to get GitHub token from VSCode authentication API using the same scopes as extension activation
	const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, { createIfNone: false });
	const accessToken = session?.accessToken;
	if (!accessToken) {
		throw new Error("Copilot not set up.");
	}
	const copilot = CopilotChatProvider.getInstance();
	const provider = copilot.provider;
	provider.setOptions({ debug: false });
	const details = await extractServerDetailsFromReadme(accessToken, readme, false);
	if (details && !('error' in details) && ('name' in details)) {
		return cloudMcpIndexer.transformPackageToInstallFormat(details);
	}
	outputLogger.warn("Failed to extract server details from README, falling back to old example dspy extraction", { errorDetails: details });
	const gen = ax`
		readme:${f.string('MCP server readme with instructions')} ->
		name:${f.string('Package name')},
		command:${f.string('Specifies the executable or interpreter to run. Prefer npx, docker, and uvx command, in that order.')},
		arguments:${f.array(f.string('Package arguments and runtime arguments. These are the arguments that will be passed to the command when it is run.'))},
		env:${f.json('Environment variables to set for the server process. Often includes configurable information such as API keys, hosts, ports, filesystem paths.')},
		inputs:${f.array(f.json('User configurable server details extracted from the readme. Inputs can include api keys, filesystem paths that the user needs to configure, hostnames, passwords, and names of resources.'))}
	`;
	gen.setExamples(await dspyExamples());

	const object = await gen.forward(
		provider,
		{ readme },
		{ stream: false }
	);
	return {
		name: object.name,
		command: object.command,
		args: object.arguments,
		env: object.env,
		inputs: object.inputs
	};
}

export async function openMcpInstallUri(mcpConfig: object) {
	// Create the URI with the mcp configuration
	const uriString = `vscode:mcp/install?${encodeURIComponent(
		JSON.stringify(mcpConfig)
	)}`;
	const uri = vscode.Uri.parse(uriString);
	const success = await vscode.env.openExternal(uri);
	// Return object with uri property and success status
	return { uri: uriString, success };
}
