import fs from 'fs';
import os from 'os';
import path from 'path';
import { EklavyaConfig, ProviderName } from './types.js';

export const CONFIG_DIR   = path.join(os.homedir(), '.eklavya');
export const CONFIG_FILE  = path.join(CONFIG_DIR, 'config.json');
export const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
export const PERSONAS_DIR = path.join(CONFIG_DIR, 'personas');
export const COUNCILS_DIR = path.join(CONFIG_DIR, 'councils');

export const DEFAULTS: EklavyaConfig = {
  providers: {},
  default_provider: 'anthropic',
  default_council: 'software-architecture',
  default_rounds: 2,
  stream: true,
  max_tokens_per_turn: 400,
};

export function getConfigDir(): string   { return CONFIG_DIR;   }
export function getSessionsDir(): string { return SESSIONS_DIR; }
export function getPersonasDir(): string { return PERSONAS_DIR; }
export function getCouncilsDir(): string { return COUNCILS_DIR; }

export function ensureDirs(): void {
  for (const dir of [CONFIG_DIR, SESSIONS_DIR, PERSONAS_DIR, COUNCILS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

export function loadConfig(): EklavyaConfig {
  ensureDirs();

  // Environment variables take precedence
  const fromEnv: EklavyaConfig = { ...DEFAULTS, providers: {} };

  if (process.env.ANTHROPIC_API_KEY) {
    fromEnv.providers.anthropic = {
      api_key: process.env.ANTHROPIC_API_KEY,
      default_model: 'claude-sonnet-4-5-20250929',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    fromEnv.providers.openai = {
      api_key: process.env.OPENAI_API_KEY,
      default_model: 'gpt-4o',
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    fromEnv.providers.google = {
      api_key: process.env.GOOGLE_API_KEY,
      default_model: 'gemini-1.5-pro',
    };
  }

  // Merge with file config
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const fileConfig = JSON.parse(raw);
      return {
        ...fromEnv,
        ...fileConfig,
        providers: {
          ...fromEnv.providers,
          ...fileConfig.providers,
        },
      };
    } catch {
      return fromEnv;
    }
  }

  return fromEnv;
}

export function saveConfig(config: EklavyaConfig): void {
  ensureDirs();
  // Write with restricted permissions (owner read/write only) — protects API keys
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function hasProvider(config: EklavyaConfig, provider: ProviderName): boolean {
  return !!config.providers[provider]?.api_key;
}

export function getActiveProvider(config: EklavyaConfig): ProviderName {
  const pref = config.default_provider;
  if (hasProvider(config, pref)) return pref;
  // Fallback to any configured provider
  for (const p of ['anthropic', 'openai', 'google'] as ProviderName[]) {
    if (hasProvider(config, p)) return p;
  }
  throw new Error(
    'No API key configured. Run: eklavya init\n' +
    'Or set ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY environment variable.'
  );
}
