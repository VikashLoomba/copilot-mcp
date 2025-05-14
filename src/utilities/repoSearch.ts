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
  readme?: string; // Made optional, as it won't be populated here
  language: string | null;
  updatedAt: string;
}

export interface SearchMcpServersResponse {
  results: McpServerResult[];
  totalCount: number;
  hasMore: boolean;
}

export async function searchMcpServers(
  octokit: any,
  params: SearchMcpServersParams
): Promise<any | undefined> {
  try {
    const baseQuery = `"mcp" in:name,description,topics "${params.userQuery}" in:name,description`;
    const fullQuery = params.userQuery ? baseQuery : baseQuery;

    const response = await octokit.rest.search.repos({
      q: fullQuery,
      page: params.page,
      per_page: params.perPage,
      // sort: 'stars', // Optional: sort by stars or relevance
      order: 'desc',
    });
    console.dir(response, {depth: null, colors:true})
    console.log(`Found ${response} repositories for query "${fullQuery}", page ${params.page}:`);

    const processedResults: McpServerResult[] = [];
    console.log(response.data.items[0]);
    for (const repo of response.data.items) {
      if (!repo.owner) {continue;}

      // README fetching logic is removed from here.
      // The RepoCard will request it separately.

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
        language: repo.language,
        updatedAt: repo.updated_at,
        ...repo
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