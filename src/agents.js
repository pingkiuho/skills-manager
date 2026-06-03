import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

export function agentSkillsDir(agent) {
  if (!AGENTS[agent]) {
    throw new Error(`Unknown agent "${agent}".`);
  }

  return path.join(os.homedir(), AGENTS[agent].globalSkillsDir);
}

function agentDetectDir(agent) {
  if (!AGENTS[agent]) {
    throw new Error(`Unknown agent "${agent}".`);
  }

  return path.join(os.homedir(), AGENTS[agent].detectDir);
}

function hasHermesProfileSkills() {
  const profilesDir = path.join(os.homedir(), ".hermes", "profiles");
  if (!existsSync(profilesDir)) return false;

  try {
    return readdirSync(profilesDir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && existsSync(path.join(profilesDir, entry.name, "skills"))
    );
  } catch {
    return false;
  }
}

function isAgentAvailable(agent) {
  if (agent === "hermes") {
    return existsSync(agentDetectDir(agent)) ||
      existsSync(agentSkillsDir(agent)) ||
      hasHermesProfileSkills();
  }

  return existsSync(agentDetectDir(agent)) || existsSync(agentSkillsDir(agent));
}

export function listSupportedAgents() {
  return Object.entries(AGENTS).map(([id, agent]) => ({
    id,
    ...agent,
    path: agentSkillsDir(id),
  }));
}

export function detectAvailableAgents() {
  return listSupportedAgents().filter(({ id }) => isAgentAvailable(id));
}
