import * as vscode from "vscode";
import { sendChatParticipantRequest } from "@vscode/chat-extension-utils";
import {
	dspyExamples,
	GITHUB_AUTH_PROVIDER_ID,
	SCOPES,
} from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { AxAgent, AxFunction, ax, f } from "@ax-llm/ax";
import { getReadme, searchMcpServers2 } from "./utilities/repoSearch";
import { cloudMcpIndexer } from "./utilities/cloudMcpIndexer";
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

const getRepoReadme = {
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
		// Add logic here to handle the install scenario
		try {
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
							description:
								"Extracts the VSCode installation configuration for a given MCP server's README on GitHub and adds it to VSCode.",
							inputSchema: getRepoReadme.parameters,
							invoke: async (
								options: vscode.LanguageModelToolInvocationOptions<{
									repoName: string;
									repoOwner: string;
								}>
							) => {
								const readme = await getReadme({
									repoName: options.input.repoName,
									repoOwner: options.input.repoOwner,
								});
								console.log("readme: ", readme);
								const object = await readmeExtractionRequest(
									readme
								);
								const cmdResponse = await openMcpInstallUri(
									object
								);
								if (cmdResponse && cmdResponse.uri) {
									// Log install URI opened with standardized telemetry
									logChatInstallUriOpened(cmdResponse.uri);
								}
								// Open the URI using VS Code commands
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart(
										JSON.stringify(object)
									),
								]);
							},
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
			//   console.dir(agentResponse, { depth: null, colors: true });
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
	constructor(private readonly userQuery: string, private readonly stream: vscode.ChatResponseStream) {
		this.userQuery = userQuery;
		this.stream = stream;

	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ userQuery: string; }>): Promise<vscode.LanguageModelToolResult> {
		this.stream.progress("Beginning search for installable MCP servers...");
		const copilot = CopilotChatProvider.getInstance();
		const provider = copilot.provider;
		provider.setOptions({ debug: true, });
		outputLogger.debug("GitHubSearchTool invoked", { options });
		// Create a wrapper function that uses the query generator
		const generateAndSearchRepos: AxFunction = {
			name: "generateAndSearchRepos",
			description: "Generate a search query and search for MCP repositories",
			func: async (args: { originalUserMessage: string }) => {
				// First, generate the query
				const queryGeneratorAgent = new AxAgent<
					{ originalUserMessage: string },
					{ query: string }
				>({
					name: "Query Generator Agent",
					description: "An AI Agent that generates search queries for finding MCP servers.",
					signature: `originalUserMessage:string "The original user message that was sent to the agent." -> query:string "A search query that can be used to find relevant MCP server repositories using the GitHub repository search API."`,
				});
				
				queryGeneratorAgent.setExamples([
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
				
				const queryResult = await queryGeneratorAgent.forward(
					provider,
					{ originalUserMessage: args.originalUserMessage },
					{ stream: false }
				);
				
				// Then use the generated query to search
				const searchResults = await searchMcpServers2({ 
					query: queryResult.query,
					// nextPageCursor: ""
				});
				
				// Check search results against CloudMCP asynchronously (non-blocking)
				if (searchResults?.results?.length > 0) {
					const repositories = searchResults.results.map((result: any) => ({
						url: result.url,
						name: result.fullName.split('/')[1] || result.fullName,
						fullName: result.fullName
					}));
					cloudMcpIndexer.checkRepositories(repositories).catch((error: any) => {
						outputLogger.warn("Failed to check repositories with CloudMCP", error);
					});
				}
				
				return searchResults;
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
		const clone_identifier_agent = new AxAgent<
			{ nameWithOwner: string },
			{ clone_required: boolean }
		>({
			name: "Clone Identifier Agent",
			description: "An AI Agent that retrieves a repositories readme from the given nameWithOwner and identifies whether the MCP server must be cloned and built locally to be used.",
			signature: `"Identifies if the README.md for the given MCP server can be configured without building the code locally." nameWithOwner:string "GitHub repository name with owner" -> clone_required:boolean "Whether the repository must be cloned and built locally to use the MCP server."`,
			functions: [getRepoReadme],
		}, { debug: true }
		);
		const primaryAgent = new AxAgent<
			{ originalUserMessage: string },
			{ relevantRepositoryResults: any[] }
		>({
			name: "Search Coordinator Agent",
			description:
				"An AI Agent that coordinates the search for MCP servers using the Query Generator agent + GitHub search tool.",
			signature: `originalUserMessage:string "The original user message that was sent to the agent." -> relevantRepositoryResults:json[] "An array of repository results. Include all information in the response."`,
			functions: [generateAndSearchRepos],
		});

		const repositoryResponse = await primaryAgent.forward(
			provider,
			{ originalUserMessage: this.userQuery },
			{ stream: false, modelConfig: { maxTokens: 111452, }, }
		);
		this.stream.progress("Processing search results...");
		outputLogger.debug("Query Response", { results: repositoryResponse.relevantRepositoryResults });
		if (repositoryResponse.relevantRepositoryResults.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					"No relevant MCP server repositories found for your query."
				),
			]);
		}
		const installableRepositories = [];
		for (const repo of repositoryResponse.relevantRepositoryResults) {
			const cloneRequired = await clone_identifier_agent.forward(
				provider,
				{ nameWithOwner: (repo as any).fullName },
				{ stream: false }
			);
			if (!cloneRequired.clone_required) {
				installableRepositories.push(repo);
			}
		}
		outputLogger.debug("Installable Repositories", { count: installableRepositories.length, repositories: installableRepositories });
		if (installableRepositories.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					"No installable MCP server repositories found for your query."
				),
			]);
		}
		// Return the results as a LanguageModelToolResult
		// Convert the results to LanguageModelTextPart
		const results = installableRepositories.map(
			(result) =>
				new vscode.LanguageModelTextPart(
					JSON.stringify(result)
				)
		);
		// Return the results as a LanguageModelToolResult
		return new vscode.LanguageModelToolResult(results);
	}
	public name: string = "github_search_agent";
	public description: string =
		"Tool to search repositories using the GitHub API.";
	public inputSchema: vscode.LanguageModelToolInformation["inputSchema"] =
		{
			type: "object",
			properties: {
				userQuery: {
					type: "string",
					description:
						"A search query to find relevant MCP server repositories on GitHub.",
				},
			},
		};
}

export async function readmeExtractionRequest(readme: string) {
	const copilot = CopilotChatProvider.getInstance();
	const provider = copilot.provider;
	provider.setOptions({ debug: false });
	const commandIdentifierAgent = new AxAgent<
		{ readme: string },
		{ available_command_types: string[]; requires_clone: boolean }
	>({
		name: "Command Identifier Agent",
		description: "An AI Agent that identifies the types of commands the MCP server configuration can use and whether the repository must be cloned locally to use the MCP server.",
		signature: `"Identify the type of command used to start the MCP server. The command should be a string that can be used to start the MCP server." readme:string "MCP server readme with instructions" -> requires_clone:boolean "Whether the repository must be cloned locally to use the MCP server.", available_command_types?:class[] "npx, docker, uvx, bunx" "Available command types that can be used for the MCP server configuration."`,
	}
	);
	const commandIdentifierResponse = await commandIdentifierAgent.forward(
		provider,
		{ readme },
		{ stream: false }
	);
	console.log(
		"Command Identifier Response: ",
		commandIdentifierResponse.available_command_types,
		commandIdentifierResponse.requires_clone
	);

	const gen = ax`
		readme:${f.string('MCP server readme with instructions')} ->
		command:${f.string('the command used to start the MCP server. Prefer npx, docker, and uvx commands.')},
		name:${f.string('The name of the MCP server')},
		args:${f.array(f.string('arguments to pass in to the command'))},
		env:${f.json('Environment variables that the MCP server needs. Often includes configurable information such as API keys, hosts, ports, filesystem paths.')},
		inputs:${f.array(f.json('All user configurable server details extracted from the readme. Inputs can include api keys, filesystem paths that the user needs to configure, hostnames, passwords, and names of resources.'))}
	`;
	gen.setExamples(dspyExamples);

	const object = await gen.forward(
		provider,
		{ readme },
		{ stream: false }
	);
	return object;
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
