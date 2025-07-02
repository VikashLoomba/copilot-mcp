import {
	type RequestType,
	type NotificationType,
} from "vscode-messenger-common";

export const searchServersType: RequestType<
	{ query: string; page?: number; perPage?: number },
	{ results: any[]; totalCount: number; currentPage: number; perPage: number; cloudMcpDetails?: Record<string, any> }
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
	timestamp: string;
}> = { method: "cloudMCPInterest" };

export const checkCloudMcpType: RequestType<{
	repoUrl: string;
	repoName: string;
	repoFullName?: string;
}, CloudMcpCheckResult> = { method: "checkCloudMcp" };