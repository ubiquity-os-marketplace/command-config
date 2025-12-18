import path from "node:path";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { getFileContent } from "./get-file-content";
import { checkOrgPermissions, checkUserRepoPermissions } from "./user-permission";

const LOCAL_CONFIG_FULL_PATH = ".github/.ubiquity-os.config.local.yml";

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

async function processRepoConfigs(
  context: Context,
  targetMap: Record<string, Target>
): Promise<{ repoConfig: string | undefined; repoDevConfig: string | undefined; repoLocalConfig: string | undefined }> {
  const { payload, config } = context;
  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;

  const repoConfig = await tryGetRepoConfigFile(context, repoOwner, repoName, config.configPath, "Config");
  const repoDevConfig = await tryGetRepoConfigFile(context, repoOwner, repoName, config.devConfigPath, "Dev");
  const repoLocalConfig = await tryGetRepoConfigFile(context, repoOwner, repoName, LOCAL_CONFIG_FULL_PATH, "Local");

  if (repoConfig || repoDevConfig || repoLocalConfig) {
    const baseRepoTarget = {
      owner: repoOwner,
      repo: repoName,
      localDir: path.join(repoOwner, repoName),
      url: `https://github.com/${repoOwner}/${repoName}.git`,
      readonly: false,
    } satisfies Omit<Target, "type" | "filePath">;

    if (repoConfig) {
      const repoTarget: Target = {
        type: "config",
        ...baseRepoTarget,
        filePath: config.configPath,
      };
      targetMap[buildIdForTarget(repoTarget)] = repoTarget;
    }

    if (repoDevConfig) {
      const repoDevTarget: Target = {
        type: "dev",
        ...baseRepoTarget,
        filePath: config.devConfigPath,
      };
      targetMap[buildIdForTarget(repoDevTarget)] = repoDevTarget;
    }

    if (repoLocalConfig) {
      const repoLocalTarget: Target = {
        type: "local",
        ...baseRepoTarget,
        filePath: LOCAL_CONFIG_FULL_PATH,
      };
      targetMap[buildIdForTarget(repoLocalTarget)] = repoLocalTarget;
    }
  }

  return { repoConfig, repoDevConfig, repoLocalConfig };
}

async function getConfig(context: Context, orgName: string, repoName: string, configPath: string) {
  try {
    const content = await getFileContent(context, orgName, repoName, configPath);
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
    // Try to get org level configs
    const orgConfig = (
      await Promise.all([getConfig(context, orgName, ".ubiquity-os", config.devConfigPath), getConfig(context, orgName, ".ubiquity-os", config.configPath)])
    )
      .filter((o) => !!o)
      .shift();

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
    const { repoConfig, repoDevConfig, repoLocalConfig } = await processRepoConfigs(context, targetMap);

    if (!(repoConfig || repoDevConfig || repoLocalConfig)) {
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
