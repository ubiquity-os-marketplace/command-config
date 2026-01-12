import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { Context } from "../types/index";

function createConfigurationHandler(logger: Context["logger"]) {
  return new ConfigurationHandler(logger as never, {} as never, null);
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
