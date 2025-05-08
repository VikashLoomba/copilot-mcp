

// Define interfaces for better type safety and clarity
export interface SearchMcpServersParams {
  userQuery?: string; // Optional: user's specific search keywords
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
  readme: string; // A short snippet of the README
  language: string | null;
  updatedAt: string;
}

export interface SearchMcpServersResponse {
  results: McpServerResult[];
  totalCount: number;
  hasMore: boolean;
}

const README_EXCERPT_LENGTH = 200; // Max length for README excerpt

export async function searchMcpServers(
  octokit: any,
  params: SearchMcpServersParams
): Promise<SearchMcpServersResponse | undefined> {
  try {
    const baseQuery = '("mcpServers: {" OR "mcp: {" OR claude_desktop_config.json) AND ("npx" OR "uvx") in:readme language:TypeScript language:Python language:JavaScript';
    const fullQuery = params.userQuery ? `${baseQuery} ${params.userQuery}` : baseQuery;

    const response = await octokit.search.repos({
      q: fullQuery,
      page: params.page,
      per_page: params.perPage,
      // sort: 'stars', // Optional: sort by stars or relevance
      order: 'desc',
    });

    console.log(`Found ${response.data.total_count} repositories for query "${fullQuery}", page ${params.page}:`);

    const processedResults: McpServerResult[] = [];
    console.log(response.data.items[0]);
    for (const repo of response.data.items) {
      if (!repo.owner) {continue;}

      let readmeContent = "README not found or is empty.";
      try {
        const readmeResponse = await octokit.repos.getReadme({
          owner: repo.owner.login,
          repo: repo.name,
        });
        const decodedContent = Buffer.from(readmeResponse.data.content, 'base64').toString();
        readmeContent = decodedContent;
      } catch (readmeError: any) {
        // Log specific error for README fetching, but don't let it stop processing other repos
        if (readmeError.status === 404) {
          console.warn(`README not found for ${repo.full_name}.`);
          readmeContent = "README not available for this repository.";
        } else {
          readmeContent = "Error fetching README.";
        }
      }

      processedResults.push({
        id: repo.id,
        url: repo.html_url,
        name: repo.name,
        fullName: repo.full_name,
        stars: repo.stargazers_count || 0,
        author: {
          name: repo.owner.login,
          profileUrl: repo.owner.html_url,
          avatarUrl: repo.owner.avatar_url,
        },
        description: repo.description,
        readme: readmeContent,
        language: repo.language,
        updatedAt: repo.updated_at,
      });
    }

    const hasMore = (params.page * params.perPage) < response.data.total_count;

    return {
      results: processedResults,
      totalCount: response.data.total_count,
      hasMore,
    };

  } catch (error: any) {
    console.error(`Error searching repositories with query "${params.userQuery}":`, error.message);
    if (error.status === 422) {
        return { results: [], totalCount: 0, hasMore: false, error: "Invalid search query or parameters." } as any;
    }
    return { results: [], totalCount: 0, hasMore: false, error: error.message } as any;
  }
}