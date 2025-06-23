import { checkUserPermissions } from "../helpers/user-permission";
import { Context } from "../types/index";
import { syncAgent } from "./sync-configs-agent";

export async function syncConfigs(context: Context) {
  const { payload, logger, eventName, commentHandler } = context;

  if (payload.comment.user?.type === "Bot") {
    throw logger.error("Comment is from a bot. Skipping.");
  }

  // Fetch the Editor Instruction
  const extractedInstructions = extractEditorInstruction(context);
  if (!extractedInstructions) {
    const errorMessage = logger.info("No editor instruction found in comment. Skipping.");
    await commentHandler.postComment(context, errorMessage);
    return { status: 200, reason: errorMessage.logMessage.raw };
  }
  const { editorInstruction } = extractedInstructions;

  // Use the payload to determine if this is a pull or issue
  if (eventName === "pull_request_review_comment.created") {
    // eslint-disable-next-line
    // TODO: Implement Pull Request Review Comment Support
    throw logger.error("This is a pull request, not supported for now");
  }

  // Check user permissions before proceeding allow only if (admin || write)
  // eslint-disable-next-line
  // TODO: Handle Privacy Settings for user
  if (!(await checkUserPermissions(context))) {
    throw logger.error("User does not have the required permissions. Skipping.");
  }

  const prUrls = await syncAgent(editorInstruction, context);
  if (prUrls.length === 0) {
    const errorMessage = logger.info("No pull requests was created.");
    await commentHandler.postComment(context, errorMessage);
    return { status: 200, reason: errorMessage.logMessage.raw };
  } else {
    const prList = prUrls
      .map((url) => {
        return `- ${url}`;
      })
      .join("\n\n");
    await context.commentHandler.postComment(context, logger.ok(prList));
    return { status: 200, reason: logger.info(prList).logMessage.raw };
  }
}

function extractEditorInstruction(context: Context): { editorInstruction: string } | null {
  const { payload, command, logger } = context;

  let editorInstruction;

  if (command && command.name !== "config") {
    editorInstruction = command.parameters.editorInstruction;
  } else if (payload.comment.body.trim().startsWith("/config")) {
    editorInstruction = payload.comment.body.trim().replace("/config", "").trim();
  } else {
    return null;
  }

  if (!editorInstruction || editorInstruction.trim() === "") {
    throw logger.error("Editor instruction cannot be empty. Please provide editing instructions.");
  }

  // The target-scope handler will check if repo config exists otherwise fallback to org
  return { editorInstruction };
}
