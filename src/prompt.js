import readline from "node:readline";
import { CLI_DISPLAY_NAME } from "./branding.js";

const ENTER_ALTERNATE_SCREEN = "\u001b[?1049h";
const EXIT_ALTERNATE_SCREEN = "\u001b[?1049l";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_SCREEN = "\u001b[2J\u001b[H";
export const BACK = Symbol("back");
export const EXIT = Symbol("exit");
const NO_ESCAPE_VALUE = Symbol("no-escape-value");

export const BANNER = [
  "  _         _      ____  _    _ _ _     _     ",
  " | |    ___| |_   / ___|| | _(_) | |___| |__  ",
  " | |   / _ \\ __|  \\___ \\| |/ / | | / __| '_ \\ ",
  " | |__|  __/ |_    ___) |   <| | | \\__ \\ | | |",
  " |_____\\___|\\__|  |____/|_|\\_\\_|_|_|___/_| |_|",
  "                 letskills                  ",
];

export function createChecklistState(choices, defaultAgents = []) {
  const selectableChoices = choices.filter(({ selectable }) => selectable !== false);
  return {
    cursor: 0,
    selected: new Set(
      selectableChoices.filter(({ id }) => defaultAgents.includes(id)).map(({ id }) => id),
    ),
  };
}

export function updateChecklistState(state, action, choices, { singleSelection = false } = {}) {
  const selected = new Set(state.selected);
  let cursor = state.cursor;
  const selectableChoices = choices.filter(({ selectable }) => selectable !== false);
  const currentChoice = choices[cursor];

  if (action === "up") {
    cursor = (cursor - 1 + choices.length) % choices.length;
  } else if (action === "down") {
    cursor = (cursor + 1) % choices.length;
  } else if (action === "toggle") {
    if (currentChoice?.selectable === false) return { cursor, selected };
    const agent = currentChoice.id;
    if (selected.has(agent)) selected.delete(agent);
    else {
      if (singleSelection) selected.clear();
      selected.add(agent);
    }
  } else if (action === "toggle-all") {
    if (selectableChoices.length === 0) return { cursor, selected };
    if (selectableChoices.every(({ id }) => selected.has(id))) {
      for (const { id } of selectableChoices) selected.delete(id);
    } else {
      for (const { id } of selectableChoices) selected.add(id);
    }
  }

  return { cursor, selected };
}

export function selectedAgentIds(state, choices) {
  return choices
    .filter(({ id, selectable }) => selectable !== false && state.selected.has(id))
    .map(({ id }) => id);
}

export function formatChecklistRows(choices, state) {
  const nameWidth = Math.max(0, ...choices.filter(({ selectable }) => selectable !== false).map(({ name }) => name.length));

  return choices.map(({ id, name, path, selectable }, index) => {
    const cursor = state.cursor === index ? ">" : " ";
    if (selectable === false) {
      return `${cursor} ↩ ${name.padEnd(nameWidth)}  ${path}`;
    }
    const radio = state.selected.has(id) ? "●" : "○";
    return `${cursor} ${radio} ${name.padEnd(nameWidth)}  ${path}`;
  });
}

export function formatResultRows(rows, choices) {
  const names = new Map(choices.map(({ id, name }) => [id, name]));
  const nameWidth = Math.max(...rows.map(({ agent }) => names.get(agent)?.length || agent.length));

  return rows.map(({ agent, target }) => {
    const name = names.get(agent) || agent;
    return `  ✓ ${name.padEnd(nameWidth)}  ${target}`;
  });
}

export function formatSkillRows(skillNames) {
  return skillNames.map((skillName) => `  • ${skillName}`);
}

function formatSkillSection(skillNames) {
  return ["Skills:", ...formatSkillRows(skillNames)];
}

function renderScreen(lines, output) {
  output.write(`${CLEAR_SCREEN}${[...BANNER, "", ...lines].join("\n")}\n`);
}

function escapeHint(label) {
  return `Esc ${label}`;
}

function escapeAction(label) {
  return `Esc to ${label}`;
}

function renderChecklist({
  title,
  welcome,
  choices,
  skillNames,
  showSkillSection,
  singleSelection,
  state,
  error,
  statusMessage,
  escapeLabel = "cancel",
  output,
}) {
  const lines = [
    welcome,
    "",
    title,
    "",
    ...(showSkillSection ? [...formatSkillSection(skillNames), ""] : []),
    ...formatChecklistRows(choices, state),
    "",
    singleSelection
      ? `Up/Down move   Space select   Enter confirm   ${escapeHint(escapeLabel)}`
      : `Up/Down move   Space toggle   a toggle all   Enter confirm   ${escapeHint(escapeLabel)}`,
  ];

  if (statusMessage) lines.push("", statusMessage);
  if (error) lines.push("", `Error: ${error}`);
  renderScreen(lines, output);
}

function renderWorking({ title, skillNames, output }) {
  renderScreen([title, "", ...formatSkillSection(skillNames), "", "Working..."], output);
}

function renderResult({ title, skillNames, summary = [], rows = [], choices, output }) {
  const lines = [
    title,
    "",
    ...formatSkillSection(skillNames),
    "",
    ...summary,
    ...(summary.length > 0 && rows.length > 0 ? [""] : []),
    ...formatResultRows(rows, choices),
    "",
    "Press Enter or Esc to exit.",
  ];
  renderScreen(lines, output);
}

export async function selectAgents({
  title,
  welcome = "Welcome. Choose the agents you want to update.",
  choices,
  skillNames = [],
  showSkillSection = true,
  singleSelection = false,
  selectionNoun = "agent",
  defaultAgents = [],
  showBackItem = false,
  backLabel = "Back",
  backDescription = "Return to the previous menu",
  confirmEscapeExit = false,
  escapeExitMessage = "Click Esc again to exit.",
  escapeLabel = "cancel",
  escapeValue = NO_ESCAPE_VALUE,
  input = process.stdin,
  output = process.stdout,
  onConfirm,
}) {
  if (choices.length === 0) return [];
  if (typeof input.setRawMode !== "function") {
    throw new Error("Interactive selection requires a TTY.");
  }

  const menuChoices = showBackItem
    ? [...choices, { id: BACK, name: backLabel, path: backDescription, selectable: false }]
    : choices;
  let state = createChecklistState(menuChoices, defaultAgents);
  let error;
  let statusMessage;
  let phase = "selection";
  let resultValue;
  let resultError;
  let escapeArmed = false;
  const wasRaw = input.isRaw;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
  renderChecklist({
    title,
    welcome,
    choices: menuChoices,
    skillNames,
    showSkillSection,
    singleSelection,
    state,
    escapeLabel,
    output,
  });

  return new Promise((resolve, reject) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(`${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}`);
    }

    function finish(callback, value) {
      cleanup();
      callback(value);
    }

    function onKeypress(_character, key = {}) {
      if (phase === "result" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(resolve, resultValue);
        return;
      }

      if (phase === "error" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(reject, resultError);
        return;
      }

      if (phase !== "selection") return;

      if (escapeArmed && key.name !== "escape") {
        escapeArmed = false;
        statusMessage = undefined;
      }

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        if (confirmEscapeExit && !escapeArmed) {
          escapeArmed = true;
          error = undefined;
          statusMessage = escapeExitMessage;
          renderChecklist({
            title,
            welcome,
            choices: menuChoices,
            skillNames,
            showSkillSection,
            singleSelection,
            state,
            error,
            statusMessage,
            escapeLabel,
            output,
          });
          return;
        }

        finish(resolve, EXIT);
        return;
      }

      const currentChoice = menuChoices[state.cursor];
      if (currentChoice?.selectable === false && (key.name === "return" || key.name === "enter" || key.name === "space")) {
        finish(resolve, BACK);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const selected = selectedAgentIds(state, menuChoices);
        if (singleSelection && selected.length === 0) {
          state = updateChecklistState(state, "toggle", menuChoices, { singleSelection });
          selected.push(...selectedAgentIds(state, menuChoices));
        }
        if (selected.length === 0) {
          error = `Select at least one ${selectionNoun}.`;
          renderChecklist({
            title,
            welcome,
            choices: menuChoices,
            skillNames,
            showSkillSection,
            singleSelection,
            state,
            error,
            statusMessage,
            escapeLabel,
            output,
          });
          return;
        }

        if (!onConfirm) {
          finish(resolve, selected);
          return;
        }

        phase = "working";
        renderWorking({ title: "Updating agent skills", skillNames, output });
        Promise.resolve(onConfirm(selected)).then(
          ({ title, summary, rows, value }) => {
            phase = "result";
            resultValue = value;
            renderResult({ title, skillNames, summary, rows, choices: menuChoices, output });
          },
          (operationError) => {
            phase = "error";
            resultError = operationError;
            renderResult({
              title: "Update failed",
              skillNames,
              summary: [`Error: ${operationError.message}`],
              choices: menuChoices,
              output,
            });
          },
        );
        return;
      }

      const action =
        key.name === "up" || key.name === "k"
          ? "up"
          : key.name === "down" || key.name === "j"
            ? "down"
            : key.name === "space"
              ? "toggle"
              : !singleSelection && key.name === "a"
                ? "toggle-all"
                : undefined;

      if (!action) return;
      error = undefined;
      statusMessage = undefined;
      escapeArmed = false;
      state = updateChecklistState(state, action, menuChoices, { singleSelection });
      renderChecklist({
        title,
        welcome,
        choices: menuChoices,
        skillNames,
        showSkillSection,
        singleSelection,
        state,
        escapeLabel,
        statusMessage,
        output,
      });
    }

    input.on("keypress", onKeypress);
  });
}

const SOURCE_FIELDS = [
  { id: "name", label: "Source name", required: true },
  { id: "url", label: "HTTPS URL or local directory", required: true },
];

const ACCOUNT_FIELDS = [
  { id: "name", label: "Account name", required: true },
  { id: "domain", label: "Domain", required: true },
  { id: "token", label: "Access token", required: true, secret: true },
];

function fieldValue(field, value) {
  if (field.secret) {
    return value ? "•".repeat(value.length) : "";
  }
  return value || "";
}

export function formatSourceSetupLines({
  values,
  cursor = 0,
  account,
  repository,
  escapeLabel = "cancel",
}) {
  return [
    "Welcome. Add a repository or local directory as a skill source.",
    "",
    account
      ? `Account: ${account.name} (${account.domain})`
      : "Account: public repository or local directory",
    "",
    ...SOURCE_FIELDS.map((field, index) => {
      const pointer = cursor === index ? ">" : " ";
      return `${pointer} ${field.label}: ${fieldValue(field, values[field.id] || "")}`;
    }),
    ...(repository ? ["", `Detected: ${repository.provider} on ${repository.domain}`] : []),
    "",
    `Type to edit   Up/Down move   Enter next or confirm   ${escapeHint(escapeLabel)}`,
  ];
}

export function formatAccountSetupLines({
  values,
  cursor = 0,
  credentialFile,
  escapeLabel = "cancel",
}) {
  return [
    "Welcome. Add a reusable GitHub or GitLab account.",
    "",
    "Private repository setup:",
    "  GitHub: use an HTTPS personal access token with repository read access.",
    "  GitLab: use an HTTPS access token with read_repository permission.",
    `  Accounts are saved in ${credentialFile} with file mode 0600.`,
    "",
    ...ACCOUNT_FIELDS.map((field, index) => {
      const pointer = cursor === index ? ">" : " ";
      return `${pointer} ${field.label}: ${fieldValue(field, values[field.id] || "")}`;
    }),
    "",
    `Type to edit   Up/Down move   Enter next or confirm   ${escapeHint(escapeLabel)}`,
  ];
}

export async function setupRepositorySource({
  initialName = "",
  initialUrl = "",
  account,
  inspectUrl,
  confirmEscapeExit = false,
  escapeExitMessage = "Click Esc again to exit.",
  escapeLabel = "cancel",
  escapeValue = NO_ESCAPE_VALUE,
  input = process.stdin,
  output = process.stdout,
  onConfirm,
}) {
  if (typeof input.setRawMode !== "function") {
    throw new Error("Interactive source setup requires a TTY.");
  }

  const values = { name: initialName, url: initialUrl };
  let cursor = initialName ? 1 : 0;
  let phase = "form";
  let error;
  let statusMessage;
  let resultValue;
  let resultError;
  let escapeArmed = false;
  const wasRaw = input.isRaw;

  function repository() {
    try {
      return values.url ? inspectUrl(values.url) : undefined;
    } catch {
      return undefined;
    }
  }

  function renderForm() {
    const lines = formatSourceSetupLines({
      values,
      cursor,
      account,
      repository: repository(),
      escapeLabel,
    });
    if (statusMessage) lines.push("", statusMessage);
    if (error) lines.push("", `Error: ${error}`);
    renderScreen(lines, output);
  }

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
  renderForm();

  return new Promise((resolve, reject) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(`${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}`);
    }

    function finish(callback, value) {
      cleanup();
      callback(value);
    }

    function onKeypress(character, key = {}) {
      if (phase === "result" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(resolve, resultValue);
        return;
      }

      if (phase === "error" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(reject, resultError);
        return;
      }

      if (phase !== "form") return;

      if (escapeArmed && key.name !== "escape") {
        escapeArmed = false;
        statusMessage = undefined;
      }

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        if (confirmEscapeExit && !escapeArmed) {
          escapeArmed = true;
          error = undefined;
          statusMessage = escapeExitMessage;
          renderForm();
          return;
        }

        if (escapeValue !== NO_ESCAPE_VALUE) {
          finish(resolve, escapeValue);
          return;
        }
        finish(resolve, EXIT);
        return;
      }

      const field = SOURCE_FIELDS[cursor];
      if (key.name === "up") {
        cursor = (cursor - 1 + SOURCE_FIELDS.length) % SOURCE_FIELDS.length;
      } else if (key.name === "down" || key.name === "tab") {
        cursor = (cursor + 1) % SOURCE_FIELDS.length;
      } else if (key.name === "backspace") {
        values[field.id] = values[field.id].slice(0, -1);
      } else if (key.name === "return" || key.name === "enter") {
        if (field.required && !values[field.id]) {
          error = `${field.label} is required.`;
          renderForm();
          return;
        }
        if (cursor < SOURCE_FIELDS.length - 1) {
          cursor += 1;
        } else {
          phase = "working";
          renderScreen(
            [
              "Adding source",
              "",
              `Source: ${values.name}`,
              `Location: ${values.url}`,
              "",
              "Preparing source...",
            ],
            output,
          );
          Promise.resolve(onConfirm(values)).then(
            ({ title, lines = [], value }) => {
              phase = "result";
              resultValue = value;
              renderScreen([title, "", ...lines, "", "Press Enter or Esc to exit."], output);
            },
            (operationError) => {
              phase = "error";
              resultError = operationError;
              renderScreen(
                [
                  "Source setup failed",
                  "",
                  `Error: ${operationError.message}`,
                  "",
                  "Press Enter or Esc to exit.",
                ],
                output,
              );
            },
          );
          return;
        }
      } else if (character && !key.ctrl && !key.meta) {
        values[field.id] += character.replace(/[\u0000-\u001f\u007f]/g, "");
      } else {
        return;
      }
      error = undefined;
      statusMessage = undefined;
      escapeArmed = false;
      renderForm();
    }

    input.on("keypress", onKeypress);
  });
}

export async function setupRepositoryAccount({
  credentialFile,
  confirmEscapeExit = false,
  escapeExitMessage = "Click Esc again to exit.",
  escapeLabel = "cancel",
  escapeValue = NO_ESCAPE_VALUE,
  input = process.stdin,
  output = process.stdout,
  onConfirm,
}) {
  if (typeof input.setRawMode !== "function") {
    throw new Error("Interactive account setup requires a TTY.");
  }

  const values = { name: "", domain: "", token: "" };
  let cursor = 0;
  let phase = "form";
  let error;
  let statusMessage;
  let resultValue;
  let resultError;
  let escapeArmed = false;
  const wasRaw = input.isRaw;

  function renderForm() {
    const lines = formatAccountSetupLines({ values, cursor, credentialFile, escapeLabel });
    if (statusMessage) lines.push("", statusMessage);
    if (error) lines.push("", `Error: ${error}`);
    renderScreen(lines, output);
  }

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
  renderForm();

  return new Promise((resolve, reject) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(`${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}`);
    }

    function finish(callback, value) {
      cleanup();
      callback(value);
    }

    function onKeypress(character, key = {}) {
      if (phase === "result" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(resolve, resultValue);
        return;
      }

      if (phase === "error" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(reject, resultError);
        return;
      }

      if (phase !== "form") return;

      if (escapeArmed && key.name !== "escape") {
        escapeArmed = false;
        statusMessage = undefined;
      }

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        if (confirmEscapeExit && !escapeArmed) {
          escapeArmed = true;
          error = undefined;
          statusMessage = escapeExitMessage;
          renderForm();
          return;
        }

        if (escapeValue !== NO_ESCAPE_VALUE) {
          finish(resolve, escapeValue);
          return;
        }
        finish(resolve, EXIT);
        return;
      }

      const field = ACCOUNT_FIELDS[cursor];
      if (key.name === "up") {
        cursor = (cursor - 1 + ACCOUNT_FIELDS.length) % ACCOUNT_FIELDS.length;
      } else if (key.name === "down" || key.name === "tab") {
        cursor = (cursor + 1) % ACCOUNT_FIELDS.length;
      } else if (key.name === "backspace") {
        values[field.id] = values[field.id].slice(0, -1);
      } else if (key.name === "return" || key.name === "enter") {
        if (field.required && !values[field.id]) {
          error = `${field.label} is required.`;
          renderForm();
          return;
        }
        if (cursor < ACCOUNT_FIELDS.length - 1) {
          cursor += 1;
        } else {
          phase = "working";
          renderScreen(["Saving account", "", `Account: ${values.name}`, "", "Working..."], output);
          Promise.resolve(onConfirm(values)).then(
            ({ title, lines = [], value }) => {
              phase = "result";
              resultValue = value;
              renderScreen([title, "", ...lines, "", "Press Enter or Esc to continue."], output);
            },
            (operationError) => {
              phase = "error";
              resultError = operationError;
              renderScreen(
                [
                  "Account setup failed",
                  "",
                  `Error: ${operationError.message}`,
                  "",
                  "Press Enter or Esc to exit.",
                ],
                output,
              );
            },
          );
          return;
        }
      } else if (character && !key.ctrl && !key.meta) {
        values[field.id] += character.replace(/[\u0000-\u001f\u007f]/g, "");
      } else {
        return;
      }
      error = undefined;
      statusMessage = undefined;
      escapeArmed = false;
      renderForm();
    }

    input.on("keypress", onKeypress);
  });
}

export async function showNotice({
  title,
  lines = [],
  escapeLabel = "continue",
  input = process.stdin,
  output = process.stdout,
}) {
  if (typeof input.setRawMode !== "function") {
    throw new Error("Interactive notice requires a TTY.");
  }

  const wasRaw = input.isRaw;
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
  renderScreen([title, "", ...lines, "", `Press Enter or ${escapeAction(escapeLabel)}.`], output);

  return new Promise((resolve) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(`${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}`);
    }

    function onKeypress(_character, key = {}) {
      if ((key.ctrl && key.name === "c") || key.name === "return" || key.name === "enter" || key.name === "escape") {
        cleanup();
        resolve();
      }
    }

    input.on("keypress", onKeypress);
  });
}

export async function setupSimpleForm({
  title,
  welcome,
  fields,
  initialValues = {},
  workingTitle = title,
  workingLines = (values) => Object.values(values),
  confirmEscapeExit = false,
  escapeExitMessage = "Click Esc again to exit.",
  escapeLabel = "cancel",
  escapeValue = NO_ESCAPE_VALUE,
  input = process.stdin,
  output = process.stdout,
  onConfirm,
}) {
  if (typeof input.setRawMode !== "function") {
    throw new Error("Interactive form requires a TTY.");
  }

  const values = Object.fromEntries(
    fields.map((field) => [field.id, initialValues[field.id] || ""]),
  );
  let cursor = 0;
  let phase = "form";
  let error;
  let statusMessage;
  let resultValue;
  let resultError;
  let escapeArmed = false;
  const wasRaw = input.isRaw;

  function renderForm() {
    const lines = [
      welcome,
      "",
      ...fields.map((field, index) => {
        const pointer = cursor === index ? ">" : " ";
        return `${pointer} ${field.label}: ${fieldValue(field, values[field.id] || "")}`;
      }),
      "",
      `Type to edit   Up/Down move   Enter next or confirm   ${escapeHint(escapeLabel)}`,
    ];
    if (statusMessage) lines.push("", statusMessage);
    if (error) lines.push("", `Error: ${error}`);
    renderScreen(lines, output);
  }

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
  renderForm();

  return new Promise((resolve, reject) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(`${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}`);
    }

    function finish(callback, value) {
      cleanup();
      callback(value);
    }

    function onKeypress(character, key = {}) {
      if (phase === "result" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(resolve, resultValue);
        return;
      }

      if (phase === "error" && (key.name === "return" || key.name === "enter" || key.name === "escape")) {
        finish(reject, resultError);
        return;
      }

      if (phase !== "form") return;

      if (escapeArmed && key.name !== "escape") {
        escapeArmed = false;
        statusMessage = undefined;
      }

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        if (confirmEscapeExit && !escapeArmed) {
          escapeArmed = true;
          error = undefined;
          statusMessage = escapeExitMessage;
          renderForm();
          return;
        }

        if (escapeValue !== NO_ESCAPE_VALUE) {
          finish(resolve, escapeValue);
          return;
        }
        finish(resolve, EXIT);
        return;
      }

      const field = fields[cursor];
      if (key.name === "up") {
        cursor = (cursor - 1 + fields.length) % fields.length;
      } else if (key.name === "down" || key.name === "tab") {
        cursor = (cursor + 1) % fields.length;
      } else if (key.name === "backspace") {
        values[field.id] = values[field.id].slice(0, -1);
      } else if (key.name === "return" || key.name === "enter") {
        if (field.required && !values[field.id]) {
          error = `${field.label} is required.`;
          renderForm();
          return;
        }
        if (cursor < fields.length - 1) {
          cursor += 1;
        } else {
          phase = "working";
          renderScreen([workingTitle, "", ...workingLines(values), "", "Working..."], output);
          Promise.resolve(onConfirm(values)).then(
            ({ title: resultTitle, lines = [], value }) => {
              phase = "result";
              resultValue = value;
              renderScreen([resultTitle, "", ...lines, "", "Press Enter or Esc to exit."], output);
            },
            (operationError) => {
              phase = "error";
              resultError = operationError;
              renderScreen(
                [
                  `${title} failed`,
                  "",
                  `Error: ${operationError.message}`,
                  "",
                  "Press Enter or Esc to exit.",
                ],
                output,
              );
            },
          );
          return;
        }
      } else if (character && !key.ctrl && !key.meta) {
        values[field.id] += character.replace(/[\u0000-\u001f\u007f]/g, "");
      } else {
        return;
      }

      error = undefined;
      statusMessage = undefined;
      escapeArmed = false;
      renderForm();
    }

    input.on("keypress", onKeypress);
  });
}
