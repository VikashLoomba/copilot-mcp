import {
	type RequestType,
	type NotificationType,
} from "vscode-messenger-common";

export const searchServersType: RequestType<
	{ query: string; 
	page?: number;
	language?: 'javascript' | 'python';
	sort?: 'stars' | 'name' | 'updated' | 'created'; },
	{ results: any[]; totalCount: number; pageInfo: {hasNextPage?: boolean; hasPreviousPage?: boolean; currentPage?: number; perPage?: number;} }
> = { method: "search" };

export const getReadmeType: RequestType<
	{ fullName: string; name: string; owner: any },
	{ readme: string; fullName: string }
> = { method: "requestReadme" };

export const getMcpConfigType: RequestType<void, { servers: any[] }> = {
	method: "getMcpConfigObject",
};

export const updateMcpConfigType: NotificationType<{ servers: any[] }> = {
	method: "updateMcpConfigObject",
};

export const updateServerEnvVarType: NotificationType<
	{ serverName: string; envKey: string; newValue: string }
> = { method: "updateServerEnvVar" };

export const deleteServerType: NotificationType<{ serverName: string }> = { method: "deleteServer" };

import type { CloudMcpCheckResult } from "../../utilities/cloudMcpIndexer";

export const aiAssistedSetupType: RequestType<{repo: any; cloudMcpDetails?: CloudMcpCheckResult}, boolean> = { method: "aiAssistedSetup" };

export const sendFeedbackType: NotificationType<{ feedback: string }> = { method: "sendFeedback" };

export const cloudMCPInterestType: NotificationType<{ 
	repoName: string; 
	repoOwner: string;
	repoUrl: string;
	timestamp: string;
}> = { method: "cloudMCPInterest" };

export const checkCloudMcpType: RequestType<{
	repoUrl: string;
	repoName: string;
	repoFullName?: string;
	owner: string;
}, CloudMcpCheckResult> = { method: "checkCloudMcp" };

export const previewReadmeType: NotificationType<{ 
	fullName: string;
	readme: string;
}> = { method: "previewReadme" };

// Direct installation from a structured config (used by Official Registry results)
export const installFromConfigType: RequestType<{
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    inputs?: Array<{ type: 'promptString'; id: string; description?: string; password?: boolean }>;
    url?: string; // for remote installs
    headers?: Array<{ name: string; value: string }>; // for remote installs with headers
}, boolean> = { method: "installFromConfig" };

// Official Registry search (proxied via extension to avoid CORS)
export const registrySearchType: RequestType<
    { search: string; limit?: number; cursor?: string },
    { servers: any[]; metadata: { next_cursor?: string; count?: number } }
> = { method: "registrySearch" };
