import { Context } from "../../types/index";
import { SuperOpenAi } from "./openai";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { validateYamlContent } from "../../helpers/validator";
import { Manifest } from "../../types/github";

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

export class Completions extends SuperOpenAi {
  constructor(client: OpenAI, context: Context) {
    super(client, context);
  }

  promptBuilder(originalContent: string, parserCode: string, manifests: Manifest[], repoUrl: string): string {
    // Build the prompt
    return [
      `As a YAML configuration editor, modify the following YAML file according to the user's instructions, ensuring valid syntax and preserving formatting. Your task is to apply the changes while maintaining proper YAML structure.

KEY INSTRUCTIONS:
1. Preserve all list indicators (hyphens \`-\`), especially for plugin configurations
2. Validate the modified YAML against the parser code provided below
3. Use the provided manifests to understand valid property names and default values
4. **Do not alter any URLs in the configuration unless explicitly instructed**

Here is the original YAML configuration file for ${repoUrl}:`,

      originalContent,

      `Provide only the modified YAML content without any additional explanation, headers, footers, code block markers, or language identifiers.

When making changes to plugin configurations, maintain this structure:

# Example of correct plugin formatting
- uses:
- plugin: <ORG/OWNER>/<REPO>@main
  with:
    property1: value1
    property2: value2

PLUGIN INSTRUCTIONS:
- Ensure all plugin configurations are correctly formatted
- Use the manifests below to understand valid plugin properties and default values
- Do not remove any existing plugin configurations unless instructed
- Add new plugin configurations at the end of the file
- Infer ORG/OWNER and REPO details from the included plugin configurations and manifests
- DO NOT REMOVE CONTENT UNLESS SPECIFICALLY INSTRUCTED TO DO SO.


FORMATTING REQUIREMENTS:
- Preserve all indentation and spacing conventions from the original file
- Keep all comments intended for human readers—including any URLs within them
- Only remove commented-out YAML code if specifically instructed
- Do not remove or alter any documentation comments or URLs
- If adding new properties, refer to the manifests for proper names and default values

The YAML parser that will be used to validate your output is shown below. Ensure your modifications comply with this parser:`,

      parserCode,

      `IMPORTANT CONTEXT MANIFESTS:
The following manifests define the allowed properties and default values for plugins referenced in the configuration. Use these as your reference when adding or modifying plugin properties:`,
      manifests
        .map((manifest) => {
          this.context.logger.info(`Manifest: ${JSON.stringify(manifest)}`);
          return `### ${manifest.name} - Start
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

      const response = await this.client.chat.completions.create({
        model: "anthropic/claude-3.7-sonnet",
        max_tokens: 4000,
        temperature: attempts > 1 ? 0.2 : 0,
        messages,
      });

      if (!response) throw this.context.logger.error("No response from API");
      const completion = response.choices[0]?.message?.content;
      if (!completion) throw this.context.logger.error("No completion generated");

      // Validate the YAML output
      const validation = validateYamlContent(completion, this.context.logger);
      if (validation.isValid) {
        return {
          text: completion,
          tokenCounts: {
            inputTokens: response.usage?.prompt_tokens || 0,
            outputTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
          },
          metadata: {
            attempts,
            ...response,
          },
        };
      }

      lastError = validation.error;
      this.context.logger.warn(`Invalid YAML on attempt ${attempts}/${maxRetries}: ${validation.error}`);

      // If we've exhausted our retries, throw an error
      if (attempts >= maxRetries) {
        throw this.context.logger.error(`Failed to generate valid YAML after ${maxRetries} attempts. Last error: ${validation.error}`);
      }
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw this.context.logger.error("Unexpected end of completion generation");
  }
}
