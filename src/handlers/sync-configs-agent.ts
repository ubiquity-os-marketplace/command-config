import { fetchMarketplacePluginRegistry } from "../helpers/fetch-plugin-registry";
import { fetchAndParseFileContent, processTargetRepos } from "../helpers/process-targets";
import { targetBuilder } from "../helpers/target-scope";
import { Manifest } from "../types/github";
import { Context } from "../types/index";

export async function syncAgent(editorInstruction: string, context: Context): Promise<string[]> {
  const { logger } = context;

  //Build targets are
  const targets = await targetBuilder(context);

  // PR URLS if multiple targets
  const prUrls: string[] = [];

  // Manifest Cache
  const manifestStore: Record<string, Manifest> = {};

  try {
    await fetchMarketplacePluginRegistry(context, manifestStore);
  } catch (error) {
    logger.error(`Error fetching marketplace plugin registry`, {
      err: error,
    });
  }

  for (const target of Object.values(targets)) {
    try {
      logger.info(`Fetching and parsing file content for target: ${JSON.stringify(target)}`);
      await fetchAndParseFileContent(context, target, manifestStore);
    } catch (error) {
      logger.warn(`Error fetching and parsing file content for target: ${error} & ${JSON.stringify(target)}`);
      continue;
    }
  }

  logger.info("Manifest store ready", { count: Object.keys(manifestStore).length });
  // Run the Repo Config Extractor on the targets (by this point we know the sender has permissions to the targets)
  for (const target of Object.values(targets)) {
    if (target.readonly) continue;
    try {
      const prUrl = await processTargetRepos(target, editorInstruction, context, manifestStore);
      if (prUrl) prUrls.push(prUrl);
    } catch (error) {
      await context.commentHandler.postComment(
        context,
        logger.warn(`Failed to process the target ${target.url}.`, {
          err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
          target: JSON.stringify(target),
        }),
        { updateComment: true }
      );
      continue;
    }
  }
  return prUrls;
}
