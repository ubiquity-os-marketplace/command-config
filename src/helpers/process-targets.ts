import prettier from "prettier";
import { Manifest } from "../types/github";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { applyChanges } from "./apply-changes";
import { fetchManifests } from "./fetch-manifests";
import { getFileContent } from "./get-file-content";
import { buildPluginAliasIndex, expandPluginInstallShorthand } from "./plugin-alias";
import { parseConfig } from "./validator";

function extractYamlOnly(text: string): string {
  text = text.replace(/^```yaml[\r\n]?/i, "").replace(/```$/i, "");
  const yamlStart = text.search(/^[a-zA-Z0-9_-]+:/m);
  if (yamlStart > 0) {
    text = text.slice(yamlStart);
  }
  return text.trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractInstallPluginKeys(instruction: string): string[] {
  const keys: string[] = [];
  const pattern = /\b(?:install|add|enable)\s+(?<key>https?:\/\/\S+|[\w.-]+\/[\w.-]+@[^\s]+)/gi;
  for (const match of instruction.matchAll(pattern)) {
    const rawKey = match.groups?.key;
    if (!rawKey) continue;
    const key = rawKey.trim().replace(/[)\],.;:!?]+$/, "");
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

function findPluginsLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => /^plugins:\s*(#.*)?$/.test(line));
}

function inferChildIndent(lines: readonly string[], pluginsLineIndex: number): string {
  for (let i = pluginsLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(\s+)\S/.exec(lines[i]);
    if (match?.[1]) return match[1];
    break;
  }
  return "  ";
}

function findPluginsEndIndex(lines: readonly string[], pluginsLineIndex: number): number {
  for (let i = pluginsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(line) && /^[A-Za-z0-9_-]+:/.test(line)) return i;
  }
  return lines.length;
}

function findPluginsInsertIndex(lines: readonly string[], pluginsLineIndex: number, endIndex: number): number {
  if (endIndex !== lines.length) return endIndex;

  for (let i = lines.length - 1; i > pluginsLineIndex; i--) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\s/.test(line)) return i + 1;
    return i;
  }
  return endIndex;
}

function hasPluginEntryLine(lines: readonly string[], childIndent: string, key: string): boolean {
  const keyPattern = new RegExp(`^${escapeRegex(childIndent)}${escapeRegex(key)}\\s*:\\s*(#.*)?$`);
  return lines.some((line) => keyPattern.test(line));
}

function ensurePluginsInstalledInYaml(yaml: string, pluginKeys: readonly string[]): { yaml: string; added: string[] } {
  const keys = [...new Set(pluginKeys.map((k) => k.trim()).filter(Boolean))];
  if (!keys.length) return { yaml, added: [] };

  const lines = yaml.split(/\r?\n/);
  const pluginsLineIndex = findPluginsLineIndex(lines);
  const added: string[] = [];

  if (pluginsLineIndex === -1) {
    const nextLines = [...lines];
    if (nextLines.length && nextLines[nextLines.length - 1].trim() !== "") nextLines.push("");
    nextLines.push("plugins:");
    for (const key of keys) {
      nextLines.push(`  ${key}:`);
      added.push(key);
    }
    return { yaml: nextLines.join("\n"), added };
  }

  const childIndent = inferChildIndent(lines, pluginsLineIndex);
  const endIndex = findPluginsEndIndex(lines, pluginsLineIndex);
  let insertIndex = findPluginsInsertIndex(lines, pluginsLineIndex, endIndex);

  for (const key of keys) {
    const hasEntry = hasPluginEntryLine(lines, childIndent, key);
    if (hasEntry) continue;
    lines.splice(insertIndex, 0, `${childIndent}${key}:`);
    insertIndex++;
    added.push(key);
  }

  return { yaml: lines.join("\n"), added };
}

export async function processTargetRepos(
  target: Target,
  parserCode: string,
  editorInstruction: string,
  context: Context,
  manifestStore?: Record<string, Manifest>
): Promise<string | undefined> {
  const { currentFileContents } = await fetchAndParseFileContent(context, target, manifestStore);

  // Build Prompt
  const { adapters } = context;
  const prompt = adapters.llm.completions.promptBuilder(currentFileContents, parserCode, manifestStore ?? {}, target.url);

  context.logger.info(`Prompt: ${prompt}`);
  const aliasIndex = buildPluginAliasIndex(manifestStore ?? {});
  const expanded = expandPluginInstallShorthand(editorInstruction, aliasIndex);
  const installKeys = extractInstallPluginKeys(expanded.expandedInstruction);
  if (expanded.replacements.length) {
    context.logger.info("Expanded plugin shorthand in editor instruction.", {
      replacements: expanded.replacements,
    });
  }
  if (expanded.ambiguous.length) {
    context.logger.warn("Some plugin names were ambiguous; leaving them unchanged.", {
      ambiguous: expanded.ambiguous,
    });
  }

  const isPureInstall =
    installKeys.length > 0 &&
    /^(?:\s*(?:install|add|enable)\s+\S+)(?:\s*(?:,|and)\s*(?:install|add|enable)\s+\S+)*\s*$/i.test(expanded.expandedInstruction.trim());

  if (isPureInstall) {
    const patched = ensurePluginsInstalledInYaml(currentFileContents, installKeys);
    if (!patched.added.length) {
      context.logger.warn("No change was triggered by the instruction.");
      return undefined;
    }
    const { pullRequestUrl } = await applyChanges(target, patched.yaml, context, editorInstruction);
    context.logger.info(`Pull request created: ${pullRequestUrl}`);
    return pullRequestUrl;
  }

  // Update the file with the new content by making a LLM call
  const llmResponse = await adapters.llm.completions.createCompletions(prompt, expanded.expandedInstruction);

  // Log the updated file contents
  context.logger.info(`Updated file contents: ${JSON.stringify(llmResponse)}`);

  const updatedFileContents = extractYamlOnly(llmResponse.text);

  // Format YAML using Prettier before PR creation
  let formattedFileContents = updatedFileContents;
  try {
    formattedFileContents = await prettier.format(updatedFileContents, {
      parser: "yaml",
      ...((await prettier.resolveConfig(".prettierrc")) || {}),
    });
  } catch (err) {
    context.logger.warn("Prettier formatting failed, using unformatted YAML.", { err, content: updatedFileContents });
  }

  if (installKeys.length) {
    const patched = ensurePluginsInstalledInYaml(formattedFileContents, installKeys);
    if (patched.added.length) {
      context.logger.info("Applied deterministic plugin install patch after LLM response.", {
        added: patched.added,
      });
      formattedFileContents = patched.yaml;
    }
  }

  if (formattedFileContents.trim() === currentFileContents.trim()) {
    context.logger.warn("No change was triggered by the instruction.");
    return undefined;
  }

  const { pullRequestUrl } = await applyChanges(target, formattedFileContents, context, editorInstruction);
  context.logger.info(`Pull request created: ${pullRequestUrl}`);
  return pullRequestUrl;
}

export async function fetchAndParseFileContent(context: Context, target: Target, manifestStore?: Record<string, Manifest>) {
  const currentFileContents = await getFileContent(context, target.owner, target.repo, target.filePath);
  if (!currentFileContents) throw context.logger.error("File content not found. for target: " + JSON.stringify(target));

  // Parse Config
  const parsedUrls = parseConfig(currentFileContents, context.logger);
  // Manifest Cache (to avoid fetching the same manifest multiple times)
  const manifestCache: Record<string, Manifest> = manifestStore || {};
  // Fetch Manifest
  const manifests = await fetchManifests(parsedUrls, manifestCache, context);
  return { currentFileContents, manifests };
}
