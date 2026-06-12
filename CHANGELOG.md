# Change Log

All notable changes to the "copilot-mcp" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

*Sponsored by [Cloud MCP](https://cloudmcp.run/?utm_source=copilot-mcp&utm_medium=marketplace&utm_campaign=marketplace-changelog) – Deploy remote MCP servers in seconds.*

## [0.0.95] - 2026-06-12

### Fixed

- AI-assisted setup works again. It was hardcoded to the `gpt-5.2-codex` Copilot model, which GitHub retired on 2026-06-01, causing every setup attempt to fail. The extension now resolves a currently-available model from your Copilot account's live `/models` catalog (preferring `claude-sonnet-4.6`, then `gpt-5.3-codex`), with a known-good fallback if the catalog can't be reached.
- AI-assisted setup failures now surface the real underlying cause (including the actual HTTP status and error returned by the language model) to diagnostics, instead of a generic, undiagnosable failure.
- The What's New notes now render on VS Code forks/OSS builds that don't ship the built-in Markdown preview command, falling back to opening the notes as a document or on the web.

### Changed

- Failure-driven "Deploy on CloudMCP" clicks (from the failed-setup card) are now attributed separately from normal repo-card deploys — distinct campaign plus a `surface` telemetry property — so we can tell how often the hosted fallback rescues a failed setup. The destination is unchanged.
- Error and auth telemetry was tightened — still minimal and anonymous; see the Telemetry section in the README for what is collected.

## [0.0.94] - 2026-06-11

### Added

- The Installed tab now lists servers from VS Code's user-level `mcp.json` (where VS Code stores user-scope MCP servers since 1.102, including servers this extension installs into VS Code). Those entries are read-only: edit and delete actions point you to the "MCP: Open User Configuration" command.
- "Run on CloudMCP" button on Official Registry cards, plus hosted-fallback links when a server can't be installed locally and when a registry search returns no results — each opens the CloudMCP catalog with the server or search prefilled.

### Changed

- Registry searches that hit an API error now show "Search failed — try again" instead of being indistinguishable from zero results.
- The failed-setup card now explains that setup failed and offers the hosted CloudMCP fallback alongside Retry Install.
- Install and error telemetry was tightened — still minimal and anonymous; see the Telemetry section in the README for what is collected.
- CI: GitHub Actions workflows updated to current action versions.

### Fixed

- AI-assisted setup failures no longer report a generic "no result returned" — the real underlying error (including language-model errors) is surfaced to logs and diagnostics.
- Remote MCP servers installed to VS Code now use VS Code's native config shape (explicit `http`/`sse` type and a plain header map), so remote installs from registry cards produce valid `mcp.json` entries.
- Git hooks (`.husky`) are no longer packaged into the extension, and the dependency lockfiles were refreshed: orphaned packages pruned and in-range dependency updates picked up (including runtime dependencies such as axios, ai, undici, and ws; no `package.json` ranges changed).

## [0.0.93] - 2026-06-11

### Added

- "Deploy on CloudMCP" now opens the CloudMCP discover page with a search prefilled for the server you clicked, instead of a generic landing page.
- Telemetry section in the README documenting what the extension collects and how to disable it.

### Changed

- Telemetry overhauled: the old, broken pipeline was removed entirely. The new telemetry is minimal and anonymous (basic usage events like search/install/link clicks, including truncated search terms — no file contents, no account identifiers) and respects VS Code's `telemetry.telemetryLevel` setting.
- Refreshed the Discord invite link and README formatting.

### Fixed

- Release packaging is resilient to the husky prepare script, plus other CI reliability fixes.

## [0.0.92] - 2026-03-03

### Fixed

- Linux: the sidebar launcher visibility loop no longer spams sidebar/focus commands.

### Changed

- CI: version bump and release workflows are now gated on passing tests.

## [0.0.91] - 2026-02-16

### Added

- **Installed Skills** view in the Skills tab when search is empty.
- Uninstall support for installed skills with a confirmation dialog, agent selection (preselected to all installed agents), and shared-path safety guardrails.

### Changed

- Improved installed skill card layout so location details and uninstall actions are easier to scan.

## [0.0.90] - 2026-02-11

### Added

- Dedicated **Skills search mode** in the Search tab, separate from MCP server search.
- `skills.sh`-powered search with paginated results and inline sub-skill discovery.
- Sub-skill selection controls with all sub-skills selected by default.
- Install targeting controls for agents and scope (project/global), including install to all detected agents, specific agents, and advanced options behind a gear button.
- Secondary sidebar launcher for the extension panel.

### Changed

- Search is now the first/default top-level tab in the panel.

## [0.0.89] - 2025-12-19

### Changed

- Dependency cleanup and maintenance release.

## [0.0.88] - 2025-10-17

### Added

- **Codex CLI MCP installer**: install MCP servers directly into Codex CLI from Copilot MCP.

### Changed

- GitHub sign-in is no longer required for non-AI-assisted usage; you are only prompted when the extension needs GitHub APIs for search.
- Claude CLI installs now run in the background with improved error handling.

## [0.0.87] - 2025-10-16

### Changed

- Improved Claude integration assets and webview state management.

## [0.0.86] - 2025-10-15

### Added

- Claude Code installer now copies the generated install command to your clipboard in case the install fails.

## [0.0.85] - 2025-10-09

### Added

- Unified install controls: choose between VS Code and Claude Code before running a single install button.
- Claude Code support: install MCP servers directly into Claude Code (if installed) using stdio or HTTP transports.

### Fixed

- Bug fixes and reliability improvements.

## [0.0.84] - 2025-10-08

### Added

- Add remote HTTP MCP servers from the Official MCP Registry via a new "Install Remote" button.
- Automatic `${input:...}` prompts for tokens and headers on remote installs.

### Fixed

- Restored full compatibility with the Official MCP Registry; searches return results immediately with updated metadata.

## [0.0.83] - 2025-09-16

### Changed

- Marketplace metadata updates and deploy URL tracking parameters.

## [0.0.82] - 2025-09-16

### Changed

- Display name changed to "Copilot MCP"; removed an unused dependency.

## [0.0.81] - 2025-09-13

### Changed

- Display name and marketplace metadata updates.

## [0.0.80] - 2025-09-12

### Added

- Official MCP Registry provider: search the public, curated MCP registry right inside the extension. The registry is the default provider, with the option to switch back to GitHub anytime.
- Direct installs from the registry: install local packages (npm, PyPI, etc.) or remote endpoints with one click using registry metadata.
- Smart, secure prompts for API keys and other required values at install time.
- Remote server support: add remote MCP servers by URL, including headers for authentication.

### Fixed

- Correct package spec is included for installs (so commands like `npx`/`uvx` just work), fixes for remote-only servers, and other polish.

---

For releases prior to 0.0.80, see [WHATS_NEW.md](https://github.com/VikashLoomba/copilot-mcp/blob/main/WHATS_NEW.md).
