import { Buffer } from "node:buffer";
import { Context } from "../types/index";
import { Manifest } from "../types/github";

type RegistryPlugin = {
  owner?: unknown;
  repo?: unknown;
  default_branch?: unknown;
  manifest?: unknown;
};

type ParsedRegistryEntry = {
  cacheKey: string;
  manifest: Manifest;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function readGitHubFileRaw(
  context: Context,
  { owner, repo, path, ref }: { owner: string; repo: string; path: string; ref: string }
): Promise<string | null> {
  try {
    const response = await context.octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    if ("content" in response.data) {
      return Buffer.from(response.data.content, "base64").toString("utf8");
    }
  } catch (error: unknown) {
    context.logger.debug("Failed to read registry file via GitHub API (will fall back to raw URL).", {
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      owner,
      repo,
      path,
      ref,
    });
  }
  return null;
}

async function readRawUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function parseRegistryEntry(entry: unknown): ParsedRegistryEntry | null {
  if (!isRecord(entry)) return null;
  const plugin = entry as RegistryPlugin;

  const pluginOwner = readString(plugin.owner).trim();
  const pluginRepo = readString(plugin.repo).trim();
  const defaultBranch = readString(plugin.default_branch).trim() || "main";
  if (!pluginOwner || !pluginRepo) return null;

  const manifestRaw = plugin.manifest;
  if (!isRecord(manifestRaw)) return null;

  const name = readString(manifestRaw.name).trim();
  if (!name) return null;

  const shortName = readString(manifestRaw.short_name).trim() || `${pluginOwner}/${pluginRepo}@${defaultBranch}`;
  const homepageUrl = readString(manifestRaw.homepage_url).trim();

  const listenersValue = (manifestRaw as Record<string, unknown>).listeners ?? (manifestRaw as Record<string, unknown>)["ubiquity:listeners"];
  const commandsValue = (manifestRaw as Record<string, unknown>).commands;

  const cacheKey = `${pluginOwner}/${pluginRepo}/${defaultBranch}`;
  return {
    cacheKey,
    manifest: {
      name,
      description: readString(manifestRaw.description),
      short_name: shortName,
      homepage_url: homepageUrl || undefined,
      "ubiquity:listeners": readStringArray(listenersValue),
      commands: isRecord(commandsValue) ? (commandsValue as Manifest["commands"]) : {},
      config_properties: readStringArray((manifestRaw as Record<string, unknown>).config_properties),
    },
  };
}

export async function fetchMarketplacePluginRegistry(context: Context, manifestStore: Record<string, Manifest>): Promise<void> {
  const owner = "ubiquity-os-marketplace";
  const repo = ".ubiquity-os";
  const ref = "main";
  const path = ".github/ubiquity-os-marketplace.plugin-registry.json";

  const raw =
    (await readGitHubFileRaw(context, { owner, repo, path, ref })) ?? (await readRawUrl(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`));
  if (!raw) {
    context.logger.warn("Marketplace plugin registry could not be loaded; continuing without it.", { owner, repo, ref, path });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    context.logger.warn("Marketplace plugin registry JSON was invalid; continuing without it.", {
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    return;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
    context.logger.warn("Marketplace plugin registry JSON had an unexpected shape; continuing without it.");
    return;
  }

  const entries = parsed.plugins as unknown[];
  for (const entry of entries) {
    const parsedEntry = parseRegistryEntry(entry);
    if (!parsedEntry) continue;
    manifestStore[parsedEntry.cacheKey] = parsedEntry.manifest;
  }

  context.logger.ok("Loaded marketplace plugin registry", { count: Object.keys(manifestStore).length });
}
