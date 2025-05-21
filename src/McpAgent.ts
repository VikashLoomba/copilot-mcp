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
			page: {
				description: "Page number for results.",
				type: "number",
			},
			perPage: {
				description: "Number of results to include per page",
				type: "number",
			},
		},
		required: ["query", "page", "perPage"],
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
	provider.setOptions({ debug: false });
	const Octokit = await import("@octokit/rest");

	const session = await vscode.authentication.getSession(
		GITHUB_AUTH_PROVIDER_ID,
		SCOPES,
		{ createIfNone: true }
	);
	const octokit = new Octokit.Octokit({
		auth: session.accessToken,
	});
	//   return;
	// Chat request handler implementation goes here
	// Test for the `teach` command
	if (request.command === "search") {
		logger.logUsage("chatParticipant:search", {
			request,
			user: session.account,
		});
		// Add logic here to handle the search scenario
		console.dir(request, { depth: null, colors: true });
		const SearchTool = new GitHubSearchTool();
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
							name: GitHubSearchTool.name,
							description: GitHubSearchTool.description,
							inputSchema: GitHubSearchTool.inputSchema,
							invoke: async (options) =>
								SearchTool.invoke(
									options as vscode.LanguageModelToolInvocationOptions<{
										userQuery: string;
									}>,
									token
								),
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
											server: JSON.stringify(object),
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
	implements vscode.LanguageModelTool<{ userQuery: string }>
{
	public static name: string = "github_search_agent";
	public static description: string =
		"Tool to search repositories on GitHub.";
	public static inputSchema: vscode.LanguageModelToolInformation["inputSchema"] =
		{
			type: "object",
			properties: {
				userQuery: {
					type: "string",
					description:
						"The intended GitHub repository search query by the user.",
				},
			},
		};
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{
			userQuery: string;
		}>,
		_token: vscode.CancellationToken
	) {
		const copilot = CopilotChatProvider.getInstance();
		const provider = copilot.provider;
		provider.setOptions({ debug: false });
		const githubAgent = new AxAgent<
			{ query: string },
			{ relevantRepositoryResults: JSON }
		>({
			name: "GitHub Repository Search Agent",
			description:
				"An AI Agent specializing in finding GitHub Repositories related to a user query.",
			signature: `query:string "The users request for finding a related mcp server on GitHub." -> relevantRepositoryResults:json "An array of repository results. Include all information in the response."`,
			functions: [githubRepositorySearch],
		});

		const agentResponse = await githubAgent.forward(
			provider,
			{ query: options.input.userQuery ?? {} },
			{ stream: false }
		);
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(JSON.stringify(agentResponse)),
		]);
	}
}

export async function readmeExtractionRequest(readme: string) {
	const copilot = CopilotChatProvider.getInstance();
	const provider = copilot.provider;
	provider.setOptions({ debug: false });
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
	return vscode.commands.executeCommand("vscode.open", uri);
}
