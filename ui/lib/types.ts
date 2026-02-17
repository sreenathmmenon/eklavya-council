export interface Message {
  speaker: string;
  speaker_role: string;
  content: string;
  round: number;
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

export interface Persona {
  id: string;
  name: string;
  role: string;
  expertise: string[];
  style: string;
}

export interface Council {
  id: string;
  name: string;
  description: string;
  persona_ids: string[];
  rounds: number;
}

export interface StreamChunk {
  type: 'token' | 'speaker_start' | 'round_start' | 'synthesis' | 'done' | 'error';
  speaker?: string;
  speaker_role?: string;
  round?: number;
  token?: string;
  synthesis?: Synthesis;
  error?: string;
}
