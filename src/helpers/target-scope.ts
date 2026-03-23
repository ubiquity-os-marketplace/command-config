import path from "node:path";
import { CONFIG_PROD_FULL_PATH } from "@ubiquity-os/plugin-sdk/configuration";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { getFileContent } from "./get-file-content";
import { checkOrgPermissions, checkUserRepoPermissions } from "./user-permission";

const VALID_CONFIG_SUFFIX = /^[a-z0-9][a-z0-9_-]*$/i;

function normalizeEnvironmentName(environment: string | null | undefined): string {
  return String(environment ?? "")
    .trim()
    .toLowerCase();
}

function getConfigPathCandidatesForEnvironment(environment: string | null | undefined): string[] {
  const normalized = normalizeEnvironmentName(environment);
  if (!normalized) {
    return [CONFIG_PROD_FULL_PATH];
  }
  if (normalized === "production" || normalized === "prod") {
    return [CONFIG_PROD_FULL_PATH];
  }

  if (!VALID_CONFIG_SUFFIX.test(normalized)) {
    return [CONFIG_PROD_FULL_PATH];
  }

  return [`.github/.ubiquity-os.config.${normalized}.yml`, CONFIG_PROD_FULL_PATH];
}

function readEnvironment(context: Context): string {
  return typeof context.config.environment === "string" ? context.config.environment.trim() : "";
}

function getConfigPathCandidates(context: Context): string[] {
  return getConfigPathCandidatesForEnvironment(readEnvironment(context));
}

function getPrimaryConfigPath(context: Context): string {
  const environment = readEnvironment(context);
  return getConfigPathCandidatesForEnvironment(environment)[0];
}

async function tryGetRepoConfigFile(context: Context, owner: string, repo: string, filePath: string, label: string): Promise<string | undefined> {
  try {
    return await getFileContent(context, owner, repo, filePath);
  } catch (error: unknown) {
    context.logger.debug(
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
      const message = `Invalid GitHub URL: ${target.name}`;
      logger.warn(message);
      throw new Error(message);
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
      filePath: getPrimaryConfigPath(context),
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
      type: "config",
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
  const { payload, logger } = context;
  const orgName = payload.repository.owner.login || (payload.organization && payload.organization.login);
  const candidatePaths = getConfigPathCandidates(context);
  let filePath = candidatePaths[0] ?? CONFIG_PROD_FULL_PATH;

  if (!orgName) {
    const message = "Organization not found in payload.";
    logger.warn(message);
    throw new Error(message);
  }

  try {
    let orgConfig: { content: string; configPath: string } | null = null;
    for (const candidate of candidatePaths) {
      orgConfig = await getConfig(context, orgName, ".ubiquity-os", candidate);
      if (orgConfig?.content) {
        break;
      }
    }

    if (!orgConfig?.content) {
      logger.debug("No configuration found at repository or organization level.");
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
    logger.debug(`Organization config file not found: ${orgName}/.ubiquity-os/${filePath}. Error: ${error instanceof Error ? error.message : String(error)}`);
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
    context.logger.error(`Error accessing configurations: ${error || "Unknown error"}`);
    return {};
  }
}

// ID Builder for the target
function buildIdForTarget(target: Target): string {
  return `${target.owner}/${target.repo}/${target.type}`;
}
