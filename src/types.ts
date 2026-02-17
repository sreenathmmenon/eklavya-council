// ─── Core Domain Types ──────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  role: string;
  expertise: string[];
  style: string;           // communication style and tone
  bias?: string;           // known perspective/bias to make debate richer
  contrarian_level: number; // 0.0 (agreeable) → 1.0 (challenges everything)
  verbosity: 'brief' | 'medium' | 'detailed';
  provider?: string;       // override: 'anthropic' | 'openai' | 'google'
  model?: string;          // override specific model for this persona
}

export interface Council {
  id: string;
  name: string;
  description: string;
  persona_ids: string[];   // ordered list of persona ids
  rounds: number;          // how many full debate rounds
  focus?: string;          // optional domain context injected into moderator
}

export interface Message {
  speaker: string;
  speaker_role: string;
  content: string;
  round: number;           // 0 = moderator open, N = round N, -1 = synthesis
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
