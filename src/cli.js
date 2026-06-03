import path from "node:path";
import {
  addSkills,
  initSkill,
  installSkills,
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
  setupRepositoryAccount,
  setupRepositorySource,
  showNotice,
} from "./prompt.js";
import {
  addSource,
  credentialsPath,
  discoverSourceSkills,
  getAccount,
  listAccounts,
  listSources,
  parseRepositoryUrl,
  removeAccount,
  removeSource,
  saveAccount,
  updateSource,
} from "./sources.js";
import { updateInstalledSkills } from "./updater.js";

const HELP = `skillman - manage a small personal agent skills library

Usage:
  skillman init <name> [--dir <path>]
  skillman add <local-skill-folder...> [-a, --agent <agent...>] [--force] [--no-interactive]
  skillman add --source <source-name>
  skillman install <skill...> [-a, --agent <agent...>] [--force]
  skillman list
  skillman remove <skill...> [-a, --agent <agent...>] [--purge] [--no-interactive]
  skillman remove --source <source-name> [--purge]
  skillman update
  skillman sync [--force]
  skillman agents
  skillman account add <name> <domain> <token>
  skillman account list
  skillman account remove <name>
  skillman source
  skillman source add [name] [https-url|local-directory] [--account <name>] [--no-interactive]
  skillman source list
  skillman source update <name>
  skillman source remove <name>

Notes:
  In a terminal, add and remove show an interactive agent selector.
  Pass "--no-interactive" to skip prompts. The default add target is codex.
  Pass "--agent all" to target every supported agent.
  Personal copies live in ~/.skills-manager/skills by default.
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
  return options.agents.length === 0 &&
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

async function addInteractively(sources, options, input, output) {
  if (!shouldPrompt(options, input, output)) return false;
  const skillNames = await listSourceSkillNames(sources);

  const result = await selectAgents({
    title: "Install the following skill(s) to which agents?",
    choices: listAgents(),
    skillNames,
    defaultAgents: ["codex"],
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

async function addFromRepositorySource(sourceName, options, input, output) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Using "--source" requires an interactive terminal.');
  }

  const discovered = await discoverSourceSkills(sourceName);
  if (discovered.length === 0) {
    throw new Error(`Source "${sourceName}" does not contain any SKILL.md files.`);
  }

  while (true) {
    const selected = await selectAgents({
      welcome: `Welcome. Choose skills from source "${sourceName}".`,
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
          const skills = await discoverSourceSkills(sourceName);
          return describeSourceAddResult(createdSource, skills);
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
        const skills = await discoverSourceSkills(sourceName);
        return describeSourceAddResult(createdSource, skills);
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
          "Usage: skillman source add <name> <https-url|local-directory> [--account <name>] --no-interactive",
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

  if (!name) throw new Error(`Usage: skillman source ${action} <name>`);
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
      throw new Error("Usage: skillman account add <name> <domain> <token>");
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
    if (!name) throw new Error("Usage: skillman account remove <name>");
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

export async function run(argv, { input = process.stdin, output = process.stdout } = {}) {
  const [command = "help", ...args] = argv;
  const { positionals, options } = parseArguments(args);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
  } else if (command === "init") {
    if (positionals.length !== 1) throw new Error("Usage: skillman init <name>");
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
    const { added, reused, installed } = await addSkills(positionals, options);
    if (added.length > 0) console.log(`Added ${added.join(", ")}`);
    if (reused.length > 0) console.log(`Reused library copy: ${reused.join(", ")}`);
    printRows(installed);
  } else if (command === "install") {
    printRows(await installSkills(positionals, options));
  } else if (command === "list" || command === "ls") {
    const skills = await listSkills();
    printRows(
      skills.map(({ name, description, agents, source }) => ({
        skill: name,
        agents: agents.join(", ") || "-",
        source: source || "-",
        description,
      })),
    );
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
    printRows(
      listAgents().map(({ id, name, path }) => ({
        agent: id,
        name,
        path,
      })),
    );
  } else if (command === "account" || command === "accounts") {
    await runAccountCommand(positionals);
  } else if (command === "source" || command === "sources") {
    await runSourceCommand(positionals, options, input, output);
  } else {
    throw new Error(`Unknown command "${command}". Run "skillman help".`);
  }
}
