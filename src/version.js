import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_COMMAND, CLI_DISPLAY_NAME } from "./branding.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function packageJsonPath(root = PACKAGE_ROOT) {
  return path.join(root, "package.json");
}

async function readPackageMetadata(root = PACKAGE_ROOT) {
  return JSON.parse(await readFile(packageJsonPath(root), "utf8"));
}

async function runGit(args, { cwd = PACKAGE_ROOT } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `git ${args[0]} failed with exit code ${code}.`));
    });
  });
}

export function cliRoot() {
  return PACKAGE_ROOT;
}

export async function getCliVersion({
  root = PACKAGE_ROOT,
  readPackageMetadataCommand = readPackageMetadata,
  runGitCommand = runGit,
} = {}) {
  const metadata = await readPackageMetadataCommand(root);
  let branch = "-";
  let source = "package";

  try {
    branch = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
    source = "git";
  } catch {
    // Installed without a git checkout.
  }

  return {
    version: metadata.version,
    branch,
    source,
    path: root,
  };
}

export async function updateCli({
  root = PACKAGE_ROOT,
  readPackageMetadataCommand = readPackageMetadata,
  runGitCommand = runGit,
} = {}) {
  const beforeMetadata = await readPackageMetadataCommand(root);

  let repoRoot;
  try {
    repoRoot = await runGitCommand(["rev-parse", "--show-toplevel"], { cwd: root });
  } catch {
    throw new Error(
      `${CLI_DISPLAY_NAME} is not running from a git checkout at ${root}. Reinstall it from the repository clone to use "${CLI_COMMAND} version update".`,
    );
  }

  const status = await runGitCommand(["status", "--porcelain"], { cwd: root });
  if (status) {
    throw new Error(
      `Refusing to update ${CLI_DISPLAY_NAME} because the checkout at ${repoRoot} has uncommitted changes.`,
    );
  }

  const branch = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
  const beforeCommit = await runGitCommand(["rev-parse", "HEAD"], { cwd: root });

  await runGitCommand(["pull", "--ff-only"], { cwd: root });

  const afterCommit = await runGitCommand(["rev-parse", "HEAD"], { cwd: root });
  const afterMetadata = await readPackageMetadataCommand(root);

  return {
    previousVersion: beforeMetadata.version,
    version: afterMetadata.version,
    branch,
    source: "git",
    updated: beforeCommit !== afterCommit,
    path: repoRoot,
  };
}
