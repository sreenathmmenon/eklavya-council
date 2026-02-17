#!/usr/bin/env node
/**
 * Eklavya Council CLI
 * Usage: eklavya <command> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

import { loadConfig, saveConfig, getActiveProvider, DEFAULTS } from './config.js';
import { runCouncil } from './orchestrator.js';
import { saveSession, listSessions, loadSession, exportSessionMarkdown } from './storage.js';
import { getCouncil, listCouncils } from './data/councils.js';
import { getPersona, listPersonas, PERSONAS } from './data/personas.js';
import { EklavyaConfig, ProviderName } from './types.js';

const program = new Command();

const VERSION = '0.1.0';

// ─── Branding ────────────────────────────────────────────────────────────────

function printBrand(): void {
  console.log('');
  console.log(chalk.bold.cyan('  ███████╗██╗  ██╗██╗      █████╗ ██╗   ██╗██╗   ██╗ █████╗ '));
  console.log(chalk.bold.cyan('  ██╔════╝██║ ██╔╝██║     ██╔══██╗██║   ██║╚██╗ ██╔╝██╔══██╗'));
  console.log(chalk.bold.cyan('  █████╗  █████╔╝ ██║     ███████║██║   ██║ ╚████╔╝ ███████║'));
  console.log(chalk.bold.cyan('  ██╔══╝  ██╔═██╗ ██║     ██╔══██║╚██╗ ██╔╝  ╚██╔╝  ██╔══██║'));
  console.log(chalk.bold.cyan('  ███████╗██║  ██╗███████╗██║  ██║ ╚████╔╝    ██║   ██║  ██║'));
  console.log(chalk.bold.cyan('  ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝  ╚═══╝     ╚═╝   ╚═╝  ╚═╝'));
  console.log('');
  console.log(chalk.dim('  Virtual Council  ·  Multi-Persona LLM Debate Engine  ·  v' + VERSION));
  console.log('');
}

// ─── Program Setup ───────────────────────────────────────────────────────────

program
  .name('eklavya')
  .description('Eklavya Virtual Council — convene expert AI personas to debate any question')
  .version(VERSION);

// ─── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Configure API keys and defaults')
  .action(async () => {
    printBrand();
    console.log(chalk.bold('  Configure Eklavya Council'));
    console.log(chalk.dim('  API keys are stored in ~/.eklavya/config.json'));
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
        type: 'input',
        name: 'anthropic_key',
        message: 'Anthropic API key (leave blank to skip):',
        default: config.providers.anthropic?.api_key ?? '',
      },
      {
        type: 'input',
        name: 'openai_key',
        message: 'OpenAI API key (leave blank to skip):',
        default: config.providers.openai?.api_key ?? '',
      },
      {
        type: 'input',
        name: 'google_key',
        message: 'Google Gemini API key (leave blank to skip):',
        default: config.providers.google?.api_key ?? '',
      },
      {
        type: 'list',
        name: 'default_council',
        message: 'Default council:',
        choices: listCouncils().map(c => ({ name: `${c.name} — ${c.description}`, value: c.id })),
        default: config.default_council,
      },
      {
        type: 'number',
        name: 'default_rounds',
        message: 'Default debate rounds (1–3):',
        default: config.default_rounds,
        validate: (v: number) => v >= 1 && v <= 3 ? true : 'Must be 1–3',
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

    if (answers.anthropic_key) {
      newConfig.providers.anthropic = {
        api_key: answers.anthropic_key,
        default_model: 'claude-3-5-sonnet-20241022',
      };
    }
    if (answers.openai_key) {
      newConfig.providers.openai = {
        api_key: answers.openai_key,
        default_model: 'gpt-4o',
      };
    }
    if (answers.google_key) {
      newConfig.providers.google = {
        api_key: answers.google_key,
        default_model: 'gemini-1.5-pro',
      };
    }

    saveConfig(newConfig);

    console.log('');
    console.log(chalk.green('  ✓ Configuration saved to ~/.eklavya/config.json'));
    console.log('');
    console.log(chalk.white('  Try it:'));
    console.log(chalk.cyan('  eklavya ask "Should we use microservices?"'));
    console.log('');
  });

// ─── ask ─────────────────────────────────────────────────────────────────────

program
  .command('ask [question]')
  .description('Convene a council to debate a question')
  .option('-c, --council <id>', 'Council to use (default: from config)')
  .option('-r, --rounds <n>', 'Number of debate rounds (1–3)', parseInt)
  .option('-p, --personas <ids>', 'Comma-separated persona IDs (overrides council)')
  .option('--provider <name>', 'Override LLM provider (anthropic|openai|google)')
  .option('--no-stream', 'Disable streaming output')
  .option('-o, --output <file>', 'Save session as markdown to file')
  .action(async (questionArg: string | undefined, opts) => {
    const config = loadConfig();

    // Merge CLI overrides into config
    if (opts.provider) config.default_provider = opts.provider as ProviderName;
    if (opts.stream === false) config.stream = false;

    // Validate provider
    try {
      getActiveProvider(config);
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'));
      process.exit(1);
    }

    // Get question
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

    // Get council
    const councilId = opts.council ?? config.default_council;
    let council;
    try {
      council = getCouncil(councilId);
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'));
      process.exit(1);
    }

    // Apply round override
    if (opts.rounds) council = { ...council, rounds: Math.min(3, Math.max(1, opts.rounds)) };

    // Apply persona override
    const personaOverrides = opts.personas
      ? opts.personas.split(',').map((p: string) => p.trim())
      : undefined;

    try {
      const session = await runCouncil(question!, council, config, personaOverrides);

      // Save session
      const file = saveSession(session);
      console.log(chalk.dim(`  Session saved: ${file}`));
      console.log(chalk.dim(`  Session ID:    ${session.id}`));
      console.log('');

      // Export markdown if requested
      if (opts.output) {
        const md = exportSessionMarkdown(session);
        fs.writeFileSync(opts.output, md);
        console.log(chalk.green(`  ✓ Exported to: ${opts.output}`));
        console.log('');
      }
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ Council failed: ' + e.message + '\n'));
      if (process.env.DEBUG) console.error(e);
      process.exit(1);
    }
  });

// ─── councils ────────────────────────────────────────────────────────────────

const councilsCmd = program.command('councils').description('Manage councils');

councilsCmd
  .command('list')
  .description('List all available councils')
  .action(() => {
    const config = loadConfig();
    console.log('');
    console.log(chalk.bold('  Available Councils'));
    console.log(chalk.dim('  ─'.repeat(35)));

    listCouncils().forEach(c => {
      const isDefault = c.id === config.default_council;
      const marker = isDefault ? chalk.cyan(' ●') : '  ';
      console.log(`${marker} ${chalk.bold(c.id.padEnd(22))} ${chalk.white(c.name)}`);
      console.log(`     ${chalk.dim(c.description)}`);
      console.log(`     ${chalk.dim('Personas: ' + c.persona_ids.join(', ') + '  ·  Rounds: ' + c.rounds)}`);
      console.log('');
    });
  });

// ─── personas ────────────────────────────────────────────────────────────────

const personasCmd = program.command('personas').description('Manage personas');

personasCmd
  .command('list')
  .description('List all available personas')
  .action(() => {
    console.log('');
    console.log(chalk.bold('  Available Personas'));
    console.log(chalk.dim('  ─'.repeat(35)));

    listPersonas().forEach(p => {
      console.log(`  ${chalk.bold.white(p.id.padEnd(28))} ${chalk.cyan(p.name)}`);
      console.log(`  ${' '.repeat(28)} ${chalk.dim(p.role)}`);
      console.log(`  ${' '.repeat(28)} ${chalk.dim('Expertise: ' + p.expertise.slice(0, 3).join(', '))}`);
      console.log('');
    });
  });

personasCmd
  .command('show <id>')
  .description('Show full persona details')
  .action((id: string) => {
    try {
      const p = getPersona(id);
      console.log('');
      console.log(chalk.bold.white(`  ${p.name}`));
      console.log(chalk.dim(`  ${p.role}`));
      console.log('');
      console.log(chalk.white(`  Expertise:    `) + p.expertise.join(', '));
      console.log(chalk.white(`  Style:        `) + p.style);
      if (p.bias) console.log(chalk.white(`  Bias:         `) + p.bias);
      console.log(chalk.white(`  Contrarian:   `) + (p.contrarian_level * 10).toFixed(0) + '/10');
      console.log(chalk.white(`  Verbosity:    `) + p.verbosity);
      if (p.provider) console.log(chalk.white(`  Provider:     `) + p.provider);
      console.log('');
    } catch (e: any) {
      console.error(chalk.red('  ✗ ' + e.message));
      process.exit(1);
    }
  });

// ─── sessions ────────────────────────────────────────────────────────────────

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
    // Support short IDs (first 8 chars)
    let session;
    try {
      if (id.length === 8) {
        const all = listSessions(100);
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

    const md = exportSessionMarkdown(session);
    console.log(md);
  });

sessionsCmd
  .command('export <id>')
  .description('Export a session to markdown file')
  .option('-o, --output <file>', 'Output file path')
  .action((id: string, opts) => {
    try {
      const sessions = listSessions(100);
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

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show current configuration status')
  .action(() => {
    const config = loadConfig();

    console.log('');
    console.log(chalk.bold('  Eklavya Council — Configuration Status'));
    console.log(chalk.dim('  ─'.repeat(35)));
    console.log('');

    const providers: ProviderName[] = ['anthropic', 'openai', 'google'];
    providers.forEach(p => {
      const configured = !!config.providers[p]?.api_key;
      const isDefault = p === config.default_provider;
      const status = configured ? chalk.green('✓ configured') : chalk.dim('✗ not set');
      const def = isDefault ? chalk.cyan(' (default)') : '';
      console.log(`  ${p.padEnd(12)} ${status}${def}`);
    });

    console.log('');
    console.log(`  Default council:  ${chalk.white(config.default_council)}`);
    console.log(`  Default rounds:   ${chalk.white(String(config.default_rounds))}`);
    console.log(`  Streaming:        ${chalk.white(config.stream ? 'enabled' : 'disabled')}`);
    console.log('');

    const sessions = listSessions(1);
    console.log(`  Sessions stored:  ${chalk.white(String(listSessions(1000).length))}`);
    if (sessions.length > 0) {
      console.log(`  Last session:     ${chalk.dim(new Date(sessions[0].created_at).toLocaleString())}`);
    }
    console.log('');
  });

// ─── No-arg default ──────────────────────────────────────────────────────────

program.action(() => {
  printBrand();
  program.help();
});

program.parse(process.argv);

// If no command given, show help
if (process.argv.length <= 2) {
  printBrand();
  program.help();
}
