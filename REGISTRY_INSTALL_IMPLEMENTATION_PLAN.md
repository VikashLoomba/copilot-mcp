# Official Registry Install UI Implementation Plan

## Objectives
- Replace the dual-button install flow in `web/src/components/RegistryServerCard.tsx` with a single, program-aware install experience.
- Allow users to target **VS Code** or **Claude Code** when installing MCP servers sourced from the official registry.
- Preserve and extend existing registry normalization logic while eliminating reliance on `any` for the new pathways.
- Reuse the existing `installFromConfig` pipeline for VS Code installs and introduce an analogous, well-typed request for Claude CLI installs.

## Current State Summary
- Registry search uses `SearchRegistryServers.tsx` to render `RegistryServerCard` items. Each card currently exposes independent **Install Local** (stdio) and **Install Remote** buttons tied to `installFromConfigType`.
- The install payload builders already normalize runtime arguments, env vars, and HTTP headers but defer prompting via `inputs` placeholders.
- Extension-side handling in `src/panels/ExtensionPanel.ts` funnels installs through `openMcpInstallUri`, which constructs a `vscode:mcp/install` URI. No Claude CLI integration exists today.

## UI & Front-End Changes
1. **Introduce Program Selection**
   - Add a `toggle` or `segmented` control (reusing `ToggleGroup` from `SearchMCPServers.tsx`) at the top of `RegistryServerCard` to switch between `VSCode` and `ClaudeCode`.
   - Store the choice in a new `programTarget` state typed as `'vscode' | 'claude'`.

2. **Unify Install Mode Selection**
   - Replace the dual buttons with a secondary control that selects the install mode when both stdio packages and remote transports are available.
   - Define `installMode` state typed as `'package' | 'remote'`, defaulting to the first available option. Hide the selector when only one mode exists.
   - Continue to surface the existing `Select` components for choosing the specific package or remote endpoint within each mode.

3. **Single Install Call-To-Action**
   - Render one primary `Button` whose label reflects both `programTarget` and `installMode` (e.g., `Install Package in VS Code`, `Add Remote to Claude Code`).
   - Reuse the existing `isInstallingLocal/isInstallingRemote` state by replacing them with a single `isInstalling` boolean plus optional status text (e.g., `Installing in Claude Code…`).
   - Ensure disabled states respect missing selections, unsupported transports, or unresolved builder errors.

4. **User Feedback Enhancements**
   - Surface inline helper text when the Claude CLI is not detected (fed from new extension response metadata).
   - Preserve repository/website links and descriptive metadata already present on the card.

## Shared Data & Type Improvements
1. **Create Shared Install Payload Types**
   - In `src/shared/types/rpcTypes.ts`, extract new interfaces:
     ```ts
     interface InstallInput { type: 'promptString'; id: string; description?: string; password?: boolean; }
     interface InstallCommandPayload {
       name: string;
       command?: string;
       args?: string[];
       env?: Record<string, string>;
       url?: string;
       headers?: Array<{ name: string; value: string }>;
       inputs?: InstallInput[];
     }
     ```
   - Update `installFromConfigType` to reference `InstallCommandPayload` instead of inline `any`-adjacent shapes.

2. **Add Claude-Specific Request Type**
   - Define `installClaudeFromConfigType: RequestType<InstallCommandPayload & { transport: 'stdio' | 'http' | 'sse'; mode: 'package' | 'remote'; }, { success: boolean; cliAvailable: boolean; errorMessage?: string }>` within the same module.
   - Export the new type to webview components.

3. **Refactor Front-End Builders**
   - Extract the argument/env/header normalization helpers from `RegistryServerCard.tsx` into a local utility (e.g., `web/src/utils/registryInstall.ts`) returning strongly typed results:
     ```ts
     interface BuildResult {
       payload: InstallCommandPayload;
       missingInputs: InstallInput[];
       unavailableReason?: string;
     }
     ```
   - Ensure functions use typed registry models (`RegistryPackage`, `RegistryTransport`) without `any`.
   - Allow the builder to report when a transport is unsupported (e.g., OCI without a runtime hint) so the UI can disable the install mode gracefully.

## Extension (Back-End) Adjustments
1. **Handle New Claude Install Request**
   - In `src/panels/ExtensionPanel.ts`, register `messenger.onRequest(installClaudeFromConfigType, …)`.
   - For each incoming request:
     - Iterate over `payload.inputs ?? []` and gather values using `vscode.window.showInputBox({ prompt: input.description, password: input.password ?? false, ignoreFocusOut: true })`.
     - Substitute the collected responses into `payload.args`, `payload.env`, and `payload.headers` before invoking the CLI.
     - Leverage VS Code’s terminal/task APIs instead of spawning child processes directly:
       - Construct a `ShellExecution` via `new vscode.ShellExecution(claudeBinary, ['mcp', 'add-json', payload.name, configJson])`, where `claudeBinary` is resolved per platform and `configJson` is the filtered JSON string.
       - Create a temporary `Task` (e.g., `"Claude MCP Install"`) scoped to the workspace and execute it using `vscode.tasks.executeTask`.
       - Subscribe to `vscode.tasks.onDidEndTaskProcess` to capture the exit code and translate it into `{ success: boolean; cliAvailable: boolean; errorMessage?: string }`.
       - On `code === undefined` with an associated `ShellExecution` error indicating a missing binary, report `{ success: false, cliAvailable: false }`.
       - Optionally surface a toast (`vscode.window.showInformationMessage`) when the task finishes successfully.
     - Ensure the temporary task/terminal is disposed after completion to avoid clutter (use `TaskPresentationOptions` with `reveal: Never` and `isTransient: true`).

2. **Reuse Existing Telemetry Utilities**
   - Call `logWebviewInstallAttempt(payload.name)` with an additional context flag (e.g., program target) if telemetry schema allows.
   - Log failures via `logError` with a Claude-specific tag.

3. **Shared Utility Extraction**
   - Move `openMcpInstallUri` invocation behind a helper that accepts `InstallCommandPayload`. Update current VS Code handler to use the same helper for clarity and future reuse.

## Webview ⇄ Extension Interaction
- Update `RegistryServerCard.tsx` to await the Claude install response, check `cliAvailable`, and set inline error state (e.g., `setInstallError({ message, missingCli: !cliAvailable })`).
- When CLI is missing, present actionable UI: offer a link to installation docs (using `mcp.md` anchor) and provide a `Copy Command` button that copies the generated CLI command to the clipboard via a new `copyClaudeCommand` helper (pure web side).
- Maintain existing VS Code behavior, including progress state updates and error handling.

## Documentation & Telemetry Updates
- Append a changelog entry to `WHATS_NEW.md` describing the unified install flow and Claude support.
- Reference relevant `mcp.md` sections if we need to guide users toward Claude CLI installation.
- Confirm telemetry event naming with `TelemetryEvents` to avoid schema drift; add new enums if necessary without using `any`.

## Testing & Validation
1. **Automated**
   - Run `pnpm lint` and any available type checks (`pnpm tsc --noEmit`) to verify type safety after removing `any`.
2. **Manual (VS Code)**
   - Search a registry server with only stdio packages; install to VS Code and confirm `vscode:mcp/install` prompt appears.
   - Search a server with only remote endpoints; verify install disables stdio mode and succeeds via VS Code.
3. **Manual (Claude)**
   - With Claude CLI available, install both package and remote variants; confirm CLI reports success and new server appears in `claude mcp list`.
   - Without the CLI, ensure the UI surfaces guidance and copying the command works.
4. **Edge Cases**
   - Validate flows when required inputs/environment variables are missing; prompts should appear before CLI execution.
   - Confirm telemetry logs without throwing when installs fail or are canceled.

## Follow-Up Considerations
- Evaluate consolidating similar install logic for GitHub-sourced servers to reuse the new helpers.
- Investigate caching CLI availability detection to avoid repeating spawn checks on every card interaction.
- Consider localizing new UI strings via existing localization patterns if/when introduced.
