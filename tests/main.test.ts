import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drop } from "@mswjs/data";
import { CommentHandler } from "@ubiquity-os/plugin-sdk";
import { customOctokit as Octokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import dotenv from "dotenv";
import manifest from "../manifest.json";
import { runPlugin } from "../src";
import { Env } from "../src/types/index";
import { Context } from "../src/types/context";
import { db } from "./__mocks__/db";
import { createComment, setupTests } from "./__mocks__/helpers";
import { server } from "./__mocks__/node";
import { STRINGS } from "./__mocks__/strings";

dotenv.config();
const octokit = new Octokit();

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});
afterAll(() => server.close());

describe("Plugin tests", () => {
  beforeEach(async () => {
    drop(db);
    await setupTests();
  });

  it("Should serve the manifest file", async () => {
    const worker = (await import("../src/worker")).default;
    const response = await worker.fetch(new Request("http://localhost/manifest.json"), { OPENROUTER_API_KEY: "mock-api-key" });
    const content = await response.json();
    expect(content).toEqual(manifest);
  });

  describe("Sync Config Tests", () => {
    it("Should create PR and include URL in comment", async () => {
      const { context } = createContext("/config update dependencies");
      context.command = {
        name: "config",
        parameters: {
          editorInstruction: "update dependencies",
        },
      };

      await runPlugin(context);
      const comments = db.issueComments.getAll();
      const lastComment = comments[comments.length - 1].body;
      expect(lastComment).toMatch(/\[!TIP\]/);
      expect(lastComment).toMatch(/- https:\/\/github.com\//);

      // Verify git operations updated the database
      const gitRefs = db.git_refs.getAll();
      const gitFiles = db.git_files.getAll();
      const pulls = db.pulls.getAll();

      expect(gitRefs.length).toBeGreaterThan(0);
      expect(gitFiles.length).toBeGreaterThan(0);
      expect(pulls.length).toBe(1);
      expect(pulls[0].html_url).toMatch(/https:\/\/github.com\//);
    });

    it("Should handle missing editor instructions", async () => {
      const { context } = createContext("/config");
      try {
        await runPlugin(context);
        fail("Expected an error to be thrown");
      } catch (error) {
        expect(error).toBeDefined();
      }
      const comments = db.issueComments.getAll();
      expect(comments.length).toBe(2); // One more comment should be created containing the error
    });
  });
});

/**
 * The heart of each test. This function creates a context object with the necessary data for the plugin to run.
 *
 * So long as everything is defined correctly in the db (see `./__mocks__/helpers.ts: setupTests()`),
 * this function should be able to handle any event type and the conditions that come with it.
 *
 * Refactor according to your needs.
 */
function createContext(commentBody: string = "/Hello", repoId: number = 1, payloadSenderId: number = 1, commentId: number = 1, issueOne: number = 1) {
  const repo = db.repo.findFirst({ where: { id: { equals: repoId } } }) as unknown as Context["payload"]["repository"];
  const sender = db.users.findFirst({ where: { id: { equals: payloadSenderId } } }) as unknown as Context["payload"]["sender"];
  const issue1 = db.issue.findFirst({ where: { id: { equals: issueOne } } }) as unknown as Context<"issue_comment.created">["payload"]["issue"];

  createComment(commentBody, commentId); // create it first then pull it from the DB and feed it to _createContext
  const comment = db.issueComments.findFirst({ where: { id: { equals: commentId } } }) as unknown as Context["payload"]["comment"];

  const context = createContextInner(repo, sender, issue1, comment);
  const infoSpy = jest.spyOn(context.logger, "info");
  const errorSpy = jest.spyOn(context.logger, "error");
  const debugSpy = jest.spyOn(context.logger, "debug");
  const okSpy = jest.spyOn(context.logger, "ok");
  const verboseSpy = jest.spyOn(context.logger, "verbose");

  return {
    context,
    infoSpy,
    errorSpy,
    debugSpy,
    okSpy,
    verboseSpy,
    repo,
    issue1,
  };
}

/**
 * Creates the context object central to the plugin.
 *
 * This should represent the active `SupportedEvents` payload for any given event.
 */
function createContextInner(
  repo: Context["payload"]["repository"],
  sender: Context["payload"]["sender"],
  issue: Context<"issue_comment.created">["payload"]["issue"],
  comment: Context["payload"]["comment"]
) {
  return {
    eventName: "issue_comment.created",
    command: null,
    payload: {
      action: "created",
      sender: sender,
      repository: repo,
      issue: issue,
      comment: comment,
      installation: { id: 1 } as Context["payload"]["installation"],
      organization: { login: STRINGS.USER_1 } as Context["payload"]["organization"],
    },
    logger: new Logs("debug"),
    config: {
      baseUrl: "https://openrouter.ai/api/v1",
      parserPath: `https://github.com/${STRINGS.USER_1}/ubiquity-os-kernel.git`,
      configPath: ".github/.ubiquity-os.config.yml",
      devConfigPath: ".github/.ubiquity-os.config.dev.yml",
      defaultTargets: [{ name: `https://github.com/${STRINGS.USER_1}/.ubiquity-os.git`, type: "dev" }],
    },
    env: {
      OPENROUTER_API_KEY: "mock-api-key",
    } as Env,
    octokit: octokit,
    commentHandler: new CommentHandler(),
  } as unknown as Context;
}
