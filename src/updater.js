import { addSkills, listSkills } from "./manager.js";
import {
  discoverSourceSkills,
  listSources,
  updateSource,
} from "./sources.js";

export async function updateInstalledSkills({
  addSkillsCommand = addSkills,
  discoverSourceSkillsCommand = discoverSourceSkills,
  listSkillsCommand = listSkills,
  listSourcesCommand = listSources,
  updateSourceCommand = updateSource,
} = {}) {
  const installedSkills = (await listSkillsCommand())
    .filter(({ agents }) => agents.length > 0);
  const configuredSources = new Set(
    (await listSourcesCommand()).map(({ name }) => name),
  );
  const sourceNames = [
    ...new Set(
      installedSkills
        .map(({ source }) => source)
        .filter((source) => source && configuredSources.has(source)),
    ),
  ].sort();
  const discoveredBySource = new Map();
  const updatedSources = [];

  for (const source of sourceNames) {
    await updateSourceCommand(source);
    const discovered = await discoverSourceSkillsCommand(source);
    discoveredBySource.set(
      source,
      new Map(discovered.map((skill) => [skill.name, skill])),
    );
    updatedSources.push(source);
  }

  const updatedSkills = [];
  const skippedSkills = [];

  for (const skill of installedSkills) {
    if (!skill.source) {
      skippedSkills.push({
        skill: skill.name,
        source: "-",
        reason: "local skill",
      });
      continue;
    }
    if (!configuredSources.has(skill.source)) {
      skippedSkills.push({
        skill: skill.name,
        source: skill.source,
        reason: "source is not configured",
      });
      continue;
    }

    const discovered = discoveredBySource.get(skill.source).get(skill.name);
    if (!discovered) {
      skippedSkills.push({
        skill: skill.name,
        source: skill.source,
        reason: "skill is no longer present in source",
      });
      continue;
    }

    await addSkillsCommand([discovered.path], {
      agents: skill.agents,
      force: true,
      source: skill.source,
    });
    updatedSkills.push({
      skill: skill.name,
      source: skill.source,
    });
  }

  return { updatedSources, updatedSkills, skippedSkills };
}
