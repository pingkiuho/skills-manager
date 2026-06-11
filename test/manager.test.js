import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  addSkills,
  defaultAgentSelection,
  findBrokenInstalls,
  initSkill,
  listAvailableAgents,
  listSkills,
  removeSkills,
  syncSkills,
} from "../src/manager.js";

let sandbox;
let previousHome;
let previousManagerHome;

async function makeWritable(root) {
  let stats;
  try {
    stats = await lstat(root);
  } catch {
    return;
  }

  if (stats.isSymbolicLink()) return;

  if (stats.isDirectory()) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      await makeWritable(path.join(root, entry.name));
    }
  }

  await chmod(root, stats.mode | 0o200);
}

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "let-skills-"));
  previousHome = process.env.HOME;
  previousManagerHome = process.env.SKILLS_MANAGER_HOME;
  process.env.HOME = path.join(sandbox, "home");
  process.env.SKILLS_MANAGER_HOME = path.join(sandbox, "manager");
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;

  if (previousManagerHome === undefined) delete process.env.SKILLS_MANAGER_HOME;
  else process.env.SKILLS_MANAGER_HOME = previousManagerHome;

  await makeWritable(sandbox);
  await rm(sandbox, { recursive: true, force: true });
});

async function makeSkill(name) {
  const skillFile = await initSkill(name, { destination: sandbox });
  await writeFile(
    skillFile,
    `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n# ${name}\n`,
  );
  return path.dirname(skillFile);
}

test("adds a skill and links it to Codex by default", async () => {
  const source = await makeSkill("release-notes");

  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/release-notes/SKILL.md");
  const libraryCopy = path.join(process.env.SKILLS_MANAGER_HOME, "skills", "release-notes");
  const libraryFile = path.join(libraryCopy, "SKILL.md");
  assert.match(await readFile(target, "utf8"), /Test skill release-notes/);
  assert.equal((await stat(libraryCopy)).mode & 0o222, 0);
  assert.equal((await stat(libraryFile)).mode & 0o222, 0);
  await assert.rejects(
    writeFile(target, "blocked"),
    (error) => error?.code === "EACCES" || error?.code === "EPERM",
  );

  assert.deepEqual(await listSkills(), [
    {
      name: "release-notes",
      description: "Test skill release-notes.",
      agents: ["codex"],
    },
  ]);
});

test("installs one skill to multiple selected agents", async () => {
  const source = await makeSkill("commit-helper");

  await addSkills([source], { agents: ["codex", "claude-code"] });

  assert.match(
    await readFile(path.join(process.env.HOME, ".codex/skills/commit-helper/SKILL.md"), "utf8"),
    /commit-helper/,
  );
  assert.match(
    await readFile(path.join(process.env.HOME, ".claude/skills/commit-helper/SKILL.md"), "utf8"),
    /commit-helper/,
  );
});

test("detects only supported agents that are present in the home directory", async () => {
  await mkdir(path.join(process.env.HOME, ".claude"), { recursive: true });
  await mkdir(path.join(process.env.HOME, ".hermes"), { recursive: true });

  assert.deepEqual(
    listAvailableAgents().map(({ id }) => id),
    ["claude-code", "hermes"],
  );
  assert.deepEqual(defaultAgentSelection(), ["claude-code"]);
});

test("detects Hermes when only a profile skills directory is present", async () => {
  await mkdir(
    path.join(process.env.HOME, ".hermes", "profiles", "work", "skills"),
    { recursive: true },
  );

  assert.deepEqual(
    listAvailableAgents().map(({ id }) => id),
    ["hermes", "hermes:work"],
  );
  assert.deepEqual(defaultAgentSelection(), ["hermes"]);
});

test("detects each Hermes profile skills directory as an independent destination", async () => {
  await mkdir(path.join(process.env.HOME, ".hermes", "skills"), { recursive: true });
  await mkdir(path.join(process.env.HOME, ".hermes", "profiles", "alpha", "skills"), {
    recursive: true,
  });
  await mkdir(path.join(process.env.HOME, ".hermes", "profiles", "beta", "skills"), {
    recursive: true,
  });

  assert.deepEqual(
    listAvailableAgents().map(({ id, path: agentPath }) => ({ id, path: agentPath })),
    [
      { id: "hermes", path: path.join(process.env.HOME, ".hermes", "skills") },
      {
        id: "hermes:alpha",
        path: path.join(process.env.HOME, ".hermes", "profiles", "alpha", "skills"),
      },
      {
        id: "hermes:beta",
        path: path.join(process.env.HOME, ".hermes", "profiles", "beta", "skills"),
      },
    ],
  );
});

test("installs a skill to a selected Hermes profile destination", async () => {
  await mkdir(
    path.join(process.env.HOME, ".hermes", "profiles", "work", "skills"),
    { recursive: true },
  );
  const source = await makeSkill("profile-helper");

  const result = await addSkills([source], { agents: ["hermes:work"] });

  const target = path.join(
    process.env.HOME,
    ".hermes",
    "profiles",
    "work",
    "skills",
    "profile-helper",
  );
  assert.deepEqual(result.installed, [
    { skill: "profile-helper", agent: "hermes:work", target },
  ]);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /profile-helper/);
  assert.deepEqual(await listSkills(), [
    {
      name: "profile-helper",
      description: "Test skill profile-helper.",
      agents: ["hermes:work"],
    },
  ]);
});

test("normalizes a plural SKILLS.md filename when adding a local skill", async () => {
  const source = path.join(sandbox, "plural-file");
  await mkdir(source);
  await writeFile(
    path.join(source, "SKILLS.md"),
    "---\nname: plural-file\ndescription: Uses a plural filename.\n---\n",
  );

  await addSkills([source]);

  assert.match(
    await readFile(path.join(process.env.HOME, ".codex/skills/plural-file/SKILL.md"), "utf8"),
    /Uses a plural filename/,
  );
});

test("adding an existing library skill repairs a missing agent link", async () => {
  const source = await makeSkill("repair-add");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/repair-add");
  await unlink(target);

  const result = await addSkills([source]);

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.reused, ["repair-add"]);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /repair-add/);
});

test("source-backed add links agents directly to the source skill", async () => {
  const source = await makeSkill("source-backed");
  await addSkills([source], { source: "team-skills", sourceRoot: sandbox });

  assert.deepEqual(await listSkills(), [
    {
      name: "source-backed",
      description: "Test skill source-backed.",
      agents: ["codex"],
      source: "team-skills",
      path: source,
      sourcePath: "source-backed",
      readOnly: false,
    },
  ]);
  assert.equal(
    await readlink(path.join(process.env.HOME, ".codex/skills/source-backed")),
    source,
  );
  await writeFile(
    path.join(process.env.HOME, ".codex/skills/source-backed/SKILL.md"),
    "---\nname: source-backed\ndescription: Edited source-backed skill.\n---\n",
  );
  assert.match(
    await readFile(path.join(source, "SKILL.md"), "utf8"),
    /Edited source-backed/,
  );

  await addSkills([source], { force: true });

  assert.deepEqual(await listSkills(), [
    {
      name: "source-backed",
      description: "Edited source-backed skill.",
      agents: ["codex"],
    },
  ]);
});

test("source-backed add can protect the source folder as read-only", async () => {
  const source = await makeSkill("protected-source");

  await addSkills([source], { source: "team-skills", sourceRoot: sandbox, readOnly: true });

  assert.equal((await stat(source)).mode & 0o222, 0);
  await assert.rejects(
    writeFile(path.join(source, "SKILL.md"), "blocked"),
    (error) => error?.code === "EACCES" || error?.code === "EPERM",
  );
  assert.deepEqual(await listSkills(), [
    {
      name: "protected-source",
      description: "Test skill protected-source.",
      agents: ["codex"],
      source: "team-skills",
      path: source,
      sourcePath: "protected-source",
      readOnly: true,
    },
  ]);
});

test("force add refreshes an existing read-only library copy", async () => {
  const source = await makeSkill("refresh-me");
  const skillFile = path.join(source, "SKILL.md");
  await addSkills([source]);

  await writeFile(
    skillFile,
    "---\nname: refresh-me\ndescription: Updated refresh-me skill.\n---\n\n# refresh-me\n",
  );
  await addSkills([source], { force: true });

  const target = path.join(process.env.HOME, ".codex/skills/refresh-me/SKILL.md");
  const libraryFile = path.join(process.env.SKILLS_MANAGER_HOME, "skills", "refresh-me", "SKILL.md");
  assert.match(await readFile(target, "utf8"), /Updated refresh-me skill/);
  assert.equal((await stat(libraryFile)).mode & 0o222, 0);
});

test("sync repairs a deleted agent link", async () => {
  const source = await makeSkill("project-guide");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/project-guide");
  await unlink(target);
  assert.deepEqual(await findBrokenInstalls(), [
    {
      skill: "project-guide",
      agent: "codex",
      target,
    },
  ]);
  await syncSkills();

  assert.deepEqual(await findBrokenInstalls(), []);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /project-guide/);
});

test("sync with force repairs a stale agent link", async () => {
  const source = await makeSkill("daily-plan");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/daily-plan");
  await unlink(target);
  await symlink(path.join(sandbox, "missing"), target, "dir");
  await syncSkills({ force: true });

  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /daily-plan/);
});

test("remove unlinks a skill and keeps its library copy", async () => {
  const source = await makeSkill("clean-up");
  await addSkills([source]);

  await removeSkills(["clean-up"]);

  assert.deepEqual(await listSkills(), [
    {
      name: "clean-up",
      description: "Test skill clean-up.",
      agents: [],
    },
  ]);
  assert.match(
    await readFile(
      path.join(process.env.SKILLS_MANAGER_HOME, "skills", "clean-up", "SKILL.md"),
      "utf8",
    ),
    /clean-up/,
  );
});

test("remove clears a broken saved install without deleting the library copy", async () => {
  const source = await makeSkill("repair-later");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/repair-later");
  await unlink(target);

  assert.deepEqual(await findBrokenInstalls(), [
    {
      skill: "repair-later",
      agent: "codex",
      target,
    },
  ]);

  await removeSkills(["repair-later"]);

  assert.deepEqual(await findBrokenInstalls(), []);
  assert.deepEqual(await listSkills(), [
    {
      name: "repair-later",
      description: "Test skill repair-later.",
      agents: [],
    },
  ]);
});

test("remove refuses to delete an unmanaged agent folder", async () => {
  const source = await makeSkill("careful-remove");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/careful-remove");
  await unlink(target);
  await mkdir(target);
  await writeFile(path.join(target, "notes.txt"), "keep me");

  await assert.rejects(
    removeSkills(["careful-remove"]),
    /Refusing to remove unmanaged target/,
  );
  assert.equal(await readFile(path.join(target, "notes.txt"), "utf8"), "keep me");
});
