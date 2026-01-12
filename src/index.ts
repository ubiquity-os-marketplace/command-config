import { syncConfigs } from "./handlers/sync-config";
import { Context } from "./types/index";
import { isCommentEvent } from "./types/typeguards";
import { createAdapters } from "./adapters/index";

/**
 * The main plugin function. Split for easier testing.
 */
export async function runPlugin(context: Context) {
  const { logger, eventName, commentHandler } = context;

  context.adapters = createAdapters(context);

  if (isCommentEvent(context)) {
    await commentHandler.postComment(context, logger.info("Processing configuration change request..."));
    return await syncConfigs(context);
  }

  logger.warn(`Unsupported event: ${eventName}`);
}
