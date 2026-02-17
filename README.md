# Eklavya Council

> *Eklavya learned from a clay idol of his guru when no real teacher would take him. This tool is your virtual council when no expert is available.*

**Eklavya Council** — the debate your question deserves. You pose a question. A council of expert AI personas debate it in structured rounds. A synthesis engine produces decisions, dissent, open questions, and action items.

Not a chatbot. A **thinking environment**.

> ⚠ **Disclaimer:** Eklavya Council generates AI-simulated debate perspectives. All personas are AI-generated archetypes — not real people. Output is a **thinking tool only** — not professional, legal, medical, financial, or psychological advice. Never use this as a substitute for qualified professional help. **In a crisis, call 988 (US) or your local emergency number.**

---

## What it does

```
You: "Should we migrate to microservices?"

EKLAVYA COUNCIL  ·  Software Architecture Council
══════════════════════════════════════════════════

── MODERATOR  ·  Opening ─────────────────────────
We're examining microservices migration across three dimensions:
team topology fit, operational complexity, and long-term scalability.

── DISTRIBUTED SYSTEMS EXPERT ────────────────────
The question is poorly formed. "Microservices" is a deployment
topology, not an architecture. What you're actually asking is whether
Conway's Law alignment justifies the operational overhead...

── THE SKEPTIC  ·  Senior Engineer ───────────────
I've seen three companies do this migration. Two of them spent 18 months
and ended up with a distributed monolith harder to debug than what
they started with...

── SYNTHESIS ──────────────────────────────────────
✓ DECISIONS
  1. Do not migrate — team cognitive load cannot support it at current size
  2. Address the real problem: module coupling inside the monolith first

⚡ DISSENT
  · Systems Expert: question needs reframing — this isn't an architecture question

→ ACTIONS
  1. Run Team Topologies assessment before any architecture discussion
  2. Measure current deployment frequency as baseline
```

---

## Install

```bash
npm install -g eklavya-council
```

Or from source:

```bash
git clone https://github.com/sreenathmmenon/eklavya-council.git
cd eklavya-council
npm install && npm run build && npm link
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

| Council | Best for |
|---|---|
| `software-architecture` | Architecture, tech choices, system design |
| `product-strategy` | Product direction, features, build vs buy |
| `career-decision` | Career moves, pivots, learning investments |
| `startup-idea` | Startup validation, business model review |
| `code-review` | Architectural code review, patterns, security |
| `personal-decision` | Life decisions, priorities, values |
| `deep-debate` | 7 experts · 3 rounds · comprehensive analysis |
| `learning-path` | What to learn next, skill priorities |

---

## Personas

### Domain Experts (Archetypes)
| ID | Role |
|---|---|
| `distributed-systems-expert` | Author & Researcher in Distributed Systems |
| `cloud-native-expert` | Cloud Infrastructure & Kubernetes Practitioner |
| `data-engineer` | Data Platform & Streaming Specialist |
| `large-scale-systems-engineer` | Hyperscale Infrastructure Architect |
| `frontend-architect` | Frontend Systems & Developer Experience Lead |
| `security-expert` | Principal Security Engineer |

### Debate Archetypes
| ID | Role |
|---|---|
| `skeptic` | Senior Engineer (10+ years battle scars) |
| `pragmatist` | Staff Engineer / Ship It Person |
| `devil-advocate` | Hired Contrarian |
| `cfo` | Chief Financial Officer |
| `ceo` | Chief Executive Officer |
| `visionary` | CTO / Futurist |

### Life & Career
| ID | Role |
|---|---|
| `mentor` | Experienced Advisor |
| `realist` | Ground Truth Provider |
| `ambitious-challenger` | High-Performance Coach |
| `stoic` | Philosophical Advisor |

> **Custom personas:** Create your own with `eklavya persona add` — stored locally in `~/.eklavya/personas/`.

---

## Multi-Provider Support

```bash
# Anthropic (default)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Google Gemini
export GOOGLE_API_KEY=...

# Override provider for a session
eklavya ask "..." --provider openai
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
eklavya council add              Create a custom council
eklavya council delete <id>      Delete a custom council

eklavya personas list            List all personas
eklavya persona add              Create a custom persona
eklavya personas show <id>       Show persona details

eklavya sessions list            List recent sessions
eklavya sessions show <id>       Display a past session
eklavya sessions export <id>     Export session to markdown

eklavya status                   Show configuration status
```

---

## Web UI

A web UI is included in `ui/` (Next.js 15 + Tailwind). Live streaming, per-persona colours, council verdict panel.

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

- **Architecture decisions** — multiple expert viewpoints in minutes
- **Career decisions** — Mentor, Realist, and Ambitious Challenger weigh in
- **Startup validation** — CEO + CFO + Skeptic before committing resources
- **Personal decisions** — Stoic + Realist + Mentor at 2am
- **Code review** — Security, Systems, and Pragmatist perspectives
- **Learning path** — What to learn next from multiple angles

---

## Roadmap

- [x] CLI with streaming output
- [x] Multi-provider support (Anthropic, OpenAI, Google)
- [x] 8 built-in councils, 16 built-in personas
- [x] Session history and markdown export
- [x] Custom persona and council creation
- [x] Web UI (Next.js + Tailwind) with live streaming
- [ ] Persona memory across sessions
- [ ] Ollama local model support (offline mode)
- [ ] Shareable session links

---

## Safety & Limitations

- All personas are **AI-generated archetypes** — not real people
- Output is a **thinking tool**, not authoritative advice
- Not a substitute for medical, legal, financial, or mental health professionals
- **Crisis resources:** 988 Suicide & Crisis Lifeline (US) · Crisis Text Line: text HOME to 741741

---

## Contributing

Contributions welcome — especially new personas and council templates.
Open an issue or PR at [github.com/sreenathmmenon/eklavya-council](https://github.com/sreenathmmenon/eklavya-council).

---

*"The debate your question deserves."*

**License:** MIT · **Author:** Sreenath
