import path from "path";
import { Context } from "../types/index";
import { Target } from "../types/target";
import { checkOrgPermissions, checkUserRepoPermissions } from "./user-permission";
import { getFileContent } from "./get-file-content";

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
): Promise<{ repoConfig: string | undefined; repoDevConfig: string | undefined }> {
  const { payload, config, logger } = context;
  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  let repoConfig, repoDevConfig;

  try {
    // Try to get repo level configs
    repoConfig = await getFileContent(context, repoOwner, repoName, config.configPath);
  } catch (error: unknown) {
    logger.info(
      `Config file not found in repo: ${repoOwner}/${repoName}/${config.configPath}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    repoDevConfig = await getFileContent(context, repoOwner, repoName, config.devConfigPath);
  } catch (error: unknown) {
    logger.info(
      `Dev config file not found in repo: ${repoOwner}/${repoName}/${config.devConfigPath}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (repoConfig || repoDevConfig) {
    if (repoConfig) {
      const repoTarget: Target = {
        type: "config",
        owner: repoOwner,
        repo: repoName,
        localDir: path.join(repoOwner, repoName),
        url: `https://github.com/${repoOwner}/${repoName}.git`,
        filePath: config.configPath,
        readonly: false,
      };
      targetMap[buildIdForTarget(repoTarget)] = repoTarget;
    }

    if (repoDevConfig) {
      const repoDevTarget: Target = {
        type: "dev",
        owner: repoOwner,
        repo: repoName,
        localDir: path.join(repoOwner, repoName),
        url: `https://github.com/${repoOwner}/${repoName}.git`,
        filePath: config.devConfigPath,
        readonly: false,
      };
      targetMap[buildIdForTarget(repoDevTarget)] = repoDevTarget;
    }
  }

  return { repoConfig, repoDevConfig };
}

async function processOrgConfig(context: Context, targetMap: Record<string, Target>): Promise<void> {
  const { payload, config, logger } = context;
  const orgName = payload.repository.owner.login || (payload.organization && payload.organization.login);

  if (!orgName) {
    throw logger.error("Organization not found in payload.");
  }

  try {
    // Try to get org level configs
    const orgConfig = await getFileContent(context, orgName, ".ubiquity-os", config.configPath);
    if (!orgConfig) {
      logger.info("No configuration found at repository or organization level.");
      return;
    }

    const hasOrgPermission = await checkOrgPermissions(context, orgName, ".ubiquity-os");
    const orgRepoTarget: Target = {
      type: "config",
      owner: orgName,
      repo: ".ubiquity-os",
      localDir: path.join(orgName, ".ubiquity-os"),
      url: `https://github.com/${orgName}/.ubiquity-os.git`,
      filePath: config.configPath,
      readonly: !hasOrgPermission,
    };

    targetMap[buildIdForTarget(orgRepoTarget)] = orgRepoTarget;
  } catch (error: unknown) {
    logger.info(
      `Organization config file not found: ${orgName}/.ubiquity-os/${config.configPath}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function targetBuilder(context: Context): Promise<Record<string, Target>> {
  try {
    const targetMap: Record<string, Target> = {};
    const { repoConfig, repoDevConfig } = await processRepoConfigs(context, targetMap);

    if (!(repoConfig || repoDevConfig)) {
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
