import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENTS, DEFAULT_AGENT } from "./agents.js";

const MANIFEST_VERSION = 1;

function storageDir() {
  return process.env.SKILLS_MANAGER_HOME || path.join(os.homedir(), ".skills-manager");
}

function skillsDir() {
  return path.join(storageDir(), "skills");
}

function manifestPath() {
  return path.join(storageDir(), "installs.json");
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function entryExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function linksTo(target, source) {
  try {
    const stats = await lstat(target);
    if (!stats.isSymbolicLink()) return false;

    return path.resolve(path.dirname(target), await readlink(target)) === path.resolve(source);
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function assertSkillName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
}

export function resolveAgents(agents = []) {
  const requested = agents.length === 0 ? [DEFAULT_AGENT] : agents;
  const resolved = requested.includes("all") ? Object.keys(AGENTS) : unique(requested);

  for (const agent of resolved) {
    if (!AGENTS[agent]) {
      throw new Error(
        `Unknown agent "${agent}". Run "skillman agents" to see supported agents.`,
      );
    }
  }

  return resolved;
}

export function agentSkillsDir(agent) {
  if (!AGENTS[agent]) {
    throw new Error(`Unknown agent "${agent}".`);
  }

  return path.join(os.homedir(), AGENTS[agent].globalSkillsDir);
}

async function readManifest() {
  if (!(await exists(manifestPath()))) {
    return { version: MANIFEST_VERSION, installs: {}, sources: {} };
  }

  const manifest = JSON.parse(await readFile(manifestPath(), "utf8"));
  if (manifest.version !== MANIFEST_VERSION || typeof manifest.installs !== "object") {
    throw new Error(`Unsupported manifest at ${manifestPath()}.`);
  }

  manifest.sources ||= {};
  return manifest;
}

async function writeManifest(manifest) {
  await mkdir(storageDir(), { recursive: true });
  const temporaryPath = `${manifestPath()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryPath, manifestPath());
}

async function readSkillMetadata(skillFolder) {
  const entries = await readdir(skillFolder, { withFileTypes: true });
  const skillEntry = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md",
  ) || entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === "skills.md",
  );
  if (!skillEntry) {
    throw new Error(`Missing SKILL.md in ${skillFolder}.`);
  }
  const skillFile = path.join(skillFolder, skillEntry.name);

  const contents = await readFile(skillFile, "utf8");
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!frontmatter) {
    throw new Error(`Missing YAML frontmatter in ${skillFile}.`);
  }

  const name = frontmatter[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
  const description = frontmatter[1].match(
    /^description:\s*["']?([^"'\n]+?)["']?\s*$/m,
  )?.[1];

  if (!name || !description) {
    throw new Error(`SKILL.md must define name and description in ${skillFile}.`);
  }

  assertSkillName(name);
  return { name, description, skillFile };
}

export async function listSourceSkillNames(sources) {
  if (sources.length === 0) {
    throw new Error("Provide at least one local skill folder.");
  }

  const skillNames = [];
  for (const source of sources) {
    const metadata = await readSkillMetadata(path.resolve(source));
    skillNames.push(metadata.name);
  }

  return unique(skillNames);
}

async function linkSkill(skillName, agent, { force = false } = {}) {
  const source = path.join(skillsDir(), skillName);
  if (!(await exists(source))) {
    throw new Error(`Skill "${skillName}" is not in your library. Add it first.`);
  }

  const target = path.join(agentSkillsDir(agent), skillName);
  await mkdir(path.dirname(target), { recursive: true });

  if (await entryExists(target)) {
    if (
      (await linksTo(target, source)) ||
      ((await exists(target)) && (await realpath(target)) === (await realpath(source)))
    ) {
      return target;
    }

    if (!force) {
      throw new Error(`Target already exists: ${target}. Use --force to replace it.`);
    }

    await rm(target, { recursive: true, force: true });
  }

  await symlink(source, target, "dir");
  return target;
}

export async function initSkill(name, { destination = process.cwd() } = {}) {
  assertSkillName(name);
  const skillFolder = path.resolve(destination, name);
  const skillFile = path.join(skillFolder, "SKILL.md");

  if (await exists(skillFolder)) {
    throw new Error(`Destination already exists: ${skillFolder}.`);
  }

  await mkdir(skillFolder, { recursive: true });
  await writeFile(
    skillFile,
    `---\nname: ${name}\ndescription: Describe when an agent should use this skill.\n---\n\n# ${name}\n\nAdd instructions here.\n`,
  );

  return skillFile;
}

export async function addSkills(
  sources,
  { agents = [], force = false, source: repositorySource } = {},
) {
  if (sources.length === 0) {
    throw new Error("Provide at least one local skill folder.");
  }

  await mkdir(skillsDir(), { recursive: true });
  const added = [];
  const reused = [];
  const skillNames = [];
  const skillSources = {};

  for (const source of sources) {
    const sourcePath = path.resolve(source);
    const metadata = await readSkillMetadata(sourcePath);
    const destination = path.join(skillsDir(), metadata.name);

    if (await exists(destination)) {
      if (force) {
        await rm(destination, { recursive: true, force: true });
        await cp(sourcePath, destination, { recursive: true });
        await normalizeSkillFile(metadata.skillFile, destination);
        added.push(metadata.name);
        skillSources[metadata.name] = repositorySource;
      } else {
        reused.push(metadata.name);
      }
    } else {
      await cp(sourcePath, destination, { recursive: true });
      await normalizeSkillFile(metadata.skillFile, destination);
      added.push(metadata.name);
      skillSources[metadata.name] = repositorySource;
    }

    if (repositorySource) skillSources[metadata.name] = repositorySource;
    skillNames.push(metadata.name);
  }

  const installed = await installSkills(skillNames, { agents, force, skillSources });
  return { added, reused, installed };
}

async function normalizeSkillFile(sourceSkillFile, destination) {
  if (path.basename(sourceSkillFile) === "SKILL.md") return;
  await cp(sourceSkillFile, path.join(destination, "SKILL.md"));
}

export async function installSkills(
  skillNames,
  { agents = [], force = false, skillSources = {} } = {},
) {
  if (skillNames.length === 0) {
    throw new Error("Provide at least one skill name.");
  }

  const resolvedAgents = resolveAgents(agents);
  const manifest = await readManifest();
  const installed = [];

  for (const skillName of unique(skillNames)) {
    assertSkillName(skillName);
    await readSkillMetadata(path.join(skillsDir(), skillName));

    for (const agent of resolvedAgents) {
      const target = await linkSkill(skillName, agent, { force });
      installed.push({ skill: skillName, agent, target });
    }

    manifest.installs[skillName] = unique([
      ...(manifest.installs[skillName] || []),
      ...resolvedAgents,
    ]).sort();

    if (Object.hasOwn(skillSources, skillName)) {
      if (skillSources[skillName]) manifest.sources[skillName] = skillSources[skillName];
      else delete manifest.sources[skillName];
    }
  }

  await writeManifest(manifest);
  return installed;
}

export async function removeSkills(skillNames, { agents = [], purge = false } = {}) {
  if (skillNames.length === 0) {
    throw new Error("Provide at least one skill name.");
  }

  const manifest = await readManifest();
  const removed = [];

  for (const skillName of unique(skillNames)) {
    assertSkillName(skillName);
    const installedAgents = manifest.installs[skillName] || [];
    const resolvedAgents = agents.length === 0 ? installedAgents : resolveAgents(agents);
    const remainingAgents = installedAgents.filter((agent) => !resolvedAgents.includes(agent));
    const targets = resolvedAgents.map((agent) => ({
      agent,
      target: path.join(agentSkillsDir(agent), skillName),
    }));

    if (purge && remainingAgents.length > 0) {
      throw new Error(
        `Cannot purge "${skillName}" while it is installed to: ${remainingAgents.join(", ")}.`,
      );
    }

    const source = path.join(skillsDir(), skillName);
    for (const { target } of targets) {
      if (await entryExists(target)) {
        if (!(await linksTo(target, source))) {
          throw new Error(`Refusing to remove unmanaged target: ${target}.`);
        }
      }
    }

    for (const { agent, target } of targets) {
      if (await entryExists(target)) {
        await rm(target, { force: true });
      }
      removed.push({ skill: skillName, agent, target });
    }

    if (remainingAgents.length === 0) {
      delete manifest.installs[skillName];
    } else {
      manifest.installs[skillName] = remainingAgents;
    }

    if (purge) {
      await rm(path.join(skillsDir(), skillName), { recursive: true, force: true });
      delete manifest.sources[skillName];
    }
  }

  await writeManifest(manifest);
  return removed;
}

export async function syncSkills({ force = false } = {}) {
  const manifest = await readManifest();
  const synced = [];

  for (const [skillName, agents] of Object.entries(manifest.installs)) {
    for (const agent of agents) {
      const target = await linkSkill(skillName, agent, { force });
      synced.push({ skill: skillName, agent, target });
    }
  }

  return synced;
}

export async function listSkills() {
  const manifest = await readManifest();
  if (!(await exists(skillsDir()))) {
    return [];
  }

  const entries = await readdir(skillsDir(), { withFileTypes: true });
  const listed = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const metadata = await readSkillMetadata(path.join(skillsDir(), entry.name));
      listed.push({
        name: metadata.name,
        description: metadata.description,
        agents: manifest.installs[metadata.name] || [],
        ...(manifest.sources[metadata.name] ? { source: manifest.sources[metadata.name] } : {}),
      });
    } catch {
      // Ignore non-skill folders in the personal library.
    }
  }

  return listed.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listInstalledAgents(skillNames) {
  if (skillNames.length === 0) {
    throw new Error("Provide at least one skill name.");
  }

  const manifest = await readManifest();
  const installedAgents = new Set();

  for (const skillName of unique(skillNames)) {
    assertSkillName(skillName);
    for (const agent of manifest.installs[skillName] || []) {
      installedAgents.add(agent);
    }
  }

  return Object.keys(AGENTS).filter((agent) => installedAgents.has(agent));
}

export function listAgents() {
  return Object.entries(AGENTS).map(([id, agent]) => ({
    id,
    ...agent,
    path: agentSkillsDir(id),
  }));
}
