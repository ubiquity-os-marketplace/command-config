import { syncConfigs } from "./handlers/sync-config";
import { Context } from "./types";
import { isCommentEvent } from "./types/typeguards";
import { createAdapters } from "./adapters";
import OpenAI from "openai";

/**
 * The main plugin function. Split for easier testing.
 */
export async function runPlugin(context: Context) {
  const { logger, config, eventName, env } = context;

  // Create Clients
  const openai = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: env.OPENROUTER_API_KEY,
  });

  // Set up adapters
  context.adapters = createAdapters(openai, context);

  if (isCommentEvent(context)) {
    return await syncConfigs(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
