
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "./const";
// Define interfaces for better type safety and clarity
export interface SearchMcpServersParams {
	query?: string; // Optional: user's specific search keywords
	page: number;
	perPage: number;
}

export interface McpServerAuthor {
	name: string;
	profileUrl: string;
	avatarUrl: string;
}

export interface McpServerResult {
	id: number;
	url: string;
	name: string;
	fullName: string;
	stars: number;
	author: McpServerAuthor;
	description: string | null;
	readme?: string; // Made optional, as it won't be populated here
	language: string | null;
	updatedAt: string;
}

export interface SearchMcpServersResponse {
	results: McpServerResult[];
	totalCount: number;
	hasMore: boolean;
}
import * as vscode from "vscode";
export async function searchMcpServers(
	params: SearchMcpServersParams
): Promise<any | undefined> {
	try {
		const session = await vscode.authentication.getSession(
			GITHUB_AUTH_PROVIDER_ID,
			SCOPES
		);
		const Octokit = await import("octokit");
		const octokit = new Octokit.Octokit({
			auth: session?.accessToken,
		});
		const baseQuery = `"mcp" in:name,description,topics "${params.query}" in:name,description`;
		const fullQuery = params.query?.includes("mcp") ? params.query : baseQuery;

		const response = await octokit.rest.search.repos({
			q: fullQuery,
			page: params.page,
			per_page: params.perPage,
			// sort: 'stars', // Optional: sort by stars or relevance
			order: "desc",
		});

		const processedResults: McpServerResult[] = [];

		for (const repo of response.data.items) {
			if (!repo.owner) {
				continue;
			}

			// README fetching logic is removed from here.
			// The RepoCard will request it separately.
			processedResults.push({
				fullName: repo.full_name,
				stars: repo.stargazers_count || 0,
				author: {
					name: repo.owner.login,
					profileUrl: repo.owner.html_url,
					avatarUrl: repo.owner.avatar_url,
				},
				updatedAt: repo.updated_at,
				...repo,
				url: repo.html_url,
			});
		}

		const hasMore =
			params.page * params.perPage < response.data.total_count;

		return {
			results: processedResults,
			totalCount: response.data.total_count,
			hasMore,
		};
	} catch (error: any) {
		console.error(
			`Error searching repositories with query "${params.query}":`,
			error.message
		);
		if (error.status === 422) {
			return {
				results: [],
				totalCount: 0,
				hasMore: false,
				error: "Invalid search query or parameters.",
			} as any;
		}
		return {
			results: [],
			totalCount: 0,
			hasMore: false,
			error: error.message,
		} as any;
	}
}
interface searchWithReadme {
	query: string;
	endCursor?: string;
}
export async function searchMcpServers2(payload: searchWithReadme) {
	const graphQLOperation = `
    query SearchRepositories($userQuery: String!, $endCursor: String ) {
        search(query: $userQuery, type: REPOSITORY, first: 10, after: $endCursor ) {
            repositoryCount
            edges {
                node {
                    ... on Repository {
                        nameWithOwner
                        description
                        url
                        readme: object(expression: "HEAD:README.md") {
                            ... on Blob {
                                text
                        }
                }
            }
        }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
  `;

	try {
		const session = await vscode.authentication.getSession(
			GITHUB_AUTH_PROVIDER_ID,
			SCOPES
		);
		const { graphql } = await import("@octokit/graphql");
		// 3. Execute the GraphQL operation, passing the 'gitHubSearchSyntaxQuery'
		//    as the value for '$searchQueryVariable'.
		const response: any = await graphql(
			// Assuming 'graphql' is your client function
			graphQLOperation,
			{
				userQuery: payload.query, // Pass the constructed string as the variable
				endCursor: payload.endCursor,
				headers: {
					Authorization: `Bearer ${session?.accessToken}`,
				},
			}
		);
		console.dir(response, { depth: null, colors: true });
		if (response.search.edges.length === 0) {
			// throw new Error('No results found'); // Uncomment if you want this behavior
			console.log("No results found for your query.");
		}
		return {
			results: response.search.edges.map((edge: any) => {
				const repo = edge.node;
				return {
					fullName: repo.nameWithOwner,
					description: repo.description,
					url: repo.url,
					readme: repo.readme ? repo.readme.text : null, // Handle readme text
				};
			}),
			totalCount: response.search.repositoryCount,
			pageInfo: response.search.pageInfo,
		};
	} catch (error: any) {
		console.error(
			`Error searching repositories with user query "${payload.query}":`
		);
		// @octokit/graphql errors often have a 'response.errors' array
		if (error.response && error.response.errors) {
			error.response.errors.forEach((err: any) =>
				console.error(`- ${err.message}`)
			);
		} else {
			console.error(error);
		}
		throw error; // Re-throw if you want to handle it further up the call stack
	}
}
interface GetReadmeParams {
	repoOwner: string;
	repoName: string;
}
export async function getReadme(payload: GetReadmeParams) {
	const graphqlQuery = `query GetReadme($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
            readme: object(expression: "HEAD:README.md") {
                ... on Blob {
                    text
                }
            }
        }
    }`;
	const session = await vscode.authentication.getSession(
		GITHUB_AUTH_PROVIDER_ID,
		SCOPES
	);
	const { graphql } = await import("@octokit/graphql");
	const { repository }: any = await graphql(
		// Assuming 'graphql' is your client function
		graphqlQuery,
		{
			owner: payload.repoOwner, // Pass the constructed string as the variable
			name: payload.repoName,
			headers: {
				Authorization: `Bearer ${session?.accessToken}`,
			},
		}
	);
	// Check if repository and readme exist before accessing text
	if (!repository || !repository.readme || !repository.readme.text) {
		return ""; // Return empty string if no README found
	}
	return repository.readme.text;
}
