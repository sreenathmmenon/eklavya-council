// ─── Core Domain Types ──────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  display_name?: string;    // optional override for exports (e.g. "Senior Architect" instead of a personal name)
  role: string;
  expertise: string[];
  style: string;            // communication style and tone
  bias?: string;            // known perspective/bias to make debate richer
  contrarian_level: number; // 0.0 (agreeable) → 1.0 (challenges everything)
  verbosity: 'brief' | 'medium' | 'detailed';
  provider?: string;        // override: 'anthropic' | 'openai' | 'google'
  model?: string;           // override specific model for this persona
}

export interface Council {
  id: string;
  name: string;
  description: string;
  persona_ids: string[];    // ordered list of persona ids
  rounds: number;           // how many full debate rounds (1–3)
  focus?: string;           // optional domain context injected into moderator
}

export interface Message {
  speaker: string;
  speaker_role: string;
  content: string;
  round: number;            // 0 = moderator open, N = round N, -1 = synthesis
  timestamp: string;
}

export interface Synthesis {
  decisions: string[];
  dissent: string[];
  open_questions: string[];
  actions: string[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

export interface Session {
  id: string;
  question: string;
  council_id: string;
  council_name: string;
  transcript: Message[];
  synthesis: Synthesis;
  created_at: string;
  duration_seconds: number;
  persona_count: number;
  rounds: number;
  cost_usd?: number;        // estimated API cost for the session
  model_versions?: Record<string, string>; // persona_id → model used
  provider_calls?: number;  // total number of LLM calls made
}

// ─── Provider Types ──────────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'openai' | 'google';

export interface ProviderConfig {
  api_key: string;
  default_model: string;
}

export interface LLMRequest {
  system: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
}

export type StreamCallback = (token: string) => void;

// ─── Config ──────────────────────────────────────────────────────────────────

export interface EklavyaConfig {
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  default_provider: ProviderName;
  default_council: string;
  default_rounds: number;
  stream: boolean;
  max_tokens_per_turn: number;
}

// ─── CLI Options ─────────────────────────────────────────────────────────────

export interface AskOptions {
  council?: string;
  rounds?: number;
  personas?: string;
  provider?: string;
  noStream?: boolean;
  output?: string;
}

// ─── Streaming (Web UI) ──────────────────────────────────────────────────────

export interface StreamChunk {
  type: 'token' | 'speaker_start' | 'round_start' | 'synthesis' | 'done' | 'error';
  speaker?: string;
  speaker_role?: string;
  round?: number;
  token?: string;
  synthesis?: Synthesis;
  error?: string;
}
