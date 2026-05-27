import { Context } from "../types/index";
import { parseConfigPluginKey } from "./plugin-alias";

async function getDefaultBranchHeadSha(context: Context, owner: string, repo: string): Promise<string> {
  const { data: repository } = await context.octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repository.default_branch || "main";
  const { data: ref } = await context.octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  return ref.object.sha;
}

export async function resolveLatestPluginRefs(instruction: string, context: Context): Promise<string> {
  const matches = [...instruction.matchAll(/\b(?<key>[0-9A-Za-z._-]+\/[0-9A-Za-z._-]+@latest)\b/g)];
  if (matches.length === 0) return instruction;

  const replacements = new Map<string, string>();

  for (const match of matches) {
    const key = match.groups?.key;
    if (!key || replacements.has(key)) continue;

    const parsed = parseConfigPluginKey(key);
    if (!parsed || parsed.ref.toLowerCase() !== "latest") continue;

    const sha = await getDefaultBranchHeadSha(context, parsed.owner, parsed.repo);
    replacements.set(key, `${parsed.owner}/${parsed.repo}@${sha}`);
  }

  let updated = instruction;
  for (const [from, to] of replacements) {
    updated = updated.replaceAll(from, to);
  }
  return updated;
}
