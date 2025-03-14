import { Context } from "../types";

export async function checkUserRepoPermissions(context: Context, owner: string, repo: string): Promise<boolean> {
  const { octokit, logger } = context;
  const sender = context.payload.comment.user?.login;
  if (!sender) {
    throw logger.error("Sender not found in payload.");
  }
  const permissions = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner,
    repo,
    username: sender,
  });
  return permissions.data.permission === "admin" || permissions.data.permission === "write";
}

// Function to determine if the user is an admin for a repo/organization
export async function checkUserPermissions(context: Context, owner?: string, repo?: string): Promise<boolean> {
  // Fetch the sender's username
  const { payload, logger } = context;

  // Fetch the sender's username
  const sender = payload.comment.user?.login;

  if (!sender) {
    throw logger.error("Sender not found in payload.");
  }

  // Extract repository or organization information
  const repository = payload.repository;
  if (!owner || !repo) {
    if (!repository) {
      throw logger.error("Repository not found in payload.");
    }
    owner = repository.organization?.login || repository.owner.login;
    repo = repository.name;
  }

  const hasPermission = await checkUserRepoPermissions(context, owner, repo);
  logger.info(`User ${sender} has permission for ${owner}/${repo}: ${hasPermission}`);
  return hasPermission;
}

export async function checkOrgPermissions(context: Context, owner?: string, repo?: string): Promise<boolean> {
  const { octokit, logger, payload } = context;
  const sender = context.payload.comment.user?.login;
  if (!sender) {
    throw logger.error("Sender not found in payload.");
  }

  // Extract repository or organization information
  const repository = payload.repository;
  if (!owner) {
    if (!repository) {
      throw logger.error("Repository not found in payload.");
    }
    owner = repository.organization?.login || repository.owner.login;
  }

  // Check user permissions for current organization
  const orgPermissions = await octokit.rest.orgs.checkMembershipForUser({
    org: owner,
    username: sender,
  });

  // Check repo access if defined return true if user is a member and has access
  if (repo) {
    const hasRepoPermission = await checkUserRepoPermissions(context, owner, repo);
    return orgPermissions.status !== 302 && hasRepoPermission;
  }

  // eslint-disable-next-line
  // TODO: Handle Privacy Settings for user (hide membership?)
  logger.info(`User ${sender} is a member of ${owner}: ${orgPermissions.headers.status === "204"}: ${orgPermissions.data}`);
  return orgPermissions.status !== 302;
}
