import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { callLlm } from "@ubiquity-os/plugin-sdk";
import { stripCodeFences } from "../../helpers/strip-code-fences";
import { validateYamlContent } from "../../helpers/validator";
import { toConfigPluginKey } from "../../helpers/plugin-alias";
import { Manifest } from "../../types/github";
import { Context } from "../../types/index";

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;
  normalized = normalized.replace(/\/+$/g, "");
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return normalized;
}

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

  private _buildMessages(prompt: string, instruction: string, lastError?: string): ChatCompletionMessageParam[] {
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

    return messages;
  }

  private _ensureCompletionResponse(response: unknown): ChatCompletion {
    if (!response) throw this._context.logger.error("No response from API");
    if (isAsyncIterable(response)) {
      throw this._context.logger.error("Unexpected streaming response from LLM");
    }
    return response as ChatCompletion;
  }

  private _getCompletionText(completionResponse: ChatCompletion): string {
    const rawCompletion = completionResponse.choices?.[0]?.message?.content;
    if (!rawCompletion) throw this._context.logger.warn("No completion generated");
    return stripCodeFences(String(rawCompletion));
  }

  private _toAnswer(completionResponse: ChatCompletion, completion: string, attempts: number): Answer {
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

  private _handleInvalidYaml(attempts: number, maxRetries: number, error: string, completion: string) {
    this._context.logger.warn(`Invalid YAML on attempt ${attempts}/${maxRetries}: ${error}`, {
      completion,
    });

    if (attempts >= maxRetries) {
      throw this._context.logger.error(`Failed to generate valid YAML after ${maxRetries} attempts. Last error: ${error}`);
    }
  }

  promptBuilder(originalContent: string, manifests: Record<string, Manifest>, repoUrl: string): string {
    const catalog = Object.entries(manifests)
      .map(([locationKey, manifest]) => {
        const key = toConfigPluginKey(locationKey, manifest);
        const commands = manifest.commands
          ? Object.fromEntries(
              Object.entries(manifest.commands).map(([commandName, command]) => [
                commandName,
                {
                  description: command?.description,
                  example: command?.["ubiquity:example"],
                },
              ])
            )
          : undefined;
        const configProperties = Array.isArray(manifest.config_properties) ? manifest.config_properties : undefined;
        return {
          key,
          name: manifest.name,
          description: manifest.description,
          homepageUrl: manifest.homepage_url,
          listeners: manifest["ubiquity:listeners"],
          configProperties,
          commands,
        };
      })
      .filter((entry) => typeof entry.key === "string" && entry.key.trim().length > 0)
      .sort((a, b) => a.key.localeCompare(b.key));

    return [
      `You are a YAML editor for UbiquityOS configuration files.

Return ONLY the full YAML file content (no markdown, no code fences, no explanation).

Hard requirements:
- Preserve existing comments, anchors, and overall structure.
- Keep URLs unchanged unless explicitly instructed.
- Do NOT add empty objects (avoid \`with: {}\` and avoid \`someKey: {}\` if the plugin has no settings).
- When adding a new plugin under \`plugins:\`, use the exact plugin key from the catalog when possible.
- If the user says to install/enable/add a plugin and no configuration is specified, add the plugin key with an empty mapping value:
  plugins:
    owner/repo@ref:

The output is validated; if invalid, it will be rejected and retried.`,

      `Target file (${repoUrl}):`,
      originalContent,

      `Plugin catalog (JSON reference; DO NOT output this):`,
      JSON.stringify(catalog, null, 2),
    ].join("\n\n===\n\n");
  }

  async createCompletions(prompt: string, instruction: string, maxRetries = 3): Promise<Answer> {
    let attempts = 0;
    let lastError: string | undefined;
    const baseUrl = normalizeBaseUrl(this._context.config.baseUrl);
    const model = this._context.config.model;

    while (attempts < maxRetries) {
      attempts++;

      const messages = this._buildMessages(prompt, instruction, lastError);

      const response = await callLlm(
        {
          messages,
          max_tokens: 4000,
          temperature: attempts > 1 ? 0.2 : 0,
          ...(baseUrl ? { baseUrl } : {}),
          ...(model ? { model } : {}),
        },
        this._context
      );

      const completionResponse = this._ensureCompletionResponse(response);
      const completion = this._getCompletionText(completionResponse);

      // Validate the YAML output
      const validation = await validateYamlContent(completion, this._context);
      if (validation.isValid) {
        return this._toAnswer(completionResponse, completion, attempts);
      }

      const errorMessage = validation.error ?? "Unknown YAML validation error";
      lastError = errorMessage;
      this._handleInvalidYaml(attempts, maxRetries, errorMessage, completion);
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw this._context.logger.error("Unexpected end of completion generation");
  }
}
