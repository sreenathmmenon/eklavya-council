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
export const maxDuration = 300; // 5 minutes max

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { question, council_id, rounds } = body;

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
        const { runCouncilStream } = await import('../../../../src/orchestrator-stream');
        const { loadConfig } = await import('../../../../src/config');
        const { getCouncil } = await import('../../../../src/data/councils');

        const config = loadConfig();
        const council = getCouncil(council_id ?? 'software-architecture');
        if (rounds) council.rounds = Math.min(3, Math.max(1, Number(rounds)));

        await runCouncilStream(question, council, config, (chunk) => {
          send(chunk);
        });

        send('[DONE]');
      } catch (e: any) {
        send({ type: 'error', error: e.message ?? 'Internal error' });
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
