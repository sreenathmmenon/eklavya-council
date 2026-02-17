import fs from 'fs';
import os from 'os';
import path from 'path';
import { EklavyaConfig, ProviderName } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.eklavya');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

export const DEFAULTS: EklavyaConfig = {
  providers: {},
  default_provider: 'anthropic',
  default_council: 'software-architecture',
  default_rounds: 2,
  stream: true,
  max_tokens_per_turn: 400,
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getSessionsDir(): string {
  return SESSIONS_DIR;
}

export function ensureDirs(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function loadConfig(): EklavyaConfig {
  ensureDirs();

  // Environment variables take precedence
  const fromEnv: EklavyaConfig = { ...DEFAULTS, providers: {} };

  if (process.env.ANTHROPIC_API_KEY) {
    fromEnv.providers.anthropic = {
      api_key: process.env.ANTHROPIC_API_KEY,
      default_model: 'claude-3-5-sonnet-20241022',
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
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
    'Or set ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable.'
  );
}
