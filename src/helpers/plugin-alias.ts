import { Manifest } from "../types/github";

const URL_REGEX = /^https?:\/\//i;

export type PluginAliasIndex = Readonly<{
  aliases: Record<string, readonly string[]>;
}>;

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function parseOwnerRepoRefFromKey(key: string): { owner: string; repo: string; ref: string } | null {
  if (URL_REGEX.test(key)) return null;
  const [owner, repo, ...refParts] = key.split("/");
  if (!owner || !repo || refParts.length === 0) return null;
  return { owner, repo, ref: refParts.join("/") };
}

export function toConfigPluginKey(locationKey: string, manifest?: Manifest): string {
  const shortName = typeof manifest?.short_name === "string" ? manifest.short_name.trim() : "";
  if (shortName) return shortName;

  const homepage = typeof manifest?.homepage_url === "string" ? manifest.homepage_url.trim() : "";
  if (homepage) return homepage;

  if (URL_REGEX.test(locationKey)) return locationKey;
  const parsed = parseOwnerRepoRefFromKey(locationKey);
  if (!parsed) return locationKey;
  return `${parsed.owner}/${parsed.repo}@${parsed.ref}`;
}

type AddAliasFn = (alias: string, key: string) => void;

function addAliasesFromLocationKey(locationKey: string, canonical: string, add: AddAliasFn) {
  const parsedFromKey = parseOwnerRepoRefFromKey(locationKey);
  if (!parsedFromKey) return;
  add(parsedFromKey.repo, canonical);
  add(`${parsedFromKey.repo}@${parsedFromKey.ref}`, canonical);
}

function addAliasesFromShortName(shortName: string, canonical: string, add: AddAliasFn) {
  const trimmed = shortName.trim();
  if (!trimmed) return;
  add(trimmed, canonical);

  const atIndex = trimmed.indexOf("@");
  const ownerRepo = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);
  const ref = atIndex === -1 ? "" : trimmed.slice(atIndex + 1);
  const repo = ownerRepo.split("/")[1];
  if (!repo) return;

  add(repo, canonical);
  if (ref) add(`${repo}@${ref}`, canonical);
}

function addAliasesFromManifestName(name: string, canonical: string, add: AddAliasFn) {
  const trimmed = name.trim();
  if (!trimmed) return;
  add(trimmed, canonical);
}

export function buildPluginAliasIndex(manifestStore: Record<string, Manifest>): PluginAliasIndex {
  const aliases = new Map<string, Set<string>>();

  function add(alias: string, key: string) {
    const normalized = normalizeAlias(alias);
    if (!normalized) return;
    let set = aliases.get(normalized);
    if (!set) {
      set = new Set<string>();
      aliases.set(normalized, set);
    }
    set.add(key);
  }

  for (const [locationKey, manifest] of Object.entries(manifestStore)) {
    const canonical = toConfigPluginKey(locationKey, manifest);
    addAliasesFromLocationKey(locationKey, canonical, add);
    if (typeof manifest.short_name === "string") addAliasesFromShortName(manifest.short_name, canonical, add);
    if (typeof manifest.name === "string") addAliasesFromManifestName(manifest.name, canonical, add);
  }

  return {
    aliases: Object.fromEntries(
      [...aliases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([alias, keys]) => [alias, [...keys].sort((a, b) => a.localeCompare(b))])
    ),
  };
}

function tryResolvePluginKey(
  pluginName: string,
  explicitRef: string | undefined,
  index: PluginAliasIndex
): { resolved?: string; ambiguous?: readonly string[] } {
  const normalized = normalizeAlias(pluginName);
  const candidates = index.aliases[normalized];
  if (!candidates || candidates.length === 0) return {};
  if (candidates.length > 1) return { ambiguous: candidates };

  const base = candidates[0];
  if (!explicitRef) return { resolved: base };

  if (URL_REGEX.test(base)) return { resolved: base };

  const match = /^([0-9a-zA-Z-._]+)\/([0-9a-zA-Z-._]+)(?:@[^\s]+)?$/.exec(base);
  if (!match) return { resolved: base };
  const owner = match[1];
  const repo = match[2];
  return { resolved: `${owner}/${repo}@${explicitRef}` };
}

export type ExpandResult = Readonly<{
  expandedInstruction: string;
  replacements: ReadonlyArray<{ from: string; to: string }>;
  ambiguous: ReadonlyArray<{ name: string; candidates: readonly string[] }>;
}>;

export function expandPluginInstallShorthand(instruction: string, index: PluginAliasIndex): ExpandResult {
  const replacements: { from: string; to: string }[] = [];
  const ambiguous: { name: string; candidates: readonly string[] }[] = [];

  const pattern = /\b(install|add|enable)\s+(?<name>[a-z0-9][a-z0-9-_]*)(?:@(?<ref>[a-z0-9][a-z0-9-._/]*))?\b/gi;

  const expandedInstruction = instruction.replace(pattern, (match, verb: string, nameValue: string, refValue: string | undefined) => {
    const name = String(nameValue ?? "").trim();
    const ref = String(refValue ?? "").trim() || undefined;

    const resolution = tryResolvePluginKey(name, ref, index);
    if (resolution.ambiguous) {
      ambiguous.push({ name, candidates: resolution.ambiguous });
      return match;
    }
    if (!resolution.resolved) return match;

    const before = ref ? `${name}@${ref}` : name;
    const after = resolution.resolved;
    if (before !== after) {
      replacements.push({ from: before, to: after });
    }
    return `${verb} ${after}`;
  });

  return { expandedInstruction, replacements, ambiguous };
}
