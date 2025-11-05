import { Context } from "../types/index";
import { Manifest, PluginLocation } from "../types/github";
import { fetchManifests } from "./fetch-manifests";

export async function fetchOrganizationManifests(context: Context, organization: string, manifestCache: Record<string, Manifest>): Promise<void> {
  const repositories = await context.octokit.paginate(context.octokit.rest.repos.listForOrg, {
    org: organization,
    per_page: 100,
  });

  const pluginLocations: PluginLocation[] = [];

  for (const repository of repositories) {
    if (!repository?.name) {
      continue;
    }
    const ref = repository.default_branch || "main";
    pluginLocations.push({ owner: organization, repo: repository.name, ref });
  }

  if (pluginLocations.length === 0) {
    return;
  }

  await fetchManifests(pluginLocations, manifestCache, context);
}
