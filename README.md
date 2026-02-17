# Eklavya Virtual Council

> *Eklavya learned from a clay idol of his guru when no real teacher would take him. This tool is your virtual council when no expert is available.*

**Eklavya** is a multi-persona LLM debate engine. You pose a question. A council of named expert personas debate it in structured rounds. A synthesis engine produces decisions, dissent, open questions, and action items.

Not a chatbot. A **thinking environment**.

---

## What it does

```
You: "Should we migrate to microservices?"

EKLAVYA  ·  Software Architecture Council
══════════════════════════════════════════

── MODERATOR  ·  Opening ─────────────────
We're examining microservices migration across three dimensions:
team topology fit, operational complexity, and long-term scalability.

── MARTIN KLEPPMANN  ·  Distributed Systems ─────
The question is poorly formed. "Microservices" is a deployment
topology, not an architecture. What you're actually asking is whether
Conway's Law alignment justifies the operational overhead...

── THE SKEPTIC  ·  Senior Engineer ──────
I've seen three companies do this migration. Two of them spent 18 months
and ended up with a distributed monolith harder to debug than what
they started with...

── SYNTHESIS ─────────────────────────────
✓ DECISIONS
  1. Do not migrate — team cognitive load cannot support it at current size
  2. Address the real problem: module coupling inside the monolith first

⚡ DISSENT
  · Kleppmann: question needs reframing — this isn't an architecture question

→ ACTIONS
  1. Run Team Topologies assessment before any architecture discussion
  2. Measure current deployment frequency as baseline
```

---

## Install

```bash
# From source
git clone https://github.com/sreenathmmenon/eklavya-council.git
cd eklavya-council
npm install
npm run build
npm link
```

---

## Quick Start

```bash
# Configure API key (one-time)
eklavya init

# Or set environment variable directly
export ANTHROPIC_API_KEY=sk-ant-...

# Ask a question
eklavya ask "Should we use microservices?"

# Specify council
eklavya ask "Should I take this job offer?" --council career-decision

# More debate rounds
eklavya ask "What is wrong with our architecture?" --rounds 3

# Save to markdown
eklavya ask "Evaluate our startup idea" --council startup-idea --output session.md

# Use specific personas (override council)
eklavya ask "Tabs vs spaces" --personas "skeptic,pragmatist,devil-advocate"
```

---

## Councils

| Council | Personas | Best for |
|---|---|---|
| `software-architecture` | Kleppmann, Skeptic, Pragmatist, Security, CFO | Architecture, tech choices, system design |
| `product-strategy` | CEO, Pragmatist, Visionary, Devil's Advocate, CFO | Product direction, features, build vs buy |
| `career-decision` | Mentor, Realist, Ambitious Challenger, Stoic | Career moves, pivots, learning investments |
| `startup-idea` | CEO, CFO, Skeptic, Visionary, Devil's Advocate | Startup validation, business model review |
| `code-review` | Kleppmann, Security Expert, Pragmatist, Hightower | Architectural code review |
| `personal-decision` | Stoic, Realist, Mentor, Ambitious Challenger | Life decisions, priorities |
| `deep-debate` | 7 experts, 3 rounds | Comprehensive technical analysis |
| `learning-path` | Jeff Dean, Hightower, Mentor, Pragmatist | What to learn next |

---

## Personas

### Tech Experts
| ID | Name | Role |
|---|---|---|
| `martin-kleppmann` | Martin Kleppmann | Distributed Systems Author (DDIA) |
| `jeff-dean` | Jeff Dean | Large-Scale Systems (Google) |
| `gwen-shapira` | Gwen Shapira | Kafka PMC / Confluent |
| `kelsey-hightower` | Kelsey Hightower | Kubernetes / Cloud Native |
| `dan-abramov` | Dan Abramov | React Core / Meta |
| `werner-vogels` | Werner Vogels | CTO, AWS |

### Archetypes
| ID | Role |
|---|---|
| `skeptic` | Senior Engineer (10 years battle scars) |
| `pragmatist` | Staff Engineer / Ship It Person |
| `devil-advocate` | Hired Contrarian |
| `cfo` | Chief Financial Officer |
| `ceo` | Chief Executive Officer |
| `security-expert` | Principal Security Engineer |
| `visionary` | CTO / Futurist |

### Life & Career
| ID | Role |
|---|---|
| `mentor` | Experienced Advisor |
| `realist` | Ground Truth Provider |
| `ambitious-challenger` | High-Performance Coach |
| `stoic` | Philosophical Advisor |

---

## Multi-Provider Support

```bash
# Single provider
export ANTHROPIC_API_KEY=sk-ant-...
eklavya ask "..."

# Multiple providers — set both, eklavya uses what's available
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
eklavya ask "..." --provider openai  # override for this session
```

Supported: `anthropic` (Claude), `openai` (GPT-4o), `google` (Gemini)

---

## CLI Reference

```
eklavya init                     Configure API keys and defaults
eklavya ask [question]           Convene a council
  -c, --council <id>             Council to use
  -r, --rounds <n>               Debate rounds (1-3)
  -p, --personas <ids>           Comma-separated persona overrides
  --provider <name>              Override LLM provider
  --no-stream                    Disable streaming output
  -o, --output <file>            Export session to markdown

eklavya councils list            List all councils
eklavya personas list            List all personas
eklavya personas show <id>       Show persona details

eklavya sessions list            List recent sessions
eklavya sessions show <id>       Display a past session
eklavya sessions export <id>     Export session to markdown

eklavya status                   Show configuration status
```

---

## UI (Phase 2)

A web UI is included in `ui/` (Next.js 15 + Tailwind).

```bash
cd ui
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
# Open http://localhost:3000
```

---

## Architecture

```
eklavya ask "question"
        │
        ▼
CouncilRunner (src/orchestrator.ts)
  Loads council + personas
  Runs rounds:
    Moderator opens → Each persona speaks → Moderator summarises
  Synthesis agent produces structured JSON
        │
        ▼
Provider Abstraction (src/providers.ts)
  Unified streaming interface
  Anthropic | OpenAI | Google Gemini
        │
        ▼
Storage (src/storage.ts)
  ~/.eklavya/sessions/<id>.json
  Replayable, exportable to markdown
```

---

## Use Cases

- **Architecture decisions** — 5 expert viewpoints in 3 minutes
- **Doubt clearance** — Ask Kleppmann and Gwen Shapira your Kafka question
- **Career decisions** — Mentor, Realist, and Ambitious Challenger weigh in
- **Mentoring** — Socratic debate that teaches through conflict
- **Product strategy** — CEO + CFO + Skeptic before committing resources
- **Personal decisions** — Stoic + Realist + Long-term thinker at 2am

---

## Roadmap

- [x] CLI with streaming output
- [x] Multi-provider support (Anthropic, OpenAI, Google)
- [x] 8 built-in councils, 17 built-in personas
- [x] Session history and markdown export
- [ ] Web UI (Next.js) — scaffold in `ui/`
- [ ] Custom persona creation
- [ ] Custom council builder
- [ ] Persona memory across sessions
- [ ] Ollama local model support (offline mode)
- [ ] Shareable session links

---

## Contributing

Contributions welcome — especially new personas and council templates.
Open an issue or PR at [github.com/sreenathmmenon/eklavya-council](https://github.com/sreenathmmenon/eklavya-council).

---

*"Theory is cheap. These decisions have scar tissue behind them."*

**License:** MIT
