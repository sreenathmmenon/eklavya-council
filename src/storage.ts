/**
 * File-based session storage.
 * Sessions saved as JSON in ~/.eklavya/sessions/<id>.json
 * No external dependencies — works everywhere Node.js runs.
 */

import fs from 'fs';
import path from 'path';
import { Session } from './types.js';
import { getSessionsDir, ensureDirs } from './config.js';

const DISCLAIMER = [
  '---',
  '## ⚠ Important Disclaimer',
  '',
  '**Eklavya Council** generates AI-simulated debate perspectives. All personas are AI-generated archetypes — they are not real people and do not represent the views of any individual or organisation.',
  '',
  'This output is a **thinking tool only**. It is **not** professional, legal, medical, financial, psychological, or crisis advice of any kind.',
  '',
  '**You must not rely on this output as a substitute for:**',
  '- Qualified medical, mental health, or therapeutic professional guidance',
  '- Legal counsel or regulated financial advice',
  '- Emergency services or crisis intervention',
  '',
  '**If you or someone you know is in crisis:**',
  '- **988 Suicide & Crisis Lifeline** — call or text **988** (US, available 24/7)',
  '- **Crisis Text Line** — text **HOME** to **741741** (US, UK, CA, IE)',
  '- **International resources** — findahelpline.com',
  '- **Emergency services** — call your local emergency number (911 / 999 / 112)',
  '',
  'User-defined persona content is the responsibility of the user who created it.',
].join('\n');

export function saveSession(session: Session): string {
  ensureDirs();
  const dir = getSessionsDir();
  const file = path.join(dir, `${session.id}.json`);
  // Save with restricted permissions — sessions may contain sensitive questions
  fs.writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 });
  return file;
}

export function loadSession(id: string): Session {
  const dir = getSessionsDir();
  const file = path.join(dir, `${id}.json`);

  if (!fs.existsSync(file)) {
    throw new Error(`Session not found: ${id}`);
  }

  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Session;
}

export function listSessions(limit = 20): Session[] {
  ensureDirs();
  const dir = getSessionsDir();

  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { file: full, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(f.file, 'utf-8')) as Session;
    } catch {
      return null;
    }
  }).filter(Boolean) as Session[];
}

export function deleteSession(id: string): boolean {
  const dir = getSessionsDir();
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

export function exportSessionMarkdown(session: Session): string {
  const lines: string[] = [
    `# Eklavya Council Session`,
    ``,
    `**Question:** ${session.question}`,
    `**Council:** ${session.council_name}`,
    `**Date:** ${new Date(session.created_at).toLocaleString()}`,
    `**Duration:** ${session.duration_seconds}s`,
    `**Personas:** ${session.persona_count} | **Rounds:** ${session.rounds}`,
    session.provider_calls ? `**API calls:** ${session.provider_calls}` : '',
    ``,
    `---`,
    ``,
    `## Transcript`,
    ``,
  ].filter(l => l !== '');

  let lastRound = -99;
  for (const msg of session.transcript) {
    if (msg.round !== lastRound) {
      if (msg.round === 0) {
        lines.push(`### Opening`);
      } else if (msg.round === -1) {
        lines.push(`### Synthesis`);
      } else {
        lines.push(`### Round ${msg.round}`);
      }
      lines.push('');
      lastRound = msg.round;
    }
    lines.push(`**${msg.speaker}** *(${msg.speaker_role})*`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Synthesis');
  lines.push('');

  if (session.synthesis.summary) {
    lines.push(`> ${session.synthesis.summary}`);
    lines.push('');
  }

  if (session.synthesis.decisions.length > 0) {
    lines.push('### ✓ Decisions');
    session.synthesis.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    lines.push('');
  }

  if (session.synthesis.dissent.length > 0) {
    lines.push('### ⚡ Dissent');
    session.synthesis.dissent.forEach(d => lines.push(`- ${d}`));
    lines.push('');
  }

  if (session.synthesis.open_questions.length > 0) {
    lines.push('### ? Open Questions');
    session.synthesis.open_questions.forEach(q => lines.push(`- ${q}`));
    lines.push('');
  }

  if (session.synthesis.actions.length > 0) {
    lines.push('### → Actions');
    session.synthesis.actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');
  }

  lines.push(`*Confidence: ${session.synthesis.confidence.toUpperCase()}*`);
  lines.push('');
  lines.push(DISCLAIMER);
  lines.push('');
  lines.push('---');
  lines.push('*Generated by [Eklavya Council](https://github.com/sreenathmmenon/eklavya-council)*');

  return lines.join('\n');
}
