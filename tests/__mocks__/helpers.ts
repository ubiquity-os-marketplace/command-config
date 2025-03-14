import { db } from "./db";
import issueTemplate from "./issue-template";
import { STRINGS } from "./strings";
import usersGet from "./users-get.json";

/**
 * Helper function to setup tests.
 *
 * This function populates the mock database with the external API
 * data you'd expect to find in a real-world scenario.
 *
 * Here is where you create issues, commits, pull requests, etc.
 */
export async function setupTests() {
  // Setup users including bot user
  for (const item of usersGet) {
    db.users.create(item);
  }
  db.users.create({
    id: 9999,
    login: "bot-user",
    name: "Bot User",
    type: "Bot",
  });

  // Setup repository
  // Setup main repository
  db.repo.create({
    id: 1,
    name: STRINGS.TEST_REPO,
    owner: {
      login: STRINGS.USER_1,
      id: 1,
    },
    issues: [],
  });

  // Set up org repository
  db.repo.create({
    id: 3,
    name: ".ubiquity-os",
    owner: {
      login: STRINGS.USER_1,
      id: 2,
    },
    issues: [],
    default_branch: "main",
  });

  // Setup target repository
  db.repo.create({
    id: 2,
    name: "test-target",
    owner: {
      login: STRINGS.USER_1,
      id: 1,
    },
    issues: [],
  });

  // Setup test issues
  db.issue.create({
    ...issueTemplate,
  });

  db.issue.create({
    ...issueTemplate,
    id: 2,
    number: 2,
    labels: [],
  });

  // Setup initial git data
  setupGitData();

  createComment("/Hello", 1);
}

/**
 * Setup git-related mock data
 */
function setupGitData() {
  // Create a default branch for the org
  db.git_refs.create({
    id: 1,
    owner: STRINGS.USER_1,
    repo: ".ubiquity-os",
    ref: "main",
    sha: "default-branch-sha",
  });

  // Create a default branch ref
  db.git_refs.create({
    id: 2,
    owner: STRINGS.USER_1,
    repo: STRINGS.TEST_REPO,
    ref: "main",
    sha: "default-branch-sha",
  });

  // Create required config files
  db.git_files.create({
    id: 1,
    owner: STRINGS.USER_1,
    repo: STRINGS.TEST_REPO,
    path: ".github/.ubiquity-os.config.yml",
    sha: "config-file-sha",
    content: Buffer.from(
      `
plugin_name: test-plugin
targets:
  - name: test-target
    type: prod
`
    ).toString("base64"),
  });

  // Create plugin configuration file
  db.git_files.create({
    id: 2,
    owner: "ubiquity",
    repo: "ubiquity-os-kernel",
    path: "src/github/types/plugin-configuration.ts",
    sha: "plugin-config-sha",
    content: Buffer.from(
      `
export interface PluginConfiguration {
  name: string;
  targets: Array<{
    name: string;
    type: string;
  }>;
}
`
    ).toString("base64"),
  });

  // Create additional mock files needed for testing
  db.git_files.create({
    id: 3,
    owner: STRINGS.USER_1,
    repo: ".ubiquity-os",
    path: ".github/.ubiquity-os.config.dev.yml",
    sha: "dev-config-sha",
    content: Buffer.from(
      `
plugin_name: test-plugin-dev
targets:
  - name: test-target
    type: dev
`
    ).toString("base64"),
  });
}

export function createComment(comment: string, commentId: number) {
  const isComment = db.issueComments.findFirst({
    where: {
      id: {
        equals: commentId,
      },
    },
  });

  if (isComment) {
    db.issueComments.update({
      where: {
        id: {
          equals: commentId,
        },
      },
      data: {
        body: comment,
      },
    });
  } else {
    db.issueComments.create({
      id: commentId,
      body: comment,
      issue_number: 1,
      user: db.users.findFirst({
        where: {
          login: { equals: STRINGS.USER_1 },
        },
      }) || { id: 1, login: STRINGS.USER_1, type: "User" },
    });
  }
}
