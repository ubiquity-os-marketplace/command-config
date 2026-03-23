import { checkUserPermissions } from "../helpers/user-permission";
import { Context } from "../types/index";
import { syncAgent } from "./sync-configs-agent";

export function isSlashCommand(context: Context) {
  return context.payload.comment.body.trim().startsWith("/config");
}

export async function syncConfigs(context: Context) {
  const { payload, logger, eventName, commentHandler } = context;

  if (payload.comment.user?.type === "Bot") {
    const message = "Comment is from a bot. Skipping.";
    logger.debug(message);
    return { status: 304, reason: message };
  }

  // Ignore if the command is not /config, and if it is not an LLM command
  if (!isSlashCommand(context) && !context.command) {
    return { status: 304, reason: logger.debug("Command is not /config. Skipping.").logMessage.raw };
  }

  await commentHandler.postComment(context, logger.info("Processing configuration change request..."));

  // Fetch the Editor Instruction
  const extractedInstructions = extractEditorInstruction(context);
  if (!extractedInstructions) {
    const errorMessage = logger.debug("No editor instruction found in comment. Skipping.");
    await commentHandler.postComment(context, errorMessage);
    return { status: 200, reason: errorMessage.logMessage.raw };
  }
  const { editorInstruction } = extractedInstructions;

  // Use the payload to determine if this is a pull or issue
  if (eventName === "pull_request_review_comment.created") {
    // eslint-disable-next-line
    // TODO: Implement Pull Request Review Comment Support
    const message = "This is a pull request, not supported for now";
    logger.warn(message);
    throw new Error(message);
  }

  // Check user permissions before proceeding allow only if (admin || write)
  // eslint-disable-next-line
  // TODO: Handle Privacy Settings for user
  if (!(await checkUserPermissions(context))) {
    const message = "User does not have the required permissions. Skipping.";
    logger.warn(message);
    throw new Error(message);
  }

  const prUrls = await syncAgent(editorInstruction, context);
  if (prUrls.length === 0) {
    const errorMessage = logger.debug("No pull requests was created.");
    await commentHandler.postComment(context, errorMessage);
    return { status: 200, reason: errorMessage.logMessage.raw };
  } else {
    const prList = prUrls
      .map((url) => {
        return `- ${url}`;
      })
      .join("\n\n");
    await context.commentHandler.postComment(context, logger.ok(prList));
    return { status: 200, reason: logger.ok(prList).logMessage.raw };
  }
}

function extractEditorInstruction(context: Context): { editorInstruction: string } | null {
  const { payload, command, logger } = context;

  const body = payload.comment.body.trim();
  if (command && command.name === "config") {
    const editorInstruction = command.parameters.editor_instruction ?? command.parameters.editorInstruction;
    if (typeof editorInstruction === "string" && editorInstruction.trim() !== "") {
      return { editorInstruction: editorInstruction.trim() };
    }
  }

  if (body.startsWith("/config")) {
    const editorInstruction = body.slice("/config".length).trim();
    if (!editorInstruction) {
      const message = "Editor instruction cannot be empty. Please provide editing instructions.";
      logger.warn(message);
      throw new Error(message);
    }
    return { editorInstruction };
  }

  return null;
}
