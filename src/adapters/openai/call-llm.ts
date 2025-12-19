import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export type LlmCallOptions = {
  baseUrl?: string;
  model?: string;
  stream?: boolean;
  messages: ChatCompletionMessageParam[];
} & Partial<Omit<ChatCompletionCreateParamsNonStreaming, "model" | "messages" | "stream">>;

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function getEnvString(name: string): string {
  if (typeof process === "undefined" || !process?.env) return "";
  return String(process.env[name] ?? "").trim();
}

function getAiBaseUrl(options: LlmCallOptions): string {
  if (typeof options.baseUrl === "string" && options.baseUrl.trim()) {
    return normalizeBaseUrl(options.baseUrl);
  }

  const envBaseUrl = getEnvString("UBQ_AI_BASE_URL") || getEnvString("UBQ_AI_URL");
  if (envBaseUrl) return normalizeBaseUrl(envBaseUrl);

  return "https://ai.ubq.fi";
}

function getAiFallbackBaseUrl(options: LlmCallOptions): string | null {
  const envFallback = getEnvString("UBQ_AI_FALLBACK_BASE_URL") || getEnvString("UBQ_AI_FALLBACK_URL");
  if (envFallback) return normalizeBaseUrl(envFallback);

  const primary = getAiBaseUrl(options);
  const defaultFallback = "https://ai-ubq-fi.deno.dev";
  return primary === defaultFallback ? null : defaultFallback;
}

type KernelAuthedContext = {
  authToken?: string;
  ubiquityKernelToken?: string;
  payload?: unknown;
  eventPayload?: unknown;
};

async function postToFirstHealthyUrl(urls: string[], init: RequestInit): Promise<Response> {
  let lastHttpStatus: number | null = null;
  let lastHttpBody: string | null = null;
  let lastNetworkError: string | null = null;

  for (const url of urls) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastNetworkError = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (response.ok) return response;

    lastHttpStatus = response.status;
    lastHttpBody = await response.text();

    const shouldTryFallback = response.status >= 500 || response.status === 403;
    if (!shouldTryFallback) break;
  }

  if (lastHttpStatus !== null) {
    throw new Error(`LLM API error: ${lastHttpStatus} - ${lastHttpBody ?? ""}`);
  }
  throw new Error(`LLM API error: ${lastNetworkError ?? "Unknown error"}`);
}

export async function callLlm(options: LlmCallOptions, context: KernelAuthedContext): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  const authToken = String(context.authToken ?? "").trim();
  const payload = (context.payload ?? context.eventPayload) as unknown as {
    repository?: { owner?: { login?: string }; name?: string };
    installation?: { id?: number };
  };

  const owner = payload?.repository?.owner?.login ?? "";
  const repo = payload?.repository?.name ?? "";
  const installationId = payload?.installation?.id;

  if (!authToken) throw new Error("Missing authToken in inputs");

  const ubiquityKernelToken = context.ubiquityKernelToken;

  const { baseUrl, model, stream: isStream, messages, ...rest } = options;
  const url = `${getAiBaseUrl({ ...options, baseUrl })}/v1/chat/completions`;
  const body = JSON.stringify({
    ...rest,
    ...(model ? { model } : {}),
    messages,
    stream: isStream ?? false,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  if (owner) headers["X-GitHub-Owner"] = owner;
  if (repo) headers["X-GitHub-Repo"] = repo;
  if (typeof installationId === "number" && Number.isFinite(installationId)) {
    headers["X-GitHub-Installation-Id"] = String(installationId);
  }
  if (ubiquityKernelToken) {
    headers["X-Ubiquity-Kernel-Token"] = ubiquityKernelToken;
  }

  const fallbackBaseUrl = getAiFallbackBaseUrl({ ...options, baseUrl });
  const urlsToTry = [url, ...(fallbackBaseUrl ? [`${fallbackBaseUrl}/v1/chat/completions`] : [])];

  const response = await postToFirstHealthyUrl(urlsToTry, { method: "POST", headers, body });

  if (isStream) {
    if (!response.body) {
      throw new Error("LLM API error: missing response body for streaming request");
    }
    return parseSseStream(response.body);
  }
  return response.json();
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done: isDone } = await reader.read();
      if (isDone) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (!event.startsWith("data: ")) continue;
        const data = event.slice(6);
        if (data === "[DONE]") return;
        yield JSON.parse(data) as ChatCompletionChunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
