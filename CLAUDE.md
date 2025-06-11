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