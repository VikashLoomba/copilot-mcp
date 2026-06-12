import { readFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Reader for VS Code's USER-LEVEL MCP configuration file (`mcp.json`).
 *
 * Since VS Code 1.102, user-scope MCP servers live in a dedicated `mcp.json`
 * inside the user data `User` directory (opened via the
 * "MCP: Open User Configuration" command) instead of the deprecated
 * `mcp.servers` entry in settings.json:
 *   - Linux:   ~/.config/Code/User/mcp.json (XDG_CONFIG_HOME respected)
 *   - macOS:   ~/Library/Application Support/Code/User/mcp.json
 *   - Windows: %APPDATA%\Code\User\mcp.json
 *   - Portable mode: $VSCODE_PORTABLE/user-data/User/mcp.json
 *   - Forks/variants swap the "Code" folder for their product nameShort
 *     ("Code - Insiders", "Code - OSS", "VSCodium", "Cursor", ...).
 *
 * File shape (verified against VS Code's mcpResourceScannerService, which
 * reads `Object.entries(parsed.servers ?? {})` from the top level):
 *   { "servers"?: { "<name>": { ... } }, "inputs"?: [ ... ], "sandbox"?: ... }
 * VS Code parses it as JSONC with `allowTrailingComma` and `allowEmptyContent`,
 * so this reader tolerates comments, trailing commas, and empty files too.
 *
 * Known limitations (documented, fail-safe):
 *   - Profiles: a non-default profile that customizes MCP stores its servers in
 *     `User/profiles/<id>/mcp.json`. The stable extension API does not expose
 *     the active profile; `context.globalStorageUri` currently points at the
 *     shared `User/globalStorage` for every profile (verified on disk), so the
 *     active profile id is not detectable. If a profile-scoped globalStorageUri
 *     (`User/profiles/<id>/globalStorage/...`) is ever observed, this module
 *     already prefers that profile's mcp.json and falls back to the default
 *     profile's file (matching VS Code's partial-profile semantics). Otherwise
 *     only the default profile's user mcp.json is read.
 *   - Remote extension hosts (SSH/WSL/containers) and web: the user-level
 *     mcp.json lives on the local client, so the read finds no file and the
 *     function returns [] rather than failing.
 *
 * This module does no work at activation time: no top-level VS Code calls, no
 * watchers, no registrations. Everything is an on-demand async fs read.
 */

export interface UserMcpServerEntry {
    /** Server name — the key under "servers" in mcp.json. */
    name: string;
    /** Raw, unvalidated server definition (stdio/http/sse shapes vary). */
    config: unknown;
    /** Absolute path of the mcp.json the entry was read from. */
    sourcePath: string;
}

/** Inputs used to locate the user-level mcp.json; injectable for testing. */
export interface UserMcpJsonLookup {
    platform: NodeJS.Platform;
    homeDir: string;
    env: Record<string, string | undefined>;
    /** `vscode.env.appName`, e.g. "Visual Studio Code - Insiders". */
    appName: string;
    /** `context.globalStorageUri.fsPath`, when an ExtensionContext is available. */
    globalStorageFsPath?: string;
}

/**
 * Replaces line comments (`//`) and block comments (slash-star ... star-slash)
 * with whitespace, preserving string contents and newlines. String-aware,
 * escape-aware.
 */
function stripJsoncComments(text: string): string {
    let result = '';
    let i = 0;
    let inString = false;
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\' && i + 1 < text.length) {
                result += ch + text[i + 1];
                i += 2;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            result += ch;
            i++;
            continue;
        }
        if (ch === '"') {
            inString = true;
            result += ch;
            i++;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                result += ' ';
                i++;
            }
            continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
            result += '  ';
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                result += text[i] === '\n' ? '\n' : ' ';
                i++;
            }
            if (i < text.length) {
                result += '  ';
                i += 2;
            }
            continue;
        }
        result += ch;
        i++;
    }
    return result;
}

/**
 * Replaces commas that directly precede `}` or `]` with whitespace.
 * Expects comment-free input (run stripJsoncComments first). String-aware.
 */
function stripTrailingCommas(text: string): string {
    let result = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\' && i + 1 < text.length) {
                result += ch + text[i + 1];
                i++;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            result += ch;
            continue;
        }
        if (ch === '"') {
            inString = true;
            result += ch;
            continue;
        }
        if (ch === ',') {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j])) {
                j++;
            }
            if (j < text.length && (text[j] === '}' || text[j] === ']')) {
                result += ' ';
                continue;
            }
        }
        result += ch;
    }
    return result;
}

/**
 * Parses the text of a user-level mcp.json into server entries.
 * Pure function (exported for testing): no fs, no VS Code APIs.
 *
 * Mirrors VS Code's own tolerance: JSONC comments and trailing commas are
 * accepted, an empty/whitespace-only file yields [] (allowEmptyContent), and
 * a missing or null "servers" property yields []. Returns null — never
 * throws — when the content is malformed or not mcp.json-shaped.
 */
export function parseUserMcpJson(text: string, sourcePath: string): UserMcpServerEntry[] | null {
    try {
        const normalized = stripTrailingCommas(stripJsoncComments(text));
        if (normalized.trim().length === 0) {
            return [];
        }
        const parsed: unknown = JSON.parse(normalized);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return null;
        }
        const servers = (parsed as { servers?: unknown }).servers;
        if (servers === undefined || servers === null) {
            return [];
        }
        if (typeof servers !== 'object' || Array.isArray(servers)) {
            return null;
        }
        return Object.entries(servers as Record<string, unknown>).map(([name, config]) => ({
            name,
            config,
            sourcePath,
        }));
    } catch {
        return null;
    }
}

/**
 * Maps `vscode.env.appName` (product nameLong) to the on-disk user data
 * folder (product nameShort). Microsoft builds prefix nameShort with
 * "Visual Studio " ("Visual Studio Code - Insiders" -> "Code - Insiders");
 * known forks (Code - OSS, VSCodium, Cursor, Windsurf, ...) use the same
 * value for both.
 */
function dataDirNameFromAppName(appName: string): string {
    const microsoftPrefix = 'Visual Studio ';
    if (appName.startsWith(microsoftPrefix)) {
        return appName.slice(microsoftPrefix.length);
    }
    return appName;
}

/** Platform-default parent of the "<product>/User" tree, or undefined. */
function defaultUserDataBase(lookup: UserMcpJsonLookup): string | undefined {
    if (lookup.platform === 'win32') {
        if (lookup.env.APPDATA) {
            return lookup.env.APPDATA;
        }
        return lookup.homeDir ? path.join(lookup.homeDir, 'AppData', 'Roaming') : undefined;
    }
    if (lookup.platform === 'darwin') {
        return lookup.homeDir
            ? path.join(lookup.homeDir, 'Library', 'Application Support')
            : undefined;
    }
    if (lookup.env.XDG_CONFIG_HOME) {
        return lookup.env.XDG_CONFIG_HOME;
    }
    return lookup.homeDir ? path.join(lookup.homeDir, '.config') : undefined;
}

/**
 * Returns candidate absolute paths for the user-level mcp.json, most reliable
 * first. The first candidate that exists on disk should win.
 * Pure function (exported for testing): no fs, no VS Code APIs.
 */
export function getUserMcpJsonCandidates(lookup: UserMcpJsonLookup): string[] {
    const candidates: string[] = [];

    // 1. Derive the User directory from globalStorageUri when available. This
    //    transparently handles --user-data-dir, portable mode, and forks, and
    //    detects a profile-scoped shape if VS Code ever emits one.
    if (lookup.globalStorageFsPath) {
        // <userData>/User[/profiles/<id>]/globalStorage/<publisher.extension>
        const storageRoot = path.dirname(lookup.globalStorageFsPath);
        if (path.basename(storageRoot) === 'globalStorage') {
            const scopeDir = path.dirname(storageRoot);
            if (path.basename(path.dirname(scopeDir)) === 'profiles') {
                // Profile-scoped: prefer the profile's own mcp.json, then fall
                // back to the default profile's (partial profiles inherit it).
                candidates.push(path.join(scopeDir, 'mcp.json'));
                candidates.push(path.join(path.dirname(path.dirname(scopeDir)), 'mcp.json'));
            } else {
                candidates.push(path.join(scopeDir, 'mcp.json'));
            }
        }
    }

    // 2. Portable mode keeps user data next to the app.
    if (lookup.env.VSCODE_PORTABLE) {
        candidates.push(path.join(lookup.env.VSCODE_PORTABLE, 'user-data', 'User', 'mcp.json'));
    }

    // 3. Platform default location for this product.
    const base = defaultUserDataBase(lookup);
    if (base) {
        candidates.push(path.join(base, dataDirNameFromAppName(lookup.appName), 'User', 'mcp.json'));
    }

    return [...new Set(candidates)];
}

/**
 * Reads the MCP servers defined in VS Code's user-level mcp.json.
 *
 * Fail-safe by contract — never throws:
 *   - resolves to the parsed entries when a user-level mcp.json exists;
 *   - resolves to [] when no user-level mcp.json exists (no user servers);
 *   - resolves to null when a file exists but cannot be read or parsed
 *     (callers should then simply skip the user-level source).
 *
 * @param context Optional. When provided, `context.globalStorageUri` is used
 *                to locate the user data directory exactly (covers custom
 *                --user-data-dir, portable mode, and unknown forks); otherwise
 *                resolution falls back to env/platform defaults. Zero-arg
 *                calls are fully supported.
 */
export async function readUserMcpServers(
    context?: vscode.ExtensionContext
): Promise<UserMcpServerEntry[] | null> {
    try {
        const candidates = getUserMcpJsonCandidates({
            platform: process.platform,
            homeDir: os.homedir(),
            env: process.env,
            appName: vscode.env.appName,
            globalStorageFsPath: context?.globalStorageUri?.fsPath,
        });
        for (const candidate of candidates) {
            let raw: string;
            try {
                raw = await readFile(candidate, 'utf8');
            } catch {
                // Missing/unreadable at this location — try the next candidate.
                continue;
            }
            // The first existing file decides the result. A malformed existing
            // file yields null rather than silently falling back to another
            // scope's file, which would misrepresent the user's configuration.
            return parseUserMcpJson(raw, candidate);
        }
        return [];
    } catch {
        return null;
    }
}
