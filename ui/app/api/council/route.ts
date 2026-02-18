/**
 * POST /api/council
 * Runs a council session and streams output via SSE (Server-Sent Events).
 *
 * Note: This API route requires the CLI package's orchestrator to be importable.
 * For standalone UI deployment, install the CLI package or configure the API to
 * call a separately running eklavya server.
 *
 * Request body: { question: string, council_id: string, rounds: number }
 * Response: text/event-stream with StreamChunk JSON lines
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Normalise errors from the Anthropic SDK (and others) into a human-readable string.
// The SDK sometimes sets e.message to the raw JSON response body, e.g.:
//   {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"..."}
function extractErrorMessage(e: any): string {
  const FRIENDLY: Record<string, string> = {
    overloaded_error : 'The AI service is temporarily overloaded. Please wait a moment and try again.',
    rate_limit_error : 'Rate limit reached. Please wait a moment and try again.',
    authentication_error: 'API key is invalid or not configured. Check your environment variables.',
    invalid_request_error: 'Invalid request sent to the AI provider.',
  };

  // Anthropic SDK typed errors expose .error (the parsed response body)
  const sdkBody = e?.error;
  if (sdkBody && typeof sdkBody === 'object') {
    const errType = (sdkBody as any)?.error?.type ?? (sdkBody as any)?.type;
    if (errType && FRIENDLY[errType]) return FRIENDLY[errType];
    const errMsg = (sdkBody as any)?.error?.message ?? (sdkBody as any)?.message;
    if (errMsg) return String(errMsg);
  }

  // e.message may be the raw JSON body (seen in some SDK versions on serverless)
  const msg = e?.message;
  if (typeof msg === 'string') {
    try {
      const parsed = JSON.parse(msg);
      const errType = parsed?.error?.type ?? parsed?.type;
      if (errType && FRIENDLY[errType]) return FRIENDLY[errType];
      const errMsg = parsed?.error?.message ?? parsed?.message;
      if (errMsg) return String(errMsg);
    } catch {
      // not JSON — return as-is (but strip any internal CLI hints)
      return msg.replace(/Run: eklavya \w+/g, '').trim() || 'Council error.';
    }
  }

  return 'An unexpected error occurred. Please try again.';
}

export const maxDuration = 300; // 5 minutes max

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { question, council_id, rounds, userContext } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: 'Question is required' }, { status: 400 });
  }

  // Note: API key validation is handled inside the stream by loadConfig() + getActiveProvider().
  // loadConfig() reads from BOTH process.env vars AND ~/.eklavya/config.json (set via `eklavya init`),
  // so we must not short-circuit here with an env-only check.

  // Create SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object | string) {
        const line = `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      }

      try {
        // Dynamic import to avoid bundling issues
        const { runCouncilStream } = await import('../../../src/orchestrator-stream');
        const { loadConfig } = await import('../../../src/config');
        const { getCouncil } = await import('../../../src/data/councils');

        const config = loadConfig();
        const council = getCouncil(council_id ?? 'software-architecture');
        if (rounds) council.rounds = Math.min(3, Math.max(1, Number(rounds)));

        const ctx = typeof userContext === 'string' && userContext.trim() ? userContext.trim() : undefined;
        await runCouncilStream(question, council, config, (chunk) => {
          send(chunk);
        }, undefined, ctx);

        send('[DONE]');
      } catch (e: any) {
        send({ type: 'error', error: extractErrorMessage(e) });
        send('[DONE]');
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
