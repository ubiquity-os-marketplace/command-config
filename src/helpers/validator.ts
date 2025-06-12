import { Value } from "@sinclair/typebox/value";
import { YAMLError } from "yaml";
import yaml from "js-yaml";
import { Context } from "../types/index";
import { PluginConfiguration, configSchema, configSchemaValidator } from "../config/plugin-schema";

export function parseConfig(yamlContent: string, logger: Context["logger"]): PluginLocation[] {
  try {
    Value.Cast(configSchema, yaml.load(yamlContent)); // Validate schema
    return parsePluginLocations(yamlContent, logger);
  } catch (error) {
    logger.error("Failed to parse YAML content", { stack: error instanceof Error ? error.stack : String(error) });
    return [];
  }
}

export function validateYamlContent(content: string, logger: Context["logger"]): { isValid: boolean; error?: string } {
  try {
    const { yaml, errors } = parseYaml(content, logger);
    if (errors) {
      return { isValid: false, error: errors.map((error) => error.message).join(", ") };
    }
    const targetRepoConfiguration: PluginConfiguration | null = yaml as PluginConfiguration;
    if (targetRepoConfiguration) {
      const configSchemaWithDefaults = Value.Default(configSchema, targetRepoConfiguration) as Readonly<unknown>;
      const errors = configSchemaValidator.testReturningErrors(configSchemaWithDefaults);
      if (errors) {
        return {
          isValid: false,
          error: Array.from(errors)
            .map((error) => error.message)
            .join(", "),
        };
      }
    }
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Invalid YAML content",
    };
  }
}

export function parseYaml(data: null | string, logger: Context["logger"]) {
  if (!data) {
    return { yaml: null, errors: null };
  }

  try {
    const parsedData = yaml.load(data);
    return { yaml: parsedData ?? null, errors: null };
  } catch (error) {
    logger.error("Error parsing YAML", { stack: error instanceof Error ? error.stack : String(error) });
    return { errors: [error] as YAMLError[], yaml: null };
  }
}

export type PluginLocation = string | { owner: string; repo: string; ref?: string };

export function parsePluginLocations(yamlContent: string, logger: Context["logger"]): PluginLocation[] {
  const { yaml: parsedYaml, errors } = parseYaml(yamlContent, logger);
  if (errors) {
    logger.error("Failed to parse YAML content:" + errors.map((error) => error.message).join(", "));
    return [];
  }

  const plugins = (parsedYaml as PluginConfiguration)?.plugins || [];
  return plugins.flatMap(
    (plugin) =>
      plugin.uses?.flatMap((use): PluginLocation[] => {
        if (typeof use === "string") {
          return [use];
        }

        if (use && typeof use.plugin === "string") {
          const plugin = use.plugin;
          if (plugin.startsWith("http")) {
            return [`${plugin}/manifest.json`];
          }

          const parts = plugin.split("/");
          if (parts.length >= 2) {
            const owner = parts[0];
            const repoAndRef = parts[1].split("@");
            const repo = repoAndRef[0];
            const ref = repoAndRef[1];

            return [{ owner, repo, ...(ref && { ref }) }];
          }
        }

        return [];
      }) || []
  );
}
