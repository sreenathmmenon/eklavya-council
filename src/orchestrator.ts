/**
 * Council Orchestrator
 *
 * Runs a full council session:
 *   1. Moderator opens the session
 *   2. Each persona speaks in order (repeated for N rounds)
 *   3. Moderator summarises between rounds — summary passed to next round (not full transcript)
 *   4. Synthesis agent produces final structured output
 *
 * Security: persona fields are sanitised before interpolation.
 * Safety:   contrarian_level is wired into both temperature and explicit instruction.
 * Quality:  Round 2+ receives compact prior-round summaries — prevents echo chamber convergence.
 */

import chalk from 'chalk';
import { EklavyaConfig, Message, Persona, Council, Session, Synthesis } from './types.js';
import { callProvider } from './providers.js';
import { getPersona } from './data/personas.js';
import { getActiveProvider } from './config.js';

// ─── Security: Field Sanitisation ────────────────────────────────────────────

/**
 * Strip characters that could be used to escape or inject into system prompts.
 * Limits field length to prevent context stuffing.
 */
function sanitiseField(value: string, maxLength = 500): string {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // strip control chars
    .replace(/```/g, "'''")                              // neutralise code fences
    .replace(/^(SYSTEM|USER|ASSISTANT|HUMAN):/gim, '')  // strip role injection headers
    .slice(0, maxLength)
    .trim();
}

function sanitisePersona(persona: Persona): Persona {
  return {
    ...persona,
    name:    sanitiseField(persona.name, 100),
    role:    sanitiseField(persona.role, 150),
    style:   sanitiseField(persona.style, 500),
    bias:    persona.bias ? sanitiseField(persona.bias, 300) : undefined,
    expertise: persona.expertise.map(e => sanitiseField(e, 80)).slice(0, 10),
  };
}

// ─── contrarian_level → temperature mapping ───────────────────────────────────

/**
 * contrarian_level (0.0–1.0) scales debate temperature.
 * High contrarians run hotter to generate more divergent responses.
 */
function contrarianTemperature(level: number): number {
  // Scale 0.6 (agreeable) → 1.0 (maximum contrarian)
  return 0.6 + level * 0.4;
}

function contrarianInstruction(level: number): string {
  if (level >= 0.8) {
    return 'Challenge every assumption aggressively. Find the flaw or risk in every position stated. Do not agree unless you are genuinely compelled by evidence.';
  } else if (level >= 0.5) {
    return 'Push back where you have genuine doubts. Do not accept claims at face value without scrutiny.';
  } else {
    return 'Look for synthesis and common ground where the evidence supports it, but do not abandon your core position.';
  }
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildPersonaSystemPrompt(rawPersona: Persona): string {
  const persona = sanitisePersona(rawPersona);
  const displayName = persona.display_name ?? persona.name;

  return [
    `You are a debate persona drawing on the expertise and style of: ${displayName}, ${persona.role}.`,
    ``,
    `YOUR EXPERTISE: ${persona.expertise.join(', ')}.`,
    `YOUR COMMUNICATION STYLE: ${persona.style}`,
    persona.bias ? `YOUR KNOWN PERSPECTIVE: ${persona.bias}` : '',
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

/**
 * Round 1: each persona sees the moderator's opening + prior speakers in this round.
 * Round 2+: each persona sees compact summaries of prior rounds + current round's prior speakers.
 * This prevents full-transcript contamination and echo chamber convergence.
 */
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
    // Round 1: show moderator opening only
    const opening = fullTranscript.find(m => m.round === 0);
    if (opening) {
      parts.push(`MODERATOR FRAMING: ${opening.content}`, ``);
    }
  } else {
    // Round 2+: show compact summaries of previous rounds (not full transcripts)
    if (roundSummaries.length > 0) {
      parts.push(`PRIOR ROUND SUMMARIES:`);
      roundSummaries.forEach((s, i) => parts.push(`Round ${i + 1}: ${s}`));
      parts.push(``);
    }
  }

  // Show what others have said so far in THIS round
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

function buildModeratorOpenPrompt(question: string, council: Council, personaNames: string[]): { system: string; user: string } {
  const system = [
    `You are a neutral, incisive council moderator.`,
    `Your job: open the session, set context, and frame the key questions.`,
    `Be brief (60–80 words). Identify the 2–3 dimensions experts should address.`,
    `Do NOT give opinions. Do NOT answer the question. Set the stage only.`,
  ].join('\n');

  const user = [
    `Open this council session on: "${question}"`,
    `Council focus: ${council.focus ?? 'general analysis'}`,
    `Experts attending: ${personaNames.join(', ')}.`,
    `Frame the session in 2–3 sentences. Identify the key tensions or trade-offs to explore.`,
  ].join('\n');

  return { system, user };
}

function buildModeratorSummaryPrompt(
  question: string,
  transcript: Message[],
  round: number
): { system: string; user: string } {
  const system = [
    `You are a neutral council moderator.`,
    `Summarise the key points from this debate round in 60–80 words.`,
    `Capture: (1) key areas of agreement, (2) key disagreements, (3) one sharp focus question for the next round.`,
    `Be factual. Do NOT add your own opinion.`,
  ].join('\n');

  const roundMessages = transcript.filter(m => m.round === round && m.speaker !== 'Moderator');
  const user = [
    `Topic: "${question}"`,
    ``,
    `Round ${round} contributions:`,
    roundMessages.map(m => `[${m.speaker}]: ${m.content}`).join('\n\n'),
    ``,
    `Provide a compact summary. End with a sharp focus question for Round ${round + 1}.`,
  ].join('\n');

  return { system, user };
}

function buildSynthesisPrompt(question: string, transcript: Message[]): { system: string; user: string } {
  const system = [
    `You are a synthesis engine. You have observed a full expert council debate.`,
    `Produce a structured synthesis. Be ruthlessly concise and specific.`,
    ``,
    `Output EXACTLY this JSON structure — nothing else:`,
    `{`,
    `  "decisions": ["...", "..."],       // 2–4 clear recommendations or conclusions`,
    `  "dissent": ["...", "..."],          // 1–3 minority views or unresolved disagreements`,
    `  "open_questions": ["...", "..."],   // 1–3 questions the council did NOT resolve`,
    `  "actions": ["...", "..."],          // 2–4 concrete next steps`,
    `  "confidence": "low|medium|high",   // overall council confidence in its output`,
    `  "summary": "..."                   // 2–3 sentence plain-English summary for a busy decision-maker`,
    `}`,
    ``,
    `Output ONLY valid JSON. No markdown fences, no preamble, no explanation.`,
    ``,
    `IMPORTANT: These are AI-generated debate perspectives, not authoritative professional advice.`,
    `SAFETY: If the topic involves mental health, self-harm, crisis, abuse, or medical/legal decisions, the "summary" field MUST include a sentence directing the user to seek qualified professional or emergency help. Include crisis line 988 (US) if mental health or crisis is involved.`,
    `SAFETY: Never include specific medical dosages, diagnoses, investment recommendations, or legal opinions in the output.`,
  ].join('\n');

  // For synthesis, use compact transcript (speaker + content only, no metadata)
  const compactTranscript = transcript
    .filter(m => m.speaker !== 'Moderator' || m.round === 0)
    .map(m => `[${m.speaker}]: ${m.content}`)
    .join('\n\n');

  const user = [
    `Question debated: "${question}"`,
    ``,
    `Full transcript:`,
    compactTranscript,
  ].join('\n');

  return { system, user };
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

function printDivider(label: string, color: chalk.Chalk = chalk.dim): void {
  const width = 70;
  const labelWidth = label.length + 2;
  const pad = Math.max(0, Math.floor((width - labelWidth) / 2));
  console.log(color('─'.repeat(pad) + ' ' + label + ' ' + '─'.repeat(width - pad - labelWidth)));
}

function printHeader(question: string, councilName: string): void {
  console.log('');
  console.log(chalk.bold.cyan('═'.repeat(70)));
  console.log(chalk.bold.cyan('  EKLAVYA  ·  ' + councilName));
  console.log(chalk.bold.cyan('═'.repeat(70)));
  console.log(chalk.white('  ' + question));
  console.log(chalk.dim('─'.repeat(70)));
  console.log('');
}

function printSpeakerHeader(name: string, role: string): void {
  console.log('');
  printDivider(`${name.toUpperCase()}  ·  ${role}`, chalk.yellow);
}

function printModeratorHeader(label: string): void {
  console.log('');
  printDivider(`MODERATOR  ·  ${label}`, chalk.cyan);
}

function printSynthesis(synthesis: Synthesis): void {
  console.log('');
  console.log(chalk.bold.green('═'.repeat(70)));
  console.log(chalk.bold.green('  SYNTHESIS'));
  console.log(chalk.bold.green('═'.repeat(70)));

  if (synthesis.summary) {
    console.log('');
    console.log(chalk.white('  ' + synthesis.summary));
  }

  if (synthesis.decisions.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  ✓ DECISIONS'));
    synthesis.decisions.forEach((d, i) => console.log(chalk.green(`    ${i + 1}. ${d}`)));
  }

  if (synthesis.dissent.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  ⚡ DISSENT'));
    synthesis.dissent.forEach(d => console.log(chalk.yellow(`    · ${d}`)));
  }

  if (synthesis.open_questions.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  ? OPEN QUESTIONS'));
    synthesis.open_questions.forEach(q => console.log(chalk.cyan(`    · ${q}`)));
  }

  if (synthesis.actions.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  → ACTIONS'));
    synthesis.actions.forEach((a, i) => console.log(chalk.white(`    ${i + 1}. ${a}`)));
  }

  const confidenceColor = synthesis.confidence === 'high'
    ? chalk.green
    : synthesis.confidence === 'medium'
      ? chalk.yellow
      : chalk.red;

  console.log('');
  console.log(chalk.dim(`  Confidence: ${confidenceColor(synthesis.confidence.toUpperCase())}`));
  console.log(chalk.dim('  Note: Personas are AI archetypes. Output is a thinking tool, not professional advice.'));
  console.log(chalk.bold.green('═'.repeat(70)));
  console.log('');
}

// ─── Core Runner ─────────────────────────────────────────────────────────────

export async function runCouncil(
  question: string,
  council: Council,
  config: EklavyaConfig,
  personaOverrides?: string[]
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

  printHeader(question, council.name);

  // ── Moderator: Open ───────────────────────────────────────────────────────

  printModeratorHeader('Opening');

  const personaNames = personas.map(p => p.display_name ?? p.name);
  const { system: modOpenSys, user: modOpenUser } = buildModeratorOpenPrompt(question, council, personaNames);

  process.stdout.write(chalk.cyan('  '));
  const moderatorOpen = await callProvider(
    { system: modOpenSys, user: modOpenUser, max_tokens: 150, temperature: 0.5 },
    activeProvider, config, undefined,
    (token) => process.stdout.write(chalk.cyan(token))
  );
  providerCalls++;
  console.log('\n');

  transcript.push({
    speaker: 'Moderator',
    speaker_role: 'Council Moderator',
    content: moderatorOpen,
    round: 0,
    timestamp: new Date().toISOString(),
  });

  // ── Rounds ────────────────────────────────────────────────────────────────

  for (let round = 1; round <= council.rounds; round++) {
    console.log('');
    console.log(chalk.bold.white(`  ── Round ${round} of ${council.rounds} ──`));

    for (const persona of personas) {
      printSpeakerHeader(persona.display_name ?? persona.name, persona.role);

      const provider = (persona.provider as typeof activeProvider | undefined) ?? activeProvider;
      const model = persona.model ?? config.providers[provider]?.default_model ?? '';
      modelVersions[persona.id] = `${provider}/${model}`;

      const systemPrompt = buildPersonaSystemPrompt(persona);
      const userPrompt = buildPersonaUserPrompt(persona, question, transcript, roundSummaries, round);
      const temperature = contrarianTemperature(persona.contrarian_level);

      process.stdout.write(chalk.white('  '));
      const response = await callProvider(
        { system: systemPrompt, user: userPrompt, max_tokens: config.max_tokens_per_turn, temperature },
        provider, config, persona.model,
        (token) => process.stdout.write(chalk.white(token))
      );
      providerCalls++;
      console.log('\n');

      transcript.push({
        speaker: persona.display_name ?? persona.name,
        speaker_role: persona.role,
        content: response,
        round,
        timestamp: new Date().toISOString(),
      });
    }

    // Moderator summary between rounds
    if (round < council.rounds) {
      printModeratorHeader(`Round ${round} Summary`);

      const { system: sumSys, user: sumUser } = buildModeratorSummaryPrompt(question, transcript, round);

      process.stdout.write(chalk.cyan('  '));
      const summary = await callProvider(
        { system: sumSys, user: sumUser, max_tokens: 180, temperature: 0.4 },
        activeProvider, config, undefined,
        (token) => process.stdout.write(chalk.cyan(token))
      );
      providerCalls++;
      console.log('\n');

      // Store compact summary for next round — not full transcript
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

  printDivider('GENERATING SYNTHESIS', chalk.dim);

  const { system: synthSys, user: synthUser } = buildSynthesisPrompt(question, transcript);

  let synthText = '';
  synthText = await callProvider(
    { system: synthSys, user: synthUser, max_tokens: 1200, temperature: 0.2, prefill: '{' },
    activeProvider, config, undefined,
    null // no streaming — need clean JSON
  );
  providerCalls++;

  // Robust JSON extraction: strip code fences, then find first { ... last }
  synthText = synthText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const jsonMatch = synthText.match(/\{[\s\S]*\}/);
  if (jsonMatch) synthText = jsonMatch[0];

  let synthesis: Synthesis;
  try {
    synthesis = JSON.parse(synthText) as Synthesis;
    // Normalise: fill in missing fields rather than failing
    if (!Array.isArray(synthesis.decisions))     synthesis.decisions     = [];
    if (!Array.isArray(synthesis.dissent))        synthesis.dissent       = [];
    if (!Array.isArray(synthesis.open_questions)) synthesis.open_questions = [];
    if (!Array.isArray(synthesis.actions))        synthesis.actions       = [];
    if (!synthesis.confidence)                    synthesis.confidence    = 'medium';
    if (!synthesis.summary)                       synthesis.summary       = 'See transcript.';
  } catch (parseErr) {
    // Fail loudly — save partial session, never return fake output
    const partial: Session = {
      id: sessionId,
      question,
      council_id: council.id,
      council_name: council.name,
      transcript,
      synthesis: {
        decisions: [],
        dissent: [],
        open_questions: [],
        actions: [],
        confidence: 'low',
        summary: '[Synthesis failed — see transcript for full debate]',
      },
      created_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - start) / 1000),
      persona_count: personas.length,
      rounds: council.rounds,
      provider_calls: providerCalls,
      model_versions: modelVersions,
    };

    console.error(chalk.red('\n  ✗ Synthesis parsing failed. Full transcript is saved.'));
    if (process.env.DEBUG) {
      console.error('Raw synthesis output:', synthText);
      console.error('Parse error:', parseErr);
    }

    return partial;
  }

  printSynthesis(synthesis);

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
