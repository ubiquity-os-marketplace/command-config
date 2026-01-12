import { createPlugin, Options } from "@ubiquity-os/plugin-sdk";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import manifest from "../manifest.json";
import { createAdapters } from "./adapters/index";
import { runPlugin } from "./index";
import { Command } from "./types/command";
import { Env, envSchema, PluginSettings, pluginSettingsSchema, SupportedEvents } from "./types/index";

export default {
  async fetch(request: Request, env: Env) {
    return createPlugin<PluginSettings, Env, Command, SupportedEvents>(
      (context) => {
        return runPlugin({
          ...context,
          adapters: {} as ReturnType<typeof createAdapters>,
        });
      },
      manifest as Manifest,
      {
        settingsSchema: pluginSettingsSchema as unknown as Options["settingsSchema"],
        envSchema: envSchema as unknown as Options["envSchema"],
        postCommentOnError: true,
        logLevel: (env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY,
        bypassSignatureVerification: true,
      }
    ).fetch(request, env);
  },
};
