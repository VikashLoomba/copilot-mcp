#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const UPSTREAM_REPO = "https://github.com/anomalyco/opencode.git";
const UPSTREAM_DEFAULT_REF = "dev";
const UPSTREAM_SOURCE_PATH = "packages/opencode/src/provider/sdk/copilot";

const ALLOWED_EXTERNAL_IMPORTS = [
  "@ai-sdk/provider",
  "@ai-sdk/provider-utils",
  "zod",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const vendorRoot = path.join(repoRoot, "vendor", "opencode-copilot");
const vendorSrcDir = path.join(vendorRoot, "src");
const upstreamMetadataPath = path.join(vendorRoot, "UPSTREAM.json");

function parseArgs(argv) {
  const options = {
    check: false,
    verbose: false,
    ref: UPSTREAM_DEFAULT_REF,
  };

  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg.startsWith("--ref=")) {
      options.ref = arg.slice("--ref=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function log(options, message) {
  if (options.verbose) {
    console.log(message);
  }
}

function runGit(cwd, args, options) {
  log(options, `git ${args.join(" ")}`);
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

async function listFilesRecursively(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolutePath, baseDir)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(baseDir, absolutePath));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function readFileMap(dir) {
  const map = new Map();
  const files = await listFilesRecursively(dir);
  for (const relativePath of files) {
    const absolutePath = path.join(dir, relativePath);
    map.set(relativePath, await readFile(absolutePath));
  }
  return map;
}

async function calculateDrift(sourceDir, expectedMetadata) {
  const result = {
    sourceMissing: false,
    changedPaths: [],
    metadataMismatches: [],
  };

  if (!existsSync(vendorSrcDir)) {
    result.sourceMissing = true;
    return result;
  }

  const upstreamFileMap = await readFileMap(sourceDir);
  const vendorFileMap = await readFileMap(vendorSrcDir);

  const allPaths = new Set([
    ...upstreamFileMap.keys(),
    ...vendorFileMap.keys(),
  ]);

  for (const relativePath of allPaths) {
    const upstreamContents = upstreamFileMap.get(relativePath);
    const vendorContents = vendorFileMap.get(relativePath);
    if (!upstreamContents || !vendorContents) {
      result.changedPaths.push(relativePath);
      continue;
    }
    if (!upstreamContents.equals(vendorContents)) {
      result.changedPaths.push(relativePath);
    }
  }

  let metadata = null;
  if (existsSync(upstreamMetadataPath)) {
    metadata = JSON.parse(await readFile(upstreamMetadataPath, "utf8"));
  }

  for (const [key, value] of Object.entries(expectedMetadata)) {
    if (metadata?.[key] !== value) {
      result.metadataMismatches.push(
        `${key}: expected ${JSON.stringify(value)} but found ${JSON.stringify(metadata?.[key])}`,
      );
    }
  }

  return result;
}

function isAllowedExternalImport(specifier) {
  if (specifier.startsWith("node:")) {
    return true;
  }

  return ALLOWED_EXTERNAL_IMPORTS.some(
    (allowed) => specifier === allowed || specifier.startsWith(`${allowed}/`),
  );
}

async function validateVendoredSources(sourceDir) {
  const disallowedImports = [];
  const forbiddenTokens = [];
  const files = await listFilesRecursively(sourceDir);

  for (const relativePath of files) {
    const absolutePath = path.join(sourceDir, relativePath);
    const contents = await readFile(absolutePath, "utf8");

    if (contents.includes("workspace:") || contents.includes("catalog:")) {
      forbiddenTokens.push(relativePath);
    }

    if (!relativePath.endsWith(".ts")) {
      continue;
    }

    const importSpecifiers = new Set();
    const fromRegex = /\b(?:import|export)\s+[^"'`]*?\sfrom\s+["']([^"']+)["']/g;
    const sideEffectRegex = /\bimport\s+["']([^"']+)["']/g;
    const dynamicImportRegex = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

    for (const regex of [fromRegex, sideEffectRegex, dynamicImportRegex]) {
      for (const match of contents.matchAll(regex)) {
        if (match[1]) {
          importSpecifiers.add(match[1]);
        }
      }
    }

    for (const specifier of importSpecifiers) {
      if (specifier.startsWith(".")) {
        continue;
      }
      if (!isAllowedExternalImport(specifier)) {
        disallowedImports.push({
          file: relativePath,
          specifier,
        });
      }
    }
  }

  if (forbiddenTokens.length > 0) {
    const filesList = forbiddenTokens.map((file) => `- ${file}`).join("\n");
    throw new Error(
      `Found monorepo-only dependency protocol token(s) in vendored files:\n${filesList}`,
    );
  }

  if (disallowedImports.length > 0) {
    const importList = disallowedImports
      .map(({ file, specifier }) => `- ${file}: ${specifier}`)
      .join("\n");
    throw new Error(
      `Found disallowed external import(s) in vendored sources:\n${importList}`,
    );
  }
}

async function sync(options) {
  let tempDir = "";
  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-copilot-sync-"));
    log(options, `created temp directory ${tempDir}`);

    runGit(tempDir, ["init"], options);
    runGit(tempDir, ["remote", "add", "origin", UPSTREAM_REPO], options);
    runGit(tempDir, ["config", "core.sparseCheckout", "true"], options);

    const sparseCheckoutPath = path.join(tempDir, ".git", "info", "sparse-checkout");
    await writeFile(sparseCheckoutPath, `${UPSTREAM_SOURCE_PATH}/\n`, "utf8");

    runGit(tempDir, ["fetch", "--depth", "1", "origin", options.ref], options);
    runGit(tempDir, ["checkout", "FETCH_HEAD"], options);

    const commit = runGit(tempDir, ["rev-parse", "HEAD"], options);
    const sourceDir = path.join(tempDir, UPSTREAM_SOURCE_PATH);

    if (!existsSync(sourceDir)) {
      throw new Error(`Upstream source path not found: ${UPSTREAM_SOURCE_PATH}`);
    }

    await validateVendoredSources(sourceDir);

    const expectedMetadata = {
      repo: UPSTREAM_REPO,
      ref: options.ref,
      sourcePath: UPSTREAM_SOURCE_PATH,
      commit,
    };

    const drift = await calculateDrift(sourceDir, expectedMetadata);

    if (options.check) {
      if (drift.sourceMissing) {
        throw new Error(
          `Drift detected: ${path.relative(repoRoot, vendorSrcDir)} does not exist. Run npm run sync:copilot-provider.`,
        );
      }

      if (drift.changedPaths.length > 0 || drift.metadataMismatches.length > 0) {
        if (drift.changedPaths.length > 0) {
          console.error("Drift detected in vendored source files:");
          for (const changedPath of drift.changedPaths.sort((a, b) => a.localeCompare(b))) {
            console.error(`- ${changedPath}`);
          }
        }
        if (drift.metadataMismatches.length > 0) {
          console.error("Drift detected in UPSTREAM metadata:");
          for (const mismatch of drift.metadataMismatches) {
            console.error(`- ${mismatch}`);
          }
        }
        throw new Error("Vendored copilot provider is out of sync with upstream.");
      }

      console.log(
        `Vendored copilot provider is up to date at ${commit} (${options.ref}).`,
      );
      return;
    }

    if (!drift.sourceMissing && drift.changedPaths.length === 0 && drift.metadataMismatches.length === 0) {
      console.log(
        `Vendored copilot provider is already up to date at ${commit} (${options.ref}).`,
      );
      return;
    }

    await mkdir(vendorRoot, { recursive: true });
    await rm(vendorSrcDir, { recursive: true, force: true });
    await cp(sourceDir, vendorSrcDir, { recursive: true });

    const metadata = {
      ...expectedMetadata,
      syncedAt: new Date().toISOString(),
    };
    await writeFile(upstreamMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const fileCount = (await listFilesRecursively(vendorSrcDir)).length;
    console.log(
      `Synced ${fileCount} file(s) from ${UPSTREAM_REPO}@${options.ref} (${commit}).`,
    );
  } finally {
    if (tempDir) {
      try {
        const tempDirStats = await stat(tempDir);
        if (tempDirStats.isDirectory()) {
          await rm(tempDir, { recursive: true, force: true });
        }
      } catch {
        // no-op cleanup fallback
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await sync(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
