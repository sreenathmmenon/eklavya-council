/**
 * Provider Abstraction Layer
 * Unified streaming interface for Anthropic, OpenAI, and Google Gemini.
 * Each persona can be assigned to any provider — or all share one.
 */

import { EklavyaConfig, LLMRequest, ProviderName, StreamCallback } from './types.js';

// ─── Anthropic ───────────────────────────────────────────────────────────────

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

// ─── OpenAI ──────────────────────────────────────────────────────────────────

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

async function streamGoogle(
  request: LLMRequest,
  apiKey: string,
  model: string,
  onToken: StreamCallback
): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({ model });

  const prompt = `${request.system}\n\n${request.user}`;
  const result = await genModel.generateContentStream(prompt);

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

// ─── Non-streaming fallback (collect then return) ────────────────────────────

async function collectAnthropic(
  request: LLMRequest,
  apiKey: string,
  model: string
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: request.max_tokens ?? 400,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
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
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

// ─── Unified Call ────────────────────────────────────────────────────────────

export async function callProvider(
  request: LLMRequest,
  provider: ProviderName,
  config: EklavyaConfig,
  personaModel: string | undefined,
  onToken: StreamCallback | null
): Promise<string> {
  const providerConfig = config.providers[provider];
  if (!providerConfig?.api_key) {
    throw new Error(`No API key configured for provider: ${provider}`);
  }

  const apiKey = providerConfig.api_key;
  const model = personaModel ?? providerConfig.default_model;
  const streaming = onToken !== null && config.stream;

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
      case 'google': {
        let buf = '';
        await streamGoogle(request, apiKey, model, (t) => { buf += t; });
        return buf;
      }
    }
  }

  return '';
}
