/**
 * Eklavya Council CLI
 *
 * DISCLAIMER: Personas are AI archetypes. Output is a thinking tool,
 * not professional, legal, medical, or financial advice.
 * User-defined persona content is the user's own responsibility.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

import { loadConfig, saveConfig, getActiveProvider, DEFAULTS } from './config.js';
import { runCouncil } from './orchestrator.js';
import { saveSession, listSessions, loadSession, exportSessionMarkdown, deleteSession } from './storage.js';
import { getCouncil, listCouncils, saveUserCouncil, deleteUserCouncil, isBuiltinCouncil, listUserCouncils } from './data/councils.js';
import {
  getPersona, listPersonas, listBuiltinPersonas, listUserPersonas,
  saveUserPersona, deleteUserPersona, isBuiltinPersona
} from './data/personas.js';
import { EklavyaConfig, Persona, Council, ProviderName } from './types.js';

const VERSION = '0.1.0';

// ─── Branding ─────────────────────────────────────────────────────────────────

function printBrand(): void {
  console.log('');
  console.log(chalk.bold.cyan('  ███████╗██╗  ██╗██╗      █████╗ ██╗   ██╗██╗   ██╗ █████╗ '));
  console.log(chalk.bold.cyan('  ██╔════╝██║ ██╔╝██║     ██╔══██╗██║   ██║╚██╗ ██╔╝██╔══██╗'));
  console.log(chalk.bold.cyan('  █████╗  █████╔╝ ██║     ███████║██║   ██║ ╚████╔╝ ███████║'));
  console.log(chalk.bold.cyan('  ██╔══╝  ██╔═██╗ ██║     ██╔══██║╚██╗ ██╔╝  ╚██╔╝  ██╔══██║'));
  console.log(chalk.bold.cyan('  ███████╗██║  ██╗███████╗██║  ██║ ╚████╔╝    ██║   ██║  ██║'));
  console.log(chalk.bold.cyan('  ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝  ╚═══╝     ╚═╝   ╚═╝  ╚═╝'));
  console.log('');
  console.log(chalk.dim('  Eklavya Council  ·  The debate your question deserves.  ·  v' + VERSION));
  console.log(chalk.dim('  Personas are AI archetypes. Output is a thinking tool, not advice.'));
  console.log('');
}

// ─── Program Setup ────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('eklavya')
  .description('Eklavya Council — the debate your question deserves.')
  .version(VERSION);

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Configure API keys and defaults')
  .action(async () => {
    printBrand();
    console.log(chalk.bold('  Configure Eklavya Council'));
    console.log(chalk.dim('  API keys are stored in ~/.eklavya/config.json (mode 600 — owner only)'));
    console.log('');

    const config = loadConfig();

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'default_provider',
        message: 'Default LLM provider:',
        choices: ['anthropic', 'openai', 'google'],
        default: config.default_provider,
      },
      {
        type: 'password',
        name: 'anthropic_key',
        message: 'Anthropic API key (leave blank to skip):',
        default: '',
        mask: '*',
      },
      {
        type: 'password',
        name: 'openai_key',
        message: 'OpenAI API key (leave blank to skip):',
        default: '',
        mask: '*',
      },
      {
        type: 'password',
        name: 'google_key',
        message: 'Google Gemini API key (leave blank to skip):',
        default: '',
        mask: '*',
      },
      {
        type: 'list',
        name: 'default_council',
        message: 'Default council:',
        choices: listCouncils().map(c => ({ name: `${c.id.padEnd(24)} — ${c.description.substring(0, 50)}`, value: c.id })),
        default: config.default_council,
      },
      {
        type: 'number',
        name: 'default_rounds',
        message: 'Default debate rounds (1–3):',
        default: config.default_rounds,
        validate: (v: number) => (v >= 1 && v <= 3) ? true : 'Must be 1, 2, or 3',
      },
    ]);

    const newConfig: EklavyaConfig = {
      ...DEFAULTS,
      providers: {},
      default_provider: answers.default_provider as ProviderName,
      default_council: answers.default_council,
      default_rounds: answers.default_rounds,
      stream: true,
      max_tokens_per_turn: 400,
    };

    // Preserve existing keys if user left blank
    const existingAnthropic = config.providers.anthropic?.api_key;
    const existingOpenAI   = config.providers.openai?.api_key;
    const existingGoogle   = config.providers.google?.api_key;

    const anthropicKey = answers.anthropic_key || existingAnthropic;
    const openaiKey    = answers.openai_key    || existingOpenAI;
    const googleKey    = answers.google_key    || existingGoogle;

    if (anthropicKey) newConfig.providers.anthropic = { api_key: anthropicKey, default_model: 'claude-sonnet-4-5-20250929' };
    if (openaiKey)    newConfig.providers.openai    = { api_key: openaiKey,    default_model: 'gpt-4o' };
    if (googleKey)    newConfig.providers.google    = { api_key: googleKey,    default_model: 'gemini-1.5-pro' };

    saveConfig(newConfig);

    console.log('');
    console.log(chalk.green('  ✓ Configuration saved to ~/.eklavya/config.json (permissions: 600)'));
    console.log('');
    console.log(chalk.white('  Try it:'));
    console.log(chalk.cyan('  eklavya ask "Should we migrate to microservices?"'));
    console.log('');
  });

// ─── ask ──────────────────────────────────────────────────────────────────────

program
  .command('ask [question]')
  .description('Convene a council to debate a question')
  .option('-c, --council <id>', 'Council to use')
  .option('-r, --rounds <n>', 'Number of debate rounds (1–3)', parseInt)
  .option('-p, --personas <ids>', 'Comma-separated persona IDs (overrides council)')
  .option('--provider <name>', 'Override LLM provider (anthropic|openai|google)')
  .option('--no-stream', 'Disable streaming output')
  .option('-o, --output <file>', 'Save session as markdown to file')
  .option('--context <text>', 'Your role/situation — personas will tailor their advice to you')
  .action(async (questionArg: string | undefined, opts) => {
    const config = loadConfig();

    if (opts.provider) config.default_provider = opts.provider as ProviderName;
    if (opts.stream === false) config.stream = false;

    try {
      getActiveProvider(config);
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'));
      process.exit(1);
    }

    let question = questionArg;
    if (!question) {
      const ans = await inquirer.prompt([{
        type: 'input',
        name: 'question',
        message: 'What would you like the council to debate?',
        validate: (v: string) => v.trim().length > 5 ? true : 'Please enter a meaningful question',
      }]);
      question = ans.question;
    }

    const councilId = opts.council ?? config.default_council;
    let council: Council;
    try {
      council = getCouncil(councilId);
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'));
      process.exit(1);
    }

    if (opts.rounds) council = { ...council, rounds: Math.min(3, Math.max(1, opts.rounds)) };

    const personaOverrides = opts.personas
      ? opts.personas.split(',').map((p: string) => p.trim())
      : undefined;

    try {
      const userContext = opts.context?.trim() || undefined;
      const session = await runCouncil(question!, council, config, personaOverrides, userContext);
      const file = saveSession(session);
      console.log(chalk.dim(`  Session saved: ${file}`));
      console.log(chalk.dim(`  Session ID:    ${session.id}`));
      if (session.provider_calls) {
        console.log(chalk.dim(`  API calls:     ${session.provider_calls}`));
      }
      console.log('');

      if (opts.output) {
        const md = exportSessionMarkdown(session);
        fs.writeFileSync(opts.output, md);
        console.log(chalk.green(`  ✓ Exported to: ${path.resolve(opts.output)}`));
        console.log('');
      }
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ Council failed: ' + e.message + '\n'));
      if (process.env.DEBUG) console.error(e);
      process.exit(1);
    }
  });

// ─── council ──────────────────────────────────────────────────────────────────

const councilCmd = program.command('council').description('Manage councils');

councilCmd
  .command('list')
  .description('List all available councils')
  .action(() => {
    const config = loadConfig();
    const userCouncils = listUserCouncils();
    console.log('');
    console.log(chalk.bold('  Available Councils'));
    console.log(chalk.dim('  ─'.repeat(35)));

    listCouncils().forEach(c => {
      const isDefault = c.id === config.default_council;
      const isUser = userCouncils.some(u => u.id === c.id);
      const marker  = isDefault ? chalk.cyan(' ●') : '  ';
      const tag     = isUser ? chalk.dim(' [custom]') : '';
      console.log(`${marker} ${chalk.bold(c.id.padEnd(24))} ${chalk.white(c.name)}${tag}`);
      console.log(`     ${chalk.dim(c.description)}`);
      console.log(`     ${chalk.dim('Personas: ' + c.persona_ids.join(', ') + '  ·  Rounds: ' + c.rounds)}`);
      console.log('');
    });

    console.log(chalk.dim('  Tip: eklavya council create  — build your own council'));
    console.log('');
  });

councilCmd
  .command('create')
  .description('Create a custom council')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('  Create Custom Council'));
    console.log(chalk.dim('  Saved to ~/.eklavya/councils/'));
    console.log('');

    const allPersonas = listPersonas();
    const personaChoices = allPersonas.map(p => ({
      name: `${p.id.padEnd(28)} ${p.role}`,
      value: p.id,
    }));

    const answers = await inquirer.prompt([
      { type: 'input', name: 'id', message: 'Council ID (kebab-case, e.g. my-team):', validate: (v: string) => /^[a-z0-9-]+$/.test(v.trim()) ? true : 'Use lowercase letters, numbers, hyphens only' },
      { type: 'input', name: 'name', message: 'Council name:', validate: (v: string) => v.trim().length > 2 ? true : 'Name too short' },
      { type: 'input', name: 'description', message: 'Description (one line):' },
      { type: 'checkbox', name: 'persona_ids', message: 'Select personas (2–7):', choices: personaChoices, validate: (v: string[]) => (v.length >= 2 && v.length <= 7) ? true : 'Select 2–7 personas' },
      { type: 'list', name: 'rounds', message: 'Number of debate rounds:', choices: [{ name: '1 — Quick take', value: 1 }, { name: '2 — Standard debate', value: 2 }, { name: '3 — Deep analysis', value: 3 }], default: 2 },
      { type: 'input', name: 'focus', message: 'Focus context (optional, injected into moderator):' },
    ]);

    const council: Council = {
      id: answers.id.trim(),
      name: answers.name.trim(),
      description: answers.description.trim(),
      persona_ids: answers.persona_ids,
      rounds: answers.rounds,
      focus: answers.focus.trim() || undefined,
    };

    if (isBuiltinCouncil(council.id)) {
      console.log(chalk.red(`\n  ✗ "${council.id}" is a built-in council ID. Choose a different ID.\n`));
      process.exit(1);
    }

    const file = saveUserCouncil(council);
    console.log('');
    console.log(chalk.green(`  ✓ Council saved: ${file}`));
    console.log(chalk.white(`  Use: eklavya ask "..." --council ${council.id}`));
    console.log('');
  });

councilCmd
  .command('delete <id>')
  .description('Delete a custom council')
  .action((id: string) => {
    if (isBuiltinCouncil(id)) {
      console.error(chalk.red(`\n  ✗ "${id}" is a built-in council and cannot be deleted.\n`));
      process.exit(1);
    }
    const deleted = deleteUserCouncil(id);
    if (deleted) {
      console.log(chalk.green(`\n  ✓ Council deleted: ${id}\n`));
    } else {
      console.error(chalk.red(`\n  ✗ Council not found: ${id}\n`));
      process.exit(1);
    }
  });

// Keep backwards compat alias
program.command('councils').description('Alias: eklavya council list').action(() => {
  councilCmd.parse(['', '', 'list']);
});

// ─── persona ──────────────────────────────────────────────────────────────────

const personaCmd = program.command('persona').description('Manage personas');

personaCmd
  .command('list')
  .description('List all available personas')
  .option('--builtin', 'Show built-in personas only')
  .option('--custom', 'Show custom personas only')
  .action((opts) => {
    const builtins = listBuiltinPersonas();
    const userOwned = listUserPersonas();

    console.log('');

    if (!opts.custom) {
      console.log(chalk.bold('  Built-in Personas'));
      console.log(chalk.dim('  ─'.repeat(35)));
      builtins.forEach(p => {
        console.log(`  ${chalk.bold.white(p.id.padEnd(28))} ${chalk.cyan(p.role)}`);
        console.log(`  ${' '.repeat(28)} ${chalk.dim('Expertise: ' + p.expertise.slice(0, 3).join(', '))}`);
        console.log(`  ${' '.repeat(28)} ${chalk.dim(`Contrarian: ${(p.contrarian_level * 10).toFixed(0)}/10  ·  Verbosity: ${p.verbosity}`)}`);
        console.log('');
      });
    }

    if (!opts.builtin && userOwned.length > 0) {
      console.log(chalk.bold('  Your Custom Personas'));
      console.log(chalk.dim('  ─'.repeat(35)));
      userOwned.forEach(p => {
        console.log(`  ${chalk.bold.yellow(p.id.padEnd(28))} ${chalk.cyan(p.name)}`);
        console.log(`  ${' '.repeat(28)} ${chalk.dim(p.role)}`);
        console.log(`  ${' '.repeat(28)} ${chalk.dim('Expertise: ' + p.expertise.slice(0, 3).join(', '))}`);
        console.log('');
      });
    } else if (!opts.builtin) {
      console.log(chalk.dim('  No custom personas yet. Run: eklavya persona add'));
    }

    console.log(chalk.dim('  Tip: eklavya persona add  — create a custom persona'));
    console.log('');
  });

personaCmd
  .command('show <id>')
  .description('Show full persona details')
  .action((id: string) => {
    try {
      const p = getPersona(id);
      const isUser = !isBuiltinPersona(id);
      console.log('');
      console.log(chalk.bold.white(`  ${p.name}`) + (isUser ? chalk.dim(' [custom]') : ''));
      console.log(chalk.dim(`  ${p.role}`));
      if (p.display_name && p.display_name !== p.name) {
        console.log(chalk.dim(`  Display name: ${p.display_name}`));
      }
      console.log('');
      console.log(chalk.white('  Expertise:    ') + p.expertise.join(', '));
      console.log(chalk.white('  Style:        ') + p.style);
      if (p.bias) console.log(chalk.white('  Bias:         ') + p.bias);
      console.log(chalk.white('  Contrarian:   ') + (p.contrarian_level * 10).toFixed(0) + '/10');
      console.log(chalk.white('  Verbosity:    ') + p.verbosity);
      if (p.provider) console.log(chalk.white('  Provider:     ') + p.provider);
      if (p.model)    console.log(chalk.white('  Model:        ') + p.model);
      console.log('');
    } catch (e: any) {
      console.error(chalk.red('  ✗ ' + e.message));
      process.exit(1);
    }
  });

personaCmd
  .command('add')
  .description('Create a custom persona')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('  Create Custom Persona'));
    console.log(chalk.dim('  Saved to ~/.eklavya/personas/'));
    console.log(chalk.dim('  Tip: Use display_name to show a different name in exports (optional).'));
    console.log('');

    const answers = await inquirer.prompt([
      { type: 'input', name: 'id', message: 'Persona ID (kebab-case):', validate: (v: string) => /^[a-z0-9-]+$/.test(v.trim()) ? true : 'Use lowercase letters, numbers, hyphens only' },
      { type: 'input', name: 'name', message: 'Internal name (how they are referred to in debate):' },
      { type: 'input', name: 'display_name', message: 'Display name for exports (optional, press Enter to use name):' },
      { type: 'input', name: 'role', message: 'Role / title:' },
      { type: 'input', name: 'expertise', message: 'Expertise areas (comma-separated):' },
      { type: 'input', name: 'style', message: 'Communication style (describe how they speak and reason):' },
      { type: 'input', name: 'bias', message: 'Known bias or perspective (optional):' },
      {
        type: 'list', name: 'contrarian_level', message: 'Contrarian level:',
        choices: [
          { name: '0.2 — Very agreeable, seeks common ground', value: 0.2 },
          { name: '0.4 — Mildly sceptical', value: 0.4 },
          { name: '0.6 — Regularly challenges assumptions', value: 0.6 },
          { name: '0.8 — Aggressively contrarian', value: 0.8 },
          { name: '1.0 — Maximum devil\'s advocate', value: 1.0 },
        ],
        default: 0.6,
      },
      { type: 'list', name: 'verbosity', message: 'Response length:', choices: ['brief', 'medium', 'detailed'], default: 'medium' },
      {
        type: 'list', name: 'provider', message: 'LLM provider override (optional):',
        choices: [{ name: 'Use default provider', value: '' }, 'anthropic', 'openai', 'google'],
        default: '',
      },
    ]);

    if (isBuiltinPersona(answers.id.trim())) {
      console.log(chalk.red(`\n  ✗ "${answers.id}" is a built-in persona ID. Choose a different ID.\n`));
      process.exit(1);
    }

    const persona: Persona = {
      id: answers.id.trim(),
      name: answers.name.trim(),
      display_name: answers.display_name.trim() || undefined,
      role: answers.role.trim(),
      expertise: answers.expertise.split(',').map((e: string) => e.trim()).filter(Boolean),
      style: answers.style.trim(),
      bias: answers.bias.trim() || undefined,
      contrarian_level: answers.contrarian_level,
      verbosity: answers.verbosity as 'brief' | 'medium' | 'detailed',
      provider: answers.provider || undefined,
    };

    const file = saveUserPersona(persona);
    console.log('');
    console.log(chalk.green(`  ✓ Persona saved: ${file}`));
    console.log(chalk.white(`  Use: eklavya ask "..." --personas ${persona.id}`));
    console.log('');
  });

personaCmd
  .command('delete <id>')
  .description('Delete a custom persona')
  .action((id: string) => {
    if (isBuiltinPersona(id)) {
      console.error(chalk.red(`\n  ✗ "${id}" is a built-in persona and cannot be deleted.\n`));
      process.exit(1);
    }
    const deleted = deleteUserPersona(id);
    if (deleted) {
      console.log(chalk.green(`\n  ✓ Persona deleted: ${id}\n`));
    } else {
      console.error(chalk.red(`\n  ✗ Persona not found: ${id}\n`));
      process.exit(1);
    }
  });

// Keep backwards compat alias
program.command('personas').description('Alias: eklavya persona list').action(() => {
  personaCmd.parse(['', '', 'list']);
});

// ─── sessions ─────────────────────────────────────────────────────────────────

const sessionsCmd = program.command('sessions').description('View past council sessions');

sessionsCmd
  .command('list')
  .description('List recent sessions')
  .option('-n, --limit <n>', 'Number of sessions to show', parseInt)
  .action((opts) => {
    const sessions = listSessions(opts.limit ?? 10);

    if (sessions.length === 0) {
      console.log(chalk.dim('\n  No sessions yet. Run: eklavya ask "your question"\n'));
      return;
    }

    console.log('');
    console.log(chalk.bold('  Recent Sessions'));
    console.log(chalk.dim('  ─'.repeat(35)));

    sessions.forEach(s => {
      const date = new Date(s.created_at).toLocaleString();
      console.log(`  ${chalk.cyan(s.id.substring(0, 8))}  ${chalk.white(s.question.substring(0, 55))}${s.question.length > 55 ? '…' : ''}`);
      console.log(`           ${chalk.dim(s.council_name + '  ·  ' + date + '  ·  ' + s.duration_seconds + 's')}`);
      console.log('');
    });

    console.log(chalk.dim('  Run: eklavya sessions show <id>'));
    console.log('');
  });

sessionsCmd
  .command('show <id>')
  .description('Display a past session')
  .option('--json', 'Output raw JSON')
  .action((id: string, opts) => {
    let session: any;
    try {
      if (id.length <= 8) {
        const all = listSessions(200);
        const match = all.find(s => s.id.startsWith(id));
        if (!match) throw new Error(`Session not found: ${id}`);
        session = match;
      } else {
        session = loadSession(id);
      }
    } catch (e: any) {
      console.error(chalk.red('  ✗ ' + e.message));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(session, null, 2));
      return;
    }

    console.log(exportSessionMarkdown(session));
  });

sessionsCmd
  .command('export <id>')
  .description('Export a session to markdown file')
  .option('-o, --output <file>', 'Output file path')
  .action((id: string, opts) => {
    try {
      const sessions = listSessions(200);
      const session = sessions.find(s => s.id.startsWith(id)) ?? loadSession(id);
      const md = exportSessionMarkdown(session);
      const outFile = opts.output ?? `eklavya-session-${id.substring(0, 8)}.md`;
      fs.writeFileSync(outFile, md);
      console.log(chalk.green(`\n  ✓ Exported to: ${path.resolve(outFile)}\n`));
    } catch (e: any) {
      console.error(chalk.red('  ✗ ' + e.message));
      process.exit(1);
    }
  });

sessionsCmd
  .command('delete <id>')
  .description('Delete a session')
  .action(async (id: string) => {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete session ${id.substring(0, 8)}? This cannot be undone.`,
      default: false,
    }]);
    if (!confirm) return;

    try {
      const sessions = listSessions(200);
      const session = sessions.find(s => s.id.startsWith(id));
      const fullId = session?.id ?? id;
      const deleted = deleteSession(fullId);
      if (deleted) {
        console.log(chalk.green(`\n  ✓ Session deleted\n`));
      } else {
        console.error(chalk.red(`\n  ✗ Session not found\n`));
        process.exit(1);
      }
    } catch (e: any) {
      console.error(chalk.red('  ✗ ' + e.message));
      process.exit(1);
    }
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show configuration and system status')
  .action(() => {
    const config = loadConfig();

    console.log('');
    console.log(chalk.bold('  Eklavya Council — Status'));
    console.log(chalk.dim('  ─'.repeat(35)));
    console.log('');

    const providers: ProviderName[] = ['anthropic', 'openai', 'google'];
    providers.forEach(p => {
      const configured = !!config.providers[p]?.api_key;
      const isDefault  = p === config.default_provider;
      const status = configured ? chalk.green('✓ configured') : chalk.dim('✗ not set');
      const def    = isDefault ? chalk.cyan(' (default)') : '';
      console.log(`  ${p.padEnd(12)} ${status}${def}`);
    });

    console.log('');
    console.log(`  Default council:   ${chalk.white(config.default_council)}`);
    console.log(`  Default rounds:    ${chalk.white(String(config.default_rounds))}`);
    console.log(`  Streaming:         ${chalk.white(config.stream ? 'enabled' : 'disabled')}`);
    console.log('');

    const builtins = listBuiltinPersonas();
    const customs  = listUserPersonas();
    console.log(`  Built-in personas: ${chalk.white(String(builtins.length))}`);
    console.log(`  Custom personas:   ${chalk.white(String(customs.length))}`);
    console.log('');

    const sessions = listSessions(1000);
    console.log(`  Sessions stored:   ${chalk.white(String(sessions.length))}`);
    if (sessions.length > 0) {
      console.log(`  Last session:      ${chalk.dim(new Date(sessions[0].created_at).toLocaleString())}`);
    }
    console.log('');
  });

// ─── Default: show brand + help ───────────────────────────────────────────────

program.action(() => {
  printBrand();
  program.outputHelp();
});

program.parse(process.argv);

if (process.argv.length <= 2) {
  printBrand();
  program.outputHelp();
}
