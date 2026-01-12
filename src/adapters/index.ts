import { Context } from "../types/index";
import { GitAdapter } from "./git/git";
import { PullRequest } from "./git/super/actions/pull-request";
import { Completions } from "./openai/completions";

export function createAdapters(context: Context) {
  return {
    llm: {
      completions: new Completions(context),
    },
    git: {
      super: new GitAdapter(context),
      pull_request: new PullRequest(context),
    },
  };
}
