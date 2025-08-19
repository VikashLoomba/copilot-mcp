import * as vscode from "vscode";
import axios from "axios";

const GITHUB_AUTH_PROVIDER_ID = "github";
const SCOPES = ["repo", "read:org", "read:user"];

// Helper function to escape HTML

// Helper function to extract installation section from README


// GitHub API Helpers
interface searchWithReadme {
	query: string;
	page?: number;
	language?: 'javascript' | 'python';
	sort?: 'stars' | 'name' | 'updated' | 'created';
}

export async function searchMcpServers2(payload: searchWithReadme) {
	// Build the query with language filter if provided
	let languageFilter = '';
	if (payload.language === 'javascript') {
		// Use TypeScript filter which will catch most JS/TS MCP servers
		languageFilter = ' language:typescript';
	} else if (payload.language === 'python') {
		languageFilter = ' language:python';
	}
	
	const searchQuery = `"mcp" in:name,description,topics "${payload.query}" in:name,description${languageFilter}`;
	
	// Map sort option to GitHub REST API sort parameter
	// GitHub REST API only supports: stars, forks, help-wanted-issues, updated
	// For 'name' and 'created', we'll use default and sort client-side
	const sortParam = payload.sort === 'stars' ? 'stars' : 
	                 payload.sort === 'updated' ? 'updated' : 
	                 'stars'; // default to stars for name/created
	
	const page = payload.page || 1;
	const perPage = 30;
	
	try {
		const session = await vscode.authentication.getSession(
			GITHUB_AUTH_PROVIDER_ID,
			SCOPES,
			{ createIfNone: true }
		);
		
		if (!session || !session.accessToken) {
			throw new Error("Failed to get GitHub authentication session");
		}
		
		const headers = {
			"Accept": "application/vnd.github.v3+json",
			"Authorization": `Bearer ${session.accessToken}`,
		};

		// Use REST API search endpoint
		const response = await axios.get(
			"https://api.github.com/search/repositories",
			{
				headers,
				params: {
					q: searchQuery,
					sort: sortParam,
					order: 'desc',
					per_page: perPage,
					page: page
				}
			}
		);

		const items = response.data.items || [];
		const totalCount = response.data.total_count || 0;
		
		// Fetch README for each repository to check for install commands
		const fetchReadmes = async (repos: any[]) => {
			const promises = repos.map(async (repo) => {
				try {
					const readmeResponse = await axios.get(
						`https://api.github.com/repos/${repo.full_name}/readme`,
						{
							headers: {
								...headers,
								Accept: "application/vnd.github.v3.raw",
							},
						}
					);
					return { ...repo, readme: readmeResponse.data };
				} catch (error) {
					// If README fetch fails, continue without it
					return { ...repo, readme: null };
				}
			});
			return Promise.all(promises);
		};

		const reposWithReadmes = await fetchReadmes(items);
		
		// Calculate page info for pagination
		const hasNextPage = page * perPage < totalCount;
		const hasPreviousPage = page > 1;
		
		// Transform the results to match expected format
		let transformedResults = reposWithReadmes.map((repo: any) => {
			const readmeText = repo.readme || "";
			// Check for install command in README
			const hasInstallCommand = readmeText && (
				readmeText.includes(`"command": "uvx"`) ||
				readmeText.includes(`"command": "npx"`) ||
				readmeText.includes(`"command": "pypi"`) ||
				readmeText.includes(`"command": "docker"`) ||
				readmeText.includes(`"command": "pipx"`)
			);
			
			return {
				fullName: repo.full_name,
				stars: repo.stargazers_count,
				author: {
					name: repo.owner.login,
					profileUrl: repo.owner.html_url,
					avatarUrl: repo.owner.avatar_url,
				},
				updatedAt: repo.updated_at,
				createdAt: repo.created_at,
				description: repo.description,
				url: repo.html_url,
				language: repo.language,
				readme: readmeText,
				hasInstallCommand: hasInstallCommand,
			};
		});
		
		// Sort results with hasInstallCommand first within each sort type
		const sortWithInstallPriority = (results: any[]) => {
			// Separate into installable and non-installable
			const installable = results.filter((r: any) => r.hasInstallCommand);
			const nonInstallable = results.filter((r: any) => !r.hasInstallCommand);
			
			// Return combined array with installable first
			return [...installable, ...nonInstallable];
		};
		
		// Apply client-side sorting for 'name' and 'created' since REST API doesn't support them
		if (payload.sort === 'name') {
			transformedResults = transformedResults.sort((a: any, b: any) => 
				a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase())
			);
		} else if (payload.sort === 'created') {
			transformedResults = transformedResults.sort((a: any, b: any) => 
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
			);
		}
		
		// Apply install command priority sorting after the main sort
		transformedResults = sortWithInstallPriority(transformedResults);

		return {
			results: transformedResults,
			totalCount: totalCount,
			pageInfo: {
				hasNextPage,
				hasPreviousPage,
				currentPage: page,
				perPage
			},
		};
	} catch (error: any) {
		console.error(
			`Error searching repositories with user query "${payload.query}":`
		);
		
		if (error.response) {
			// Handle specific HTTP error responses
			if (error.response.status === 401) {
				console.error("- Authentication failed. Please check your GitHub credentials.");
				console.error("- You may need to sign in again to GitHub in VS Code.");
			} else if (error.response.data && error.response.data.message) {
				console.error(`- ${error.response.data.message}`);
			} else {
				console.error(`- HTTP ${error.response.status}: ${error.response.statusText}`);
			}
		} else if (error.message) {
			console.error(`- ${error.message}`);
		} else {
			console.error(error);
		}
		throw error;
	}
}

interface GetReadmeParams {
	repoOwner: string;
	repoName: string;
}
export async function getReadme(payload: GetReadmeParams) {
    const session = await vscode.authentication.getSession(
        GITHUB_AUTH_PROVIDER_ID,
        SCOPES
    );
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${payload.repoOwner}/${payload.repoName}/readme`,
            {
                headers: {
                    'Authorization': `Bearer ${session?.accessToken}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );
        
        if (response.ok) {
            return await response.text();
        }
        return "";
    } catch (error) {
        console.error('Error fetching README:', error);
        return "";
    }
}