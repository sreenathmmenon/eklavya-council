import { Council } from '../types.js';

/**
 * Built-in council templates.
 * Each council is a curated group of personas optimised for a specific decision type.
 */

export const COUNCILS: Record<string, Council> = {
  'software-architecture': {
    id: 'software-architecture',
    name: 'Software Architecture Council',
    description: 'For architecture decisions, technology choices, system design trade-offs, and migration planning.',
    persona_ids: ['martin-kleppmann', 'skeptic', 'pragmatist', 'security-expert', 'cfo'],
    rounds: 2,
    focus: 'software systems, distributed architecture, reliability, cost, and operational complexity',
  },

  'product-strategy': {
    id: 'product-strategy',
    name: 'Product Strategy Council',
    description: 'For product direction, feature prioritisation, build vs buy, and go-to-market decisions.',
    persona_ids: ['ceo', 'pragmatist', 'visionary', 'devil-advocate', 'cfo'],
    rounds: 2,
    focus: 'product-market fit, customer value, competitive position, and execution feasibility',
  },

  'career-decision': {
    id: 'career-decision',
    name: 'Career Decision Council',
    description: 'For career moves, job decisions, pivots, learning investments, and professional direction.',
    persona_ids: ['mentor', 'realist', 'ambitious-challenger', 'stoic'],
    rounds: 2,
    focus: 'long-term career trajectory, risk, opportunity, and personal fulfilment',
  },

  'startup-idea': {
    id: 'startup-idea',
    name: 'Startup Idea Council',
    description: 'For evaluating startup ideas, business models, market opportunity, and competitive moats.',
    persona_ids: ['ceo', 'cfo', 'skeptic', 'visionary', 'devil-advocate'],
    rounds: 2,
    focus: 'market size, differentiation, execution risk, unit economics, and timing',
  },

  'code-review': {
    id: 'code-review',
    name: 'Code Review Council',
    description: 'For architectural code review — not line-by-line but design patterns, maintainability, and correctness.',
    persona_ids: ['martin-kleppmann', 'security-expert', 'pragmatist', 'kelsey-hightower'],
    rounds: 2,
    focus: 'code design, maintainability, security, correctness, and operational concerns',
  },

  'personal-decision': {
    id: 'personal-decision',
    name: 'Personal Decision Council',
    description: 'For big life decisions — where to live, relationships, major purchases, priorities.',
    persona_ids: ['stoic', 'realist', 'mentor', 'ambitious-challenger'],
    rounds: 2,
    focus: 'values alignment, long-term impact, risk, and personal truth',
  },

  'learning-path': {
    id: 'learning-path',
    name: 'Learning Path Council',
    description: 'For deciding what to learn next, skill gaps, curriculum design, and knowledge priorities.',
    persona_ids: ['jeff-dean', 'kelsey-hightower', 'mentor', 'pragmatist'],
    rounds: 2,
    focus: 'high-leverage skills, depth vs breadth, market demand, and learning efficiency',
  },

  'deep-debate': {
    id: 'deep-debate',
    name: 'Deep Technical Debate',
    description: 'Full technical council with multiple expert viewpoints. More personas, more rounds.',
    persona_ids: ['martin-kleppmann', 'jeff-dean', 'gwen-shapira', 'kelsey-hightower', 'skeptic', 'security-expert', 'cfo'],
    rounds: 3,
    focus: 'comprehensive technical analysis from multiple expert perspectives',
  },
};

export function getCouncil(id: string): Council {
  const c = COUNCILS[id];
  if (!c) throw new Error(`Council not found: "${id}". Run: eklavya councils list`);
  return c;
}

export function listCouncils(): Council[] {
  return Object.values(COUNCILS);
}
