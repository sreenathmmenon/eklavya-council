/**
 * Provider Abstraction Layer
 * Unified streaming interface for Anthropic, OpenAI, and Google Gemini.
 * Each persona can be assigned to any provider — or all share one.
 */

import { EklavyaConfig, LLMRequest, ProviderName, StreamCallback } from './types.js';

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function streamAnthropic(
  request: LLMRequest,
  apiKey: string,
  model: string,
  onToken: StreamCallback
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  let full = '';
  const stream = await client.messages.stream({
    model,
    max_tokens: request.max_tokens ?? 400,
    temperature: request.temperature ?? 0.8,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      onToken(event.delta.text);
      full += event.delta.text;
    }
  }

  return full;
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function streamOpenAI(
  request: LLMRequest,
  apiKey: string,
  model: string,
  onToken: StreamCallback
): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });

  let full = '';
  const stream = await client.chat.completions.create({
    model,
    max_tokens: request.max_tokens ?? 400,
    temperature: request.temperature ?? 0.8,
    stream: true,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? '';
    if (token) {
      onToken(token);
      full += token;
    }
  }

  return full;
}

// ─── Google Gemini ────────────────────────────────────────────────────────────
// Uses systemInstruction properly (not concatenated into user prompt)

async function streamGoogle(
  request: LLMRequest,
  apiKey: string,
  model: string,
  onToken: StreamCallback
): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(apiKey);

  // Pass system prompt via systemInstruction — never concatenate with user content
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: request.system,
  });

  const result = await genModel.generateContentStream(request.user);

  let full = '';
  for await (const chunk of result.stream) {
    const token = chunk.text();
    if (token) {
      onToken(token);
      full += token;
    }
  }

  return full;
}

// ─── Non-streaming (for synthesis JSON) ──────────────────────────────────────

async function collectAnthropic(
  request: LLMRequest,
  apiKey: string,
  model: string
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  // Assistant prefill forces the model to continue from a given string.
  // Used for synthesis to guarantee JSON output: prefill='{' means the
  // model cannot deviate — it must complete the JSON object.
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: request.user },
  ];
  if (request.prefill) {
    messages.push({ role: 'assistant', content: request.prefill });
  }

  const response = await client.messages.create({
    model,
    max_tokens: request.max_tokens ?? 400,
    temperature: request.temperature ?? 0.3,
    system: request.system,
    messages,
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  // If we used a prefill, prepend it back — the API returns only the continuation
  return request.prefill ? request.prefill + text : text;
}

async function collectOpenAI(
  request: LLMRequest,
  apiKey: string,
  model: string
): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    max_tokens: request.max_tokens ?? 400,
    temperature: request.temperature ?? 0.3,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

async function collectGoogle(
  request: LLMRequest,
  apiKey: string,
  model: string
): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: request.system,
  });

  const result = await genModel.generateContent(request.user);
  return result.response.text();
}

// ─── Unified Call with Retry ──────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('overload') || msg.includes('529') ||
         msg.includes('rate_limit') || msg.includes('429') ||
         msg.includes('timeout') || msg.includes('econnreset');
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && isRetryable(err)) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } else if (attempt < retries && !isRetryable(err)) {
        throw err; // non-retryable errors (auth, bad request) — fail fast
      }
    }
  }
  throw lastError;
}

export async function callProvider(
  request: LLMRequest,
  provider: ProviderName,
  config: EklavyaConfig,
  personaModel: string | undefined,
  onToken: StreamCallback | null
): Promise<string> {
  const providerConfig = config.providers[provider];
  if (!providerConfig?.api_key) {
    throw new Error(`No API key configured for provider: ${provider}. Set the corresponding environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY).`);
  }

  const apiKey = providerConfig.api_key;
  const model = personaModel ?? providerConfig.default_model;
  const streaming = onToken !== null && config.stream;

  return withRetry(async () => {
    if (streaming) {
      switch (provider) {
        case 'anthropic': return streamAnthropic(request, apiKey, model, onToken!);
        case 'openai':    return streamOpenAI(request, apiKey, model, onToken!);
        case 'google':    return streamGoogle(request, apiKey, model, onToken!);
      }
    } else {
      switch (provider) {
        case 'anthropic': return collectAnthropic(request, apiKey, model);
        case 'openai':    return collectOpenAI(request, apiKey, model);
        case 'google':    return collectGoogle(request, apiKey, model);
      }
    }
    return '';
  });
}
