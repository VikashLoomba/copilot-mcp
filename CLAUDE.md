# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Copilot MCP is a VSCode extension that enables searching, managing, and installing Model Context Protocol (MCP) servers. It extends GitHub Copilot Chat's capabilities by providing a chat participant interface and a sidebar UI for MCP server discovery.

## Development Commands

### Root Directory Commands
```bash
# Install dependencies for both extension and web UI
npm run install:all

# Build both extension and web UI
npm run build:all

# Development mode - watch for changes
npm run watch

# Run tests
npm run test

# Lint the codebase
npm run lint

# Package extension for production
npm run package

# Create VSIX package for distribution
npm run package-extension
```

### Web UI Commands (from /web directory)
```bash
# Start development server
npm run start

# Build for production
npm run build

# Run linting
npm run lint
```

## Architecture Overview

### Extension Structure
- **Entry Point**: `src/extension.ts` - Activates extension, registers chat participant and webview
- **Chat Participant**: `src/McpAgent.ts` - Handles `@mcp` chat commands (`/search`, `/install`)
- **Webview Panel**: `src/panels/ExtensionPanel.ts` - Manages sidebar UI communication
- **GitHub Integration**: `src/utilities/repoSearch.ts` - Searches GitHub for MCP servers
- **Copilot Integration**: `src/utilities/CopilotChat.ts` - Interfaces with GitHub Copilot

### Web UI Structure
- Separate React application in `/web/` directory
- Built with Vite, React 19, TypeScript, and Tailwind CSS
- Uses shadcn/ui component library
- Communicates with extension via VSCode postMessage API

### Key Technologies
- **Build**: esbuild for extension bundling, Vite for web UI
- **AI/LLM**: @ax-llm/ax agent framework, AI SDK for model interactions
- **Testing**: VSCode test framework with Mocha
- **Telemetry**: Application Insights and OpenTelemetry integration

## Development Guidelines

### Testing Changes
1. Run `npm run watch` in root directory for continuous builds
2. Press F5 in VSCode to launch Extension Development Host
3. Test chat participant with `@mcp /search <query>` or `@mcp /install <repo>`
4. Test sidebar UI functionality

### Code Conventions
- TypeScript strict mode enabled
- ESLint configuration in `eslint.config.mjs`
- React components use function components with TypeScript
- Telemetry events follow consistent naming: `mcp_<action>_<target>`

### Important Files
- `package.json` - Extension manifest and scripts
- `src/types/registry.ts` - MCP server registry types
- `src/shared/types/rpcTypes.ts` - VSCode messaging types
- `web/src/components/` - React UI components
- `src/utilities/cloudMcpIndexer.ts` - CloudMCP API integration for server indexing

## CloudMCP Integration Architecture

### Current Implementation (Individual Async Loading)

The architecture uses individual async loading where each repo card independently fetches its CloudMCP details:

1. **Search Flow**:
   - User enters search query in `SearchMCPServers.tsx`
   - Component sends `searchServersType` request to backend via vscode-messenger
   - `ExtensionPanel.ts` receives request and calls `searchMcpServers()` to get GitHub results
   - Results are returned immediately without CloudMCP details
   - Each `RepoCard` independently requests its CloudMCP status on mount

2. **Data Structures**:
   ```typescript
   // Search response (no CloudMCP details)
   {
     results: McpServerResult[],
     totalCount: number,
     currentPage: number,
     perPage: number
   }
   
   // Individual CloudMCP check request/response
   checkCloudMcpType: RequestType<{
     repoUrl: string;
     repoName: string;
     repoFullName?: string;
   }, CloudMcpCheckResult>
   
   // CloudMcpCheckResult structure
   {
     success: boolean,
     exists: boolean,
     installConfig?: {
       name: string,
       command: string,
       args: string[],
       env: Record<string, string>,
       inputs: InstallConfigInput[]
     },
     error?: string
   }
   ```

3. **Frontend Processing**:
   - `SearchMCPServers` renders results immediately without CloudMCP details
   - Each `RepoCard` fetches its own CloudMCP details via `checkCloudMcpType` request
   - Install button shows "Loading..." while `isLoadingCloudMcp` is true
   - Button enables when `cloudMcpDetails.success && cloudMcpDetails.installConfig`
   - Uses `setShouldShowInstallButton` to control install button visibility

4. **Caching Strategy**:
   - `CloudMcpIndexer` maintains a 5-minute TTL cache
   - Cache key uses `fullName` if available, otherwise `url`
   - Successful results are cached; failures are not cached
   - Cache prevents duplicate API calls for the same repository

### Benefits of Current Architecture
- **Instant search results**: Cards appear immediately with GitHub data
- **Progressive enhancement**: Install buttons activate as CloudMCP data arrives
- **Better perceived performance**: No waiting for batch processing
- **Efficient resource usage**: Only checks visible repositories
- **Smart caching**: Reduces redundant CloudMCP API calls

### Implementation Details
- **RPC Communication**: Uses `vscode-messenger` for type-safe messaging
- **Error Handling**: Failed CloudMCP checks don't block UI rendering
- **State Management**: Each RepoCard manages its own CloudMCP loading state
- **Telemetry**: Tracks cache hits/misses and CloudMCP check performance