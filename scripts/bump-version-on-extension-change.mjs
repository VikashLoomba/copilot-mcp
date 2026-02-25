#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const WATCHED_PATHS = [/^src\//, /^web\/src\//];
const IGNORED_PATHS = [
  /^src\/test\//,
  /^web\/src\/test\//,
  /^web\/src\/.*\.test\.[cm]?[jt]sx?$/,
  /^src\/.*\.test\.[cm]?ts$/,
];

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runCommand(command, args) {
  execFileSync(command, args, {
    stdio: "inherit",
  });
}

function getStagedFiles() {
  const output = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (!output) {
    return [];
  }

  return output.split("\n").map((file) => file.trim()).filter(Boolean);
}

function isExtensionSourceFile(filePath) {
  if (!WATCHED_PATHS.some((pattern) => pattern.test(filePath))) {
    return false;
  }
  if (IGNORED_PATHS.some((pattern) => pattern.test(filePath))) {
    return false;
  }
  return true;
}

function readVersionFromGitObject(revisionSpec) {
  const packageJson = runGit(["show", revisionSpec]);
  const parsed = JSON.parse(packageJson);
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`Could not read version from ${revisionSpec}`);
  }
  return parsed.version;
}

function stageVersionFiles() {
  const filesToStage = ["package.json"];
  if (existsSync("package-lock.json")) {
    filesToStage.push("package-lock.json");
  }
  runGit(["add", ...filesToStage]);
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const stagedFiles = getStagedFiles();
  const extensionChanges = stagedFiles.filter((filePath) => isExtensionSourceFile(filePath));

  if (extensionChanges.length === 0) {
    return;
  }

  const headVersion = readVersionFromGitObject("HEAD:package.json");
  const indexVersion = readVersionFromGitObject(":package.json");

  if (headVersion !== indexVersion) {
    console.log(`[version-bump] Version already changed (${headVersion} -> ${indexVersion}); skipping auto-bump.`);
    return;
  }

  console.log("[version-bump] Extension source changes detected in staged files:");
  for (const filePath of extensionChanges) {
    console.log(`[version-bump] - ${filePath}`);
  }

  if (dryRun) {
    console.log("[version-bump] Dry run enabled; skipping version bump.");
    return;
  }

  runCommand("npm", ["version", "patch", "--no-git-tag-version"]);
  stageVersionFiles();

  const nextVersion = readVersionFromGitObject(":package.json");
  console.log(`[version-bump] Bumped version ${headVersion} -> ${nextVersion} and staged version files.`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[version-bump] ${message}`);
  process.exit(1);
}
