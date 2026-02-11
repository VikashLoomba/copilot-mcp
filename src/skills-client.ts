import { existsSync } from 'node:fs';
import { parseSource } from './source-parser';
import { cloneRepo, cleanupTempDir } from './git';
import { discoverSkills, filterSkills } from './skills';
import { agents, detectInstalledAgents } from './agents';
import { installSkillForAgent, type InstallMode } from './installer';
import type { AgentType } from './types';

export interface SkillSearchItem {
  id: string;
  name: string;
  installs: number;
  source?: string;
}

export interface SearchSkillsOptions {
  baseUrl?: string;
  page?: number; // 1-based (client-side pagination)
  pageSize?: number;
  maxFetchLimit?: number;
  signal?: AbortSignal;
}

export interface SearchSkillsResult {
  items: SkillSearchItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  fetchedCount: number;
  raw: unknown;
}

/**
 * Search skills via skills.sh API.
 * Confirmed params: q + limit.
 * Pagination here is client-side by requesting enough rows with limit.
 */
export async function searchSkills(
  query: string,
  options: SearchSkillsOptions = {}
): Promise<SearchSkillsResult> {
  const q = query.trim();
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? 20));
  const maxFetchLimit = Math.max(1, Math.floor(options.maxFetchLimit ?? 1000));

  if (!q) {
    return {
      items: [],
      page,
      pageSize,
      hasMore: false,
      fetchedCount: 0,
      raw: { skills: [] },
    };
  }

  const start = (page - 1) * pageSize;
  const endExclusive = start + pageSize;
  const limit = endExclusive + 1; // +1 so hasMore can be computed

  if (limit > maxFetchLimit) {
    throw new Error(
      `Requested page/pageSize requires limit=${limit}, above maxFetchLimit=${maxFetchLimit}`
    );
  }

  const url = new URL('/api/search', options.baseUrl ?? 'https://skills.sh');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, { signal: options.signal });
  if (!res.ok) {
    throw new Error(`skills search failed: ${res.status} ${res.statusText}`);
  }

  const raw = (await res.json()) as { skills?: unknown[] };
  const rows = Array.isArray(raw.skills) ? raw.skills : [];

  const normalized: SkillSearchItem[] = rows
    .map((row): SkillSearchItem | null => {
      if (!row || typeof row !== 'object') return null;
      const x = row as Record<string, unknown>;

      const id = typeof x.id === 'string' ? x.id.trim() : '';
      const name = typeof x.name === 'string' ? x.name.trim() : '';
      if (!id || !name) return null;

      const installs = typeof x.installs === 'number' ? x.installs : 0;
      const source =
        typeof x.source === 'string' && x.source.trim().length > 0 ? x.source.trim() : undefined;

      return { id, name, installs, source };
    })
    .filter((v): v is SkillSearchItem => v !== null);

  return {
    items: normalized.slice(start, endExclusive),
    page,
    pageSize,
    hasMore: normalized.length > endExclusive,
    fetchedCount: normalized.length,
    raw,
  };
}

export interface ListSkillsOptions {
  fullDepth?: boolean;
  includeInternal?: boolean;
}

export interface ListedSkill {
  name: string;
  description: string;
  path: string;
}

export interface AddSkillsOptions {
  skillNames?: string[]; // similar to --skill
  agents?: AgentType[] | ['*']; // similar to --agent
  global?: boolean; // similar to --global
  mode?: InstallMode; // symlink|copy
  fullDepth?: boolean; // similar to --full-depth
  cwd?: string;
  includeInternal?: boolean;
}

export interface InstallRecord {
  skillName: string;
  agent: AgentType;
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
}

export interface AddSkillsResult {
  source: string;
  selectedSkills: string[];
  targetAgents: AgentType[];
  installed: InstallRecord[];
  failed: InstallRecord[];
}

async function resolveSourceForRepoPath(source: string): Promise<{
  baseDir: string;
  subpath?: string;
  tempDir: string | null;
  parsedType: string;
}> {
  const parsed = parseSource(source);

  if (parsed.type === 'direct-url' || parsed.type === 'well-known') {
    throw new Error(
      `Source type "${parsed.type}" is not supported by this helper. Use repo/path sources.`
    );
  }

  if (parsed.type === 'local') {
    if (!parsed.localPath || !existsSync(parsed.localPath)) {
      throw new Error(`Local path does not exist: ${parsed.localPath ?? source}`);
    }

    return {
      baseDir: parsed.localPath,
      subpath: parsed.subpath,
      tempDir: null,
      parsedType: parsed.type,
    };
  }

  const tempDir = await cloneRepo(parsed.url, parsed.ref);
  return {
    baseDir: tempDir,
    subpath: parsed.subpath,
    tempDir,
    parsedType: parsed.type,
  };
}

/**
 * Programmatic equivalent of: skills add <source> --list
 */
export async function listSkillsFromSource(
  source: string,
  options: ListSkillsOptions = {}
): Promise<ListedSkill[]> {
  const resolved = await resolveSourceForRepoPath(source);

  try {
    const skills = await discoverSkills(resolved.baseDir, resolved.subpath, {
      includeInternal: options.includeInternal ?? false,
      fullDepth: options.fullDepth,
    });

    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      path: s.path,
    }));
  } finally {
    if (resolved.tempDir) {
      await cleanupTempDir(resolved.tempDir).catch(() => {});
    }
  }
}

/**
 * Programmatic equivalent of: skills add <source> [--skill ...] [--agent ...]
 * Non-interactive behavior:
 * - if skillNames omitted, installs all discovered skills
 * - if agents omitted, installs to detected agents; if none detected, installs to all
 */
export async function addSkillsFromSource(
  source: string,
  options: AddSkillsOptions = {}
): Promise<AddSkillsResult> {
  const resolved = await resolveSourceForRepoPath(source);
  const cwd = options.cwd ?? process.cwd();

  try {
    const includeInternal = options.includeInternal ?? !!(options.skillNames && options.skillNames.length);

    const discovered = await discoverSkills(resolved.baseDir, resolved.subpath, {
      includeInternal,
      fullDepth: options.fullDepth,
    });

    if (discovered.length === 0) {
      throw new Error('No valid skills found in source.');
    }

    const requested = options.skillNames ?? [];

    const selectedSkills =
      requested.length === 0 || requested.includes('*')
        ? discovered
        : filterSkills(discovered, requested);

    if (selectedSkills.length === 0) {
      throw new Error(`No matching skills found for: ${requested.join(', ')}`);
    }

    let targetAgents: AgentType[];
    if (options.agents && options.agents.some((a) => a === '*')) {
      targetAgents = Object.keys(agents) as AgentType[];
    } else if (options.agents && options.agents.length > 0) {
      const valid = new Set(Object.keys(agents));
      const invalid = options.agents.filter((a) => !valid.has(a));
      if (invalid.length > 0) {
        throw new Error(`Invalid agents: ${invalid.join(', ')}`);
      }
      targetAgents = options.agents as AgentType[];
    } else {
      const detected = await detectInstalledAgents();
      targetAgents = detected.length > 0 ? detected : (Object.keys(agents) as AgentType[]);
    }

    const installed: InstallRecord[] = [];
    const failed: InstallRecord[] = [];

    for (const skill of selectedSkills) {
      for (const agent of targetAgents) {
        const result = await installSkillForAgent(skill, agent, {
          global: options.global,
          cwd,
          mode: options.mode,
        });

        const record: InstallRecord = {
          skillName: skill.name,
          agent,
          success: result.success,
          path: result.path,
          canonicalPath: result.canonicalPath,
          mode: result.mode,
          symlinkFailed: result.symlinkFailed,
          error: result.error,
        };

        if (result.success) {
          installed.push(record);
        } else {
          failed.push(record);
        }
      }
    }

    return {
      source,
      selectedSkills: selectedSkills.map((s) => s.name),
      targetAgents,
      installed,
      failed,
    };
  } finally {
    if (resolved.tempDir) {
      await cleanupTempDir(resolved.tempDir).catch(() => {});
    }
  }
}

export type SearchSelection = Pick<SkillSearchItem, 'id' | 'name' | 'source'>;

/**
 * Equivalent to CLI behavior after selecting a find result:
 * pkg = source || id
 * add pkg --skill name
 */
export async function installSkillFromSearchResult(
  selected: SearchSelection,
  options: Omit<AddSkillsOptions, 'skillNames'> = {}
): Promise<AddSkillsResult> {
  const pkg = (selected.source ?? '').trim() || selected.id.trim();
  if (!pkg) {
    throw new Error('Selected skill is missing both source and id');
  }

  return addSkillsFromSource(pkg, {
    ...options,
    skillNames: [selected.name],
  });
}
