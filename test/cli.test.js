import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { run } from "../src/cli.js";

let sandbox;
let previousManagerHome;
let originalTable;
let originalLog;
let rows;
let logs;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "skillman-cli-"));
  previousManagerHome = process.env.SKILLS_MANAGER_HOME;
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
  if (previousManagerHome === undefined) delete process.env.SKILLS_MANAGER_HOME;
  else process.env.SKILLS_MANAGER_HOME = previousManagerHome;
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
