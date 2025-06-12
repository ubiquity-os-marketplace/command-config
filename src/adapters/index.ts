import { Context } from "../types/index";
import { SuperOpenAi } from "./openai/openai";
import { GitAdapter } from "./git/git";
import { PullRequest } from "./git/super/actions/pull-request";
import { Completions } from "./openai/completions";
import OpenAI from "openai";

export function createAdapters(openai: OpenAI, context: Context) {
  return {
    openai: {
      completions: new Completions(openai, context),
      super: new SuperOpenAi(openai, context),
    },
    git: {
      super: new GitAdapter(context),
      pull_request: new PullRequest(context),
    },
  };
}
