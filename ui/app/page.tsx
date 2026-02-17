'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { StreamChunk, Message, Synthesis, Council } from '../lib/types';

// ─── Council list ─────────────────────────────────────────────────────────────
const COUNCILS: Council[] = [
  { id: 'software-architecture', name: 'Software Architecture',   description: 'Architecture, tech choices, system design',    persona_ids: [], rounds: 2 },
  { id: 'product-strategy',      name: 'Product Strategy',        description: 'Direction, features, build vs buy',             persona_ids: [], rounds: 2 },
  { id: 'career-decision',       name: 'Career Decision',         description: 'Career moves, pivots, learning investments',    persona_ids: [], rounds: 2 },
  { id: 'startup-idea',          name: 'Startup Idea',            description: 'Evaluate ideas, models, moats',                 persona_ids: [], rounds: 2 },
  { id: 'deep-debate',           name: 'Deep Technical Debate',   description: '7 experts · 3 rounds · full analysis',         persona_ids: [], rounds: 3 },
  { id: 'personal-decision',     name: 'Personal Decision',       description: 'Life decisions, priorities, values',            persona_ids: [], rounds: 2 },
  { id: 'learning-path',         name: 'Learning Path',           description: 'What to learn next, skill priorities',         persona_ids: [], rounds: 2 },
  { id: 'code-review',           name: 'Code Review',             description: 'Architecture review, patterns, security',      persona_ids: [], rounds: 2 },
];

// ─── Per-persona theme (all class names written as full literals for Tailwind JIT) ──
interface PersonaTheme {
  text:    string;  // speaker name colour
  borderL: string;  // left border on active card  (border-l-{colour})
  bg:      string;  // card bg tint while streaming
  dot:     string;  // roster status dot           (bg-{colour})
  avatar:  string;  // avatar circle bg            (bg-{colour})
}

const PERSONA_THEMES: PersonaTheme[] = [
  { text: 'text-yellow-300',  borderL: 'border-l-yellow-400',  bg: 'bg-yellow-950/20',  dot: 'bg-yellow-400',  avatar: 'bg-yellow-900'  },
  { text: 'text-emerald-300', borderL: 'border-l-emerald-400', bg: 'bg-emerald-950/20', dot: 'bg-emerald-400', avatar: 'bg-emerald-900' },
  { text: 'text-violet-300',  borderL: 'border-l-violet-400',  bg: 'bg-violet-950/20',  dot: 'bg-violet-400',  avatar: 'bg-violet-900'  },
  { text: 'text-orange-300',  borderL: 'border-l-orange-400',  bg: 'bg-orange-950/20',  dot: 'bg-orange-400',  avatar: 'bg-orange-900'  },
  { text: 'text-sky-300',     borderL: 'border-l-sky-400',     bg: 'bg-sky-950/20',     dot: 'bg-sky-400',     avatar: 'bg-sky-900'     },
  { text: 'text-rose-300',    borderL: 'border-l-rose-400',    bg: 'bg-rose-950/20',    dot: 'bg-rose-400',    avatar: 'bg-rose-900'    },
  { text: 'text-teal-300',    borderL: 'border-l-teal-400',    bg: 'bg-teal-950/20',    dot: 'bg-teal-400',    avatar: 'bg-teal-900'    },
  { text: 'text-amber-300',   borderL: 'border-l-amber-400',   bg: 'bg-amber-950/20',   dot: 'bg-amber-400',   avatar: 'bg-amber-900'   },
];

// Moderator always gets cyan — distinct from all persona colours
const MODERATOR_THEME: PersonaTheme = {
  text:    'text-cyan-400',
  borderL: 'border-l-cyan-400',
  bg:      'bg-cyan-950/20',
  dot:     'bg-cyan-400',
  avatar:  'bg-cyan-900',
};

// ─── Types ────────────────────────────────────────────────────────────────────
type SessionState = 'idle' | 'running' | 'done' | 'error';

interface UIMessage extends Message {
  isStreaming?: boolean;
}

interface RosterEntry {
  name:       string;
  role:       string;
  themeIndex: number;   // -1 = moderator, 0-7 = persona theme index
  status:     'speaking' | 'done';
}

// ─── Small components ─────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, theme }: { name: string; theme: PersonaTheme }) {
  return (
    <span
      className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold select-none ${theme.avatar} ${theme.text}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}

function RoundBanner({ round }: { round: number }) {
  const label =
    round === 0  ? 'Opening Statement' :
    round === -1 ? 'Synthesis'         :
    `Round ${round}`;

  return (
    <div className="flex items-center gap-3 my-4" role="separator" aria-label={label}>
      <div className="flex-1 h-px bg-gray-800" />
      <span className="text-xs text-gray-600 font-medium tracking-[0.2em] uppercase px-1">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-800" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Home() {
  const [question, setQuestion]           = useState('');
  const [councilId, setCouncilId]         = useState('software-architecture');
  const [rounds, setRounds]               = useState(2);
  const [state, setState]                 = useState<SessionState>('idle');
  const [messages, setMessages]           = useState<UIMessage[]>([]);
  const [synthesis, setSynthesis]         = useState<Synthesis | null>(null);
  const [error, setError]                 = useState('');
  const [currentSpeaker, setCurrentSpeaker] = useState('');
  const [roster, setRoster]               = useState<RosterEntry[]>([]);
  const [sessionQuestion, setSessionQuestion] = useState('');

  const transcriptRef   = useRef<HTMLDivElement>(null);
  const abortRef        = useRef<AbortController | null>(null);
  const speakerThemeMap = useRef<Record<string, number>>({});  // name → theme index
  const themeCounter    = useRef(0);

  // ── Theme helpers ────────────────────────────────────────────────────────
  const isModeratorSpeaker = (name: string) =>
    name === 'Moderator' || name.startsWith('MODERATOR');

  function getTheme(speaker: string): PersonaTheme {
    if (isModeratorSpeaker(speaker)) return MODERATOR_THEME;
    if (speakerThemeMap.current[speaker] === undefined) {
      speakerThemeMap.current[speaker] = themeCounter.current % PERSONA_THEMES.length;
      themeCounter.current++;
    }
    return PERSONA_THEMES[speakerThemeMap.current[speaker]];
  }

  function getThemeIndex(speaker: string): number {
    return isModeratorSpeaker(speaker) ? -1 : (speakerThemeMap.current[speaker] ?? 0);
  }

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, synthesis]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const cancelCouncil = useCallback(() => {
    abortRef.current?.abort();
    setState('idle');
    setCurrentSpeaker('');
  }, []);

  // ── Main session runner ──────────────────────────────────────────────────
  async function runCouncil() {
    if (!question.trim() || state === 'running') return;

    const q = question.trim();
    setState('running');
    setSynthesis(null);
    setMessages([]);
    setError('');
    setCurrentSpeaker('');
    setRoster([]);
    setSessionQuestion(q);
    speakerThemeMap.current = {};
    themeCounter.current    = 0;

    const controller  = new AbortController();
    abortRef.current  = controller;

    try {
      const response = await fetch('/api/council', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q, council_id: councilId, rounds }),
        signal:  controller.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Council failed');
      }

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder
          .decode(value)
          .split('\n')
          .filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') { setState('done'); break outer; }

          try {
            const chunk: StreamChunk = JSON.parse(data);

            // ── error chunk from server ───────────────────────────────────
            if (chunk.type === 'error') {
              throw new Error(chunk.error ?? 'Council error');
            }

            // ── speaker_start: new persona takes the floor ───────────────
            if (chunk.type === 'speaker_start') {
              const spk  = chunk.speaker!;
              const role = chunk.speaker_role!;

              // Assign theme now (side-effect: populates speakerThemeMap)
              getTheme(spk);
              const themeIdx = getThemeIndex(spk);

              setCurrentSpeaker(spk);

              // Roster: mark previous speaker done, add/activate new one
              setRoster(prev => {
                const updated = prev.map(r =>
                  r.status === 'speaking' ? { ...r, status: 'done' as const } : r
                );
                const exists = updated.find(r => r.name === spk);
                if (exists) {
                  return updated.map(r => r.name === spk ? { ...r, status: 'speaking' } : r);
                }
                return [...updated, { name: spk, role, themeIndex: themeIdx, status: 'speaking' }];
              });

              // Messages: close previous streaming card, open new one
              setMessages(prev => [
                ...prev.map(m => ({ ...m, isStreaming: false })),
                {
                  speaker:      spk,
                  speaker_role: role,
                  content:      '',
                  round:        chunk.round!,
                  timestamp:    new Date().toISOString(),
                  isStreaming:  true,
                },
              ]);
            }

            // ── token: append to active card ─────────────────────────────
            if (chunk.type === 'token') {
              setMessages(prev =>
                prev.map((m, i) =>
                  i === prev.length - 1 && m.isStreaming
                    ? { ...m, content: m.content + chunk.token }
                    : m
                )
              );
            }

            // ── synthesis: final verdict ──────────────────────────────────
            if (chunk.type === 'synthesis') {
              setSynthesis(chunk.synthesis!);
              setMessages(prev => prev.map(m => ({ ...m, isStreaming: false })));
              setRoster(prev => prev.map(r => ({ ...r, status: 'done' as const })));
              setState('done');
              setCurrentSpeaker('');
            }
          } catch (parseErr) {
            // Re-throw application errors; only swallow JSON SyntaxErrors
            // (malformed/partial SSE frames are safe to skip, real errors are not)
            if (!(parseErr instanceof SyntaxError)) throw parseErr;
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setError(e.message ?? 'Unknown error');
      setState('error');
    }
  }

  // ── Build render list: messages interleaved with round banners ───────────
  type RenderItem =
    | { kind: 'banner';  round: number; key: string }
    | { kind: 'message'; msg: UIMessage; index: number };

  const renderItems: RenderItem[] = [];
  let lastRound = -99;
  messages.forEach((msg, i) => {
    if (msg.round !== lastRound) {
      renderItems.push({ kind: 'banner', round: msg.round, key: `banner-r${msg.round}-i${i}` });
      lastRound = msg.round;
    }
    renderItems.push({ kind: 'message', msg, index: i });
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const selectedCouncil       = COUNCILS.find(c => c.id === councilId);
  const currentSpeakerTheme   = currentSpeaker ? getTheme(currentSpeaker) : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 max-w-6xl mx-auto px-4">

      {/* ── Header ── */}
      <header
        className="flex items-center justify-between py-3 border-b border-gray-800/80 flex-shrink-0"
        role="banner"
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-cyan-400 tracking-[0.25em]">EKLAVYA</h1>
          <span className="text-xs text-gray-600 hidden sm:inline">
            Virtual Council · Multi-Persona AI Debate
          </span>
        </div>

        {/* Live status */}
        <div
          className="flex items-center gap-3"
          aria-live="polite"
          aria-atomic="true"
        >
          {state === 'running' && currentSpeaker && currentSpeakerTheme && (
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSpeakerTheme.dot} animate-pulse`}
                aria-hidden="true"
              />
              <span className={`text-sm font-medium ${currentSpeakerTheme.text}`}>
                {currentSpeaker}
              </span>
              <span className="text-xs text-gray-500">is speaking</span>
            </div>
          )}
          {state === 'running' && !currentSpeaker && (
            <span className="text-xs text-gray-500 animate-pulse">Convening…</span>
          )}
          {state === 'done' && (
            <span className="text-sm text-green-400" role="status">✓ Complete</span>
          )}
          {state === 'error' && (
            <span className="text-sm text-red-400" role="alert">Failed</span>
          )}
          {state === 'running' && (
            <button
              onClick={cancelCouncil}
              className="px-3 py-1 text-xs text-gray-400 border border-gray-700 rounded hover:border-red-600 hover:text-red-400 transition-colors focus:outline-none focus:ring-1 focus:ring-red-600"
            >
              Cancel
            </button>
          )}
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-1 gap-5 overflow-hidden py-4">

        {/* ── Sidebar ── */}
        <aside
          className="w-56 flex-shrink-0 flex flex-col overflow-hidden"
          aria-label="Council controls"
        >
          {/* Controls — fixed, never shrink */}
          <div className="flex flex-col gap-4 flex-shrink-0">

            {/* Question */}
            <div>
              <label
                htmlFor="question-input"
                className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block"
              >
                Question
              </label>
              <textarea
                id="question-input"
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-800 resize-none transition-colors"
                rows={4}
                placeholder="Should we migrate to microservices?"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                disabled={state === 'running'}
                onKeyDown={e => e.key === 'Enter' && e.metaKey && runCouncil()}
                aria-describedby="question-hint"
              />
              <p id="question-hint" className="text-xs text-gray-700 mt-1">⌘↩ to run</p>
            </div>

            {/* Council */}
            <div>
              <label
                htmlFor="council-select"
                className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block"
              >
                Council
              </label>
              <select
                id="council-select"
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-800"
                value={councilId}
                onChange={e => setCouncilId(e.target.value)}
                disabled={state === 'running'}
              >
                {COUNCILS.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {selectedCouncil && (
                <p className="text-xs text-gray-600 mt-1 leading-snug" aria-live="polite">
                  {selectedCouncil.description}
                </p>
              )}
            </div>

            {/* Rounds */}
            <div>
              <label
                htmlFor="rounds-slider"
                className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block"
              >
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
              <div className="flex justify-between text-xs text-gray-600 mt-0.5" aria-hidden="true">
                <span>Quick</span><span>Deep</span>
              </div>
            </div>

            {/* Primary button */}
            <button
              onClick={state === 'running' ? cancelCouncil : runCouncil}
              disabled={state !== 'running' && !question.trim()}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-950 ${
                state === 'running'
                  ? 'bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-900 focus:ring-red-700'
                  : !question.trim()
                    ? 'bg-gray-900 text-gray-600 cursor-not-allowed border border-gray-800'
                    : 'bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-900 cursor-pointer focus:ring-cyan-700'
              }`}
              aria-label={state === 'running' ? 'Cancel council session' : 'Convene council'}
            >
              {state === 'running' ? '✕ Cancel Session' : 'Convene Council →'}
            </button>

            {/* New session */}
            {state !== 'idle' && (
              <button
                onClick={() => {
                  setState('idle');
                  setMessages([]);
                  setSynthesis(null);
                  setError('');
                  setRoster([]);
                  setSessionQuestion('');
                }}
                className="w-full py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-gray-600"
              >
                ↺ New Session
              </button>
            )}
          </div>

          {/* ── Live Roster — scrollable, fills remaining space ── */}
          {roster.length > 0 && (
            <div className="mt-4 flex-1 min-h-0 flex flex-col overflow-hidden border-t border-gray-800/60 pt-3">
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-2.5 flex-shrink-0">
                In Session
              </p>
              <ul
                className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1"
                aria-label="Council members in session"
              >
                {roster.map(entry => {
                  const theme    = entry.themeIndex === -1
                    ? MODERATOR_THEME
                    : PERSONA_THEMES[entry.themeIndex];
                  const speaking = entry.status === 'speaking';
                  return (
                    <li key={entry.name} className="flex items-start gap-2">
                      {/* Status dot — aligned with first text line */}
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          speaking ? `${theme.dot} animate-pulse` : 'bg-gray-700'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <span
                          className={`text-xs block leading-tight font-medium truncate ${
                            speaking ? theme.text : 'text-gray-500'
                          }`}
                        >
                          {entry.name}
                        </span>
                        <span className="text-xs text-gray-700 block leading-tight truncate mt-0.5">
                          {entry.role}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Disclaimer — always pinned to bottom */}
          <p className="text-xs text-gray-700 leading-relaxed flex-shrink-0 mt-4 pt-3 border-t border-gray-800/40">
            AI archetypes · thinking tool · not advice
          </p>
        </aside>

        {/* ── Transcript ── */}
        <main
          className="flex-1 flex flex-col min-h-0"
          aria-label="Council transcript"
        >
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto space-y-0 pr-1"
            aria-live="polite"
            aria-label="Council messages"
            role="log"
          >

            {/* ── Empty / idle state ── */}
            {messages.length === 0 && state === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                <div className="text-5xl text-gray-800 font-light select-none">⊕</div>
                <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
                  Convene a council of expert AI personas to debate your question from
                  multiple angles — skeptic, pragmatist, visionary, and more.
                </p>
                <p className="text-gray-600 text-xs">
                  Select a council · enter your question · Convene
                </p>
              </div>
            )}

            {/* ── Convening: waiting for first LLM response ── */}
            {messages.length === 0 && state === 'running' && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-gray-500 text-sm">Convening council…</p>
                <p className="text-gray-700 text-xs">Moderator is opening the session</p>
              </div>
            )}

            {/* ── Question brief at top of transcript ── */}
            {sessionQuestion && messages.length > 0 && (
              <div className="mb-2 px-4 py-3 rounded-lg bg-gray-900/50 border border-gray-800/60">
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Before the council
                </p>
                <p className="text-sm text-gray-200 leading-relaxed">
                  &ldquo;{sessionQuestion}&rdquo;
                </p>
              </div>
            )}

            {/* ── Messages + Round banners ── */}
            {renderItems.map(item => {
              if (item.kind === 'banner') {
                return <RoundBanner key={item.key} round={item.round} />;
              }

              const { msg } = item;
              const theme   = getTheme(msg.speaker);
              const active  = msg.isStreaming ?? false;

              return (
                <article
                  key={item.index}
                  className={`rounded-lg px-4 py-3 mb-2 border-l-2 transition-colors duration-200 ${
                    active
                      ? `${theme.bg} ${theme.borderL} border border-r border-t border-b border-gray-800/20`
                      : 'bg-gray-900/30 border-l-gray-800/40 border border-gray-800/30'
                  }`}
                  aria-label={`${msg.speaker}: ${
                    msg.round === 0  ? 'Opening' :
                    msg.round === -1 ? 'Synthesis' :
                    `Round ${msg.round}`
                  }`}
                >
                  {/* Speaker header */}
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar name={msg.speaker} theme={theme} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-semibold ${theme.text}`}>
                        {msg.speaker}
                      </span>
                      <span className="text-xs text-gray-600 ml-2">
                        {msg.speaker_role}
                      </span>
                    </div>
                    {active && (
                      <span className="text-xs text-gray-600 animate-pulse flex-shrink-0">
                        speaking…
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="pl-9">
                    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {msg.content
                        ? msg.content
                        : active
                          ? <span className="opacity-40">▋</span>
                          : <span className="text-gray-600">…</span>
                      }
                      {active && msg.content && (
                        <span className="animate-pulse opacity-50"> ▋</span>
                      )}
                    </p>
                  </div>
                </article>
              );
            })}

            {/* ── Synthesis verdict ── */}
            {synthesis && (
              <section
                className="mt-4 rounded-xl border border-gray-700/50 overflow-hidden"
                aria-label="Session synthesis"
              >
                {/* Verdict header */}
                <div className="bg-gray-800/60 px-5 py-3 border-b border-gray-700/50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold text-gray-300 tracking-[0.3em] uppercase">
                      Council Verdict
                    </h2>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      synthesis.confidence === 'high'   ? 'bg-green-900/60 text-green-300' :
                      synthesis.confidence === 'medium' ? 'bg-yellow-900/60 text-yellow-300' :
                                                          'bg-red-900/60 text-red-300'
                    }`}>
                      {synthesis.confidence.toUpperCase()} confidence
                    </span>
                  </div>
                </div>

                <div className="bg-gray-900/40 px-5 py-4 space-y-4">
                  {/* Summary */}
                  {synthesis.summary && (
                    <p className="text-sm text-gray-200 leading-relaxed italic border-l-2 border-cyan-700 pl-3">
                      {synthesis.summary}
                    </p>
                  )}

                  {/* Grid: decisions + actions + dissent + open questions */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
                    {synthesis.decisions.length > 0 && (
                      <div>
                        <p className="text-green-400 font-semibold uppercase tracking-wider mb-2">
                          ✓ Decisions
                        </p>
                        <ol className="space-y-1.5">
                          {synthesis.decisions.map((d, i) => (
                            <li key={i} className="text-gray-300 leading-relaxed">
                              {i + 1}. {d}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {synthesis.actions.length > 0 && (
                      <div>
                        <p className="text-cyan-400 font-semibold uppercase tracking-wider mb-2">
                          → Actions
                        </p>
                        <ol className="space-y-1.5">
                          {synthesis.actions.map((a, i) => (
                            <li key={i} className="text-gray-300 leading-relaxed">
                              {i + 1}. {a}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {synthesis.dissent.length > 0 && (
                      <div>
                        <p className="text-yellow-300 font-semibold uppercase tracking-wider mb-2">
                          ⚡ Dissent
                        </p>
                        <ul className="space-y-1.5">
                          {synthesis.dissent.map((d, i) => (
                            <li key={i} className="text-gray-300 leading-relaxed">· {d}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {synthesis.open_questions.length > 0 && (
                      <div>
                        <p className="text-violet-300 font-semibold uppercase tracking-wider mb-2">
                          ? Open Questions
                        </p>
                        <ul className="space-y-1.5">
                          {synthesis.open_questions.map((q, i) => (
                            <li key={i} className="text-gray-300 leading-relaxed">· {q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-700 italic pt-1 border-t border-gray-800/60">
                    Thinking tool · not professional, legal, medical, or financial advice
                  </p>
                </div>
              </section>
            )}

            {/* ── Error ── */}
            {error && (
              <div
                className="mt-2 bg-red-950/20 border border-red-900/40 rounded-lg px-4 py-3"
                role="alert"
              >
                <p className="text-sm text-red-400">✗ {error}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Run <code className="text-gray-400">eklavya status</code> to check API key configuration.
                </p>
              </div>
            )}

            {/* Bottom padding so last card isn't flush to edge */}
            <div className="h-4" aria-hidden="true" />
          </div>
        </main>
      </div>
    </div>
  );
}
