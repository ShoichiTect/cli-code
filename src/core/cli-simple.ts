#!/usr/bin/env node
/**
 * Simple CLI Entry Point
 * Standard terminal-based CLI without React Ink
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Agent } from './agent.js';
import { SimpleCLI } from './simple-cli.js';

const BANNER = `
  ██████    ██████   ██████   ██████
 ███░░███░░███░░░██ ███░░███ ███░░███
░███ ░███ ░███ ░░░ ░███ ░███░███ ░███
░███ ░███ ░███     ░███ ░███░███ ░███
░░███░███ ░███     ░░██████ ░░███░███
 ░░░░░███ ░░░░      ░░░░░░   ░░░░░███
 ██  ░███                        ░███
░░██████                         ░███
 ░░░░░░                          ░░░
                        ███
                      ░░███
  ██████   ██████   ███████   ██████
 ███░░███ ███░░███ ███░░███  ███░░███
░███ ░░░ ░███ ░███░███ ░███ ░███████
░███  ███░███ ░███░███ ░███ ░███░░░
░░██████ ░░██████ ░░███████ ░░██████
 ░░░░░░   ░░░░░░   ░░░░░░░░  ░░░░░░
`;

const program = new Command();

interface StartChatOptions {
  temperature: number;
  system: string | null;
  debug?: boolean;
  proxy?: string;
}

/**
 * Start the interactive terminal chat using SimpleCLI
 */
async function startChat(options: StartChatOptions): Promise<void> {
  // Print banner
  console.log(chalk.hex('#FF4500')(BANNER));

  const defaultModel = 'moonshotai/kimi-k2-instruct';

  // Validate proxy URL if provided
  if (options.proxy) {
    try {
      new URL(options.proxy);
    } catch (error) {
      console.log(chalk.red('Invalid proxy URL provided'));
      console.log(
        chalk.yellow(
          'Proxy URL must be a valid URL (e.g., http://proxy:8080 or socks5://proxy:1080)'
        )
      );
      process.exit(1);
    }
  }

  try {
    // Create agent (API key will be checked on first message)
    const agent = await Agent.create(
      defaultModel,
      options.temperature,
      options.system,
      options.debug,
      options.proxy
    );

    // Create and run SimpleCLI
    const cli = new SimpleCLI(agent);
    await cli.run();
  } catch (error) {
    console.log(chalk.red(`Error initializing agent: ${error}`));
    process.exit(1);
  }
}

program
  .name('groq')
  .description('Groq Code CLI - Simple Terminal Interface')
  .version('1.0.2')
  .option(
    '-t, --temperature <temperature>',
    'Temperature for generation',
    parseFloat,
    1.0
  )
  .option('-s, --system <message>', 'Custom system message')
  .option(
    '-d, --debug',
    'Enable debug logging to debug-agent.log in current directory'
  )
  .option(
    '-p, --proxy <url>',
    'Proxy URL (e.g. http://proxy:8080 or socks5://proxy:1080)'
  )
  .action(async (opts) => {
    await startChat({
      temperature: opts.temperature,
      system: opts.system || null,
      debug: opts.debug,
      proxy: opts.proxy,
    });
  });

program.parse();
