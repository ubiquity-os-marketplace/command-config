import path from "node:path";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { getFileContent } from "./get-file-content";
import { checkOrgPermissions, checkUserRepoPermissions } from "./user-permission";

const LOCAL_CONFIG_FULL_PATH = ".github/.ubiquity-os.config.local.yml";
const VALID_CONFIG_SUFFIX = /^[a-z0-9][a-z0-9_-]*$/i;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getConfigPathCandidatesFromSettings(context: Context): string[] {
  const maybeCandidates = (context.config as Record<string, unknown>).configPathCandidates;
  if (Array.isArray(maybeCandidates) && maybeCandidates.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return maybeCandidates;
  }
  return [];
}

function getFallbackConfigPathCandidates(context: Context): string[] {
  const environment = readString((context.config as Record<string, unknown>).environment)
    .trim()
    .toLowerCase();
  const configPath = context.config.configPath;
  const devConfigPath = context.config.devConfigPath;

  if (!environment) return [devConfigPath, configPath];
  if (environment === "production" || environment === "prod") return [configPath];

  const suffix = environment === "development" ? "dev" : environment;
  if (suffix === "dev") return [devConfigPath, configPath];
  if (!VALID_CONFIG_SUFFIX.test(suffix)) return [devConfigPath, configPath];

  const derived = suffix === "local" ? LOCAL_CONFIG_FULL_PATH : `.github/.ubiquity-os.config.${suffix}.yml`;
  return derived === configPath ? [configPath] : [derived, configPath];
}

function getConfigPathCandidates(context: Context): string[] {
  const fromKernel = getConfigPathCandidatesFromSettings(context);
  if (fromKernel.length) return fromKernel;
  return getFallbackConfigPathCandidates(context);
}

function getTargetTypeForConfigPath(context: Context, filePath: string): string {
  if (filePath === LOCAL_CONFIG_FULL_PATH) return "local";
  if (filePath === context.config.devConfigPath) return "dev";
  if (filePath === context.config.configPath) return "config";
  return "config";
}

async function tryGetRepoConfigFile(context: Context, owner: string, repo: string, filePath: string, label: string): Promise<string | undefined> {
  try {
    return await getFileContent(context, owner, repo, filePath);
  } catch (error: unknown) {
    context.logger.info(
      `${label} config file not found in repo: ${owner}/${repo}/${filePath}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

async function processBaseTargets(context: Context): Promise<Record<string, Target>> {
  const { config, logger } = context;
  const targetMap: Record<string, Target> = {};
  const baseTargets: Target[] = [];

  for (const target of config.defaultTargets) {
    const match = RegExp(/github\.com\/([^/]+)\/([^/]+)(\.git)?$/).exec(target.name);
    if (!match) {
      throw logger.error(`Invalid GitHub URL: ${target.name}`);
    }
    const owner = match[1];
    const repo = match[2].replace(".git", "");

    const hasRepoPermission = await checkUserRepoPermissions(context, owner, repo);

    baseTargets.push({
      type: target.type || "main",
      owner,
      repo,
      localDir: path.join(owner, repo),
      url: target.name,
      filePath: target.type === "dev" ? config.devConfigPath : config.configPath,
      readonly: !hasRepoPermission,
    });
  }

  // Add base targets to map
  baseTargets.forEach((target) => {
    targetMap[buildIdForTarget(target)] = target;
  });

  logger.info(`Base targets: ${JSON.stringify(targetMap, null, 2)}`);
  return targetMap;
}

async function processRepoConfigs(context: Context, targetMap: Record<string, Target>): Promise<{ repoConfig: string | undefined }> {
  const { payload } = context;
  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;

  const baseRepoTarget = {
    owner: repoOwner,
    repo: repoName,
    localDir: path.join(repoOwner, repoName),
    url: `https://github.com/${repoOwner}/${repoName}.git`,
    readonly: false,
  } satisfies Omit<Target, "type" | "filePath">;

  for (const candidate of getConfigPathCandidates(context)) {
    const repoConfig = await tryGetRepoConfigFile(context, repoOwner, repoName, candidate, "Config");
    if (!repoConfig) continue;

    const repoTarget: Target = {
      type: getTargetTypeForConfigPath(context, candidate),
      ...baseRepoTarget,
      filePath: candidate,
    };
    targetMap[buildIdForTarget(repoTarget)] = repoTarget;
    return { repoConfig };
  }

  return { repoConfig: undefined };
}

async function getConfig(context: Context, orgName: string, repoName: string, configPath: string) {
  try {
    const content = await getFileContent(context, orgName, repoName, configPath);
    if (!content) return null;
    return { content, configPath };
  } catch {
    return null;
  }
}

async function processOrgConfig(context: Context, targetMap: Record<string, Target>): Promise<void> {
  const { payload, config, logger } = context;
  const orgName = payload.repository.owner.login || (payload.organization && payload.organization.login);
  let filePath = config.configPath;

  if (!orgName) {
    throw logger.error("Organization not found in payload.");
  }

  try {
    let orgConfig: { content: string; configPath: string } | null = null;
    for (const candidate of getConfigPathCandidates(context)) {
      orgConfig = await getConfig(context, orgName, ".ubiquity-os", candidate);
      if (orgConfig?.content) {
        break;
      }
    }

    if (!orgConfig?.content) {
      logger.info("No configuration found at repository or organization level.");
      return;
    }

    const hasOrgPermission = await checkOrgPermissions(context, orgName, ".ubiquity-os");
    filePath = orgConfig.configPath;
    const orgRepoTarget: Target = {
      type: "config",
      owner: orgName,
      repo: ".ubiquity-os",
      localDir: path.join(orgName, ".ubiquity-os"),
      url: `https://github.com/${orgName}/.ubiquity-os.git`,
      filePath,
      readonly: !hasOrgPermission,
    };

    targetMap[buildIdForTarget(orgRepoTarget)] = orgRepoTarget;
  } catch (error: unknown) {
    logger.info(`Organization config file not found: ${orgName}/.ubiquity-os/${filePath}. Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function targetBuilder(context: Context): Promise<Record<string, Target>> {
  try {
    const targetMap: Record<string, Target> = {};
    const { repoConfig } = await processRepoConfigs(context, targetMap);

    if (!repoConfig) {
      await processOrgConfig(context, targetMap);
    }

    if (Object.keys(targetMap).length === 0) {
      return await processBaseTargets(context);
    }

    return targetMap;
  } catch (error: unknown) {
    context.logger.info(`Error accessing configurations: ${error || "Unknown error"}`);
    return {};
  }
}

// ID Builder for the target
function buildIdForTarget(target: Target): string {
  return `${target.owner}/${target.repo}/${target.type}`;
}
