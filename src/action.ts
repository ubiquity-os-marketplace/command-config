import * as github from "@actions/github";
import { createActionsPlugin } from "@ubiquity-os/plugin-sdk";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import { runPlugin } from "./index";
import { Env, envSchema, PluginSettings, pluginSettingsSchema, SupportedEvents } from "./types/index";
import { Command } from "./types/command";
import { createAdapters } from "./adapters/index";

export default createActionsPlugin<PluginSettings, Env, Command, SupportedEvents>(
  (context) => {
    const rawInputs = (github.context.payload as { inputs?: Record<string, unknown> } | undefined)?.inputs;
    const authToken = typeof rawInputs?.authToken === "string" ? rawInputs.authToken : undefined;
    const ubiquityKernelToken = typeof rawInputs?.ubiquityKernelToken === "string" ? rawInputs.ubiquityKernelToken : undefined;

    return runPlugin({
      ...context,
      authToken,
      ubiquityKernelToken,
      adapters: {} as ReturnType<typeof createAdapters>,
    });
  },

  {
    logLevel: (process.env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
    settingsSchema: pluginSettingsSchema,
    envSchema: envSchema,
    ...(process.env.KERNEL_PUBLIC_KEY && { kernelPublicKey: process.env.KERNEL_PUBLIC_KEY }),
    postCommentOnError: true,
    bypassSignatureVerification: process.env.NODE_ENV === "local",
  }
);
