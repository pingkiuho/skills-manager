import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the real system home directory.
 *
 * When running inside a Hermes agent profile, $HOME is overridden to the
 * profile home (e.g. ~/.hermes/profiles/salad/home).  os.homedir() respects
 * $HOME, so it returns the profile home instead of the actual user home.
 * This breaks agentSkillsDir() because skills live under the real home
 * (~/.hermes/skills or ~/.hermes/profiles/<name>/skills), not under the
 * profile home.
 *
 * Detecting the profile-home pattern and walking up to the real home
 * avoids relying on os.userInfo() which breaks tests that override $HOME.
 */
function realHome() {
  const home = os.homedir();
  const marker = ".hermes/profiles/";
  const idx = home.indexOf(marker);
  if (idx !== -1 && home[idx + marker.length]) {
    return home.slice(0, idx);
  }
  return home;
}

export const AGENTS = {
  codex: {
    name: "Codex",
    detectDir: ".codex",
    globalSkillsDir: ".codex/skills",
  },
  "claude-code": {
    name: "Claude Code",
    detectDir: ".claude",
    globalSkillsDir: ".claude/skills",
  },
  "github-copilot": {
    name: "GitHub Copilot",
    detectDir: ".copilot",
    globalSkillsDir: ".copilot/skills",
  },
  hermes: {
    name: "Hermes",
    detectDir: ".hermes",
    globalSkillsDir: ".hermes/skills",
  },
};

export const DEFAULT_AGENT = "codex";
const HERMES_PROFILE_AGENT_PREFIX = "hermes:";

function hermesProfilesDir() {
  return path.join(realHome(), ".hermes", "profiles");
}

function hermesProfileAgentId(profileName) {
  return `${HERMES_PROFILE_AGENT_PREFIX}${profileName}`;
}

function hermesProfileName(agent) {
  if (!agent.startsWith(HERMES_PROFILE_AGENT_PREFIX)) return undefined;
  const profileName = agent.slice(HERMES_PROFILE_AGENT_PREFIX.length);
  if (!profileName || profileName.includes("/") || profileName.includes(path.sep)) {
    return undefined;
  }
  return profileName;
}

function hermesProfileSkillsDir(profileName) {
  return path.join(hermesProfilesDir(), profileName, "skills");
}

export function agentSkillsDir(agent) {
  const profileName = hermesProfileName(agent);
  if (profileName) return hermesProfileSkillsDir(profileName);

  if (!AGENTS[agent]) {
    throw new Error(`Unknown agent "${agent}".`);
  }
  return path.join(realHome(), AGENTS[agent].globalSkillsDir);
}

function agentDetectDir(agent) {
  if (!AGENTS[agent]) {
    throw new Error(`Unknown agent "${agent}".`);
  }

  return path.join(os.homedir(), AGENTS[agent].detectDir);
}

function hasHermesProfileSkills() {
  const profilesDir = hermesProfilesDir();
  if (!existsSync(profilesDir)) return false;

  try {
    return readdirSync(profilesDir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && existsSync(path.join(profilesDir, entry.name, "skills"))
    );
  } catch {
    return false;
  }
}

function listHermesProfileAgents() {
  const profilesDir = hermesProfilesDir();
  if (!existsSync(profilesDir)) return [];

  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) =>
        entry.isDirectory() && existsSync(path.join(profilesDir, entry.name, "skills"))
      )
      .map((entry) => ({
        id: hermesProfileAgentId(entry.name),
        name: `Hermes (${entry.name})`,
        detectDir: path.join(".hermes", "profiles", entry.name),
        globalSkillsDir: path.join(".hermes", "profiles", entry.name, "skills"),
        path: hermesProfileSkillsDir(entry.name),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch {
    return [];
  }
}

function isAgentAvailable(agent) {
  const profileName = hermesProfileName(agent);
  if (profileName) return existsSync(hermesProfileSkillsDir(profileName));

  if (agent === "hermes") {
    return existsSync(agentDetectDir(agent)) ||
      existsSync(agentSkillsDir(agent)) ||
      hasHermesProfileSkills();
  }

  return existsSync(agentDetectDir(agent)) || existsSync(agentSkillsDir(agent));
}

export function isSupportedAgent(agent) {
  if (AGENTS[agent]) return true;
  const profileName = hermesProfileName(agent);
  return Boolean(profileName && existsSync(hermesProfileSkillsDir(profileName)));
}

export function listSupportedAgents() {
  return [
    ...Object.entries(AGENTS).map(([id, agent]) => ({
      id,
      ...agent,
      path: agentSkillsDir(id),
    })),
    ...listHermesProfileAgents(),
  ];
}

export function detectAvailableAgents() {
  return listSupportedAgents().filter(({ id }) => isAgentAvailable(id));
}
