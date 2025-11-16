import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { fetchOrganizationManifests } from "../../src/helpers/fetch-organization-manifests.js";
import type { Manifest } from "../../src/types/github.js";
import type { Context } from "../../src/types/index.js";

class TestError extends Error {}

describe("fetchOrganizationManifests", () => {
  it("loads manifests for repositories in the organization", async () => {
    const manifestCache: Record<string, Manifest> = {};

    const repositories = [{ name: "alpha", default_branch: "develop" }, { name: "beta" }];

    const manifestsByRepo: Record<string, Manifest> = {
      alpha: { name: "Alpha Manifest" },
      beta: { name: "Beta Manifest" },
    };

    async function listForOrg() {
      return repositories;
    }

    async function getContent({ repo, ref }: { repo: string; ref?: string }) {
      if (!ref) {
        throw new TestError(`missing ref for ${repo}`);
      }
      const manifest = manifestsByRepo[repo];
      if (!manifest) {
        throw new TestError(`missing manifest for ${repo}`);
      }
      return {
        data: {
          content: Buffer.from(JSON.stringify(manifest)).toString("base64"),
        },
      };
    }

    const octokit = {
      paginate: async (method: unknown, params: { org: string }) => {
        expect(method).toBe(listForOrg);
        if (params.org !== "ubiquity-os-marketplace") {
          throw new TestError("unexpected organization");
        }
        return repositories;
      },
      rest: {
        repos: {
          listForOrg,
          getContent,
        },
      },
    };

    const context = {
      octokit,
      logger: new Logs("info"),
    } as unknown as Context;

    await fetchOrganizationManifests(context, "ubiquity-os-marketplace", manifestCache);

    expect(manifestCache["ubiquity-os-marketplace/alpha/develop"]).toEqual({
      name: "Alpha Manifest",
      description: "",
      commands: {},
      "ubiquity:listeners": [],
      configuration: {},
    });
    expect(manifestCache["ubiquity-os-marketplace/beta/main"]).toEqual({
      name: "Beta Manifest",
      description: "",
      commands: {},
      "ubiquity:listeners": [],
      configuration: {},
    });
  });
});
