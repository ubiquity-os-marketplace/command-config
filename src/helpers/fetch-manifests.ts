import { Buffer } from "node:buffer";
import { Manifest, PluginLocation } from "../types/github";
import { Context } from "../types/index";

const MANIFEST_FILENAME = "manifest.json";
const GITHUB_HOST = "github.com";
const RAW_GITHUB_HOST = "raw.githubusercontent.com";

type GitHubManifestTarget = {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
};

function normalizeRepoName(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

function ensureManifestPath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return MANIFEST_FILENAME;
  return trimmed.endsWith(`/${MANIFEST_FILENAME}`) || trimmed === MANIFEST_FILENAME ? trimmed : `${trimmed}/${MANIFEST_FILENAME}`;
}

function splitRefAndPath(pathParts: string[], refOverride?: string): { ref?: string; path: string } {
  if (refOverride) {
    return { ref: refOverride, path: ensureManifestPath(pathParts.join("/")) };
  }

  if (pathParts.length === 0) {
    return { path: MANIFEST_FILENAME };
  }

  if (pathParts[0] === MANIFEST_FILENAME) {
    return { path: MANIFEST_FILENAME };
  }

  const [ref, ...rest] = pathParts;
  if (rest.length === 0) {
    return { ref, path: MANIFEST_FILENAME };
  }

  return {
    ref,
    path: ensureManifestPath(rest.join("/")),
  };
}

function parseGitHubManifestUrl(location: string): GitHubManifestTarget | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const refOverride = url.searchParams.get("ref")?.trim() || undefined;

  if (host === RAW_GITHUB_HOST) {
    if (parts.length < 3) return null;
    const [owner, repoRaw, ...rest] = parts;
    const repo = normalizeRepoName(repoRaw);
    const { ref, path } = splitRefAndPath(rest, refOverride);
    return { owner, repo, ref, path };
  }

  if (host !== GITHUB_HOST) return null;
  if (parts.length < 2) return null;

  const [owner, repoRaw, ...rest] = parts;
  const repo = normalizeRepoName(repoRaw);

  if (rest[0] === "blob" || rest[0] === "tree") {
    const { ref, path } = splitRefAndPath(rest.slice(1), refOverride);
    return { owner, repo, ref, path };
  }

  return { owner, repo, ...(refOverride ? { ref: refOverride } : {}), path: MANIFEST_FILENAME };
}

async function fetchManifestFromGitHub(context: Context, target: GitHubManifestTarget): Promise<Manifest> {
  const response = await context.octokit.rest.repos.getContent({
    owner: target.owner,
    repo: target.repo,
    path: target.path,
    ...(target.ref ? { ref: target.ref } : {}),
  });
  if ("content" in response.data) {
    const content = Buffer.from(response.data.content, "base64").toString("utf8");
    return decodeManifest(JSON.parse(content));
  }
  throw new Error("Not a file content response");
}

export async function fetchManifests(pluginLocations: PluginLocation[], manifestCache: Record<string, Manifest>, context: Context): Promise<Manifest[]> {
  const manifests: Manifest[] = [];

  for (const plugin of pluginLocations) {
    context.logger.info(`Trying to fetch manifest`, {
      plugin: plugin,
    });
    const manifest = await fetchManifest(plugin, manifestCache, context);
    if (manifest) {
      manifests.push(manifest);
    }
  }

  return [...Object.values(manifestCache), ...manifests];
}
async function fetchManifest(plugin: PluginLocation, manifestCache: Record<string, Manifest>, context: Context): Promise<Manifest | null> {
  if (typeof plugin === "string") {
    // For URL strings, use the existing cache mechanism
    if (manifestCache[plugin]) {
      return manifestCache[plugin];
    }

    try {
      const githubTarget = parseGitHubManifestUrl(plugin);
      if (githubTarget) {
        const manifest = await fetchManifestFromGitHub(context, githubTarget);
        manifestCache[plugin] = manifest;
        return manifest;
      }
    } catch (e) {
      context.logger.warn(`Could not fetch manifest for ${plugin} via GitHub API: ${e}`);
    }

    try {
      const normalized = plugin.trim().replace(/\/+$/, "");
      const manifestUrl = normalized.endsWith(`/${MANIFEST_FILENAME}`) ? normalized : `${normalized}/${MANIFEST_FILENAME}`;
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const manifest = decodeManifest(await response.json());
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
    const manifest = await fetchManifestFromGitHub(context, { owner, repo, ref, path: MANIFEST_FILENAME });
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
    short_name: typeof typedManifest.short_name === "string" && typedManifest.short_name.trim().length ? typedManifest.short_name.trim() : undefined,
    commands: typedManifest.commands || {},
    "ubiquity:listeners": typedManifest["ubiquity:listeners"] || [],
    configuration: typedManifest.configuration || {},
    homepage_url: typedManifest.homepage_url,
  };
}
