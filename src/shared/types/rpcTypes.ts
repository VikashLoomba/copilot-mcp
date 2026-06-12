import {
        type RequestType,
        type NotificationType,
} from "vscode-messenger-common";
import type { AgentType } from "../../types";

export type InstallInput = {
        type: "promptString";
        id: string;
        description?: string;
        password?: boolean;
};

export interface InstallCommandPayload {
        name: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        /** Remote transport type; consumed by toNativeInstallPayload so SSE
         * servers are written to mcp.json as `"type": "sse"` (defaults to http). */
        type?: "http" | "sse";
        headers?: Array<{ name: string; value: string }>;
        inputs?: InstallInput[];
}

export type InstallTransport = "stdio" | "http" | "sse";

export type InstallMode = "package" | "remote";

export interface CliInstallRequest extends InstallCommandPayload {
        transport: InstallTransport;
        mode: InstallMode;
}

export type ClaudeInstallRequest = CliInstallRequest;
export type CodexInstallRequest = CliInstallRequest;

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
export const installFromConfigType: RequestType<InstallCommandPayload, boolean> = {
        method: "installFromConfig",
};

export const installClaudeFromConfigType: RequestType<ClaudeInstallRequest, void> = {
        method: "installClaudeFromConfig",
};

export const installCodexFromConfigType: RequestType<CodexInstallRequest, void> = {
        method: "installCodexFromConfig",
};

// Official Registry search (proxied via extension to avoid CORS).
// `errored` is optional and additive: when true the panel is reporting an API
// failure (as opposed to a genuinely empty result set); older panels omit it.
export const registrySearchType: RequestType<
	{ search: string; limit?: number; cursor?: string },
	{ servers: any[]; metadata: { nextCursor?: string; count?: number }; errored?: boolean }
> = { method: "registrySearch" };

// Interest in running a server hosted on CloudMCP, sent from Official Registry
// surfaces in the webview. `surface` identifies where the action was taken:
// - "registry_card": the "Run on CloudMCP" install target on a registry card
//   (`serverName` is the official registry server name).
// - "unavailable_fallback": the fallback action shown when a local/remote
//   install is unavailable (`serverName` plus the `reason` it was unavailable).
// - "zero_results": the catalog-search link shown when a registry search
//   returns no results (`query` is the search term).
export type CloudMcpRegistryInterestSurface =
	| "registry_card"
	| "unavailable_fallback"
	| "zero_results";

export interface CloudMcpRegistryInterestPayload {
	surface: CloudMcpRegistryInterestSurface;
	serverName?: string;
	reason?: string;
	query?: string;
	timestamp: string;
}

export const cloudMcpRegistryInterestType: NotificationType<CloudMcpRegistryInterestPayload> = {
	method: "cloudMcpRegistryInterest",
};

export interface SkillsSearchRequest {
        query: string;
        page?: number;
        pageSize?: number;
}

export interface SkillsSearchItemDto {
        id: string;
        name: string;
        installs: number;
        source?: string;
}

export interface SkillsSearchResponse {
        items: SkillsSearchItemDto[];
        page: number;
        pageSize: number;
        hasMore: boolean;
        fetchedCount: number;
}

export interface SkillsListFromSourceRequest {
        source: string;
}

export interface ListedSkillDto {
        name: string;
        description: string;
        path: string;
}

export interface SkillsListFromSourceResponse {
        source: string;
        skills: ListedSkillDto[];
}

export interface SkillAgentOptionDto {
        id: AgentType;
        displayName: string;
        detected: boolean;
        supportsGlobal: boolean;
}

export interface SkillsGetAgentsResponse {
        agents: SkillAgentOptionDto[];
        detectedAgents: AgentType[];
}

export type SkillsInstallScope = "project" | "global";

export interface SkillsInstallRequest {
        searchItem: SkillsSearchItemDto;
        source: string;
        selectedSkillNames: string[];
        installScope: SkillsInstallScope;
        installAllAgents: boolean;
        selectedAgents: AgentType[];
}

export interface InstallRecordDto {
        skillName: string;
        agent: AgentType;
        success: boolean;
        path: string;
        canonicalPath?: string;
        mode: "symlink" | "copy";
        symlinkFailed?: boolean;
        error?: string;
}

export interface SkillsInstallResponse {
        source: string;
        selectedSkills: string[];
        targetAgents: AgentType[];
        installed: InstallRecordDto[];
        failed: InstallRecordDto[];
}

export interface InstalledSkillDto {
        name: string;
        description: string;
        path: string;
        canonicalPath: string;
        scope: SkillsInstallScope;
        agents: AgentType[];
        uninstallPolicy: "agent-select" | "all-agents";
        uninstallPolicyReason?: string;
}

export interface SkillsListInstalledResponse {
        skills: InstalledSkillDto[];
}

export interface SkillsUninstallRequest {
        skillName: string;
        scope: SkillsInstallScope;
        selectedAgents: AgentType[];
}

export interface UninstallRecordDto {
        agent: AgentType;
        paths: string[];
        error?: string;
}

export interface SkillsUninstallResponse {
        skillName: string;
        scope: SkillsInstallScope;
        removed: UninstallRecordDto[];
        failed: UninstallRecordDto[];
        remainingAgents: AgentType[];
}

export const skillsSearchType: RequestType<SkillsSearchRequest, SkillsSearchResponse> = {
        method: "skillsSearch",
};

export const skillsListFromSourceType: RequestType<
        SkillsListFromSourceRequest,
        SkillsListFromSourceResponse
> = {
        method: "skillsListFromSource",
};

export const skillsGetAgentsType: RequestType<void, SkillsGetAgentsResponse> = {
        method: "skillsGetAgents",
};

export const skillsInstallType: RequestType<SkillsInstallRequest, SkillsInstallResponse> = {
        method: "skillsInstall",
};

export const skillsListInstalledType: RequestType<void, SkillsListInstalledResponse> = {
        method: "skillsListInstalled",
};

export const skillsUninstallType: RequestType<SkillsUninstallRequest, SkillsUninstallResponse> = {
        method: "skillsUninstall",
};
