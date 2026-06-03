import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCES_VERSION = 2;
const CREDENTIALS_VERSION = 2;

function storageDir() {
  return process.env.SKILLS_MANAGER_HOME || path.join(os.homedir(), ".skills-manager");
}

function sourcesDir() {
  return path.join(storageDir(), "sources");
}

function sourcesPath() {
  return path.join(storageDir(), "sources.json");
}

export function credentialsPath() {
  return path.join(storageDir(), ".credentials.json");
}

export function sourceRepoDir(name) {
  assertSourceName(name);
  return path.join(sourcesDir(), name);
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertSourceName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid source name "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
}

function assertAccountName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid account name "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
}

function assertSkillName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid skill directory "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
}

function providerForDomain(domain) {
  return domain === "github.com" || domain.endsWith(".github.com") ? "github" : "gitlab";
}

function usernameForProvider(provider) {
  return provider === "github" ? "x-access-token" : "oauth2";
}

export function parseRepositoryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Repository URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Repository URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Repository URL must not include credentials.");
  }
  if (!url.hostname || url.pathname === "/" || !url.pathname) {
    throw new Error("Repository URL must include a repository path.");
  }

  url.hash = "";
  url.search = "";
  const domain = url.hostname.toLowerCase();
  return {
    url: url.toString().replace(/\/$/, ""),
    domain,
    provider: providerForDomain(domain),
  };
}

async function parseLocalDirectory(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Source location is required.");
  }

  let directoryPath = trimmed;
  if (trimmed.includes("://")) {
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("Source location must be an HTTPS repository URL or a local directory path.");
    }
    if (url.protocol !== "file:") {
      throw new Error("Source location must be an HTTPS repository URL or a local directory path.");
    }
    directoryPath = fileURLToPath(url);
  }

  const resolvedPath = path.resolve(directoryPath);
  let directoryStats;
  try {
    directoryStats = await stat(resolvedPath);
  } catch {
    throw new Error(`Local source directory "${resolvedPath}" does not exist.`);
  }
  if (!directoryStats.isDirectory()) {
    throw new Error(`Local source directory "${resolvedPath}" is not a directory.`);
  }

  return {
    type: "directory",
    location: resolvedPath,
    path: resolvedPath,
  };
}

export async function parseSourceLocation(value) {
  if (/^https:\/\//i.test(value.trim())) {
    const repository = parseRepositoryUrl(value);
    return {
      type: "repository",
      location: repository.url,
      ...repository,
    };
  }
  return parseLocalDirectory(value);
}

export function normalizeAccountDomain(value) {
  let domain = value.trim().toLowerCase();
  if (!domain) throw new Error("Account domain is required.");
  if (domain.includes("://")) {
    try {
      domain = new URL(domain).hostname.toLowerCase();
    } catch {
      throw new Error("Account domain must be a valid hostname.");
    }
  }
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
    throw new Error("Account domain must be a valid hostname.");
  }
  return domain;
}

async function readJson(filePath, fallback) {
  if (!(await exists(filePath))) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writePrivateJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
}

async function readSourcesFile() {
  const registry = await readJson(sourcesPath(), { version: SOURCES_VERSION, sources: {} });
  if (registry.version === 1 && typeof registry.sources === "object") {
    return {
      version: SOURCES_VERSION,
      sources: Object.fromEntries(
        Object.entries(registry.sources).map(([name, source]) => [
          name,
          {
            ...source,
            type: "repository",
            location: source.url,
          },
        ]),
      ),
    };
  }
  if (registry.version !== SOURCES_VERSION || typeof registry.sources !== "object") {
    throw new Error(`Unsupported sources registry at ${sourcesPath()}.`);
  }
  return registry;
}

async function writeSourcesFile(registry) {
  await writePrivateJson(sourcesPath(), registry);
}

async function readCredentialsFile() {
  const credentials = await readJson(credentialsPath(), {
    version: CREDENTIALS_VERSION,
    accounts: {},
  });

  if (credentials.version === 1 && typeof credentials.domains === "object") {
    const accounts = {};
    for (const [domain, credential] of Object.entries(credentials.domains)) {
      const name = `legacy-${domain.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      accounts[name] = {
        name,
        domain,
        ...credential,
      };
    }
    return { version: CREDENTIALS_VERSION, accounts };
  }

  if (credentials.version !== CREDENTIALS_VERSION || typeof credentials.accounts !== "object") {
    throw new Error(`Unsupported credentials file at ${credentialsPath()}.`);
  }
  return credentials;
}

export async function getCredential(domain) {
  const credentials = await readCredentialsFile();
  const normalizedDomain = normalizeAccountDomain(domain);
  return Object.values(credentials.accounts).find(
    (account) => account.domain === normalizedDomain,
  );
}

export async function saveCredential(domain, token, { provider } = {}) {
  if (!token) return;
  const normalizedDomain = domain.toLowerCase();
  const name = `default-${normalizedDomain.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return saveAccount(name, normalizedDomain, token, { provider });
}

export async function listAccounts() {
  const credentials = await readCredentialsFile();
  return Object.values(credentials.accounts)
    .map(({ token: _token, ...account }) => account)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getAccount(name) {
  assertAccountName(name);
  const credentials = await readCredentialsFile();
  const account = credentials.accounts[name];
  if (!account) {
    throw new Error(`Unknown account "${name}".`);
  }
  return account;
}

export async function removeAccount(name) {
  assertAccountName(name);
  const credentials = await readCredentialsFile();
  const account = credentials.accounts[name];
  if (!account) {
    throw new Error(`Unknown account "${name}".`);
  }

  const registry = await readSourcesFile();
  const dependentSources = Object.values(registry.sources)
    .filter((source) => source.account === name)
    .map((source) => source.name)
    .sort((left, right) => left.localeCompare(right));
  if (dependentSources.length > 0) {
    throw new Error(
      `Cannot remove account "${name}" while used by sources: ${dependentSources.join(", ")}.`,
    );
  }

  delete credentials.accounts[name];
  await writePrivateJson(credentialsPath(), credentials);
  return account;
}

export async function saveAccount(name, domain, token, { provider } = {}) {
  assertAccountName(name);
  if (!token) throw new Error("Access token is required.");
  const normalizedDomain = normalizeAccountDomain(domain);
  const resolvedProvider = provider || providerForDomain(normalizedDomain);
  const credentials = await readCredentialsFile();
  credentials.accounts[name] = {
    name,
    domain: normalizedDomain,
    provider: resolvedProvider,
    username: usernameForProvider(resolvedProvider),
    token,
    updatedAt: new Date().toISOString(),
  };
  await writePrivateJson(credentialsPath(), credentials);
}

async function ensureAskpassScript() {
  const askpassPath = path.join(storageDir(), ".git-askpass.sh");
  await mkdir(storageDir(), { recursive: true });
  await writeFile(
    askpassPath,
    '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "$SKILLMAN_GIT_USERNAME" ;;\n  *) printf "%s\\n" "$SKILLMAN_GIT_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );
  await chmod(askpassPath, 0o700);
  return askpassPath;
}

export async function runGit(args, { credential } = {}) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };

  if (credential?.token) {
    env.GIT_ASKPASS = await ensureAskpassScript();
    env.SKILLMAN_GIT_USERNAME = credential.username;
    env.SKILLMAN_GIT_TOKEN = credential.token;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("git", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || `git ${args[0]} failed with exit code ${code}.`;
      reject(new Error(credential?.token ? message.replaceAll(credential.token, "[redacted]") : message));
    });
  });
}

export async function listSources() {
  const registry = await readSourcesFile();
  return Object.values(registry.sources).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getSource(name) {
  assertSourceName(name);
  const registry = await readSourcesFile();
  const source = registry.sources[name];
  if (!source) {
    throw new Error(`Unknown source "${name}". Run "skillman source list" to see configured sources.`);
  }
  return source;
}

export async function addSource(
  name,
  sourceLocation,
  options = {},
) {
  const { account, token, runGitCommand = runGit } = options;
  assertSourceName(name);
  const sourceLocationInfo = await parseSourceLocation(sourceLocation);
  const registry = await readSourcesFile();
  if (registry.sources[name]) {
    throw new Error(`Source "${name}" already exists.`);
  }

  let source;
  if (sourceLocationInfo.type === "repository") {
    let credential;
    if (token) {
      const accountName = account || `default-${sourceLocationInfo.domain.replace(/[^a-z0-9]+/g, "-")}`;
      await saveAccount(accountName, sourceLocationInfo.domain, token, {
        provider: sourceLocationInfo.provider,
      });
      credential = await getAccount(accountName);
    } else if (account) {
      credential = await getAccount(account);
      if (credential.domain !== sourceLocationInfo.domain) {
        throw new Error(
          `Account "${account}" is for ${credential.domain}, but the repository is on ${sourceLocationInfo.domain}.`,
        );
      }
    } else if (!Object.hasOwn(options, "account")) {
      credential = await getCredential(sourceLocationInfo.domain);
    }
    const destination = sourceRepoDir(name);
    await mkdir(sourcesDir(), { recursive: true });

    try {
      await runGitCommand(["clone", "--depth", "1", sourceLocationInfo.url, destination], {
        credential,
      });
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw new Error(
        `Could not clone ${sourceLocationInfo.url}. Check the repository URL and access token. ${error.message}`,
      );
    }

    source = {
      name,
      type: "repository",
      location: sourceLocationInfo.url,
      url: sourceLocationInfo.url,
      domain: sourceLocationInfo.domain,
      provider: sourceLocationInfo.provider,
      account: credential?.name,
      authentication: credential ? "account" : "public",
      path: destination,
      addedAt: new Date().toISOString(),
    };
  } else {
    if (token) throw new Error("Local directory sources do not support access tokens.");
    if (account) throw new Error("Local directory sources do not use repository accounts.");
    source = {
      name,
      type: "directory",
      location: sourceLocationInfo.location,
      provider: "local",
      path: sourceLocationInfo.path,
      addedAt: new Date().toISOString(),
    };
  }

  registry.sources[name] = source;
  await writeSourcesFile(registry);
  return source;
}

export async function updateSource(name, { runGitCommand = runGit } = {}) {
  const source = await getSource(name);
  if (source.type === "directory") {
    await parseLocalDirectory(source.path);
    return source;
  }
  const credential = source.account
    ? await getAccount(source.account)
    : source.authentication === "public"
      ? undefined
      : await getCredential(source.domain);
  await runGitCommand(["-C", source.path, "pull", "--ff-only"], { credential });
  return source;
}

export async function removeSource(name) {
  const registry = await readSourcesFile();
  const source = registry.sources[name];
  if (!source) throw new Error(`Unknown source "${name}".`);
  if (source.type !== "directory") {
    await rm(source.path, { recursive: true, force: true });
  }
  delete registry.sources[name];
  await writeSourcesFile(registry);
  return source;
}

async function walkSkillFiles(folder, found = []) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      await walkSkillFiles(entryPath, found);
    } else if (
      entry.isFile() &&
      (entry.name.toLowerCase() === "skill.md" || entry.name.toLowerCase() === "skills.md")
    ) {
      found.push(entryPath);
    }
  }
  return found;
}

function readFrontmatterName(contents) {
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  return frontmatter?.[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
}

export async function discoverSourceSkills(name) {
  const source = await getSource(name);
  const skillFiles = await walkSkillFiles(source.path);
  const discovered = [];
  const seen = new Set();

  for (const skillFile of skillFiles) {
    const folder = path.dirname(skillFile);
    const skillName = path.basename(folder);
    assertSkillName(skillName);
    const frontmatterName = readFrontmatterName(await readFile(skillFile, "utf8"));
    if (frontmatterName && frontmatterName !== skillName) {
      throw new Error(
        `Skill directory "${skillName}" does not match frontmatter name "${frontmatterName}".`,
      );
    }
    if (seen.has(skillName)) {
      throw new Error(`Source "${name}" contains more than one "${skillName}" skill directory.`);
    }
    seen.add(skillName);
    discovered.push({
      name: skillName,
      path: folder,
      relativePath: path.relative(source.path, folder) || ".",
    });
  }

  return discovered.sort((left, right) => left.name.localeCompare(right.name));
}
