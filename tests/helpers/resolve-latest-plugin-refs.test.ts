import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { resolveLatestPluginRefs } from "../../src/helpers/resolve-latest-plugin-refs.js";
import type { Context } from "../../src/types/index.js";

describe("resolveLatestPluginRefs", () => {
  it("pins owner/repo@latest to the default branch commit sha", async () => {
    const context = {
      logger: new Logs("info"),
      octokit: {
        rest: {
          repos: {
            get: jest.fn(async () => ({ data: { default_branch: "development" } })),
          },
          git: {
            getRef: jest.fn(async () => ({ data: { object: { sha: "abc123def456" } } })),
          },
        },
      },
    } as unknown as Context;

    await expect(resolveLatestPluginRefs("install ubiquity-os-marketplace/command-wallet@latest", context)).resolves.toBe(
      "install ubiquity-os-marketplace/command-wallet@abc123def456"
    );

    expect(context.octokit.rest.repos.get).toHaveBeenCalledWith({
      owner: "ubiquity-os-marketplace",
      repo: "command-wallet",
    });
    expect(context.octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "ubiquity-os-marketplace",
      repo: "command-wallet",
      ref: "heads/development",
    });
  });
});
