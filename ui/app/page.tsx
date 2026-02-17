'use client';

import { useState, useRef, useEffect } from 'react';
import { StreamChunk, Message, Synthesis, Council } from '../lib/types';

const COUNCILS: Council[] = [
  { id: 'software-architecture', name: 'Software Architecture', description: 'Architecture, tech choices, system design', persona_ids: [], rounds: 2 },
  { id: 'product-strategy', name: 'Product Strategy', description: 'Direction, features, build vs buy', persona_ids: [], rounds: 2 },
  { id: 'career-decision', name: 'Career Decision', description: 'Career moves, pivots, learning investments', persona_ids: [], rounds: 2 },
  { id: 'startup-idea', name: 'Startup Idea', description: 'Evaluate ideas, models, moats', persona_ids: [], rounds: 2 },
  { id: 'deep-debate', name: 'Deep Technical Debate', description: '7 experts, 3 rounds, full analysis', persona_ids: [], rounds: 3 },
  { id: 'personal-decision', name: 'Personal Decision', description: 'Life decisions, priorities, values', persona_ids: [], rounds: 2 },
];

type SessionState = 'idle' | 'running' | 'done' | 'error';

interface UIMessage extends Message {
  isStreaming?: boolean;
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [councilId, setCouncilId] = useState('software-architecture');
  const [rounds, setRounds] = useState(2);
  const [state, setState] = useState<SessionState>('idle');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [error, setError] = useState('');
  const [currentSpeaker, setCurrentSpeaker] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  async function runCouncil() {
    if (!question.trim() || state === 'running') return;

    setState('running');
    setSynthesis(null);
    setMessages([]);
    setError('');
    setCurrentSpeaker('');

    try {
      const response = await fetch('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, council_id: councilId, rounds }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Council failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') { setState('done'); break; }

          try {
            const chunk: StreamChunk = JSON.parse(data);

            if (chunk.type === 'speaker_start') {
              setCurrentSpeaker(chunk.speaker ?? '');
              setMessages(prev => [...prev, {
                speaker: chunk.speaker!,
                speaker_role: chunk.speaker_role!,
                content: '',
                round: chunk.round!,
                timestamp: new Date().toISOString(),
                isStreaming: true,
              }]);
            }

            if (chunk.type === 'token') {
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 && m.isStreaming
                  ? { ...m, content: m.content + chunk.token }
                  : m
              ));
            }

            if (chunk.type === 'round_start') {
              // Visual round marker handled by round grouping in render
            }

            if (chunk.type === 'synthesis') {
              setSynthesis(chunk.synthesis!);
              setMessages(prev => prev.map(m => ({ ...m, isStreaming: false })));
              setState('done');
              setCurrentSpeaker('');
            }

            if (chunk.type === 'error') {
              throw new Error(chunk.error);
            }
          } catch (parseErr) {
            // Skip malformed chunks
          }
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
      setState('error');
    }
  }

  const isModerator = (speaker: string) =>
    speaker === 'Moderator' || speaker === 'MODERATOR';

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto px-4">
      {/* Header */}
      <header className="flex items-center justify-between py-4 border-b border-gray-800">
        <div>
          <h1 className="text-xl font-bold text-cyan-400 tracking-wider">EKLAVYA</h1>
          <p className="text-xs text-gray-500">Virtual Council  ·  Multi-Persona LLM Debate</p>
        </div>
        <div className="flex items-center gap-2">
          {state === 'running' && (
            <span className="flex items-center gap-2 text-sm text-cyan-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              {currentSpeaker ? `${currentSpeaker} speaking…` : 'Council in session…'}
            </span>
          )}
          {state === 'done' && (
            <span className="text-sm text-green-400">✓ Session complete</span>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 gap-4 overflow-hidden py-4">
        {/* Left: Controls */}
        <aside className="w-64 flex-shrink-0 flex flex-col gap-4">
          {/* Question */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Question</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none"
              rows={4}
              placeholder="Should we migrate to microservices?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              disabled={state === 'running'}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && runCouncil()}
            />
          </div>

          {/* Council selector */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Council</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              value={councilId}
              onChange={e => setCouncilId(e.target.value)}
              disabled={state === 'running'}
            >
              {COUNCILS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              {COUNCILS.find(c => c.id === councilId)?.description}
            </p>
          </div>

          {/* Rounds */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">
              Rounds: {rounds}
            </label>
            <input
              type="range" min={1} max={3} value={rounds}
              onChange={e => setRounds(Number(e.target.value))}
              disabled={state === 'running'}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>1 (quick)</span><span>3 (deep)</span>
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={runCouncil}
            disabled={state === 'running' || !question.trim()}
            className={`w-full py-2.5 rounded text-sm font-medium transition-colors ${
              state === 'running' || !question.trim()
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer'
            }`}
          >
            {state === 'running' ? 'Council in session…' : 'Convene Council'}
          </button>

          {state !== 'idle' && (
            <button
              onClick={() => { setState('idle'); setMessages([]); setSynthesis(null); setQuestion(''); }}
              className="w-full py-2 rounded text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 transition-colors"
            >
              New Session
            </button>
          )}

          {/* Keyboard hint */}
          <p className="text-xs text-gray-700 text-center">⌘ + Enter to run</p>
        </aside>

        {/* Right: Transcript */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto space-y-4 pr-1"
          >
            {messages.length === 0 && state === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-gray-600 text-sm max-w-xs">
                  Eklavya convenes a council of expert AI personas to debate your question from multiple perspectives.
                </p>
                <p className="text-gray-700 text-xs mt-4">
                  Enter a question and select a council to begin.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`rounded-lg p-4 ${
                isModerator(msg.speaker)
                  ? 'bg-cyan-950/30 border border-cyan-900/40'
                  : 'bg-gray-900 border border-gray-800'
              }`}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className={`text-sm font-bold ${
                    isModerator(msg.speaker) ? 'text-cyan-400' : 'text-yellow-400'
                  }`}>{msg.speaker}</span>
                  <span className="text-xs text-gray-500">{msg.speaker_role}</span>
                  <span className="text-xs text-gray-700 ml-auto">R{msg.round}</span>
                </div>
                <p className={`text-sm text-gray-300 leading-relaxed ${msg.isStreaming ? 'cursor-blink' : ''}`}>
                  {msg.content || (msg.isStreaming ? '' : '…')}
                </p>
              </div>
            ))}

            {error && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-4">
                <p className="text-sm text-red-400">✗ {error}</p>
                <p className="text-xs text-gray-500 mt-1">Check your API key configuration.</p>
              </div>
            )}
          </div>

          {/* Synthesis panel */}
          {synthesis && (
            <div className="mt-4 bg-green-950/20 border border-green-900/30 rounded-lg p-4 flex-shrink-0">
              <h3 className="text-sm font-bold text-green-400 mb-3">SYNTHESIS</h3>

              {synthesis.summary && (
                <p className="text-sm text-gray-300 mb-3 italic">{synthesis.summary}</p>
              )}

              <div className="grid grid-cols-2 gap-4 text-xs">
                {synthesis.decisions.length > 0 && (
                  <div>
                    <p className="text-green-400 font-medium mb-1">✓ Decisions</p>
                    {synthesis.decisions.map((d, i) => <p key={i} className="text-gray-400 mb-1">{i+1}. {d}</p>)}
                  </div>
                )}
                {synthesis.actions.length > 0 && (
                  <div>
                    <p className="text-white font-medium mb-1">→ Actions</p>
                    {synthesis.actions.map((a, i) => <p key={i} className="text-gray-400 mb-1">{i+1}. {a}</p>)}
                  </div>
                )}
                {synthesis.dissent.length > 0 && (
                  <div>
                    <p className="text-yellow-400 font-medium mb-1">⚡ Dissent</p>
                    {synthesis.dissent.map((d, i) => <p key={i} className="text-gray-400 mb-1">· {d}</p>)}
                  </div>
                )}
                {synthesis.open_questions.length > 0 && (
                  <div>
                    <p className="text-cyan-400 font-medium mb-1">? Open Questions</p>
                    {synthesis.open_questions.map((q, i) => <p key={i} className="text-gray-400 mb-1">· {q}</p>)}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-600 mt-2 text-right">
                Confidence: <span className={synthesis.confidence === 'high' ? 'text-green-400' : synthesis.confidence === 'medium' ? 'text-yellow-400' : 'text-red-400'}>{synthesis.confidence.toUpperCase()}</span>
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
