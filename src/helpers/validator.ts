import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { Context } from "../types/index";

const pluginNameRegex = new RegExp("^([0-9a-zA-Z-._]+)/([0-9a-zA-Z-._]+)(?::([0-9a-zA-Z-._]+))?(?:@([0-9a-zA-Z-._]+(?:/[0-9a-zA-Z-._]+)*))?$");
const urlRegex = /^https?:\/\/\S+$/;

type PluginConfiguration = { plugins?: Record<string, unknown> };

function createConfigurationHandler(logger: Context["logger"]) {
  return new ConfigurationHandler(logger as never, {} as never, null);
}

export function parseConfig(yamlContent: string, logger: Context["logger"]): PluginLocation[] {
  try {
    return parsePluginLocations(yamlContent, logger);
  } catch (error) {
    logger.warn("Failed to parse YAML content", { stack: error instanceof Error ? error.stack : String(error) });
    return [];
  }
}

export async function validateYamlContent(content: string, logger: Context["logger"]): Promise<{ isValid: boolean; error?: string }> {
  try {
    const handler = createConfigurationHandler(logger);
    (handler as unknown as { _download: () => Promise<string> })._download = async () => content;

    const result = await handler.getConfigurationFromRepo("local", "local");

    if (!result || !result.config) {
      return { isValid: false, error: "Invalid or empty YAML content" };
    }

    if (!result.errors) {
      return { isValid: true };
    }

    const errorsArray = Array.isArray(result.errors) ? result.errors : Array.from(result.errors as Iterable<unknown>);
    const errorMessage = errorsArray
      .map((error) => (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error)))
      .join(", ");

    return { isValid: false, error: errorMessage || "Invalid YAML content" };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Invalid YAML content",
    };
  }
}

export function parseYaml(data: null | string, logger: Context["logger"]) {
  const handler = createConfigurationHandler(logger);
  return (handler as unknown as { _parseYaml: (data: null | string) => { yaml: unknown | null; errors: unknown[] | null } })._parseYaml(data);
}

export type PluginLocation = string | { owner: string; repo: string; ref?: string };

export function parsePluginIdentifier(value: string): string | PluginLocation {
  if (urlRegex.test(value)) {
    return value;
  }
  const matches = RegExp(pluginNameRegex).exec(value);
  if (!matches) {
    throw new Error(`Invalid plugin name: ${value}`);
  }
  return {
    owner: matches[1],
    repo: matches[2],
    ref: matches[4] || undefined,
  };
}

export function parsePluginLocations(yamlContent: string, logger: Context["logger"]): PluginLocation[] {
  const { yaml: parsedYaml, errors } = parseYaml(yamlContent, logger);
  if (errors) {
    logger.warn("Failed to parse YAML content:" + errors.map((error) => error.message).join(", "));
    return [];
  }

  const plugins = (parsedYaml as PluginConfiguration)?.plugins || [];

  return Object.keys(plugins).flatMap((key) => {
    return parsePluginIdentifier(key);
  });
}
