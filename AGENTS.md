# AGENTS.md

Guidance for coding agents working in this repository. This file focuses on structure and code maps so feature work can be done quickly and safely.

## Project Shape
- VS Code extension backend: `src/`
- React webview frontend: `web/src/`
- Extension/webview RPC contracts: `src/shared/types/rpcTypes.ts`
- Chat participant (`@mcp`): `src/McpAgent.ts`
- Sidebar webview provider + RPC handlers: `src/panels/ExtensionPanel.ts`

## Build + Run
- Install deps (root + web): `npm run install:all`
- Build extension + webview: `npm run build:all`
- Watch mode (extension + web): `npm run watch`
- Lint: `npm run lint`
- Tests: `npm run test`
- Package VSIX: `npm run package-extension`

Important: the extension webview loads static assets from `web/dist/assets/index.js` and `web/dist/assets/index.css` (see `src/panels/ExtensionPanel.ts`). If you change frontend code, rebuild web assets.

## Entry Points
- Extension activation + registrations: `src/extension.ts`
  - Registers webview: `CopilotMcpViewProvider`
  - Registers chat participant id: `copilot.mcp-agent`
  - Configures logging + telemetry
- Webview frontend bootstrap: `web/src/main.tsx` -> `web/src/App.tsx` -> `web/src/components/MCPServers.tsx`

## Directory Map
- `src/extension.ts`: extension activation lifecycle.
- `src/panels/ExtensionPanel.ts`: webview backend; most RPC request/notification handling.
- `src/McpAgent.ts`: chat participant command handling (`/search`, `/install`) and README-to-install extraction.
- `src/utilities/repoSearch.ts`: GitHub repository search + README retrieval.
- `src/skills-client.ts`: skills search/list/install orchestration.
- `src/skills.ts`: SKILL.md discovery/parsing/filtering.
- `src/installer.ts`: skill install logic (symlink/copy, canonical paths, global/project scope).
- `src/agents.ts`: supported agent registry + install path detection.
- `src/source-parser.ts`: source string parsing (GitHub/GitLab/local/direct URL/well-known/git).
- `src/shared/types/rpcTypes.ts`: authoritative RPC message contracts.
- `src/telemetry/*` and `src/utilities/outputLogger.ts`: telemetry + output channel logging.
- `web/src/components/*`: sidebar UI and install/search flows.
- `web/src/utils/registryInstall.ts`: Official MCP Registry payload construction for VS Code/Claude/Codex installs.

## Feature Code Maps

### 1) GitHub MCP search (webview tab)
- UI:
  - `web/src/components/SearchMCPServers.tsx`
  - `web/src/components/SearchGitHubServers.tsx`
  - `web/src/components/RepoCard.tsx`
- RPC:
  - request type `searchServersType` in `src/shared/types/rpcTypes.ts`
- Backend:
  - request handler in `src/panels/ExtensionPanel.ts`
  - GitHub API query in `src/utilities/repoSearch.ts` (`searchMcpServers2`)

### 2) AI-assisted install from GitHub README
- UI trigger:
  - Install button in `web/src/components/RepoCard.tsx`
- RPC:
  - request type `aiAssistedSetupType` in `src/shared/types/rpcTypes.ts`
- Backend flow:
  - handler in `src/panels/ExtensionPanel.ts` (`vscodeLMResponse`)
  - README extraction in `src/McpAgent.ts` (`readmeExtractionRequest`)
  - final install URI open in `src/McpAgent.ts` (`openMcpInstallUri`)

### 3) Official MCP Registry search + install
- UI:
  - `web/src/components/SearchRegistryServers.tsx`
  - `web/src/components/RegistryServerCard.tsx`
  - payload builders in `web/src/utils/registryInstall.ts`
- RPC:
  - `registrySearchType`
  - `installFromConfigType`
  - `installClaudeFromConfigType`
  - `installCodexFromConfigType`
- Backend:
  - handlers in `src/panels/ExtensionPanel.ts`
  - VS Code install path -> `openMcpInstallUri`
  - Claude CLI install path -> `runClaudeCliTask`
  - Codex CLI install path -> `runCodexCliTask`

### 4) Installed server management
- UI:
  - `web/src/components/InstalledMCPServers.tsx`
- RPC:
  - `getMcpConfigType`, `updateMcpConfigType`
  - `updateServerEnvVarType`, `deleteServerType`
- Backend:
  - merged server reads from settings + `.vscode/mcp.json` in `src/panels/ExtensionPanel.ts` (`getAllServers`)
  - deletion/update logic in `src/panels/ExtensionPanel.ts`

### 5) Skills search/list/install
- UI:
  - `web/src/components/SearchSkills.tsx`
  - `web/src/components/SkillSearchCard.tsx`
- RPC:
  - `skillsSearchType`
  - `skillsListFromSourceType`
  - `skillsGetAgentsType`
  - `skillsInstallType`
- Backend:
  - orchestrator: `src/skills-client.ts`
  - skill discovery + parsing: `src/skills.ts`
  - install engine: `src/installer.ts`
  - agent capabilities/detection: `src/agents.ts`
  - source parsing + git clone: `src/source-parser.ts`, `src/git.ts`
  - plugin manifest skill discovery: `src/plugin-manifest.ts`

### 6) Chat participant (`@mcp`)
- Registration: `src/extension.ts`
- Handler: `src/McpAgent.ts`
  - `/search`: composed search flow + GitHub tool integration
  - `/install`: README extraction + install URI open

### 7) Telemetry + logging
- Standardized telemetry helpers: `src/telemetry/standardizedTelemetry.ts`
- Event names/types: `src/telemetry/types.ts`
- Telemetry logger wiring: `src/telemetry/index.ts`
- OpenTelemetry sender + export: `src/utilities/signoz.ts`, `src/utilities/logging.ts`
- Human-readable output channel logging: `src/utilities/outputLogger.ts`

## RPC Change Checklist
When adding or changing extension/webview behavior:
1. Update/add message contracts in `src/shared/types/rpcTypes.ts`.
2. Implement extension-side handler in `src/panels/ExtensionPanel.ts`.
3. Wire frontend request/notification in relevant `web/src/components/*`.
4. Ensure payload shapes line up with frontend typed models (often `web/src/types/*`).

## Known Gotchas
- `src/utilities/cloudMcpIndexer.ts` is currently a minimal stub. Do not assume CloudMCP indexing/cache exists without implementing it.
- `checkCloudMcpType` exists in RPC types, but there is no active handler path in `src/panels/ExtensionPanel.ts`.
- There are two skills-client entry files:
  - extension-internal: `src/skills-client.ts`
  - root-level export-oriented variant: `skills-client.ts`
  Keep behavior aligned if shared APIs change.
- `src/test/extension.test.ts` is still a basic sample test; most feature changes currently rely on manual validation.

## Quick “Where Do I Edit?” Map
- Add a new sidebar tab/section: `web/src/components/MCPServers.tsx` + new component in `web/src/components/*`.
- Add a new search filter (GitHub): `web/src/components/SearchGitHubServers.tsx` + `src/shared/types/rpcTypes.ts` + `src/panels/ExtensionPanel.ts` + `src/utilities/repoSearch.ts`.
- Change install command assembly for registry servers: `web/src/utils/registryInstall.ts` and install handlers in `src/panels/ExtensionPanel.ts`.
- Change skill install destinations/agent support: `src/agents.ts` + `src/installer.ts`.
- Change SKILL.md discovery rules: `src/skills.ts` + `src/plugin-manifest.ts`.
- Change chat participant prompt/tool behavior: `src/McpAgent.ts`.
