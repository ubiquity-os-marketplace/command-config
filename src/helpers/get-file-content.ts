import { Context } from "../types/index";

export async function getFileContent(context: Context, owner: string, repo: string, path: string): Promise<string | undefined> {
  const { octokit, logger } = context;

  // Use octokit to fetch the file content
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });

  if (response.status !== 200 || !response.data) return;

  // Check if data is an array or doesn't have content property
  if (Array.isArray(response.data) || !("content" in response.data)) {
    throw logger.error(`File content not available for: ${path}`);
  }

  // Decode and return the content
  return Buffer.from(response.data.content, "base64").toString("utf-8");
}
