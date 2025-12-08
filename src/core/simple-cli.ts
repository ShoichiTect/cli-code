/**
 * Simple CLI - Main CLI class for terminal-based interaction
 * Replaces React Ink UI with standard console + readline
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { Agent } from './agent.js';
import {
  selectWithFzf,
  confirmPrompt,
  createSpinner,
  Spinner,
} from './cli-utils.js';
import {
  printColoredDiff,
  generateEditFileDiff,
  generateCreateFileDiff,
} from './diff-utils.js';
import { parseMarkdown, parseInlineElements } from '../utils/markdown.js';
import { DANGEROUS_TOOLS } from '../tools/tool-schemas.js';

// Model definitions for each provider
const MODELS = {
  groq: [
    'moonshotai/kimi-k2-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'qwen/qwen3-32b',
    'deepseek-r1-distill-llama-70b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ],
  anthropic: [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250514',
    'claude-3-5-haiku-20241022',
  ],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ],
};

interface SessionStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export class SimpleCLI {
  private agent: Agent;
  private rl: readline.Interface;
  private isProcessing: boolean = false;
  private sessionStats: SessionStats = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  };
  private spinner: Spinner | null = null;
  private lastToolArgs: Record<string, any> | null = null;

  constructor(agent: Agent) {
    this.agent = agent;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.setupAgentCallbacks();
    this.setupSignalHandlers();
  }

  /**
   * Setup signal handlers for Ctrl+C
   */
  private setupSignalHandlers(): void {
    process.on('SIGINT', () => {
      if (this.isProcessing) {
        this.agent.interrupt();
        this.spinner?.stop();
        console.log(chalk.yellow('\n Interrupted'));
      } else {
        console.log(chalk.gray('\nGoodbye!'));
        this.rl.close();
        process.exit(0);
      }
    });
  }

  /**
   * Setup agent callbacks for tool execution and messages
   */
  private setupAgentCallbacks(): void {
    this.agent.setToolCallbacks({
      onThinkingText: (content: string, reasoning?: string) => {
        this.spinner?.stop();
        // Always show reasoning
        if (reasoning) {
          console.log(chalk.dim.italic(reasoning));
        }
        if (content) {
          console.log(chalk.white(content));
        }
        this.spinner = createSpinner('Processing...');
      },

      onFinalMessage: (content: string, reasoning?: string) => {
        this.spinner?.stop();
        // Always show reasoning
        if (reasoning) {
          console.log(chalk.dim.italic(reasoning));
        }
        console.log(this.formatMarkdown(content));
      },

      onToolStart: (name: string, args: Record<string, any>) => {
        this.spinner?.stop();
        console.log(chalk.blue(`\n ${name}...`));
        this.lastToolArgs = args;
      },

      onToolEnd: (name: string, result: any) => {
        this.printToolResult(name, result);
      },

      onToolApproval: async (
        toolName: string,
        toolArgs: Record<string, any>
      ) => {
        this.spinner?.stop();
        return this.handleToolApproval(toolName, toolArgs);
      },

      onApiUsage: (usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }) => {
        this.sessionStats.promptTokens += usage.prompt_tokens;
        this.sessionStats.completionTokens += usage.completion_tokens;
        this.sessionStats.totalTokens += usage.total_tokens;
        this.sessionStats.requestCount++;
      },

      onMaxIterations: async (maxIterations: number) => {
        this.spinner?.stop();
        return confirmPrompt(
          `Reached ${maxIterations} iterations. Continue?`
        );
      },

      onError: async (error: string) => {
        this.spinner?.stop();
        console.log(chalk.red(`\nError: ${error}`));
        return confirmPrompt('Retry?');
      },
    });
  }

  /**
   * Handle tool approval flow with danger level distinction
   */
  private async handleToolApproval(
    toolName: string,
    toolArgs: Record<string, any>
  ): Promise<{ approved: boolean; autoApproveSession?: boolean }> {
    const isDangerous = DANGEROUS_TOOLS.includes(toolName);

    console.log(chalk.yellow(`\n Tool requires approval: ${toolName}`));

    // Show diff preview for file operations
    if (toolName === 'edit_file' && toolArgs.file_path) {
      await this.showDiffPreview(toolName, toolArgs);
    } else if (toolName === 'create_file' && toolArgs.file_path) {
      generateCreateFileDiff(toolArgs.content || '', toolArgs.file_path);
    } else {
      // Show args for other tools
      console.log(chalk.gray(JSON.stringify(toolArgs, null, 2)));
    }

    // Dangerous tools don't get auto-approve option
    if (isDangerous) {
      const answer = await this.question(chalk.cyan('[y]es / [n]o: '));
      const choice = answer.toLowerCase().trim();
      return { approved: choice === 'y' || choice === 'yes' };
    }

    // Normal tools get auto-approve option
    const answer = await this.question(
      chalk.cyan('[y]es / [n]o / [a]ll session: ')
    );
    const choice = answer.toLowerCase().trim();

    if (choice === 'y' || choice === 'yes') {
      return { approved: true };
    } else if (choice === 'a' || choice === 'all') {
      return { approved: true, autoApproveSession: true };
    }
    return { approved: false };
  }

  /**
   * Show diff preview for edit_file operation
   */
  private async showDiffPreview(
    toolName: string,
    toolArgs: Record<string, any>
  ): Promise<void> {
    if (toolName === 'edit_file' && toolArgs.file_path) {
      try {
        const filePath = path.resolve(toolArgs.file_path);
        const currentContent = await fs.promises.readFile(filePath, 'utf-8');
        generateEditFileDiff(
          currentContent,
          toolArgs.old_text || '',
          toolArgs.new_text || '',
          toolArgs.file_path,
          toolArgs.replace_all
        );
      } catch (error) {
        console.log(chalk.yellow(`Cannot read file for diff preview: ${error}`));
        console.log(chalk.gray(JSON.stringify(toolArgs, null, 2)));
      }
    }
  }

  /**
   * Print tool result with appropriate formatting
   */
  private printToolResult(name: string, result: any): void {
    if (!result.success) {
      if (result.userRejected) {
        console.log(chalk.yellow(` ${name} rejected by user`));
      } else {
        console.log(chalk.red(` ${name} failed: ${result.error}`));
      }
      return;
    }

    console.log(chalk.green(` ${name} completed`));

    // Tool-specific output formatting
    switch (name) {
      case 'execute_command':
        this.printCommandOutput(result);
        break;

      case 'list_files':
        if (result.content) {
          console.log(chalk.cyan(result.content));
        }
        break;

      case 'read_file':
      case 'search_files':
        // Don't print content to save space
        if (result.message) {
          console.log(chalk.dim(result.message));
        }
        break;

      case 'create_file':
      case 'edit_file':
        if (result.message) {
          console.log(chalk.dim(result.message));
        }
        // Show diff for completed file operations
        if (this.lastToolArgs) {
          if (name === 'create_file') {
            // Already shown during approval
          } else if (name === 'edit_file') {
            // Already shown during approval
          }
        }
        break;

      case 'create_tasks':
      case 'update_tasks':
        this.printTasks(result.content?.tasks || []);
        break;

      default:
        if (result.message) {
          console.log(chalk.dim(result.message));
        }
    }
  }

  /**
   * Print command output with stdout/stderr separation
   */
  private printCommandOutput(result: any): void {
    const content = result.content;
    if (typeof content !== 'string') return;

    const lines = content.split('\n');
    let section = '';

    for (const line of lines) {
      if (line.startsWith('stdout:')) {
        section = 'stdout';
        const text = line.slice(7).trim();
        if (text) console.log(chalk.white(text));
      } else if (line.startsWith('stderr:')) {
        section = 'stderr';
        const text = line.slice(7).trim();
        if (text) console.log(chalk.yellow(text));
      } else if (section === 'stdout') {
        console.log(chalk.white(line));
      } else if (section === 'stderr') {
        console.log(chalk.yellow(line));
      }
    }
  }

  /**
   * Print tasks with status icons
   */
  private printTasks(tasks: any[]): void {
    for (const task of tasks) {
      let icon: string;
      let color: typeof chalk;

      switch (task.status) {
        case 'completed':
          icon = '';
          color = chalk.green;
          break;
        case 'in_progress':
          icon = '';
          color = chalk.blue;
          break;
        default:
          icon = '';
          color = chalk.white;
      }

      console.log(color(`${icon} ${task.description}`));
    }
  }

  /**
   * Format markdown content for terminal display
   */
  private formatMarkdown(content: string): string {
    const elements = parseMarkdown(content);
    let output = '';

    for (const element of elements) {
      switch (element.type) {
        case 'code-block':
          output += chalk.cyan('```\n' + element.content + '\n```') + '\n';
          break;

        case 'heading':
          output += chalk.bold.yellow('#'.repeat(element.level || 1) + ' ' + element.content) + '\n';
          break;

        case 'mixed-line':
          const inlineElements = parseInlineElements(element.content);
          for (const inline of inlineElements) {
            switch (inline.type) {
              case 'code':
                output += chalk.cyan('`' + inline.content + '`');
                break;
              case 'bold':
                output += chalk.bold(inline.content);
                break;
              case 'italic':
                output += chalk.italic(inline.content);
                break;
              default:
                output += inline.content;
            }
          }
          output += '\n';
          break;

        default:
          output += element.content + '\n';
      }
    }

    return output;
  }

  /**
   * Ask a question and get user input
   */
  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  /**
   * Main chat loop
   */
  async run(): Promise<void> {
    console.log(chalk.gray('Type /help for commands, Ctrl+C to exit\n'));

    while (true) {
      const input = await this.question(chalk.cyan('> '));

      if (!input.trim()) continue;

      // Handle slash commands
      if (input.startsWith('/')) {
        await this.handleSlashCommand(input);
        continue;
      }

      // Regular chat
      this.isProcessing = true;
      this.spinner = createSpinner('Thinking...');

      try {
        await this.agent.chat(input);
      } catch (error) {
        this.spinner?.stop();
        console.log(chalk.red(`Error: ${error}`));
      } finally {
        this.spinner?.stop();
        this.isProcessing = false;
        console.log(''); // Add newline after response
      }
    }
  }

  /**
   * Handle slash commands
   */
  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case 'model':
        await this.selectModel();
        break;

      case 'login':
        await this.login();
        break;

      case 'clear':
        console.clear();
        this.agent.clearHistory();
        this.sessionStats = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        };
        console.log(chalk.green(' Chat cleared'));
        break;

      case 'stats':
        this.showStats();
        break;

      case 'help':
        this.showHelp();
        break;

      default:
        console.log(chalk.yellow(`Unknown command: /${command}`));
        console.log(chalk.gray('Type /help for available commands'));
    }
  }

  /**
   * Show help message
   */
  private showHelp(): void {
    console.log(chalk.cyan('\nAvailable commands:'));
    console.log('  /model  - Select AI model');
    console.log('  /login  - Set API key for a provider');
    console.log('  /clear  - Clear chat history');
    console.log('  /stats  - Show token usage statistics');
    console.log('  /help   - Show this help message');
    console.log('');
  }

  /**
   * Show session statistics
   */
  private showStats(): void {
    console.log(chalk.cyan('\nSession Statistics:'));
    console.log(`  Requests:          ${this.sessionStats.requestCount}`);
    console.log(`  Prompt tokens:     ${this.sessionStats.promptTokens.toLocaleString()}`);
    console.log(`  Completion tokens: ${this.sessionStats.completionTokens.toLocaleString()}`);
    console.log(`  Total tokens:      ${this.sessionStats.totalTokens.toLocaleString()}`);
    console.log(`  Current model:     ${this.agent.getCurrentModel()}`);
    console.log('');
  }

  /**
   * Select model using fzf or number selection
   */
  private async selectModel(): Promise<void> {
    // Build model list with provider prefixes
    const modelList: string[] = [];
    for (const [provider, models] of Object.entries(MODELS)) {
      for (const model of models) {
        modelList.push(`${provider}:${model}`);
      }
    }

    const selected = await selectWithFzf(modelList, 'Select model');

    if (selected) {
      const [provider, model] = selected.split(':');
      this.agent.setModel(model);
      console.log(chalk.green(` Switched to ${model} (${provider})`));
    }
  }

  /**
   * Login to set API key for a provider
   */
  private async login(): Promise<void> {
    const providers = ['groq', 'anthropic', 'gemini'];
    const selected = await selectWithFzf(providers, 'Select provider');

    if (!selected) return;

    const providerUrls: Record<string, string> = {
      groq: 'https://console.groq.com/keys',
      anthropic: 'https://console.anthropic.com/settings/keys',
      gemini: 'https://aistudio.google.com/apikey',
    };

    console.log(chalk.dim(`Get your API key from: ${providerUrls[selected]}`));

    const apiKey = await this.question(chalk.cyan('API Key: '));

    if (apiKey.trim()) {
      this.agent.saveApiKey(apiKey.trim(), selected as 'groq' | 'anthropic' | 'gemini');
      console.log(chalk.green(` API key saved for ${selected}`));
    } else {
      console.log(chalk.yellow(' No API key provided'));
    }
  }
}
