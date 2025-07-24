import prettier from "prettier";
import { Manifest } from "../types/github";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { applyChanges } from "./apply-changes";
import { fetchManifests } from "./fetch-manifests";
import { getFileContent } from "./get-file-content";
import { parseConfig } from "./validator";

export async function processTargetRepos(
  target: Target,
  parserCode: string,
  editorInstruction: string,
  context: Context,
  manifestStore?: Record<string, Manifest>
): Promise<string | undefined> {
  const { currentFileContents, manifests } = await fetchAndParseFileContent(context, target, manifestStore);

  // Build Prompt
  const { adapters } = context;
  const prompt = adapters.openai.completions.promptBuilder(currentFileContents, parserCode, manifests, target.url);

  context.logger.info(`Prompt: ${prompt}`);
  // Update the file with the new content by making a LLM call
  const llmResponse = await adapters.openai.completions.createCompletions(prompt, editorInstruction);

  // Log the updated file contents
  context.logger.info(`Updated file contents: ${JSON.stringify(llmResponse)}`);
  const updatedFileContents = llmResponse.text;

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

  // Detect no change and post a warning if needed
  if (formattedFileContents.trim() === currentFileContents.trim()) {
    await context.commentHandler.postComment(context, context.logger.warn("No change was triggered by the instruction."));
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
