import { Manifest, PluginLocation } from "../types/github";
import { Context } from "../types";

export async function fetchManifests(pluginLocations: PluginLocation[], manifestCache: Record<string, Manifest>, context: Context): Promise<Manifest[]> {
  const manifests: Manifest[] = [];

  for (const plugin of pluginLocations) {
    const manifest = await fetchManifest(plugin, manifestCache, context);
    if (manifest) {
      manifests.push(manifest);
    }
  }

  return manifests;
}
async function fetchManifest(plugin: PluginLocation, manifestCache: Record<string, Manifest>, context: Context): Promise<Manifest | null> {
  if (typeof plugin === "string") {
    // For URL strings, use the existing cache mechanism
    if (manifestCache[plugin]) {
      return manifestCache[plugin];
    }

    try {
      // Log that we're using a direct URL
      const response = await context.octokit.request(`GET ${plugin}`);
      const content = JSON.stringify(response.data);
      const manifest = decodeManifest(JSON.parse(content));
      manifestCache[plugin] = manifest;
      return manifest;
    } catch (e) {
      context.logger.warn(`Could not fetch manifest for ${plugin}: ${e}`);
    }

    return null;
  }

  // For repository references
  const { owner, repo, ref = "main" } = plugin;
  const cacheKey = `${owner}/${repo}/${ref}`;

  if (manifestCache[cacheKey]) {
    return manifestCache[cacheKey];
  }

  try {
    let content;
    const response = await context.octokit.rest.repos.getContent({
      owner,
      repo,
      path: "manifest.json",
      ref,
    });
    if ("content" in response.data) {
      content = Buffer.from(response.data.content, "base64").toString("utf8");
    } else {
      throw new Error("Not a file content response");
    }
    const manifest = decodeManifest(JSON.parse(content));
    manifestCache[cacheKey] = manifest;
    return manifest;
  } catch (e) {
    context.logger.warn(`Could not fetch manifest for Owner: ${owner}, Repo: ${repo}, Ref: ${ref}: ${e}`);
  }

  return null;
}

function decodeManifest(manifest: unknown): Manifest {
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("Manifest is invalid: not an object");
  }

  const typedManifest = manifest as Partial<Manifest>;

  if (typeof typedManifest.name !== "string" || typedManifest.name.length === 0) {
    throw new Error("Manifest is invalid: name is required and must be a non-empty string");
  }

  return {
    name: typedManifest.name,
    description: typedManifest.description || "",
    commands: typedManifest.commands || {},
    "ubiquity:listeners": typedManifest["ubiquity:listeners"] || [],
    configuration: typedManifest.configuration || {},
  };
}
