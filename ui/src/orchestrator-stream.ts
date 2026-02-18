/**
 * Streaming Council Orchestrator
 *
 * Variant of orchestrator.ts that emits StreamChunk events via a callback
 * instead of writing directly to stdout. Used by the web UI API route.
 *
 * Identical logic to orchestrator.ts — all fixes (contrarian_level, sanitisation,
 * round summaries, synthesis validation) apply here too.
 */

import { EklavyaConfig, Message, Persona, Council, Session, Synthesis, StreamChunk } from './types.js';
import { callProvider } from './providers.js';
import { getPersona } from './data/personas.js';
import { getActiveProvider } from './config.js';

export type ChunkCallback = (chunk: StreamChunk) => void;

// ─── Security: Field Sanitisation ────────────────────────────────────────────

function sanitiseField(value: string, maxLength = 500): string {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/```/g, "'''")
    .replace(/^(SYSTEM|USER|ASSISTANT|HUMAN):/gim, '')
    .slice(0, maxLength)
    .trim();
}

function sanitisePersona(persona: Persona): Persona {
  return {
    ...persona,
    name:      sanitiseField(persona.name, 100),
    role:      sanitiseField(persona.role, 150),
    style:     sanitiseField(persona.style, 500),
    bias:      persona.bias ? sanitiseField(persona.bias, 300) : undefined,
    expertise: persona.expertise.map(e => sanitiseField(e, 80)).slice(0, 10),
  };
}

// ─── contrarian_level ─────────────────────────────────────────────────────────

function contrarianTemperature(level: number): number {
  return 0.6 + level * 0.4;
}

function contrarianInstruction(level: number): string {
  if (level >= 0.8) return 'Challenge every assumption aggressively. Find the flaw or risk in every position stated. Do not agree unless you are genuinely compelled by evidence.';
  if (level >= 0.5) return 'Push back where you have genuine doubts. Do not accept claims at face value without scrutiny.';
  return 'Look for synthesis and common ground where the evidence supports it, but do not abandon your core position.';
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildPersonaSystemPrompt(rawPersona: Persona, userContext?: string): string {
  const persona = sanitisePersona(rawPersona);
  const displayName = persona.display_name ?? persona.name;

  return [
    `You are a debate persona drawing on the expertise and style of: ${displayName}, ${persona.role}.`,
    ``,
    `YOUR EXPERTISE: ${persona.expertise.join(', ')}.`,
    `YOUR COMMUNICATION STYLE: ${persona.style}`,
    persona.bias ? `YOUR KNOWN PERSPECTIVE: ${persona.bias}` : '',
    ``,
    userContext
      ? `PERSON YOU ARE ADVISING:\n${userContext}\nSpeak directly to their specific situation — not a generic version of the question. Reference their context explicitly.`
      : '',
    ``,
    `COUNCIL RULES:`,
    `- You are one voice in a multi-expert council debate.`,
    `- Respond in character. Be specific and concrete. Avoid vague generalities.`,
    `- ${contrarianInstruction(persona.contrarian_level)}`,
    `- Reference specific examples, failures, or patterns relevant to your expertise.`,
    `- Do NOT simply agree with everything said. You are here to add distinct value.`,
    `- Keep response to ${persona.verbosity === 'brief' ? '80–120' : persona.verbosity === 'medium' ? '150–200' : '200–280'} words.`,
    `- Do NOT use markdown headers or bullet points. Speak naturally, as in a live debate.`,
    `- Do NOT open with your own name or "As a [role]..." — just speak.`,
    ``,
    `IMPORTANT: You are an AI generating a debate perspective. Your output is a thinking tool, not authoritative advice.`,
    `SAFETY RULES (non-negotiable):`,
    `- Do NOT provide medical diagnoses, treatment recommendations, or drug dosage guidance.`,
    `- Do NOT provide legal advice, financial advice, or investment recommendations presented as fact.`,
    `- If the topic involves mental health, self-harm, suicidal ideation, or personal crisis: acknowledge the difficulty, state clearly that professional help is needed, and reference crisis resources (988 in the US; local emergency services). Do not attempt to act as a therapist or crisis counsellor.`,
    `- If the topic involves domestic violence, abuse, or personal safety: direct the user to professional support immediately.`,
    `- You may discuss these topics analytically (e.g. policy, research, frameworks) but must never substitute for qualified professional help.`,
  ].filter(Boolean).join('\n');
}

function buildPersonaUserPrompt(
  persona: Persona,
  question: string,
  fullTranscript: Message[],
  roundSummaries: string[],
  round: number
): string {
  const currentRoundMessages = fullTranscript.filter(m => m.round === round && m.speaker !== 'Moderator');
  const displayName = persona.display_name ?? persona.name;

  const parts: string[] = [`TOPIC: ${question}`, ``];

  if (round === 1) {
    const opening = fullTranscript.find(m => m.round === 0);
    if (opening) parts.push(`MODERATOR FRAMING: ${opening.content}`, ``);
  } else {
    if (roundSummaries.length > 0) {
      parts.push(`PRIOR ROUND SUMMARIES:`);
      roundSummaries.forEach((s, i) => parts.push(`Round ${i + 1}: ${s}`));
      parts.push(``);
    }
  }

  if (currentRoundMessages.length > 0) {
    parts.push(`THIS ROUND SO FAR:`);
    currentRoundMessages.forEach(m => parts.push(`[${m.speaker}]: ${m.content}`));
    parts.push(``);
  }

  parts.push(
    round === 1
      ? `ROUND 1: Give your core perspective on this topic from your area of expertise as ${displayName}.`
      : `ROUND ${round}: Build on or challenge what has been said. Do not repeat points already made. Push the debate forward.`
  );

  return parts.join('\n');
}

// ─── Streaming Runner ─────────────────────────────────────────────────────────

export async function runCouncilStream(
  question: string,
  council: Council,
  config: EklavyaConfig,
  onChunk: ChunkCallback,
  personaOverrides?: string[],
  userContext?: string
): Promise<Session> {
  const start = Date.now();
  const transcript: Message[] = [];
  const sessionId = crypto.randomUUID();
  const roundSummaries: string[] = [];
  const modelVersions: Record<string, string> = {};
  let providerCalls = 0;

  const personaIds = personaOverrides ?? council.persona_ids;
  const personas = personaIds.map(id => getPersona(id));
  const activeProvider = getActiveProvider(config);

  // ── Moderator: Open ───────────────────────────────────────────────────────

  onChunk({ type: 'speaker_start', speaker: 'Moderator', speaker_role: 'Council Moderator', round: 0 });

  const personaNames = personas.map(p => p.display_name ?? p.name);
  const modOpenSystem = [
    `You are a neutral, incisive council moderator.`,
    `Be brief (60–80 words). Identify 2–3 dimensions experts should address.`,
    `Do NOT give opinions. Set the stage only.`,
  ].join('\n');
  const modOpenUser = [
    `Open this council session on: "${question}"`,
    userContext ? `Context about the person asking: ${userContext}` : '',
    `Council focus: ${council.focus ?? 'general analysis'}`,
    `Experts attending: ${personaNames.join(', ')}.`,
    `Frame the session in 2–3 sentences. Identify key tensions to explore. If context was provided, acknowledge it briefly.`,
  ].filter(Boolean).join('\n');

  const moderatorOpen = await callProvider(
    { system: modOpenSystem, user: modOpenUser, max_tokens: 150, temperature: 0.5 },
    activeProvider, config, undefined,
    (token) => onChunk({ type: 'token', token, round: 0 })
  );
  providerCalls++;

  transcript.push({
    speaker: 'Moderator',
    speaker_role: 'Council Moderator',
    content: moderatorOpen,
    round: 0,
    timestamp: new Date().toISOString(),
  });

  // ── Rounds ────────────────────────────────────────────────────────────────

  for (let round = 1; round <= council.rounds; round++) {
    onChunk({ type: 'round_start', round });

    for (const persona of personas) {
      const displayName = persona.display_name ?? persona.name;
      onChunk({ type: 'speaker_start', speaker: displayName, speaker_role: persona.role, round });

      const provider = (persona.provider as typeof activeProvider | undefined) ?? activeProvider;
      const model = persona.model ?? config.providers[provider]?.default_model ?? '';
      modelVersions[persona.id] = `${provider}/${model}`;

      const systemPrompt = buildPersonaSystemPrompt(persona, userContext);
      const userPrompt = buildPersonaUserPrompt(persona, question, transcript, roundSummaries, round);
      const temperature = contrarianTemperature(persona.contrarian_level);

      const response = await callProvider(
        { system: systemPrompt, user: userPrompt, max_tokens: config.max_tokens_per_turn, temperature },
        provider, config, persona.model,
        (token) => onChunk({ type: 'token', token, round })
      );
      providerCalls++;

      transcript.push({
        speaker: displayName,
        speaker_role: persona.role,
        content: response,
        round,
        timestamp: new Date().toISOString(),
      });
    }

    // Moderator summary between rounds
    if (round < council.rounds) {
      onChunk({ type: 'speaker_start', speaker: 'Moderator', speaker_role: `Round ${round} Summary`, round });

      const sumSystem = [
        `You are a neutral council moderator.`,
        `Summarise the debate round in 60–80 words.`,
        `Capture agreements, disagreements, and one focus question for the next round.`,
      ].join('\n');
      const roundMessages = transcript.filter(m => m.round === round && m.speaker !== 'Moderator');
      const sumUser = [
        `Topic: "${question}"`,
        `Round ${round}:`,
        roundMessages.map(m => `[${m.speaker}]: ${m.content}`).join('\n\n'),
        `Summarise and end with a focus question for Round ${round + 1}.`,
      ].join('\n');

      const summary = await callProvider(
        { system: sumSystem, user: sumUser, max_tokens: 180, temperature: 0.4 },
        activeProvider, config, undefined,
        (token) => onChunk({ type: 'token', token, round })
      );
      providerCalls++;

      roundSummaries.push(summary);
      transcript.push({
        speaker: 'Moderator',
        speaker_role: 'Council Moderator',
        content: summary,
        round,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── Synthesis ─────────────────────────────────────────────────────────────

  const synthSystem = [
    `You are a synthesis engine for an expert council debate.`,
    `Output EXACTLY this JSON — nothing else:`,
    `{"decisions":["..."],"dissent":["..."],"open_questions":["..."],"actions":["..."],"confidence":"low|medium|high","summary":"..."}`,
    `No markdown, no preamble.`,
    `SAFETY: If the topic involves mental health, self-harm, crisis, abuse, or medical/legal decisions, the "summary" field MUST include a sentence directing the user to seek qualified professional or emergency help. Include crisis line 988 (US) if mental health or crisis is involved.`,
    `SAFETY: Never include specific medical dosages, diagnoses, investment recommendations, or legal opinions in the output.`,
  ].join('\n');

  const compactTranscript = transcript
    .filter(m => m.speaker !== 'Moderator' || m.round === 0)
    .map(m => `[${m.speaker}]: ${m.content}`)
    .join('\n\n');

  const synthUser = [
    `Question: "${question}"`,
    userContext ? `Person's context: ${userContext}` : '',
    ``,
    `Transcript:`,
    compactTranscript,
  ].filter(Boolean).join('\n');

  let synthText = await callProvider(
    { system: synthSystem, user: synthUser, max_tokens: 1800, temperature: 0.2, prefill: '{' },
    activeProvider, config, undefined, null
  );
  providerCalls++;

  // Robust JSON extraction: strip code fences, then find first { ... last }
  // This handles models that add preamble/postamble around the JSON
  synthText = synthText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const jsonMatch = synthText.match(/\{[\s\S]*\}/);
  if (jsonMatch) synthText = jsonMatch[0];

  let synthesis: Synthesis;
  try {
    synthesis = JSON.parse(synthText) as Synthesis;
    // Normalise: ensure all required arrays exist
    if (!Array.isArray(synthesis.decisions))     synthesis.decisions     = [];
    if (!Array.isArray(synthesis.dissent))        synthesis.dissent       = [];
    if (!Array.isArray(synthesis.open_questions)) synthesis.open_questions = [];
    if (!Array.isArray(synthesis.actions))        synthesis.actions       = [];
    if (!synthesis.confidence)                    synthesis.confidence    = 'medium';
    if (!synthesis.summary)                       synthesis.summary       = 'See transcript.';
  } catch (parseErr) {
    // Log raw output so we can debug what the model actually returned
    console.error('[eklavya] Synthesis JSON parse failed.');
    console.error('[eklavya] Raw synthesis text:', JSON.stringify(synthText));
    console.error('[eklavya] Parse error:', parseErr);
    synthesis = {
      decisions: [],
      dissent: [],
      open_questions: [],
      actions: [],
      confidence: 'low',
      summary: '[Synthesis could not be parsed — full debate is in the transcript above]',
    };
  }

  onChunk({ type: 'synthesis', synthesis });

  const duration = Math.round((Date.now() - start) / 1000);

  return {
    id: sessionId,
    question,
    council_id: council.id,
    council_name: council.name,
    transcript,
    synthesis,
    created_at: new Date().toISOString(),
    duration_seconds: duration,
    persona_count: personas.length,
    rounds: council.rounds,
    provider_calls: providerCalls,
    model_versions: modelVersions,
  };
}
