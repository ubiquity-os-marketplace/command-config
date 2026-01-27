import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { Manifest } from "../types/github";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { applyChanges } from "./apply-changes";
import { getFileContent } from "./get-file-content";

async function maybeFormatYaml(content: string, context: Context): Promise<string> {
  if (process.env.JEST_WORKER_ID) return content;

  try {
    const prettier = await import("prettier");
    return await prettier.format(content, {
      parser: "yaml",
      ...((await prettier.resolveConfig(".prettierrc")) || {}),
    });
  } catch (err) {
    context.logger.warn("Prettier formatting failed, using unformatted YAML.", { err, content });
    return content;
  }
}

function extractYamlOnly(text: string): string {
  text = text.replace(/^```yaml[\r\n]?/i, "").replace(/```$/i, "");
  const yamlStart = text.search(/^[a-zA-Z0-9_-]+:/m);
  if (yamlStart > 0) {
    text = text.slice(yamlStart);
  }
  return text.trim();
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasTopLevelKey(content: string, key: string): boolean {
  const pattern = new RegExp(`^${key}\\s*:`, "m");
  return pattern.test(content);
}

function extractTopLevelBlock(content: string, key: string): string | null {
  const lines = content.split(/\r?\n/);
  const keyPattern = new RegExp(`^${key}\\s*:`); // top-level only (no indentation)
  let startIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith(" ") || line.startsWith("\t")) continue;
    if (keyPattern.test(line)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) return null;

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t") && /^[a-zA-Z0-9_-]+\s*:/.test(line)) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trimEnd();
}

function injectBlockAtTop(content: string, block: string): string {
  const lines = content.split(/\r?\n/);
  let insertIndex = 0;

  while (insertIndex < lines.length) {
    const line = lines[insertIndex];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---") {
      insertIndex += 1;
      continue;
    }
    break;
  }

  const prefix = lines.slice(0, insertIndex);
  const suffix = lines.slice(insertIndex);
  const blockLines = block.split(/\r?\n/);
  const combined = [...prefix, ...blockLines];
  if (suffix.length) {
    if (combined.length && combined[combined.length - 1].trim() !== "") {
      combined.push("");
    }
  }
  return [...combined, ...suffix].join("\n");
}

function preserveImportsBlock(original: string, updated: string): string {
  if (!hasTopLevelKey(original, "imports")) return updated;
  if (hasTopLevelKey(updated, "imports")) return updated;
  const block = extractTopLevelBlock(original, "imports");
  if (!block) return updated;
  return injectBlockAtTop(updated, block);
}

export async function processTargetRepos(
  target: Target,
  editorInstruction: string,
  context: Context,
  manifestStore?: Record<string, Manifest>
): Promise<string | undefined> {
  const { currentFileContents } = await fetchAndParseFileContent(context, target, manifestStore);

  if (!currentFileContents) {
    context.logger.warn("No content was found for the manifest.");
    return undefined;
  }

  // Build Prompt
  const { adapters } = context;
  const prompt = adapters.llm.completions.promptBuilder(currentFileContents, manifestStore ?? {}, target.url);
  context.logger.info("Built prompt for YAML editor.", { chars: prompt.length });

  // Update the file with the new content by making a LLM call
  const llmResponse = await adapters.llm.completions.createCompletions(prompt, editorInstruction.trim());
  context.logger.info("LLM response received.", { attempts: llmResponse.metadata.attempts, outputChars: llmResponse.text.length });

  const updatedFileContents = extractYamlOnly(llmResponse.text);
  const mergedFileContents = preserveImportsBlock(currentFileContents, updatedFileContents);
  const formattedFileContents = await maybeFormatYaml(mergedFileContents, context);

  if (formattedFileContents.trim() === currentFileContents.trim()) {
    context.logger.debug("No change was triggered by the instruction.");
    return undefined;
  }

  const { pullRequestUrl } = await applyChanges(target, formattedFileContents, context, editorInstruction);
  context.logger.ok(`Pull request created: ${pullRequestUrl}`);
  return pullRequestUrl;
}

export async function fetchAndParseFileContent(context: Context, target: Target, manifestStore?: Record<string, Manifest>) {
  const environment = readString((context.config as Record<string, unknown>).environment).trim() || null;
  const cfgHandler = new ConfigurationHandler(context.logger, context.octokit, environment);
  const config = await cfgHandler.getConfigurationFromRepo(target.owner, target.repo);

  let currentFileContents: string | undefined;
  try {
    currentFileContents = await getFileContent(context, target.owner, target.repo, target.filePath);
  } catch (error) {
    context.logger.warn("Failed to fetch target config file; falling back to resolved configuration.", { err: error, target });
  }

  if (manifestStore && config.config?.plugins) {
    for (const key of Object.keys(config.config.plugins)) {
      const manifest = config.config.plugins[key];
      if (manifest) {
        manifestStore[key] = { ...manifest, name: key };
      }
    }
  }
  return {
    currentFileContents: currentFileContents ?? config.rawData,
    manifests: config.config?.plugins,
  };
}
