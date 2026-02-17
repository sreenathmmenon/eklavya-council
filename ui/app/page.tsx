'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { StreamChunk, Message, Synthesis, Council } from '../lib/types';

const COUNCILS: Council[] = [
  { id: 'software-architecture', name: 'Software Architecture', description: 'Architecture, tech choices, system design', persona_ids: [], rounds: 2 },
  { id: 'product-strategy', name: 'Product Strategy', description: 'Direction, features, build vs buy', persona_ids: [], rounds: 2 },
  { id: 'career-decision', name: 'Career Decision', description: 'Career moves, pivots, learning investments', persona_ids: [], rounds: 2 },
  { id: 'startup-idea', name: 'Startup Idea', description: 'Evaluate ideas, models, moats', persona_ids: [], rounds: 2 },
  { id: 'deep-debate', name: 'Deep Technical Debate', description: '7 experts, 3 rounds, full analysis', persona_ids: [], rounds: 3 },
  { id: 'personal-decision', name: 'Personal Decision', description: 'Life decisions, priorities, values', persona_ids: [], rounds: 2 },
  { id: 'learning-path', name: 'Learning Path', description: 'What to learn next, skill priorities', persona_ids: [], rounds: 2 },
  { id: 'code-review', name: 'Code Review', description: 'Architecture review, patterns, security', persona_ids: [], rounds: 2 },
];

// Per-persona colour palette — cycles across 8 distinct colours (WCAG AA on dark bg)
const PERSONA_COLORS = [
  'text-yellow-300',
  'text-emerald-300',
  'text-violet-300',
  'text-orange-300',
  'text-sky-300',
  'text-rose-300',
  'text-teal-300',
  'text-amber-300',
];

type SessionState = 'idle' | 'running' | 'done' | 'error';

interface UIMessage extends Message {
  isStreaming?: boolean;
}

export default function Home() {
  const [question, setQuestion]       = useState('');
  const [councilId, setCouncilId]     = useState('software-architecture');
  const [rounds, setRounds]           = useState(2);
  const [state, setState]             = useState<SessionState>('idle');
  const [messages, setMessages]       = useState<UIMessage[]>([]);
  const [synthesis, setSynthesis]     = useState<Synthesis | null>(null);
  const [error, setError]             = useState('');
  const [currentSpeaker, setCurrentSpeaker] = useState('');
  const transcriptRef  = useRef<HTMLDivElement>(null);
  const abortRef       = useRef<AbortController | null>(null);

  // Per-speaker colour assignment
  const speakerColorMap = useRef<Record<string, string>>({});
  const colorIndex = useRef(0);

  function getSpeakerColor(speaker: string): string {
    if (!speakerColorMap.current[speaker]) {
      speakerColorMap.current[speaker] = PERSONA_COLORS[colorIndex.current % PERSONA_COLORS.length];
      colorIndex.current++;
    }
    return speakerColorMap.current[speaker];
  }

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const cancelCouncil = useCallback(() => {
    abortRef.current?.abort();
    setState('idle');
    setCurrentSpeaker('');
  }, []);

  async function runCouncil() {
    if (!question.trim() || state === 'running') return;

    // Reset state
    setState('running');
    setSynthesis(null);
    setMessages([]);
    setError('');
    setCurrentSpeaker('');
    speakerColorMap.current = {};
    colorIndex.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, council_id: councilId, rounds }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Council failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text  = decoder.decode(value);
        const lines = text.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') { setState('done'); break outer; }

          try {
            const chunk: StreamChunk = JSON.parse(data);

            if (chunk.type === 'speaker_start') {
              setCurrentSpeaker(chunk.speaker ?? '');
              setMessages(prev => [...prev, {
                speaker:      chunk.speaker!,
                speaker_role: chunk.speaker_role!,
                content:      '',
                round:        chunk.round!,
                timestamp:    new Date().toISOString(),
                isStreaming:  true,
              }]);
            }

            if (chunk.type === 'token') {
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 && m.isStreaming
                  ? { ...m, content: m.content + chunk.token }
                  : m
              ));
            }

            if (chunk.type === 'synthesis') {
              setSynthesis(chunk.synthesis!);
              setMessages(prev => prev.map(m => ({ ...m, isStreaming: false })));
              setState('done');
              setCurrentSpeaker('');
            }

            if (chunk.type === 'error') {
              throw new Error(chunk.error ?? 'Council error');
            }
          } catch (parseErr) {
            if ((parseErr as Error).message?.includes('Council')) throw parseErr;
            // Skip malformed SSE chunks
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return; // user cancelled
      setError(e.message ?? 'Unknown error');
      setState('error');
    }
  }

  const isModerator = (speaker: string) =>
    speaker === 'Moderator' || speaker.startsWith('MODERATOR');

  const selectedCouncil = COUNCILS.find(c => c.id === councilId);

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto px-4">

      {/* Header */}
      <header className="flex items-center justify-between py-4 border-b border-gray-800" role="banner">
        <div>
          <h1 className="text-xl font-bold text-cyan-400 tracking-wider">EKLAVYA</h1>
          <p className="text-xs text-gray-400">Virtual Council  ·  Multi-Persona LLM Debate</p>
        </div>
        <div className="flex items-center gap-3" aria-live="polite" aria-atomic="true">
          {state === 'running' && (
            <>
              <span className="flex items-center gap-2 text-sm text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" aria-hidden="true" />
                {currentSpeaker ? `${currentSpeaker} speaking…` : 'Council in session…'}
              </span>
              <button
                onClick={cancelCouncil}
                className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:border-red-500 hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-label="Cancel council session"
              >
                Cancel
              </button>
            </>
          )}
          {state === 'done' && (
            <span className="text-sm text-green-400" role="status">✓ Session complete</span>
          )}
          {state === 'error' && (
            <span className="text-sm text-red-400" role="alert">Session failed</span>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 gap-4 overflow-hidden py-4">

        {/* Left: Controls */}
        <aside className="w-64 flex-shrink-0 flex flex-col gap-4" aria-label="Council controls">

          {/* Question */}
          <div>
            <label htmlFor="question-input" className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
              Question
            </label>
            <textarea
              id="question-input"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
              rows={4}
              placeholder="Should we migrate to microservices?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              disabled={state === 'running'}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && runCouncil()}
              aria-describedby="question-hint"
            />
            <p id="question-hint" className="text-xs text-gray-500 mt-1">⌘ + Enter to run</p>
          </div>

          {/* Council selector */}
          <div>
            <label htmlFor="council-select" className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
              Council
            </label>
            <select
              id="council-select"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              value={councilId}
              onChange={e => setCouncilId(e.target.value)}
              disabled={state === 'running'}
            >
              {COUNCILS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {selectedCouncil && (
              <p className="text-xs text-gray-500 mt-1" aria-live="polite">
                {selectedCouncil.description}
              </p>
            )}
          </div>

          {/* Rounds */}
          <div>
            <label htmlFor="rounds-slider" className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
              Rounds: {rounds}
            </label>
            <input
              id="rounds-slider"
              type="range" min={1} max={3} value={rounds}
              onChange={e => setRounds(Number(e.target.value))}
              disabled={state === 'running'}
              className="w-full accent-cyan-500"
              aria-valuemin={1} aria-valuemax={3} aria-valuenow={rounds}
              aria-label={`Debate rounds: ${rounds}`}
            />
            <div className="flex justify-between text-xs text-gray-500" aria-hidden="true">
              <span>1 (quick)</span><span>3 (deep)</span>
            </div>
          </div>

          {/* Run / Cancel button */}
          <button
            onClick={state === 'running' ? cancelCouncil : runCouncil}
            disabled={state !== 'running' && !question.trim()}
            className={`w-full py-2.5 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 ${
              state === 'running'
                ? 'bg-red-800 hover:bg-red-700 text-white cursor-pointer focus:ring-red-600'
                : !question.trim()
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-cyan-700 hover:bg-cyan-600 text-white cursor-pointer focus:ring-cyan-500'
            }`}
            aria-label={state === 'running' ? 'Cancel council session' : 'Convene council'}
          >
            {state === 'running' ? 'Cancel Session' : 'Convene Council'}
          </button>

          {state !== 'idle' && (
            <button
              onClick={() => { setState('idle'); setMessages([]); setSynthesis(null); setError(''); setQuestion(''); }}
              className="w-full py-2 rounded text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 transition-colors focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              New Session
            </button>
          )}

          {/* Disclaimer */}
          <p className="text-xs text-gray-600 leading-relaxed mt-auto">
            Personas are AI archetypes. Output is a thinking tool — not professional advice.
          </p>
        </aside>

        {/* Right: Transcript */}
        <main className="flex-1 flex flex-col overflow-hidden" aria-label="Council transcript">

          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto space-y-4 pr-1"
            aria-live="polite"
            aria-label="Council messages"
            role="log"
          >
            {messages.length === 0 && state === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-gray-400 text-sm max-w-xs leading-relaxed">
                  Eklavya convenes a council of expert AI personas to debate your question from multiple perspectives.
                </p>
                <p className="text-gray-500 text-xs mt-4">
                  Enter a question and select a council to begin.
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              const mod = isModerator(msg.speaker);
              const speakerColor = mod ? 'text-cyan-400' : getSpeakerColor(msg.speaker);
              return (
                <article
                  key={i}
                  className={`rounded-lg p-4 ${mod
                    ? 'bg-cyan-950/30 border border-cyan-900/40'
                    : 'bg-gray-900 border border-gray-800'
                  }`}
                  aria-label={`${msg.speaker}: Round ${msg.round}`}
                >
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`text-sm font-bold ${speakerColor}`}>{msg.speaker}</span>
                    <span className="text-xs text-gray-500">{msg.speaker_role}</span>
                    <span className="text-xs text-gray-600 ml-auto" aria-label={`Round ${msg.round}`}>R{msg.round}</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {msg.content || (msg.isStreaming ? <span className="animate-pulse">▋</span> : '…')}
                  </p>
                </article>
              );
            })}

            {error && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-4" role="alert">
                <p className="text-sm text-red-400">✗ {error}</p>
                <p className="text-xs text-gray-400 mt-1">Check your API key configuration.</p>
              </div>
            )}
          </div>

          {/* Synthesis panel */}
          {synthesis && (
            <section
              className="mt-4 bg-green-950/20 border border-green-900/30 rounded-lg p-4 flex-shrink-0"
              aria-label="Session synthesis"
            >
              <h2 className="text-sm font-bold text-green-400 mb-3">SYNTHESIS</h2>

              {synthesis.summary && (
                <p className="text-sm text-gray-300 mb-3 italic">{synthesis.summary}</p>
              )}

              <div className="grid grid-cols-2 gap-4 text-xs">
                {synthesis.decisions.length > 0 && (
                  <div>
                    <p className="text-green-400 font-medium mb-1">✓ Decisions</p>
                    {synthesis.decisions.map((d, i) => (
                      <p key={i} className="text-gray-300 mb-1">{i + 1}. {d}</p>
                    ))}
                  </div>
                )}
                {synthesis.actions.length > 0 && (
                  <div>
                    <p className="text-gray-200 font-medium mb-1">→ Actions</p>
                    {synthesis.actions.map((a, i) => (
                      <p key={i} className="text-gray-300 mb-1">{i + 1}. {a}</p>
                    ))}
                  </div>
                )}
                {synthesis.dissent.length > 0 && (
                  <div>
                    <p className="text-yellow-300 font-medium mb-1">⚡ Dissent</p>
                    {synthesis.dissent.map((d, i) => (
                      <p key={i} className="text-gray-300 mb-1">· {d}</p>
                    ))}
                  </div>
                )}
                {synthesis.open_questions.length > 0 && (
                  <div>
                    <p className="text-cyan-400 font-medium mb-1">? Open Questions</p>
                    {synthesis.open_questions.map((q, i) => (
                      <p key={i} className="text-gray-300 mb-1">· {q}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-gray-500">
                  Confidence:{' '}
                  <span className={
                    synthesis.confidence === 'high' ? 'text-green-400' :
                    synthesis.confidence === 'medium' ? 'text-yellow-300' : 'text-red-400'
                  }>
                    {synthesis.confidence.toUpperCase()}
                  </span>
                </p>
                <p className="text-xs text-gray-600 italic">
                  Thinking tool · not professional advice
                </p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
