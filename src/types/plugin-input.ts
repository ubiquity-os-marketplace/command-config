import { StaticDecode, Type as T } from "@sinclair/typebox";

/**
 * This should contain the properties of the bot config
 * that are required for the plugin to function.
 *
 * The kernel will extract those and pass them to the plugin,
 * which are built into the context object from setup().
 */
export const pluginSettingsSchema = T.Object(
  {
    environment: T.Optional(T.String()),
    autoMerge: T.Boolean({ default: false }),
    model: T.String({
      default: "gpt-5.2-codex",
      examples: [
        // cspell:disable
        "gpt-5.2-codex",
        "gpt-5.2-chat-latest",
        "gpt-5.1-codex-mini",
        "gpt-5.1-chat-latest",
        // cspell:enable
      ],
    }),
    reasoningEffort: T.Optional(
      T.Union([T.Literal("none"), T.Literal("minimal"), T.Literal("low"), T.Literal("medium"), T.Literal("high"), T.Literal("xhigh")], { default: "medium" })
    ),
    defaultTargets: T.Array(
      T.Object({
        name: T.String({ default: "https://github.com/ubiquity-os/.ubiquity-os.git" }),
        branch: T.String({ default: "main" }),
        type: T.Enum({ main: "main", dev: "dev" }, { default: "main" }),
      }),
      {
        default: [{ name: "https://github.com/ubiquity-os/.ubiquity-os.git", type: "main" }],
      }
    ),
  },
  { default: {} }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
