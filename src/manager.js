import { constants } from "node:fs";
import {
  access,
  chmod,
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
import path from "node:path";
import {
  DEFAULT_AGENT,
  agentSkillsDir,
  detectAvailableAgents,
  isSupportedAgent,
  listSupportedAgents,
} from "./agents.js";
import { getSource } from "./sources.js";
import { storageDir } from "./storage.js";

const MANIFEST_VERSION = 1;

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

async function walkSkillTree(root, visit) {
  const stats = await lstat(root);
  if (stats.isSymbolicLink()) return;

  if (stats.isDirectory()) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      await walkSkillTree(path.join(root, entry.name), visit);
    }
  }

  await visit(root, stats);
}

async function setSkillReadonly(skillPath) {
  if (!(await entryExists(skillPath))) return;

  await walkSkillTree(skillPath, async (entryPath, stats) => {
    await chmod(entryPath, stats.mode & ~0o222);
  });
}

async function setSkillWritable(skillPath) {
  if (!(await entryExists(skillPath))) return;

  await walkSkillTree(skillPath, async (entryPath, stats) => {
    await chmod(entryPath, stats.mode | 0o200);
  });
}

function assertSkillName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
}

export function defaultAgentSelection() {
  const detected = detectAvailableAgents().map(({ id }) => id);
  if (detected.includes(DEFAULT_AGENT)) return [DEFAULT_AGENT];
  if (detected.length > 0) return [detected[0]];
  return [DEFAULT_AGENT];
}

export function resolveAgents(agents = []) {
  const requested = agents.length === 0 ? [DEFAULT_AGENT] : agents;
  const resolved = requested.includes("all") ? listSupportedAgents().map(({ id }) => id) : unique(requested);

  for (const agent of resolved) {
    if (!isSupportedAgent(agent)) {
      throw new Error(
        `Unknown agent "${agent}". Supported agents: ${listSupportedAgents().map(({ id }) => id).join(", ")}.`,
      );
    }
  }

  return resolved;
}

async function readManifest() {
  if (!(await exists(manifestPath()))) {
    return {
      version: MANIFEST_VERSION,
      installs: {},
      sources: {},
      paths: {},
      sourcePaths: {},
      readOnly: {},
    };
  }

  const manifest = JSON.parse(await readFile(manifestPath(), "utf8"));
  if (manifest.version !== MANIFEST_VERSION || typeof manifest.installs !== "object") {
    throw new Error(`Unsupported manifest at ${manifestPath()}.`);
  }

  manifest.sources ||= {};
  manifest.paths ||= {};
  manifest.sourcePaths ||= {};
  manifest.readOnly ||= {};
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

async function resolveSkillTarget(skillName, manifest) {
  if (manifest.paths?.[skillName]) return manifest.paths[skillName];
  if (manifest.sources?.[skillName] && manifest.sourcePaths?.[skillName]) {
    const source = await getSource(manifest.sources[skillName]);
    return path.join(source.path, manifest.sourcePaths[skillName]);
  }
  return path.join(skillsDir(), skillName);
}

async function linkSkill(skillName, agent, { force = false, sourcePath } = {}) {
  const source = sourcePath || path.join(skillsDir(), skillName);
  if (!(await exists(source))) {
    throw new Error(`Skill "${skillName}" is not available at ${source}.`);
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
  {
    agents = [],
    force = false,
    source: repositorySource,
    sourceRoot,
    readOnly = false,
  } = {},
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

    if (repositorySource) {
      added.push(metadata.name);
      skillSources[metadata.name] = {
        source: repositorySource,
        path: sourcePath,
        relativePath: sourceRoot ? path.relative(sourceRoot, sourcePath) || "." : undefined,
        readOnly,
      };
      if (readOnly) await setSkillReadonly(sourcePath);
      else await setSkillWritable(sourcePath);
    } else if (await exists(destination)) {
      if (force) {
        await setSkillWritable(destination);
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

    if (!repositorySource) await setSkillReadonly(destination);

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
    const sourcePath = skillSources[skillName]?.path || await resolveSkillTarget(skillName, manifest);
    await readSkillMetadata(sourcePath);

    for (const agent of resolvedAgents) {
      const target = await linkSkill(skillName, agent, { force, sourcePath });
      installed.push({ skill: skillName, agent, target });
    }

    manifest.installs[skillName] = unique([
      ...(manifest.installs[skillName] || []),
      ...resolvedAgents,
    ]).sort();

    if (Object.hasOwn(skillSources, skillName)) {
      if (skillSources[skillName]) {
        manifest.sources[skillName] = skillSources[skillName].source;
        manifest.paths[skillName] = skillSources[skillName].path;
        if (skillSources[skillName].relativePath !== undefined) {
          manifest.sourcePaths[skillName] = skillSources[skillName].relativePath;
        }
        manifest.readOnly[skillName] = Boolean(skillSources[skillName].readOnly);
      } else {
        delete manifest.sources[skillName];
        delete manifest.paths[skillName];
        delete manifest.sourcePaths[skillName];
        delete manifest.readOnly[skillName];
      }
    }
  }

  await writeManifest(manifest);
  return installed;
}

export async function removeSkills(skillNames, { agents = [] } = {}) {
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

    const source = await resolveSkillTarget(skillName, manifest);
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
      if (manifest.sources[skillName]) {
        delete manifest.sources[skillName];
        delete manifest.paths[skillName];
        delete manifest.sourcePaths[skillName];
        delete manifest.readOnly[skillName];
      }
    } else {
      manifest.installs[skillName] = remainingAgents;
    }
  }

  await writeManifest(manifest);
  return removed;
}

export async function syncSkills({ force = false } = {}) {
  const manifest = await readManifest();
  const synced = [];

  for (const [skillName, agents] of Object.entries(manifest.installs)) {
    const sourcePath = await resolveSkillTarget(skillName, manifest);
    for (const agent of agents) {
      const target = await linkSkill(skillName, agent, { force, sourcePath });
      synced.push({ skill: skillName, agent, target });
    }
  }

  return synced;
}

export async function findBrokenInstalls() {
  const manifest = await readManifest();
  const broken = [];

  for (const [skillName, agents] of Object.entries(manifest.installs)) {
    const source = await resolveSkillTarget(skillName, manifest);
    if (!(await exists(source))) continue;

    for (const agent of agents) {
      const target = path.join(agentSkillsDir(agent), skillName);
      if (await entryExists(target)) continue;
      broken.push({ skill: skillName, agent, target });
    }
  }

  return broken.sort((left, right) =>
    left.skill.localeCompare(right.skill) || left.agent.localeCompare(right.agent)
  );
}

export async function listSkills() {
  const manifest = await readManifest();
  const listed = [];
  const seen = new Set();

  for (const skillName of Object.keys(manifest.installs)) {
    try {
      const skillPath = await resolveSkillTarget(skillName, manifest);
      const metadata = await readSkillMetadata(skillPath);
      const sourceName = manifest.sources[metadata.name];
      seen.add(metadata.name);
      listed.push({
        name: metadata.name,
        description: metadata.description,
        agents: manifest.installs[metadata.name] || [],
        ...(sourceName
          ? {
            source: sourceName,
            path: skillPath,
            sourcePath: manifest.sourcePaths[metadata.name],
            readOnly: Boolean(manifest.readOnly[metadata.name]),
          }
          : {}),
      });
    } catch {
      // Ignore missing or invalid installed records in list output.
    }
  }

  if (!(await exists(skillsDir()))) {
    return listed.sort((left, right) => left.name.localeCompare(right.name));
  }

  const entries = await readdir(skillsDir(), { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue;

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

  return listSupportedAgents()
    .map(({ id }) => id)
    .filter((agent) => installedAgents.has(agent));
}

export function listAgents() {
  return listSupportedAgents();
}

export function listAvailableAgents() {
  return detectAvailableAgents();
}
