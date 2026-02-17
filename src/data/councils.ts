/**
 * Built-in council templates.
 * Each council is a curated group of personas optimised for a specific decision type.
 *
 * Persona IDs reference only built-in archetypes (no real people).
 * Users add custom councils via `eklavya council create`.
 */

import fs from 'fs';
import path from 'path';
import { Council } from '../types.js';
import { getCouncilsDir, ensureDirs } from '../config.js';

// ─── Built-in Councils ────────────────────────────────────────────────────────

export const BUILTIN_COUNCILS: Record<string, Council> = {
  'software-architecture': {
    id: 'software-architecture',
    name: 'Software Architecture Council',
    description: 'Architecture decisions, technology choices, system design trade-offs, and migration planning.',
    persona_ids: ['distributed-systems-expert', 'skeptic', 'pragmatist', 'security-expert', 'cfo'],
    rounds: 2,
    focus: 'software systems, distributed architecture, reliability, cost, and operational complexity',
  },

  'product-strategy': {
    id: 'product-strategy',
    name: 'Product Strategy Council',
    description: 'Product direction, feature prioritisation, build vs buy, and go-to-market decisions.',
    persona_ids: ['ceo', 'pragmatist', 'visionary', 'devil-advocate', 'cfo'],
    rounds: 2,
    focus: 'product-market fit, customer value, competitive position, and execution feasibility',
  },

  'career-decision': {
    id: 'career-decision',
    name: 'Career Decision Council',
    description: 'Career moves, job decisions, pivots, learning investments, and professional direction.',
    persona_ids: ['mentor', 'realist', 'ambitious-challenger', 'stoic'],
    rounds: 2,
    focus: 'long-term career trajectory, risk, opportunity, and personal fulfilment',
  },

  'startup-idea': {
    id: 'startup-idea',
    name: 'Startup Idea Council',
    description: 'Evaluating startup ideas, business models, market opportunity, and competitive moats.',
    persona_ids: ['ceo', 'cfo', 'skeptic', 'visionary', 'devil-advocate'],
    rounds: 2,
    focus: 'market size, differentiation, execution risk, unit economics, and timing',
  },

  'code-review': {
    id: 'code-review',
    name: 'Code Review Council',
    description: 'Architectural code review — design patterns, maintainability, correctness, and security.',
    persona_ids: ['distributed-systems-expert', 'security-expert', 'pragmatist', 'cloud-native-expert'],
    rounds: 2,
    focus: 'code design, maintainability, security, correctness, and operational concerns',
  },

  'personal-decision': {
    id: 'personal-decision',
    name: 'Personal Decision Council',
    description: 'Big life decisions — where to live, relationships, major purchases, priorities.',
    persona_ids: ['stoic', 'realist', 'mentor', 'ambitious-challenger'],
    rounds: 2,
    focus: 'values alignment, long-term impact, risk, and personal truth',
  },

  'learning-path': {
    id: 'learning-path',
    name: 'Learning Path Council',
    description: 'What to learn next, skill gaps, curriculum design, and knowledge priorities.',
    persona_ids: ['large-scale-systems-engineer', 'cloud-native-expert', 'mentor', 'pragmatist'],
    rounds: 2,
    focus: 'high-leverage skills, depth vs breadth, market demand, and learning efficiency',
  },

  'deep-debate': {
    id: 'deep-debate',
    name: 'Deep Technical Debate',
    description: 'Full technical council with diverse expert viewpoints. More personas, more rounds.',
    persona_ids: ['distributed-systems-expert', 'large-scale-systems-engineer', 'data-engineer', 'cloud-native-expert', 'skeptic', 'security-expert', 'cfo'],
    rounds: 3,
    focus: 'comprehensive technical analysis from multiple expert perspectives',
  },
};

// ─── User-owned Councils ──────────────────────────────────────────────────────

function loadUserCouncils(): Record<string, Council> {
  try {
    ensureDirs();
    const dir = getCouncilsDir();
    const result: Record<string, Council> = {};
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const council = JSON.parse(raw) as Council;
        if (council.id) result[council.id] = council;
      } catch {
        // Skip malformed files
      }
    }
    return result;
  } catch {
    return {};
  }
}

function getAllCouncils(): Record<string, Council> {
  return { ...BUILTIN_COUNCILS, ...loadUserCouncils() };
}

export function getCouncil(id: string): Council {
  const all = getAllCouncils();
  const c = all[id];
  if (!c) throw new Error(`Council not found: "${id}". Run: eklavya council list`);
  return c;
}

export function listCouncils(): Council[] {
  return Object.values(getAllCouncils());
}

export function listUserCouncils(): Council[] {
  return Object.values(loadUserCouncils());
}

/** Save a council to ~/.eklavya/councils/<id>.json */
export function saveUserCouncil(council: Council): string {
  ensureDirs();
  const dir = getCouncilsDir();
  const file = path.join(dir, `${council.id}.json`);
  fs.writeFileSync(file, JSON.stringify(council, null, 2), { mode: 0o600 });
  return file;
}

/** Delete a user council by ID. Returns false if built-in. */
export function deleteUserCouncil(id: string): boolean {
  if (BUILTIN_COUNCILS[id]) return false;
  const dir = getCouncilsDir();
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

export function isBuiltinCouncil(id: string): boolean {
  return !!BUILTIN_COUNCILS[id];
}
