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
    baseUrl: T.String({ default: "https://openrouter.ai/api/v1" }),
    parserPath: T.String({ default: "https://github.com/ubiquity-os/ubiquity-os-kernel.git" }),
    configPath: T.String({ default: ".github/.ubiquity-os.config.yml" }),
    devConfigPath: T.String({ default: ".github/.ubiquity-os.config.dev.yml" }),
    model: T.String({
      default: "deepseek/deepseek-r1-0528:free",
      examples: ["deepseek/deepseek-r1-0528:free", "anthropic/claude-3.7-sonnet", "openai/gpt-4o"],
    }),
    defaultTargets: T.Array(
      T.Object({
        name: T.String({ default: "https://github.com/ubiquity-os/.ubiquity-os.git" }),
        branch: T.String({ default: "main" }),
        type: T.Enum({ main: "main", dev: "dev" }, { default: "main" }),
      }),
      {
        default: [{ name: "https://github.com/ubiquity-os/.ubiquity-os.git", type: "dev" }],
      }
    ),
  },
  { default: {} }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
