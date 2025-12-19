import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { callLlm } from "./call-llm";
import { stripCodeFences } from "../../helpers/strip-code-fences";
import { validateYamlContent } from "../../helpers/validator";
import { toConfigPluginKey } from "../../helpers/plugin-alias";
import { Manifest } from "../../types/github";
import { Context } from "../../types/index";

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

export interface Answer {
  text: string;
  tokenCounts: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata: {
    [key: string]: unknown;
  };
}

export class Completions {
  constructor(private readonly _context: Context) {}

  promptBuilder(originalContent: string, parserCode: string, manifests: Record<string, Manifest>, repoUrl: string): string {
    // Build the prompt
    return [
      `As a YAML configuration editor, modify the following YAML file according to the user's instructions, ensuring valid syntax and preserving formatting. Your task is to apply the changes while maintaining proper YAML structure and returning the entire file content.

    KEY INSTRUCTIONS:
    1. Preserve all list indicators (hyphens \`-\`), especially for plugin configurations
    2. Validate the modified YAML against the parser code provided below
    3. Use the provided manifests to understand valid property names and default values
    4. **Do not alter any URLs in the configuration unless explicitly instructed**
    5. Do NOT remove any comments from the YAML configuration. All comments, including documentation and inline notes, must be preserved exactly as in the original file. Only remove or alter comments if specifically instructed to do so.
    6. Always return the complete YAML configuration, including sections you did not modify.
    7. Match plugin identifiers to the manifest KEY exactly. If the KEY is a URL, keep it as a URL; if it is an owner/repo reference, keep that format.
    8. When a property is not specified by the user, omit optional fields and rely on schema defaults instead of inventing new values.

    Here is the original YAML configuration file for ${repoUrl}:`,

      originalContent,

      `Provide only the YAML content without any additional explanation, headers, footers, code block markers, or language identifiers.
      Your response MUST contain ONLY the YAML content for the entire file. Do NOT include any explanation, headers, footers, or introductory text.

    PLUGIN INSTRUCTIONS:
    - Ensure all plugin configurations match the structure already present in the file
    - Use the manifests below to understand valid plugin properties and default values
    - Do not remove any existing plugin configurations unless instructed
    - Add new plugin configurations at the end of the file unless the user specifies a position
    - DO NOT REMOVE CONTENT UNLESS SPECIFICALLY INSTRUCTED TO DO SO.
    - When adding or updating a plugin, choose properties from the manifest's configuration section. If a property is optional and no instruction is given, omit it so the schema defaults apply.

    FORMATTING REQUIREMENTS:
    - Preserve all indentation and spacing conventions from the original file
    - Keep all comments intended for human readers—including any URLs within them
    - Preserve all comments (this includes documentation, inline, and block comments) and URLs unless specifically instructed otherwise; only remove commented-out YAML code when instructed
    - If adding new properties, refer to the manifests for proper names and default values
    - DO NOT add any comment to your changes

The YAML parser that will be used to validate your output is shown below. Ensure your modifications comply with this parser:`,

      parserCode,

      `IMPORTANT CONTEXT MANIFESTS:
    The following manifests define the allowed properties and default values for plugins referenced in the configuration. Use these as your reference when adding or modifying plugin properties.
    For each manifest, the "configuration.properties" key lists the available "with:" options for each plugin. Use the KEY exactly as shown for any "plugins" entry you add or update.

`,
      Object.entries(manifests)
        .map(([name, manifest]) => {
          this._context.logger.debug(`Manifest: ${JSON.stringify(manifest)}`);
          const pluginKey = toConfigPluginKey(name, manifest);
          return `### ${manifest.name} - Start

KEY: ${pluginKey}

\`\`\`json
${JSON.stringify(manifest)}
\`\`\`
### ${manifest.name} - End\n`;
        })
        .join("\n\n"),
    ].join("\n\n===\n\n");
  }

  async createCompletions(prompt: string, instruction: string, maxRetries = 3): Promise<Answer> {
    let attempts = 0;
    let lastError: string | undefined;

    while (attempts < maxRetries) {
      attempts++;

      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: instruction,
        },
      ];

      if (lastError) {
        messages.push({
          role: "user",
          content: `The previous response generated invalid YAML. Please fix the following error and try again: ${lastError}`,
        });
      }

      const response = await callLlm(
        {
          messages,
          max_tokens: 4000,
          temperature: attempts > 1 ? 0.2 : 0,
        },
        this._context
      );

      if (!response) throw this._context.logger.error("No response from API");
      if (isAsyncIterable(response)) {
        throw this._context.logger.error("Unexpected streaming response from LLM");
      }

      const completionResponse: ChatCompletion = response;
      const rawCompletion = completionResponse.choices?.[0]?.message?.content;
      if (!rawCompletion) throw this._context.logger.warn("No completion generated");

      const completion = stripCodeFences(String(rawCompletion));

      // Validate the YAML output
      const validation = validateYamlContent(completion, this._context.logger);
      if (validation.isValid) {
        const usage = completionResponse.usage;
        return {
          text: completion,
          tokenCounts: {
            inputTokens: usage?.prompt_tokens ?? 0,
            outputTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
          },
          metadata: {
            attempts,
            ...completionResponse,
          },
        };
      }

      lastError = validation.error;
      this._context.logger.warn(`Invalid YAML on attempt ${attempts}/${maxRetries}: ${validation.error}`, {
        completion,
      });

      // If we've exhausted our retries, throw an error
      if (attempts >= maxRetries) {
        throw this._context.logger.error(`Failed to generate valid YAML after ${maxRetries} attempts. Last error: ${validation.error}`);
      }
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw this._context.logger.error("Unexpected end of completion generation");
  }
}
