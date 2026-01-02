import { Context } from "../types/context";
import { Target } from "../types/target";

export async function applyChanges(
  target: Target,
  updatedContent: string,
  context: Context,
  editorInstruction: string
): Promise<{ pullRequestUrl: string; branch: string }> {
  try {
    const { pullRequestUrl, branch, pullRequestNumber } = await context.adapters.git.pull_request.create(
      target,
      updatedContent,
      `Update ${target.filePath}`,
      editorInstruction
    );

    if (context.config.autoMerge) {
      if (typeof pullRequestNumber === "number") {
        try {
          await context.adapters.git.pull_request.merge({
            owner: target.owner,
            repo: target.repo,
            pullNumber: pullRequestNumber,
          });
          context.logger.ok(`Auto-merged pull request: ${pullRequestUrl}`);
        } catch (error) {
          context.logger.error("Auto-merge failed; leaving pull request open.", {
            stack: error instanceof Error ? error.message : String(error),
            pullRequestUrl,
          });
        }
      } else {
        context.logger.warn("Auto-merge enabled but pull request number is missing.", { pullRequestUrl });
      }
    }

    context.logger.ok(`Created pull request: ${pullRequestUrl}`);

    return {
      pullRequestUrl,
      branch,
    };
  } catch (error) {
    context.logger.error("Error applying changes:", { stack: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
