import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { Context } from "../types/index";

export async function validateYamlContent(content: string, context: Context): Promise<{ isValid: boolean; error?: string }> {
  try {
    const handler = new ConfigurationHandler(context.logger, context.octokit);

    const result = handler.parseYaml(content);

    if (!result.yaml || result.errors) {
      return { isValid: false, error: `Invalid or empty YAML content: ${result.errors?.join(", ")}` };
    }
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Invalid YAML content",
    };
  }
}
