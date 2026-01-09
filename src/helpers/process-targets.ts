import { Manifest } from "../types/github";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { applyChanges } from "./apply-changes";
import { fetchManifests } from "./fetch-manifests";
import { getFileContent } from "./get-file-content";
import { parseConfig } from "./validator";

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
  const currentFileContents = await getFileContent(context, target.owner, target.repo, target.filePath);
  if (!currentFileContents) throw context.logger.warn("File content not found. for target: " + JSON.stringify(target));

  // Parse Config
  const parsedUrls = parseConfig(currentFileContents, context.logger);
  // Manifest Cache (to avoid fetching the same manifest multiple times)
  const manifestCache: Record<string, Manifest> = manifestStore || {};
  // Fetch Manifest
  const manifests = await fetchManifests(parsedUrls, manifestCache, context);
  return { currentFileContents, manifests };
}
