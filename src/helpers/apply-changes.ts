import { Context } from "../types/context";
import { Target } from "../types/target";

export async function applyChanges(
  target: Target,
  updatedContent: string,
  context: Context,
  editorInstruction: string
): Promise<{ pullRequestUrl: string; branch: string }> {
  try {
    const { pullRequestUrl, branch } = await context.adapters.git.pull_request.create(target, updatedContent, `Update ${target.filePath}`, editorInstruction);

    context.logger.info(`Created pull request: ${pullRequestUrl}`);

    return {
      pullRequestUrl,
      branch,
    };
  } catch (error) {
    context.logger.error("Error applying changes:", { stack: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
