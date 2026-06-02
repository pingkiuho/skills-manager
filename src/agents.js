export const AGENTS = {
  codex: {
    name: "Codex",
    globalSkillsDir: ".codex/skills",
  },
  "claude-code": {
    name: "Claude Code",
    globalSkillsDir: ".claude/skills",
  },
  cursor: {
    name: "Cursor",
    globalSkillsDir: ".cursor/skills",
  },
  "gemini-cli": {
    name: "Gemini CLI",
    globalSkillsDir: ".gemini/skills",
  },
  opencode: {
    name: "OpenCode",
    globalSkillsDir: ".config/opencode/skills",
  },
  "github-copilot": {
    name: "GitHub Copilot",
    globalSkillsDir: ".copilot/skills",
  },
};

export const DEFAULT_AGENT = "codex";
