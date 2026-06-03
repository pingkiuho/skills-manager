import path from "node:path";
import {
  addSkills,
  defaultAgentSelection,
  findBrokenInstalls,
  initSkill,
  installSkills,
  listAvailableAgents,
  listAgents,
  listInstalledAgents,
  listSourceSkillNames,
  listSkills,
  removeSkills,
  syncSkills,
} from "./manager.js";
import {
  BACK,
  selectAgents,
  setupSimpleForm,
  setupRepositoryAccount,
  setupRepositorySource,
  showNotice,
} from "./prompt.js";
import {
  addSource,
  credentialsPath,
  discoverSourceSkills,
  discoverSourceSkillsReport,
  getAccount,
  listAccounts,
  listSources,
  parseRepositoryUrl,
  removeAccount,
  removeSource,
  saveAccount,
  updateSource,
} from "./sources.js";
import { CLI_COMMAND, CLI_DISPLAY_NAME, CLI_HOME_TITLE } from "./branding.js";
import { updateInstalledSkills } from "./updater.js";
import { getCliVersion, updateCli } from "./version.js";

const HELP = `${CLI_COMMAND} - manage your ${CLI_DISPLAY_NAME} library

Usage:
  ${CLI_COMMAND} init <name> [--dir <path>]
  ${CLI_COMMAND}
  ${CLI_COMMAND} add <local-skill-folder...> [-a, --agent <agent...>] [--force] [--no-interactive]
  ${CLI_COMMAND} add --source <source-name>
  ${CLI_COMMAND} install <skill...> [-a, --agent <agent...>] [--force]
  ${CLI_COMMAND} list
  ${CLI_COMMAND} remove <skill...> [-a, --agent <agent...>] [--purge] [--no-interactive]
  ${CLI_COMMAND} remove --source <source-name> [--purge]
  ${CLI_COMMAND} update
  ${CLI_COMMAND} sync [--force]
  ${CLI_COMMAND} agents
  ${CLI_COMMAND} version
  ${CLI_COMMAND} version update
  ${CLI_COMMAND} account add <name> <domain> <token>
  ${CLI_COMMAND} account list
  ${CLI_COMMAND} account remove <name>
  ${CLI_COMMAND} source
  ${CLI_COMMAND} source add [name] [https-url|local-directory] [--account <name>] [--no-interactive]
  ${CLI_COMMAND} source list
  ${CLI_COMMAND} source update <name>
  ${CLI_COMMAND} source remove <name>

Notes:
  Run "${CLI_COMMAND}" in a terminal to open the interactive home page.
  In a terminal, add and remove show an interactive agent selector for detected agents.
  Pass "--no-interactive" to skip prompts. The default add target is the detected Codex agent when available, otherwise the first detected supported agent, falling back to codex.
  Pass "--agent all" to target every supported agent.
  Personal copies live in ~/.skills-manager/skills by default.
  "${CLI_COMMAND} version update" updates this checkout with "git pull --ff-only".
`;

function parseArguments(args) {
  const positionals = [];
  const options = { agents: [] };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "-a" || argument === "--agent") {
      const agent = args[index + 1];
      if (!agent || agent.startsWith("-")) {
        throw new Error(`${argument} requires an agent name.`);
      }
      options.agents.push(agent);
      index += 1;
    } else if (argument === "--dir") {
      const destination = args[index + 1];
      if (!destination || destination.startsWith("-")) {
        throw new Error("--dir requires a path.");
      }
      options.destination = destination;
      index += 1;
    } else if (argument === "--source") {
      const source = args[index + 1];
      if (!source || source.startsWith("-")) {
        throw new Error("--source requires a source name.");
      }
      options.source = source;
      index += 1;
    } else if (argument === "--account") {
      const account = args[index + 1];
      if (!account || account.startsWith("-")) {
        throw new Error("--account requires an account name.");
      }
      options.account = account;
      index += 1;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--purge") {
      options.purge = true;
    } else if (argument === "--no-interactive") {
      options.interactive = false;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option "${argument}".`);
    } else {
      positionals.push(argument);
    }
  }

  return { positionals, options };
}

function printRows(rows) {
  if (rows.length === 0) {
    console.log("Nothing to show.");
    return;
  }

  console.table(rows);
}

function shouldPrompt(options, input, output) {
  return (options.agents || []).length === 0 &&
    options.interactive !== false &&
    input.isTTY &&
    output.isTTY;
}

function canOpenInteractiveScreen(options, input, output) {
  return options.interactive !== false && input.isTTY && output.isTTY;
}

function formatSourceRow(source) {
  return {
    source: source.name,
    type: source.type || "repository",
    provider: source.provider,
    domain: source.domain || "-",
    account: source.account || (source.type === "directory" ? "-" : "public"),
    location: source.location || source.url || source.path,
    path: source.path,
  };
}

function formatAccountRow(account) {
  return {
    account: account.name,
    provider: account.provider,
    domain: account.domain,
    updatedAt: account.updatedAt,
  };
}

function formatSkillRow(skill) {
  return {
    skill: skill.name,
    agents: skill.agents.join(", ") || "-",
    source: skill.source || "-",
    description: skill.description,
  };
}

function formatAgentRow(agent) {
  return {
    agent: agent.id,
    name: agent.name,
    path: agent.path,
  };
}

function formatVersionRow(versionInfo) {
  return {
    version: versionInfo.version,
    branch: versionInfo.branch,
    source: versionInfo.source,
    path: versionInfo.path,
  };
}

function formatVersionUpdateRow(updateInfo) {
  return {
    version: updateInfo.version,
    previousVersion: updateInfo.previousVersion,
    branch: updateInfo.branch,
    updated: updateInfo.updated ? "yes" : "no",
    path: updateInfo.path,
  };
}

function availableAgentChoices() {
  return listAvailableAgents();
}

function requireAvailableAgentChoices() {
  const choices = availableAgentChoices();
  if (choices.length === 0) {
    throw new Error(
      "No supported agents detected. Install Codex, Claude Code, GitHub Copilot, or Hermes first, or pass --agent explicitly.",
    );
  }
  return choices;
}

function formatKeyValueLines(rows) {
  if (rows.length === 0) return ["Nothing to show."];
  const entries = rows.flatMap((row) => Object.entries(row));
  const keyWidth = Math.max(...entries.map(([key]) => key.length));
  return rows.flatMap((row, index) => [
    ...Object.entries(row).map(([key, value]) => `${key.padEnd(keyWidth)}  ${value}`),
    ...(index < rows.length - 1 ? [""] : []),
  ]);
}

function formatBrokenInstallLines(installs, { limit = 6 } = {}) {
  const shown = installs.slice(0, limit).map(({ skill, agent }) => `  - ${skill} (${agent})`);
  if (installs.length > limit) {
    shown.push(`  - and ${installs.length - limit} more`);
  }
  return shown;
}

function groupInstallsBySkill(installs) {
  const grouped = new Map();

  for (const { skill, agent } of installs) {
    const agents = grouped.get(skill) || [];
    agents.push(agent);
    grouped.set(skill, agents);
  }

  return grouped;
}

function inspectSourceLocation(value) {
  return /^https:\/\//i.test(value.trim())
    ? parseRepositoryUrl(value)
    : { provider: "local directory", domain: path.resolve(value) };
}

function describeSourceAddResult(source, skills) {
  return {
    title: source.type === "directory" ? "Directory source added" : "Repository source added",
    lines: [
      `Source: ${source.name}`,
      source.type === "directory"
        ? `Directory: ${source.path}`
        : `Repository: ${source.url}`,
      source.type === "directory"
        ? "Account: not used"
        : `Account: ${source.account || "public repository"}`,
      source.type === "directory"
        ? `Managed path: ${source.path}`
        : `Local clone: ${source.path}`,
      `Discovered skills: ${skills.length}`,
    ],
    value: source,
  };
}

function formatInvalidSkillLines(invalidSkills) {
  if (invalidSkills.length === 0) return [];
  return [
    `Ignored invalid skills: ${invalidSkills.length}`,
    ...invalidSkills.map(({ relativePath, reason }) => `- ${relativePath}: ${reason}`),
  ];
}

async function addInteractively(sources, options, input, output) {
  if (!shouldPrompt(options, input, output)) return false;
  const skillNames = await listSourceSkillNames(sources);
  const choices = requireAvailableAgentChoices();

  const result = await selectAgents({
    title: "Install the following skill(s) to which agents?",
    choices,
    skillNames,
    defaultAgents: defaultAgentSelection(),
    escapeLabel: options.allowBack ? "back" : "cancel",
    ...(options.allowBack ? { escapeValue: BACK } : {}),
    input,
    output,
    onConfirm: async (agents) => {
      const result = await addSkills(sources, { ...options, agents });
      return {
        title: "Installation complete",
        summary: [
          result.added.length > 0 ? `Added: ${result.added.join(", ")}` : undefined,
          result.reused.length > 0 ? `Reused library copy: ${result.reused.join(", ")}` : undefined,
        ].filter(Boolean),
        rows: result.installed,
        value: result,
      };
    },
  });
  if (result === BACK) return BACK;
  return true;
}

async function addLocalSkillInteractively(input, output) {
  const skillPath = await setupSimpleForm({
    title: "Add local skill",
    welcome: "Welcome. Add one local skill folder to your personal library.",
    fields: [
      { id: "path", label: "Skill folder path", required: true },
    ],
    workingTitle: "Preparing local skill",
    workingLines: ({ path: sourcePath }) => [`Path: ${sourcePath}`],
    escapeLabel: "back",
    escapeValue: BACK,
    input,
    output,
    onConfirm: async ({ path: sourcePath }) => ({
      title: "Skill folder ready",
      lines: [`Path: ${sourcePath}`],
      value: sourcePath,
    }),
  });

  if (skillPath === BACK) return BACK;

  const result = await addInteractively([skillPath], { allowBack: true }, input, output);
  if (result === BACK) return addLocalSkillInteractively(input, output);
  if (result) return result;

  const { added, reused, installed } = await addSkills([skillPath]);
  await showNotice({
    title: "Installation complete",
    lines: [
      ...(added.length > 0 ? [`Added: ${added.join(", ")}`] : []),
      ...(reused.length > 0 ? [`Reused library copy: ${reused.join(", ")}`] : []),
      "",
      ...formatKeyValueLines(installed),
    ],
    escapeLabel: "close",
    input,
    output,
  });
  return true;
}

async function addFromRepositorySource(sourceName, options, input, output) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Using "--source" requires an interactive terminal.');
  }

  const { skills: discovered, invalidSkills } = await discoverSourceSkillsReport(sourceName);
  if (discovered.length === 0) {
    const reason = invalidSkills.length > 0
      ? `Source "${sourceName}" does not contain any valid skills. Invalid skills: ${invalidSkills.length}.`
      : `Source "${sourceName}" does not contain any SKILL.md files.`;
    throw new Error(reason);
  }

  while (true) {
    const selected = await selectAgents({
      welcome: [
        `Welcome. Choose skills from source "${sourceName}".`,
        invalidSkills.length > 0 ? `Ignored invalid skills: ${invalidSkills.length}` : undefined,
      ].filter(Boolean).join("\n"),
      title: "Install which skill(s) from this source?",
      choices: discovered.map(({ name, relativePath }) => ({
        id: name,
        name,
        path: relativePath,
      })),
      showSkillSection: false,
      selectionNoun: "skill",
      escapeLabel: "cancel",
      input,
      output,
    });

    const selectedNames = new Set(selected);
    const selectedFolders = discovered
      .filter(({ name }) => selectedNames.has(name))
      .map(({ path }) => path);

    const interactiveResult = await addInteractively(
      selectedFolders,
      { ...options, allowBack: true },
      input,
      output,
    );
    if (interactiveResult === BACK) continue;
    if (interactiveResult) return;

    const { added, reused, installed } = await addSkills(selectedFolders, options);
    if (added.length > 0) console.log(`Added ${added.join(", ")}`);
    if (reused.length > 0) console.log(`Reused library copy: ${reused.join(", ")}`);
    printRows(installed);
    return;
  }
}

async function removeFromRepositorySource(sourceName, options, input, output) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Using "--source" requires an interactive terminal.');
  }

  const installed = new Set(
    (await listSkills())
      .filter(({ agents }) => agents.length > 0)
      .map(({ name }) => name),
  );
  const discovered = (await discoverSourceSkills(sourceName))
    .filter(({ name }) => installed.has(name));

  if (discovered.length === 0) {
    throw new Error(`Source "${sourceName}" does not contain any installed skills.`);
  }

  while (true) {
    const selected = await selectAgents({
      welcome: `Welcome. Choose installed skills from source "${sourceName}".`,
      title: "Uninstall which skill(s) from this source?",
      choices: discovered.map(({ name, relativePath }) => ({
        id: name,
        name,
        path: relativePath,
      })),
      showSkillSection: false,
      selectionNoun: "skill",
      escapeLabel: "cancel",
      input,
      output,
    });

    const interactiveResult = await removeInteractively(
      selected,
      { ...options, allowBack: true },
      input,
      output,
    );
    if (interactiveResult === BACK) continue;
    if (interactiveResult) return;

    printRows(await removeSkills(selected, options));
    return;
  }
}

async function addRepositoryAccountInteractively(input, output, { allowBack = false } = {}) {
  return setupRepositoryAccount({
    credentialFile: credentialsPath(),
    escapeLabel: allowBack ? "back" : "cancel",
    ...(allowBack ? { escapeValue: BACK } : {}),
    input,
    output,
    onConfirm: async ({ name, domain, token }) => {
      await saveAccount(name, domain, token);
      const account = await getAccount(name);
      return {
        title: "Account saved",
        lines: [
          `Account: ${account.name}`,
          `Domain: ${account.domain}`,
          `Provider: ${account.provider}`,
        ],
        value: account,
      };
    },
  });
}

async function selectRepositoryAccount(input, output, { allowBack = false } = {}) {
  while (true) {
    const accounts = await listAccounts();
    const selection = await selectAgents({
      welcome: "Welcome. Choose an account for this repository source.",
      title: "Which account should be used?",
      choices: [
        {
          id: "__new__",
          name: "Add a new account",
          path: "Store a reusable access token",
        },
        {
          id: "__public__",
          name: "Public repository",
          path: "Clone without an access token",
        },
        ...accounts.map((account) => ({
          id: account.name,
          name: account.name,
          path: `${account.provider}  ${account.domain}`,
        })),
      ],
      showSkillSection: false,
      singleSelection: true,
      selectionNoun: "account",
      escapeLabel: allowBack ? "back" : "cancel",
      ...(allowBack ? { escapeValue: BACK } : {}),
      input,
      output,
    });

    if (selection === BACK) return BACK;
    const [selected] = selection;
    if (selected === "__new__") {
      const account = await addRepositoryAccountInteractively(input, output, { allowBack: true });
      if (account === BACK) continue;
      return account;
    }
    if (selected === "__public__") return undefined;
    return getAccount(selected);
  }
}

async function addSourceInteractively({
  initialName = "",
  initialLocation = "",
  input,
  output,
  allowBack = false,
}) {
  const initialType = initialLocation
    ? (/^https:\/\//i.test(initialLocation) ? "repository" : "directory")
    : undefined;

  while (true) {
    let sourceType = initialType;
    if (!sourceType) {
      const selection = await selectAgents({
        welcome: "Welcome. Choose the kind of source you want to add.",
        title: "Add which kind of source?",
        choices: [
          {
            id: "repository",
            name: "Repository source",
            path: "Clone from GitHub, GitLab, or a self-hosted GitLab",
          },
          {
            id: "directory",
            name: "Local directory",
            path: "Track an existing folder without cloning or deleting it",
          },
        ],
        showSkillSection: false,
        singleSelection: true,
        selectionNoun: "source type",
        escapeLabel: allowBack ? "back" : "cancel",
        ...(allowBack ? { escapeValue: BACK } : {}),
        input,
        output,
      });
      if (selection === BACK) return BACK;
      [sourceType] = selection;
    }

    if (sourceType === "repository") {
      const account = await selectRepositoryAccount(input, output, { allowBack: true });
      if (account === BACK) {
        if (initialType) return BACK;
        continue;
      }

      const source = await setupRepositorySource({
        initialName,
        initialUrl: initialLocation,
        account,
        inspectUrl: inspectSourceLocation,
        escapeLabel: "back",
        escapeValue: BACK,
        input,
        output,
        onConfirm: async ({ name: sourceName, url }) => {
          const createdSource = await addSource(sourceName, url, { account: account?.name });
          const { skills, invalidSkills } = await discoverSourceSkillsReport(sourceName);
          const result = describeSourceAddResult(createdSource, skills);
          result.lines.push(...formatInvalidSkillLines(invalidSkills));
          return result;
        },
      });
      if (source === BACK) {
        if (initialType) return BACK;
        continue;
      }
      return source;
    }

    const source = await setupRepositorySource({
      initialName,
      initialUrl: initialLocation,
      inspectUrl: inspectSourceLocation,
      escapeLabel: "back",
      escapeValue: BACK,
      input,
      output,
      onConfirm: async ({ name: sourceName, url }) => {
        const createdSource = await addSource(sourceName, url);
        const { skills, invalidSkills } = await discoverSourceSkillsReport(sourceName);
        const result = describeSourceAddResult(createdSource, skills);
        result.lines.push(...formatInvalidSkillLines(invalidSkills));
        return result;
      },
    });
    if (source === BACK) {
      if (initialType) return BACK;
      continue;
    }
    return source;
  }
}

async function manageAccountsInteractively(input, output) {
  while (true) {
    const accounts = await listAccounts();
    const selection = await selectAgents({
      welcome: "Welcome. Manage reusable repository accounts.",
      title: "What would you like to do?",
      choices: [
        {
          id: "add-account",
          name: "Add account",
          path: "Save a new reusable repository token",
        },
        {
          id: "remove-account",
          name: "Remove account",
          path: accounts.length === 0 ? "No saved accounts" : `${accounts.length} saved account(s)`,
        },
      ],
      showSkillSection: false,
      singleSelection: true,
      selectionNoun: "action",
      escapeLabel: "back",
      escapeValue: BACK,
      input,
      output,
    });

    if (selection === BACK) return;
    const [selected] = selection;
    if (selected === "add-account") {
      try {
        const result = await addRepositoryAccountInteractively(input, output, { allowBack: true });
        if (result === BACK) continue;
      } catch {
        continue;
      }
      continue;
    }

    if (accounts.length === 0) {
      await showNotice({
        title: "No accounts yet",
        lines: ["Add an account first, then come back here to remove it."],
        escapeLabel: "close",
        input,
        output,
      });
      continue;
    }

    try {
      const result = await selectAgents({
        welcome: "Welcome. Choose account(s) to remove.",
        title: "Remove which account(s)?",
        choices: accounts.map((account) => ({
          id: account.name,
          name: account.name,
          path: `${account.provider}  ${account.domain}`,
        })),
        showSkillSection: false,
        selectionNoun: "account",
        escapeLabel: "back",
        escapeValue: BACK,
        input,
        output,
        onConfirm: async (selectedAccounts) => {
          const removedAccounts = [];
          for (const accountName of selectedAccounts) {
            const removed = await removeAccount(accountName);
            removedAccounts.push(removed);
          }
          return {
            title: "Account removal complete",
            summary: [
              `Removed: ${removedAccounts.map(({ name }) => name).join(", ")}`,
            ],
            rows: removedAccounts.map((account) => ({
              agent: account.name,
              target: `${account.provider}  ${account.domain}`,
            })),
            value: removedAccounts,
          };
        },
      });
      if (result === BACK) continue;
    } catch {
      continue;
    }
  }
}

async function listSkillsInteractively(input, output) {
  const skills = await listSkills();
  await showNotice({
    title: "Installed skills",
    lines: formatKeyValueLines(skills.map(formatSkillRow)),
    escapeLabel: "back",
    input,
    output,
  });
}

async function listAgentsInteractively(input, output) {
  const available = availableAgentChoices();
  await showNotice({
    title: "Detected agents",
    lines: available.length === 0
      ? [
        "No supported agents detected.",
        "Install Codex, Claude Code, GitHub Copilot, or Hermes first.",
      ]
      : formatKeyValueLines(available.map(formatAgentRow)),
    escapeLabel: "back",
    input,
    output,
  });
}

async function updateInstalledSkillsInteractively(input, output) {
  const { updatedSources, updatedSkills, skippedSkills } = await updateInstalledSkills();
  await showNotice({
    title: "Update complete",
    lines: [
      updatedSources.length > 0
        ? `Updated sources: ${updatedSources.join(", ")}`
        : "Updated sources: -",
      updatedSkills.length > 0
        ? `Updated skills: ${updatedSkills.map(({ skill }) => skill).join(", ")}`
        : "Updated skills: -",
      skippedSkills.length > 0
        ? `Skipped skills: ${skippedSkills.map(({ skill }) => skill).join(", ")}`
        : "Skipped skills: -",
    ],
    escapeLabel: "back",
    input,
    output,
  });
}

async function syncSkillsInteractively(input, output) {
  const repaired = await syncSkills({});
  await showNotice({
    title: "Sync complete",
    lines: formatKeyValueLines(repaired.map(({ agent, skill, target }) => ({
      skill,
      agent,
      target,
    }))),
    escapeLabel: "back",
    input,
    output,
  });
}

async function promptForBrokenInstallsInteractively(input, output) {
  const brokenInstalls = await findBrokenInstalls();
  if (brokenInstalls.length === 0) return;

  const selection = await selectAgents({
    welcome: [
      `Welcome. Found ${brokenInstalls.length} broken saved agent link(s).`,
      "",
      "These installs are missing from the agent skills folders:",
      ...formatBrokenInstallLines(brokenInstalls),
    ].join("\n"),
    title: "How would you like to handle them?",
    choices: [
      {
        id: "repair-now",
        name: "Repair now",
        path: `Recreate ${brokenInstalls.length} missing link(s)`,
      },
      {
        id: "remove-saved-installs",
        name: "Remove saved installs",
        path: `Forget ${brokenInstalls.length} missing install record(s)`,
      },
      {
        id: "review-later",
        name: "Review later",
        path: "Open the home page without changing anything",
      },
    ],
    showSkillSection: false,
    singleSelection: true,
    selectionNoun: "action",
    escapeLabel: "review later",
    escapeValue: BACK,
    input,
    output,
  });

  if (selection === BACK) return;
  const [selected] = selection;
  if (selected === "review-later") return;

  try {
    if (selected === "repair-now") {
      const brokenKeys = new Set(
        brokenInstalls.map(({ skill, agent }) => `${skill}\u0000${agent}`),
      );
      const repaired = (await syncSkills({})).filter(({ skill, agent }) =>
        brokenKeys.has(`${skill}\u0000${agent}`)
      );
      await showNotice({
        title: "Broken links repaired",
        lines: [
          `Repaired ${repaired.length} saved agent link(s).`,
          "",
          ...formatBrokenInstallLines(repaired),
        ],
        escapeLabel: "continue",
        input,
        output,
      });
      return;
    }

    const removed = [];
    for (const [skill, agents] of groupInstallsBySkill(brokenInstalls)) {
      removed.push(...await removeSkills([skill], { agents }));
    }

    await showNotice({
      title: "Broken installs removed",
      lines: [
        `Removed ${removed.length} saved install record(s).`,
        "",
        ...formatBrokenInstallLines(removed),
      ],
      escapeLabel: "continue",
      input,
      output,
    });
  } catch (error) {
    await showNotice({
      title: "Could not update broken installs",
      lines: [`Error: ${error.message}`],
      escapeLabel: "continue",
      input,
      output,
    });
  }
}

async function installFromSourceInteractively(input, output) {
  const sources = await listSources();
  if (sources.length === 0) {
    await showNotice({
      title: "No sources yet",
      lines: ["Add a source first, then come back here to install from it."],
      escapeLabel: "back",
      input,
      output,
    });
    return;
  }

  const selection = await selectAgents({
    welcome: "Welcome. Choose a source to browse for skills.",
    title: "Install from which source?",
    choices: sources.map((source) => ({
      id: source.name,
      name: source.name,
      path: `${source.type || "repository"}  ${source.location || source.url || source.path}`,
    })),
    showSkillSection: false,
    singleSelection: true,
    selectionNoun: "source",
    escapeLabel: "back",
    escapeValue: BACK,
    input,
    output,
  });

  if (selection === BACK) return;
  const [sourceName] = selection;
  try {
    await addFromRepositorySource(sourceName, { agents: [] }, input, output);
  } catch (error) {
    await showNotice({
      title: "Could not open source",
      lines: [`Source: ${sourceName}`, `Error: ${error.message}`],
      escapeLabel: "back",
      input,
      output,
    });
  }
}

async function removeInstalledSkillsInteractively(input, output) {
  const skills = (await listSkills()).filter(({ agents }) => agents.length > 0);
  if (skills.length === 0) {
    await showNotice({
      title: "No installed skills",
      lines: ["Install a skill first, then come back here to remove it."],
      escapeLabel: "back",
      input,
      output,
    });
    return;
  }

  while (true) {
    const selected = await selectAgents({
      welcome: "Welcome. Choose installed skills to remove.",
      title: "Remove which skill(s)?",
      choices: skills.map((skill) => ({
        id: skill.name,
        name: skill.name,
        path: `${skill.source || "local"}  ${skill.agents.join(", ") || "-"}`,
      })),
      showSkillSection: false,
      selectionNoun: "skill",
      escapeLabel: "back",
      escapeValue: BACK,
      input,
      output,
    });

    if (selected === BACK) return;
    const interactiveResult = await removeInteractively(
      selected,
      { allowBack: true },
      input,
      output,
    );
    if (interactiveResult === BACK) continue;
    return;
  }
}

async function runSkillsManager(input, output) {
  while (true) {
    const installedCount = (await listSkills()).filter(({ agents }) => agents.length > 0).length;
    const sourceCount = (await listSources()).length;
    const selection = await selectAgents({
      welcome: "Welcome. Manage your skill library.",
      title: "What would you like to do?",
      choices: [
        {
          id: "list-installed-skills",
          name: "List installed skills",
          path: `${installedCount} skill record(s)`,
        },
        {
          id: "install-from-source",
          name: "Install from source",
          path: sourceCount === 0 ? "No configured sources" : `${sourceCount} configured source(s)`,
        },
        {
          id: "install-local-skill",
          name: "Install local skill",
          path: "Install a skill from a local folder",
        },
        {
          id: "remove-installed-skills",
          name: "Remove installed skills",
          path: installedCount === 0 ? "No installed skills" : `${installedCount} installed skill(s)`,
        },
      ],
      showSkillSection: false,
      singleSelection: true,
      selectionNoun: "action",
      escapeLabel: "back",
      escapeValue: BACK,
      input,
      output,
    });

    if (selection === BACK) return;
    const [selected] = selection;

    try {
      if (selected === "list-installed-skills") {
        await listSkillsInteractively(input, output);
      } else if (selected === "install-from-source") {
        await installFromSourceInteractively(input, output);
      } else if (selected === "install-local-skill") {
        const result = await addLocalSkillInteractively(input, output);
        if (result === BACK) continue;
      } else if (selected === "remove-installed-skills") {
        await removeInstalledSkillsInteractively(input, output);
      }
    } catch {
      continue;
    }
  }
}

async function runSourceManager(input, output) {
  while (true) {
    const sources = await listSources();
    const accounts = await listAccounts();
    const selection = await selectAgents({
      welcome: "Welcome. Manage reusable skill sources and repository accounts.",
      title: "What would you like to do?",
      choices: [
        {
          id: "add-source",
          name: "Add source",
          path: "Register a repository or local directory",
        },
        {
          id: "remove-source",
          name: "Remove source",
          path: sources.length === 0 ? "No configured sources" : `${sources.length} configured source(s)`,
        },
        {
          id: "update-source",
          name: "Update source",
          path: sources.length === 0 ? "No configured sources" : "Refresh one or more sources",
        },
        {
          id: "manage-accounts",
          name: "Manage accounts",
          path: `${accounts.length} saved account(s)`,
        },
      ],
      showSkillSection: false,
      singleSelection: true,
      selectionNoun: "action",
      escapeLabel: "exit",
      escapeValue: BACK,
      input,
      output,
    });

    if (selection === BACK) return;
    const [selected] = selection;

    if (selected === "add-source") {
      try {
        await addSourceInteractively({ input, output, allowBack: true });
      } catch {
        continue;
      }
      continue;
    }

    if (selected === "manage-accounts") {
      await manageAccountsInteractively(input, output);
      continue;
    }

    if (sources.length === 0) {
      await showNotice({
        title: "No sources yet",
        lines: ["Add a source first, then come back here to manage it."],
        escapeLabel: "close",
        input,
        output,
      });
      continue;
    }

    try {
      const title = selected === "remove-source"
        ? "Remove which source(s)?"
        : "Update which source(s)?";
      const successTitle = selected === "remove-source"
        ? "Source removal complete"
        : "Source update complete";
      const result = await selectAgents({
        welcome: "Welcome. Choose one or more sources to manage.",
        title,
        choices: sources.map((source) => ({
          id: source.name,
          name: source.name,
          path: `${source.type || "repository"}  ${source.location || source.url || source.path}`,
        })),
        showSkillSection: false,
        selectionNoun: "source",
        escapeLabel: "back",
        escapeValue: BACK,
        input,
        output,
        onConfirm: async (selectedSources) => {
          const managedSources = [];
          for (const sourceName of selectedSources) {
            const managed = selected === "remove-source"
              ? await removeSource(sourceName)
              : await updateSource(sourceName);
            managedSources.push(managed);
          }
          return {
            title: successTitle,
            summary: [
              `${selected === "remove-source" ? "Removed" : "Updated"}: ${managedSources.map(({ name }) => name).join(", ")}`,
            ],
            rows: managedSources.map((source) => ({
              agent: source.name,
              target: source.location || source.url || source.path,
            })),
            value: managedSources,
          };
        },
      });
      if (result === BACK) continue;
    } catch {
      continue;
    }
  }
}

async function runHomePage(input, output) {
  await promptForBrokenInstallsInteractively(input, output);

  while (true) {
    const skills = await listSkills();
    const installedCount = skills.filter(({ agents }) => agents.length > 0).length;
    const sources = await listSources();
    const selection = await selectAgents({
      welcome: "Welcome. Choose an area to manage.",
      title: CLI_HOME_TITLE,
      choices: [
        {
          id: "manage-skills",
          name: "Manage skills",
          path: `${installedCount} installed skill(s)`,
        },
        {
          id: "manage-sources",
          name: "Manage sources",
          path: `${sources.length} configured source(s)`,
        },
        {
          id: "update-installed-skills",
          name: "Refresh installed source skills",
          path: "Pull or rescan configured sources and refresh library copies",
        },
        {
          id: "sync-skills",
          name: "Repair agent links",
          path: "Rebuild saved symlinks from the manifest",
        },
        {
          id: "list-agents",
          name: "List agents",
          path: `${availableAgentChoices().length} detected agent target(s)`,
        },
      ],
      showSkillSection: false,
      singleSelection: true,
      selectionNoun: "section",
      escapeLabel: "exit",
      escapeValue: BACK,
      input,
      output,
    });

    if (selection === BACK) return;
    const [selected] = selection;

    try {
      if (selected === "manage-skills") {
        await runSkillsManager(input, output);
      } else if (selected === "manage-sources") {
        await runSourceManager(input, output);
      } else if (selected === "update-installed-skills") {
        await updateInstalledSkillsInteractively(input, output);
      } else if (selected === "sync-skills") {
        await syncSkillsInteractively(input, output);
      } else if (selected === "list-agents") {
        await listAgentsInteractively(input, output);
      }
    } catch {
      continue;
    }
  }
}

async function runSourceCommand(positionals, options, input, output) {
  const [action, name, repositoryUrl] = positionals;

  if (!action) {
    if (canOpenInteractiveScreen(options, input, output)) {
      await runSourceManager(input, output);
      return;
    }

    printRows((await listSources()).map(formatSourceRow));
    return;
  }

  if (action === "list" || action === "ls") {
    printRows((await listSources()).map(formatSourceRow));
    return;
  }

  if (action === "add") {
    if (!canOpenInteractiveScreen(options, input, output)) {
      if (!name || !repositoryUrl) {
        throw new Error(
          `Usage: ${CLI_COMMAND} source add <name> <https-url|local-directory> [--account <name>] --no-interactive`,
        );
      }
      const source = await addSource(name, repositoryUrl, { account: options.account });
      printRows([formatSourceRow(source)]);
      return;
    }

    await addSourceInteractively({
      initialName: name || "",
      initialLocation: repositoryUrl || "",
      input,
      output,
    });
    return;
  }

  if (!name) throw new Error(`Usage: ${CLI_COMMAND} source ${action} <name>`);
  if (action === "update") {
    printRows([formatSourceRow(await updateSource(name))]);
  } else if (action === "remove" || action === "rm") {
    printRows([formatSourceRow(await removeSource(name))]);
  } else {
    throw new Error(`Unknown source command "${action}".`);
  }
}

async function runAccountCommand(positionals) {
  const [action = "list"] = positionals;
  if (action === "add") {
    const [, name, domain, token] = positionals;
    if (!name || !domain || !token) {
      throw new Error(`Usage: ${CLI_COMMAND} account add <name> <domain> <token>`);
    }
    await saveAccount(name, domain, token);
    const account = await getAccount(name);
    printRows([formatAccountRow(account)]);
    return;
  }
  if (action === "list" || action === "ls") {
    printRows((await listAccounts()).map(formatAccountRow));
    return;
  }
  if (action === "remove" || action === "rm") {
    const [, name] = positionals;
    if (!name) throw new Error(`Usage: ${CLI_COMMAND} account remove <name>`);
    const removed = await removeAccount(name);
    printRows([formatAccountRow(removed)]);
    return;
  }
  if (action !== "list" && action !== "ls") {
    throw new Error(`Unknown account command "${action}".`);
  }
}

async function removeInteractively(skillNames, options, input, output) {
  if (!shouldPrompt(options, input, output)) return false;

  const installedAgents = await listInstalledAgents(skillNames);
  const choices = listAgents().filter(({ id }) => installedAgents.includes(id));
  if (choices.length === 0) return false;

  const result = await selectAgents({
    title: "Uninstall the following skill(s) from which agents?",
    choices,
    skillNames,
    defaultAgents: installedAgents,
    escapeLabel: options.allowBack ? "back" : "cancel",
    ...(options.allowBack ? { escapeValue: BACK } : {}),
    input,
    output,
    onConfirm: async (agents) => {
      const removed = await removeSkills(skillNames, { ...options, agents });
      return {
        title: "Uninstallation complete",
        summary: [`Removed: ${skillNames.join(", ")}`],
        rows: removed,
        value: removed,
      };
    },
  });
  if (result === BACK) return BACK;
  return true;
}

async function runVersionCommand(positionals) {
  const [action = "show"] = positionals;

  if (action === "show" || action === "list") {
    printRows([formatVersionRow(await getCliVersion())]);
    return;
  }

  if (action === "update") {
    const result = await updateCli();
    if (result.updated) {
      console.log(`Updated ${CLI_DISPLAY_NAME} on branch ${result.branch}`);
    } else {
      console.log(`${CLI_DISPLAY_NAME} is already up to date on branch ${result.branch}`);
    }
    printRows([formatVersionUpdateRow(result)]);
    return;
  }

  throw new Error(`Unknown version command "${action}".`);
}

export async function run(argv, { input = process.stdin, output = process.stdout } = {}) {
  const [command, ...args] = argv;
  const { positionals, options } = parseArguments(args);

  if (!command) {
    if (canOpenInteractiveScreen(options, input, output)) {
      await runHomePage(input, output);
      return;
    }
    console.log(HELP);
  } else if (command === "home") {
    if (!canOpenInteractiveScreen(options, input, output)) {
      console.log(HELP);
      return;
    }
    await runHomePage(input, output);
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
  } else if (command === "init") {
    if (positionals.length !== 1) throw new Error(`Usage: ${CLI_COMMAND} init <name>`);
    console.log(`Created ${await initSkill(positionals[0], options)}`);
  } else if (command === "add") {
    if (options.source) {
      if (positionals.length > 0) {
        throw new Error('Do not pass local skill folders together with "--source".');
      }
      await addFromRepositorySource(options.source, options, input, output);
      return;
    }
    if (positionals.length > 0 && await addInteractively(positionals, options, input, output)) {
      return;
    }
    const resolvedOptions = (options.agents || []).length > 0
      ? options
      : { ...options, agents: defaultAgentSelection() };
    const { added, reused, installed } = await addSkills(positionals, resolvedOptions);
    if (added.length > 0) console.log(`Added ${added.join(", ")}`);
    if (reused.length > 0) console.log(`Reused library copy: ${reused.join(", ")}`);
    printRows(installed);
  } else if (command === "install") {
    const resolvedOptions = (options.agents || []).length > 0
      ? options
      : { ...options, agents: defaultAgentSelection() };
    printRows(await installSkills(positionals, resolvedOptions));
  } else if (command === "list" || command === "ls") {
    const skills = await listSkills();
    printRows(skills.map(formatSkillRow));
  } else if (command === "remove" || command === "rm") {
    if (options.source) {
      if (positionals.length > 0) {
        throw new Error('Do not pass skill names together with "--source".');
      }
      await removeFromRepositorySource(options.source, options, input, output);
      return;
    }
    if (
      positionals.length > 0 &&
      await removeInteractively(positionals, options, input, output)
    ) {
      return;
    }
    printRows(await removeSkills(positionals, options));
  } else if (command === "update") {
    const { updatedSources, updatedSkills, skippedSkills } = await updateInstalledSkills();
    if (updatedSources.length > 0) {
      console.log(`Updated sources: ${updatedSources.join(", ")}`);
    }
    printRows([
      ...updatedSkills.map(({ skill, source }) => ({
        skill,
        source,
        status: "updated",
      })),
      ...skippedSkills.map(({ skill, source, reason }) => ({
        skill,
        source,
        status: `skipped: ${reason}`,
      })),
    ]);
  } else if (command === "sync") {
    printRows(await syncSkills(options));
  } else if (command === "agents") {
    const available = availableAgentChoices();
    if (available.length === 0) {
      console.log("No supported agents detected.");
      return;
    }
    printRows(available.map(formatAgentRow));
  } else if (command === "version") {
    await runVersionCommand(positionals);
  } else if (command === "account" || command === "accounts") {
    await runAccountCommand(positionals);
  } else if (command === "source" || command === "sources") {
    await runSourceCommand(positionals, options, input, output);
  } else {
    throw new Error(`Unknown command "${command}". Run "${CLI_COMMAND} help".`);
  }
}
