import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { run } from "../src/cli.js";

let sandbox;
let previousHome;
let previousManagerHome;
let originalTable;
let originalLog;
let rows;
let logs;

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
  sandbox = await mkdtemp(path.join(os.tmpdir(), "let-skills-cli-"));
  previousHome = process.env.HOME;
  previousManagerHome = process.env.SKILLS_MANAGER_HOME;
  process.env.HOME = path.join(sandbox, "home");
  process.env.SKILLS_MANAGER_HOME = path.join(sandbox, "manager");
  rows = [];
  logs = [];
  originalTable = console.table;
  originalLog = console.log;
  console.table = (value) => {
    rows.push(value);
  };
  console.log = (value) => {
    logs.push(value);
  };
});

afterEach(async () => {
  console.table = originalTable;
  console.log = originalLog;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousManagerHome === undefined) delete process.env.SKILLS_MANAGER_HOME;
  else process.env.SKILLS_MANAGER_HOME = previousManagerHome;
  await makeWritable(sandbox);
  await rm(sandbox, { recursive: true, force: true });
});

test("adds an account from the CLI", async () => {
  await run(["account", "add", "work-gitlab", "gitlab.example.com", "secret-token"]);

  assert.deepEqual(logs, []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], [
    {
      account: "work-gitlab",
      provider: "gitlab",
      domain: "gitlab.example.com",
      updatedAt: rows[0][0].updatedAt,
    },
  ]);
  assert.match(rows[0][0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("shows help when launched without a command outside interactive mode", async () => {
  await run([]);

  assert.equal(rows.length, 0);
  assert.match(logs[0], /letskills - manage a small personal agent skills library/);
  assert.match(logs[0], /letskills source/);
  assert.match(logs[0], /letskills version update/);
});

test("adds a local skill without requiring an agents option", async () => {
  const skillDir = path.join(sandbox, "demo-skill");
  await run(["init", "demo-skill", "--dir", sandbox]);

  rows = [];
  logs = [];
  await run(["add", skillDir, "--no-interactive"]);

  assert.equal(rows.length, 1);
  assert.deepEqual(logs, ["Added demo-skill"]);
});

test("prefers the first detected supported agent when Codex is not present", async () => {
  await mkdir(path.join(process.env.HOME, ".claude"), { recursive: true });

  const skillDir = path.join(sandbox, "claude-only");
  await run(["init", "claude-only", "--dir", sandbox]);

  rows = [];
  logs = [];
  await run(["add", skillDir, "--no-interactive"]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].agent, "claude-code");
});

test("detects Hermes from profile skills directories in non-interactive mode", async () => {
  await mkdir(
    path.join(process.env.HOME, ".hermes", "profiles", "work", "skills"),
    { recursive: true },
  );

  const skillDir = path.join(sandbox, "hermes-profile");
  await run(["init", "hermes-profile", "--dir", sandbox]);

  rows = [];
  logs = [];
  await run(["add", skillDir, "--no-interactive"]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].agent, "hermes");
});

test("adds a local skill to a selected Hermes profile destination", async () => {
  await mkdir(
    path.join(process.env.HOME, ".hermes", "profiles", "work", "skills"),
    { recursive: true },
  );

  const skillDir = path.join(sandbox, "hermes-profile-target");
  await run(["init", "hermes-profile-target", "--dir", sandbox]);

  rows = [];
  logs = [];
  await run(["add", skillDir, "--agent", "hermes:work", "--no-interactive"]);

  const target = path.join(
    process.env.HOME,
    ".hermes",
    "profiles",
    "work",
    "skills",
    "hermes-profile-target",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].agent, "hermes:work");
  assert.equal(rows[0][0].target, target);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /hermes-profile-target/);
});

test("rejects the removed purge option", async () => {
  await assert.rejects(
    run(["remove", "demo-skill", "--purge"]),
    /Unknown option "--purge"/,
  );
});

test("rejects conflicting source edit policy flags", async () => {
  await assert.rejects(
    run(["add", "--source", "team-skills", "--read-only", "--writable"]),
    /Do not pass "--read-only" together with "--writable"/,
  );
});
