import * as vscode from "vscode";
import { sendChatParticipantRequest } from "@vscode/chat-extension-utils";
import {
	dspyExamples,
	GITHUB_AUTH_PROVIDER_ID,
	SCOPES,
} from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { AxAgent, AxFunction, AxGen } from "@ax-llm/ax";
import { getReadme, searchMcpServers2 } from "./utilities/repoSearch";
import { getLogger } from "./telemetry";

const githubRepositorySearch: AxFunction = {
	name: "githubRepoSearch",
	description:
		"Use this function to search Github for repositories related to the query",
	func: searchMcpServers2,
	parameters: {
		type: "object",
		properties: {
			query: {
				description: `"The query to search for repositories on github for. 
        Usage Notes: 
        - Use quotations around multi-word search terms. For example, if you want to search for issues with the label "In progress," you'd search for label:"in progress". Search is not case sensitive.
        With the \`in\` qualifier you can restrict your search to the repository name, repository description, repository topics, contents of the README file, or any combination of these. When you omit this qualifier, only the repository name, description, and topics are searched.

        | Qualifier | Example |
        | --- | --- |
        | \`in:name\` | [**jquery in:name**] matches repositories with "jquery" in the repository name. |
        | \`in:description\` | [**jquery in:name,description**] matches repositories with "jquery" in the repository name or description. |
        | \`in:topics\` | [**jquery in:topics**] matches repositories labeled with "jquery" as a topic. |
        | \`in:readme\` | [**jquery in:readme**] matches repositories mentioning "jquery" in the repository's README file. |
        | \`repo:owner/name\` | [**repo:octocat/hello-world**] matches a specific repository name. |

        You can find a repository by searching for content in the repository's README file using the \`in:readme\` qualifier
        "`,
				type: "string",
			},
			nextPageCursor: {
				description: "Cursor for the next page of results.",
				type: "string",
			}
		},
		required: ["query", "nextPageCursor"],
	},
};
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
	const logger = getLogger();
	const copilot = CopilotChatProvider.getInstance();
	const provider = copilot.provider;
	provider.setOptions({ debug: true });
	const Octokit = await import("@octokit/rest");

	const session = await vscode.authentication.getSession(
		GITHUB_AUTH_PROVIDER_ID,
		SCOPES,
		{ createIfNone: true }
	);
	const octokit = new Octokit.Octokit({
		auth: session.accessToken,
	});

	if (request.command === "search") {
		logger.logUsage("chatParticipant:search", {
			request,
			user: session.account,
		});
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
			return await libResult.result;
		} catch (error) {
			console.dir(error, { depth: null, colors: true });
		}
	} else if (request.command === "install") {
		logger.logUsage("chatParticipant:install", {
			request,
			user: session.account,
		});
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
								if (cmdResponse) {
									logger.logUsage(
										"chatParticipant:install:openedInstallURI",
										{
											server: JSON.stringify({ repoName: `${options.input.repoOwner}/${options.input.repoName}` }),
										}
									);
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
			return await llmResponse.result;
			//   console.dir(agentResponse, { depth: null, colors: true });
		} catch (error) {
			console.dir(error, { depth: null, colors: true });
		}
	} else {
		logger.logUsage("chatParticipant:unknownIntent", { ...request });
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
		console.log("options: ", options);
		const queryGeneratorAgent = new AxAgent<
			{ userQuery: string },
			{ query: string }
		>(
			{
				name: "Query Generator Agent",
				description: "An AI Agent that generates search queries for finding MCP servers.",
				signature: `userQuery:string "The original user message that was sent to the agent." -> query:string "A search query that can be used to find relevant MCP server repositories using the GitHub repository search API."`,
			}
		);
		queryGeneratorAgent.setExamples([
			{
				userQuery: "Find a MCP server for managing Kubernetes clusters",
				query: "mcp server kubernetes"
			},
			{
				userQuery: "Search for a MCP server for mysql",
				query: "mcp server mysql",
			},
			{
				userQuery: "Find a MCP server for managing Docker containers",
				query: "docker mcp server",
			},
			{
				userQuery: "Search for a MCP server for managing PostgreSQL databases",
				query: "mcp server postgresql",
			},
			{
				userQuery: "GitHub mcp server",
				query: "mcp server github"
			}
		]);
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
		const primaryAgent = new AxAgent<{
			originalUserMessage: string;
		}, {
			relevantRepositoryResults: JSON[];
		}>({
			name: "Search Coordinator Agent",
			description:
				"An AI Agent that coordinates the search for MCP servers using the Query Generator agent + GitHub search tool.",
			signature: `originalUserMessage:string "The original user message that was sent to the agent." -> relevantRepositoryResults:json[] "An array of repository results. Include all information in the response."`,
			functions: [githubRepositorySearch],
			agents: [queryGeneratorAgent],

		}, { debug: true, maxSteps: 5 });

		const repositoryResponse = await primaryAgent.forward(
			provider,
			{ originalUserMessage: this.userQuery },
			{ stream: false, modelConfig: { maxTokens: 111452, }, }
		);
		this.stream.progress("Processing search results...");
		console.debug("Query Response: ", repositoryResponse.relevantRepositoryResults);
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
		console.debug("Installable Repositories: ", installableRepositories);
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

	const prompt = new AxGen<
		{ readme: string },
		{
			command: string;
			name: string;
			args: string[];
			env: JSON;
			inputs: {
				id: string;
				type: "promptString";
				description: "string";
				password: boolean;
			}[];
		}
	>(
		`"Extract MCP server details from the readme. User-configurable args and env values extracted from the README.md should use the \${input:<input-id>} syntax." readme:string "MCP server readme with instructions" -> command:string "the command used to start the MCP server. Prefer 'npx', 'docker', and 'uvx' commands.", args:string[] "arguments to pass in to the command", name:string "The name of the MCP server", inputs:json[] "All user configurable server details extracted from the readme. Inputs can include api keys, filesystem paths that the user needs to configure, hostnames, passwords, and names of resources. Type is always 'promptString'.", env:json "Environment variables that the MCP server needs. Often includes configurable information such as API keys, hosts, ports, filesystem paths."`
	);
	prompt.setExamples(dspyExamples);

	const object = await prompt.forward(
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
	return await vscode.env.openExternal(uri);
	// Open the URI using VS Code commands
}
