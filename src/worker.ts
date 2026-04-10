import { createPlugin, Options } from "@ubiquity-os/plugin-sdk";
import { Manifest, resolveRuntimeManifest } from "@ubiquity-os/plugin-sdk/manifest";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import manifest from "../manifest.json" with { type: "json" };
import { createAdapters } from "./adapters/index";
import { runPlugin } from "./index";
import { Command } from "./types/command";
import { Env, envSchema, PluginSettings, pluginSettingsSchema, SupportedEvents } from "./types/index";

function buildRuntimeManifest(request: Request) {
  const runtimeManifest = resolveRuntimeManifest(manifest as Manifest);
  return {
    ...runtimeManifest,
    homepage_url: new URL(request.url).origin,
  };
}

export default {
  async fetch(request: Request, env: Env) {
    const runtimeManifest = buildRuntimeManifest(request);
    if (new URL(request.url).pathname === "/manifest.json") {
      return Response.json(runtimeManifest);
    }

    return createPlugin<PluginSettings, Env, Command, SupportedEvents>(
      (context) => {
        return runPlugin({
          ...context,
          adapters: {} as ReturnType<typeof createAdapters>,
        });
      },
      runtimeManifest,
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
