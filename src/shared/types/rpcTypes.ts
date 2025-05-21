import {
	type RequestType,
	type NotificationType,
} from "vscode-messenger-common";

export const searchServersType: RequestType<
	{ query: string; page?: number; perPage?: number },
	{ results: any[]; totalCount: number; currentPage: number; perPage: number }
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

export const aiAssistedSetupType: RequestType<{repo: any}, boolean> = { method: "aiAssistedSetup" };

export const sendFeedbackType: NotificationType<{ feedback: string }> = { method: "sendFeedback" };