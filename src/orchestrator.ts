/**
 * Council Orchestrator
 *
 * Runs a full council session:
 *   1. Moderator opens the session
 *   2. Each persona speaks in order (repeated for N rounds)
 *   3. Moderator summarises between rounds
 *   4. Synthesis agent produces final structured output
 */

import chalk from 'chalk';
import { EklavyaConfig, Message, Persona, Council, Session, Synthesis } from './types.js';
import { callProvider } from './providers.js';
import { getPersona } from './data/personas.js';
import { getActiveProvider } from './config.js';

// ─── Prompt Builders ─────────────────────────────────────────────────────────

function buildPersonaSystemPrompt(persona: Persona): string {
  return [
    `You are ${persona.name}, ${persona.role}.`,
    ``,
    `YOUR EXPERTISE: ${persona.expertise.join(', ')}.`,
    `YOUR COMMUNICATION STYLE: ${persona.style}`,
    persona.bias ? `YOUR KNOWN PERSPECTIVE: ${persona.bias}` : '',
    ``,
    `COUNCIL RULES:`,
    `- You are one voice in a multi-expert council debate.`,
    `- Respond ONLY as ${persona.name}. Stay fully in character.`,
    `- Be specific and concrete. Avoid vague generalities.`,
    `- Challenge assumptions when your expertise warrants it.`,
    `- Reference specific examples, failures, or experiences relevant to your background.`,
    `- Do NOT simply agree with everything said. You are here to add distinct value.`,
    `- Keep response to ${persona.verbosity === 'brief' ? '80–120' : persona.verbosity === 'medium' ? '150–200' : '200–280'} words.`,
    `- Do NOT use headers or bullet points. Speak naturally, as if in a live debate.`,
    `- Do NOT start with "As ${persona.name}..." — just speak.`,
  ].filter(Boolean).join('\n');
}

function buildPersonaUserPrompt(
  persona: Persona,
  question: string,
  transcript: Message[],
  round: number
): string {
  const history = transcript.length > 0
    ? `\n\nCONVERSATION SO FAR:\n${transcript.map(m => `[${m.speaker}]: ${m.content}`).join('\n\n')}`
    : '';

  return [
    `TOPIC: ${question}`,
    history,
    ``,
    `ROUND ${round}: Please give your perspective as ${persona.name}.`,
    transcript.length > 0
      ? `Build on, challenge, or extend what has been said. Do not repeat points already made unless adding new depth.`
      : `Open with your core perspective on this topic from your area of expertise.`,
  ].filter(Boolean).join('\n');
}

function buildModeratorOpenPrompt(question: string, council: Council): string {
  const system = [
    `You are a neutral, incisive council moderator.`,
    `Your job: open the session, set context, and frame the key questions.`,
    `Be brief (60–80 words). Identify the 2–3 dimensions experts should address.`,
    `Do NOT give opinions. Do NOT answer the question. Set the stage only.`,
  ].join('\n');

  const user = [
    `Open this council session on: "${question}"`,
    `Council focus: ${council.focus ?? 'general analysis'}`,
    `Experts attending: ${council.persona_ids.map(id => { try { return getPersona(id).name; } catch { return id; } }).join(', ')}.`,
    `Frame the session in 2–3 sentences. Identify the key tensions or trade-offs to explore.`,
  ].join('\n');

  return JSON.stringify({ system, user });
}

function buildModeratorSummaryPrompt(
  question: string,
  transcript: Message[],
  round: number
): string {
  const system = [
    `You are a neutral council moderator.`,
    `Your job: summarise what was said this round and sharpen focus for the next round.`,
    `Be brief (60–80 words). Identify key agreements AND key disagreements.`,
    `End with ONE specific focus question for the next round.`,
    `Do NOT give your own opinion.`,
  ].join('\n');

  const roundMessages = transcript.filter(m => m.round === round);
  const user = [
    `Topic: "${question}"`,
    ``,
    `Round ${round} contributions:`,
    roundMessages.map(m => `[${m.speaker}]: ${m.content}`).join('\n\n'),
    ``,
    `Summarise key points of agreement and disagreement. End with a sharp focus question for Round ${round + 1}.`,
  ].join('\n');

  return JSON.stringify({ system, user });
}

function buildSynthesisPrompt(question: string, transcript: Message[]): string {
  const system = [
    `You are a synthesis engine. You have observed a full expert council debate.`,
    `Produce a structured synthesis. Be ruthlessly concise and specific.`,
    ``,
    `Output EXACTLY this JSON structure:`,
    `{`,
    `  "decisions": ["...", "..."],       // 2–4 clear recommendations or conclusions`,
    `  "dissent": ["...", "..."],          // 1–3 minority views or unresolved disagreements`,
    `  "open_questions": ["...", "..."],   // 1–3 questions the council did NOT resolve`,
    `  "actions": ["...", "..."],          // 2–4 concrete next steps`,
    `  "confidence": "low|medium|high",   // overall council confidence in its output`,
    `  "summary": "..."                   // 2–3 sentence plain English summary for a busy executive`,
    `}`,
    ``,
    `Output ONLY the JSON. No preamble, no explanation.`,
  ].join('\n');

  const user = [
    `Question debated: "${question}"`,
    ``,
    `Full transcript:`,
    transcript.map(m => `[${m.speaker}]: ${m.content}`).join('\n\n'),
  ].join('\n');

  return JSON.stringify({ system, user });
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

function printDivider(label: string, color: chalk.Chalk = chalk.dim): void {
  const width = 70;
  const pad = Math.max(0, Math.floor((width - label.length - 2) / 2));
  console.log(color('─'.repeat(pad) + ' ' + label + ' ' + '─'.repeat(pad)));
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

function printSpeakerHeader(name: string, role: string, round: number): void {
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

  const personaIds = personaOverrides ?? council.persona_ids;
  const personas = personaIds.map(id => getPersona(id));

  printHeader(question, council.name);

  // ── Moderator: Open ──────────────────────────────────────────────────────

  printModeratorHeader('Opening');

  const moderatorOpenRaw = buildModeratorOpenPrompt(question, council);
  const { system: modOpenSys, user: modOpenUser } = JSON.parse(moderatorOpenRaw);
  const activeProvider = getActiveProvider(config);

  process.stdout.write(chalk.cyan('  '));
  const moderatorOpen = await callProvider(
    { system: modOpenSys, user: modOpenUser, max_tokens: 150 },
    activeProvider,
    config,
    undefined,
    (token) => process.stdout.write(chalk.cyan(token))
  );
  console.log('\n');

  transcript.push({
    speaker: 'Moderator',
    speaker_role: 'Council Moderator',
    content: moderatorOpen,
    round: 0,
    timestamp: new Date().toISOString(),
  });

  // ── Rounds ───────────────────────────────────────────────────────────────

  for (let round = 1; round <= council.rounds; round++) {
    console.log('');
    console.log(chalk.bold.white(`  ── Round ${round} of ${council.rounds} ──`));

    for (const persona of personas) {
      printSpeakerHeader(persona.name, persona.role, round);

      const provider = (persona.provider as typeof activeProvider | undefined) ?? activeProvider;
      const userPrompt = buildPersonaUserPrompt(persona, question, transcript, round);
      const systemPrompt = buildPersonaSystemPrompt(persona);

      process.stdout.write(chalk.white('  '));
      const response = await callProvider(
        { system: systemPrompt, user: userPrompt, max_tokens: config.max_tokens_per_turn },
        provider,
        config,
        persona.model,
        (token) => process.stdout.write(chalk.white(token))
      );
      console.log('\n');

      transcript.push({
        speaker: persona.name,
        speaker_role: persona.role,
        content: response,
        round,
        timestamp: new Date().toISOString(),
      });
    }

    // Moderator summary between rounds
    if (round < council.rounds) {
      printModeratorHeader(`Round ${round} Summary`);

      const summaryRaw = buildModeratorSummaryPrompt(question, transcript, round);
      const { system: sumSys, user: sumUser } = JSON.parse(summaryRaw);

      process.stdout.write(chalk.cyan('  '));
      const summary = await callProvider(
        { system: sumSys, user: sumUser, max_tokens: 150 },
        activeProvider,
        config,
        undefined,
        (token) => process.stdout.write(chalk.cyan(token))
      );
      console.log('\n');

      transcript.push({
        speaker: 'Moderator',
        speaker_role: 'Council Moderator',
        content: summary,
        round,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── Synthesis ────────────────────────────────────────────────────────────

  printDivider('GENERATING SYNTHESIS', chalk.dim);

  const synthRaw = buildSynthesisPrompt(question, transcript);
  const { system: synthSys, user: synthUser } = JSON.parse(synthRaw);

  let synthText = '';
  try {
    synthText = await callProvider(
      { system: synthSys, user: synthUser, max_tokens: 600, temperature: 0.3 },
      activeProvider,
      config,
      undefined,
      null // no streaming for synthesis — we need clean JSON
    );

    // Strip markdown code fences if present
    synthText = synthText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  } catch (e) {
    synthText = '{}';
  }

  let synthesis: Synthesis;
  try {
    synthesis = JSON.parse(synthText);
  } catch {
    // Fallback if JSON parse fails
    synthesis = {
      decisions: ['Council completed — see transcript for full details'],
      dissent: [],
      open_questions: [],
      actions: ['Review full session transcript'],
      confidence: 'medium',
      summary: 'Council session completed. See transcript for detailed perspectives.',
    };
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
  };
}
