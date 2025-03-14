import { getFileContent } from "../helpers/get-file-content";
import { fetchAndParseFileContent, processTargetRepos } from "../helpers/process-targets";
import { targetBuilder } from "../helpers/target-scope";
import { Context } from "../types";
import { Manifest } from "../types/github";

export async function syncAgent(editorInstruction: string, context: Context): Promise<string[]> {
  const { logger, config } = context;

  //Build targets are
  const targets = await targetBuilder(context);

  // Use the config to get the parser details
  const match = RegExp(/github\.com\/([^/]+)\/([^/]+)(\.git)?$/).exec(config.parserPath);
  if (!match) {
    throw logger.error(`Invalid GitHub URL: ${config.parserPath}`);
  }
  const owner = match[1];
  const repo = match[2].replace(".git", "");

  // Fetch the parse code
  const parserCode = await getFileContent(context, owner, repo, "src/github/types/plugin-configuration.ts");
  if (!parserCode) throw logger.error("Parser code not found.");

  // PR URLS if multiple targets
  const prUrls: string[] = [];

  // Manifest Cache
  const manifestStore: Record<string, Manifest> = {};

  for (const target of Object.values(targets)) {
    try {
      logger.info(`Fetching and parsing file content for target: ${JSON.stringify(target)}`);
      await fetchAndParseFileContent(context, target, manifestStore);
    } catch (error) {
      logger.warn(`Error fetching and parsing file content for target: ${error} & ${JSON.stringify(target)}`);
      continue;
    }
  }

  // Run the Repo Config Extractor on the targets (by this point we know the sender has permissions to the targets)
  for (const target of Object.values(targets)) {
    if (target.readonly) continue;
    try {
      const prUrl = await processTargetRepos(target, parserCode, editorInstruction, context, manifestStore);
      if (prUrl) prUrls.push(prUrl);
    } catch (error) {
      logger.warn(`Error processing target: ${error} & ${JSON.stringify(target)}`);
      continue;
    }
  }
  return prUrls;
}
