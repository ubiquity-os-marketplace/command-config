import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { Manifest } from "../types/github";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { applyChanges } from "./apply-changes";

const CONFIG_PATH_PATTERN = /\.ubiquity-os\.config(?:\.([a-z0-9_-]+))?\.yml$/i;

function inferEnvironmentFromConfigPath(configPath: string): string | null {
  const match = CONFIG_PATH_PATTERN.exec(configPath.trim());
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return "production";
  return suffix.toLowerCase();
}

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

  const formattedFileContents = await maybeFormatYaml(updatedFileContents, context);

  if (formattedFileContents.trim() === currentFileContents.trim()) {
    context.logger.debug("No change was triggered by the instruction.");
    return undefined;
  }

  const { pullRequestUrl } = await applyChanges(target, formattedFileContents, context, editorInstruction);
  context.logger.ok(`Pull request created: ${pullRequestUrl}`);
  return pullRequestUrl;
}

export async function fetchAndParseFileContent(context: Context, target: Target, manifestStore?: Record<string, Manifest>) {
  const environment = inferEnvironmentFromConfigPath(target.filePath);
  if (!environment) {
    context.logger.warn("Unsupported configPath; expected .github/.ubiquity-os.config(.<env>).yml", { filePath: target.filePath });
    return { currentFileContents: undefined, manifests: undefined };
  }
  const cfgHandler = new ConfigurationHandler(context.logger, context.octokit, environment);
  const config = await cfgHandler.getConfigurationFromRepo(target.owner, target.repo);
  if (manifestStore && config.config?.plugins) {
    for (const key of Object.keys(config.config.plugins)) {
      const manifest = config.config.plugins[key];
      if (manifest) {
        manifestStore[key] = { ...manifest, name: key };
      }
    }
  }
  return { currentFileContents: config.rawData, manifests: config.config?.plugins };
}
