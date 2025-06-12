import { Context as PluginContext } from "@ubiquity-os/plugin-sdk";
import { Env } from "./env";
import { PluginSettings } from "./plugin-input";
import { Command } from "./command";
import { createAdapters } from "../adapters/index";

export type SupportedEvents = "issue_comment.created" | "pull_request_review_comment.created";

export type Context<T extends SupportedEvents = SupportedEvents> = PluginContext<PluginSettings, Env, Command, T> & {
  adapters: ReturnType<typeof createAdapters>;
};
