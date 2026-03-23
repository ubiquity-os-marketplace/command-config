import { jest } from "@jest/globals";

jest.mock(
  "@actions/github",
  () => ({
    __esModule: true,
    default: {
      context: {
        payload: {},
        runId: 1,
        sha: "local",
      },
    },
  }),
  { virtual: true } as never
);

jest.mock("@octokit/webhooks-methods", () => ({}), { virtual: true } as never);
