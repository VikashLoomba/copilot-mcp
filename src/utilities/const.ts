import { getReadme } from "./repoSearch";

export const GITHUB_AUTH_PROVIDER_ID = "github";
export const SCOPES = [
	"user:email",
	"read:org",
	"read:user",
];

export const dspyExamples = async () => [
    {
        readme: await getReadme({repoOwner: "microsoft", repoName: "playwright-mcp"}),
        name: "playwright-mcp",
        command: "npx",
        args: ["@microsoft/playwright-mcp@latest"],
		env: {},
		inputs: []
    },
    {
        readme: await getReadme({repoOwner: "upstash", repoName: "context7"}),
        name: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7@latest"],
        env: {},
        inputs: []
    },
	{
		readme: await getReadme({
            repoOwner: "21st-dev",
            repoName: "magic-mcp",}),
		name: "@21st-dev/magic",
		command: "npx",
		args: ["-y", "@21st-dev/magic@latest"],
		env: {
			API_KEY: "${input:apiKey}",
		},
		inputs: [
			{
				type: "promptString",
				id: "apiKey",
				description: "21st.dev Magic API Key",
				password: true,
			},
		],
	},
	{
		readme: await getReadme({
            repoOwner: "idosal",
            repoName: "git-mcp"
        }),
		name: "gitmcp",
		command: "npx",
		args: ["mcp-remote", "https://gitmcp.io/${input:owner}/${input:repo}"],
		env: {},
		inputs: [
			{
				type: "promptString",
				id: "owner",
				description: "Repository Owner",
				password: false,
			},
			{
				type: "promptString",
				id: "repo",
				description: "Repository name.",
				password: false,
			},
		],
	},
	{
		readme: await getReadme({repoName: "mcp-server-qdrant", repoOwner: "qdrant"}),
		name: "qdrant",

		command: "uvx",
		args: ["mcp-server-qdrant"],
		env: {
			QDRANT_URL: "${input:qdrantUrl}",
			QDRANT_API_KEY: "${input:qdrantApiKey}",
			COLLECTION_NAME: "${input:collectionName}",
		},
		inputs: [
			{
				type: "promptString",
				id: "qdrantUrl",
				description: "Qdrant URL",
			},
			{
				type: "promptString",
				id: "qdrantApiKey",
				description: "Qdrant API Key",
				password: true,
			},
			{
				type: "promptString",
				id: "collectionName",
				description: "Collection Name",
			},
		],
	},
];
