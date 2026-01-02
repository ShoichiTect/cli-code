/**
 * Simple CLI - Main CLI class for terminal-based interaction
 * Replaces React Ink UI with standard console + readline
 */

import * as readline from 'readline';
import chalk from 'chalk';
import {Agent} from './agent.js';
import {
	isConfirmed,
	createSpinner,
	Spinner,
	selectWithNumbers,
} from './cli-utils.js';
import {parseMarkdown, parseInlineElements} from '../utils/markdown.js';
import {DANGEROUS_TOOLS} from '../tools/tool-schemas.js';
import {type ToolName, type ToolArgsByName} from '../tools/tool-types.js';
import {formatToolParams, type ToolResult} from '../tools/tools.js';
import {learn} from '../utils/learn-log.js';

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
				// Convert literal \n to actual newlines for display
				const displayed = content.replace(/\\n/g, '\n');
				console.log(this.formatMarkdown(displayed));
			},

			onToolStart: (name) => {
				this.spinner?.stop();
				console.log(chalk.blue(`\n ${name}...`));
			},

			onToolEnd: (
				name: ToolName,
				result: ToolResult,
				toolArgs: ToolArgsByName[ToolName],
			) => {
				this.printToolResult(name, result, toolArgs);
			},

			onToolApproval: async (
				toolName: ToolName,
				toolArgs: ToolArgsByName[ToolName],
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
				return isConfirmed(`Reached ${maxIterations} iterations. Continue?`);
			},

			onError: async (error: string) => {
				this.spinner?.stop();
				console.log(chalk.red(`\nError: ${error}`));
				return isConfirmed('Retry?');
			},
		});
	}

	/**
	 * Handle tool approval flow with danger level distinction
	 */
	private async handleToolApproval(
		toolName: ToolName,
		toolArgs: ToolArgsByName[ToolName],
	): Promise<{approved: boolean; autoApproveSession?: boolean}> {
		const isDangerous = DANGEROUS_TOOLS.includes(toolName);

		console.log(chalk.yellow(`\n Tool requires approval: ${toolName}`));

		// Show args for other tools
		console.log(chalk.gray(JSON.stringify(toolArgs, null, 2)));

		// Dangerous tools don't get auto-approve option
		if (isDangerous) {
			const selection = await selectWithNumbers(['yes', 'no'], 'Confirm');
			if (!selection) return {approved: false};
			const choice = selection.toLowerCase().trim();
			return {approved: choice === 'yes'};
		}

		// Normal tools get auto-approve option
		const selection = await selectWithNumbers(['yes', 'no', 'all'], 'Confirm');
		if (!selection) return {approved: false};
		const choice = selection.toLowerCase().trim();
		if (choice === 'yes') {
			return {approved: true};
		} else if (choice === 'all') {
			return {approved: true, autoApproveSession: true};
		}
		return {approved: false};
	}

	/**
	 * Print tool result with appropriate formatting
	 */
	private printToolResult(
		name: ToolName,
		result: ToolResult,
		toolArgs?: ToolArgsByName[ToolName],
	): void {
		if (!result.success) {
			if (result.userRejected) {
				console.log(chalk.yellow(` ${name} rejected by user`));
			} else {
				console.log(chalk.red(` ${name} failed: ${result.error}`));
				const formattedArgs = this.formatToolArgs(name, toolArgs);
				if (formattedArgs) {
					console.log(chalk.dim(` ${formattedArgs}`));
				}
				const stdout = this.extractStdout(result.content);
				const stderr = this.extractStderr(result.content);
				const isCommandFailure =
					name === 'execute_command' &&
					(typeof result.exitCode === 'number' ||
						typeof result.signal === 'string' ||
						typeof result.timedOut === 'boolean' ||
						!!stdout ||
						!!stderr);

				if (isCommandFailure) {
					if (stdout) {
						console.log(
							chalk.white(` stdout: ${this.truncateOutput(stdout, 400)}`),
						);
					}
					if (stderr) {
						console.log(
							chalk.yellow(` stderr: ${this.truncateOutput(stderr, 400)}`),
						);
					}
					const meta = this.formatCommandFailureMeta(result);
					if (meta) {
						console.log(chalk.dim(` ${meta}`));
					}
				}
				if (!isCommandFailure) {
					const stackTrace = this.formatStackTrace(result.stack, true);
					if (stackTrace) {
						console.log(chalk.dim(stackTrace));
					}
				}
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

			default:
				if (result.message) {
					console.log(chalk.dim(result.message));
				}
		}
	}

	private formatToolArgs(
		name: ToolName,
		toolArgs?: ToolArgsByName[ToolName],
	): string | null {
		if (!toolArgs) return null;
		const formatted = formatToolParams(
			name,
			toolArgs as Record<string, unknown>,
		);
		return formatted ? formatted : null;
	}

	private formatStackTrace(stack?: string, stripMessage = false): string | null {
		if (!stack) return null;
		let cleaned = stack;
		if (stripMessage) {
			const atIndex = stack.indexOf('\n    at');
			if (atIndex !== -1) {
				cleaned = stack.slice(atIndex + 1).trimStart();
			}
		}
		return this.truncateOutput(cleaned, 450);
	}

	private truncateOutput(text: string, maxChars: number): string {
		if (text.length <= maxChars) return text;
		return text.slice(0, maxChars).trimEnd() + '...';
	}

	private extractStderr(content: unknown): string | null {
		if (typeof content !== 'string') return null;

		const lines = content.split('\n');
		let section = '';
		const stderrLines: string[] = [];

		for (const line of lines) {
			if (line.startsWith('stdout:')) {
				section = 'stdout';
				continue;
			}
			if (line.startsWith('stderr:')) {
				section = 'stderr';
				const text = line.slice(7).trim();
				if (text) stderrLines.push(text);
				continue;
			}
			if (section === 'stderr') {
				stderrLines.push(line);
			}
		}

		if (stderrLines.length === 0) return null;
		return stderrLines.join('\n').trim();
	}

	private extractStdout(content: unknown): string | null {
		if (typeof content !== 'string') return null;

		const lines = content.split('\n');
		let section = '';
		const stdoutLines: string[] = [];

		for (const line of lines) {
			if (line.startsWith('stdout:')) {
				section = 'stdout';
				const text = line.slice(7).trim();
				if (text) stdoutLines.push(text);
				continue;
			}
			if (line.startsWith('stderr:')) {
				section = 'stderr';
				continue;
			}
			if (section === 'stdout') {
				stdoutLines.push(line);
			}
		}

		if (stdoutLines.length === 0) return null;
		return stdoutLines.join('\n').trim();
	}

	private formatCommandFailureMeta(result: ToolResult): string | null {
		const parts: string[] = [];
		if (typeof result.exitCode === 'number') {
			parts.push(`exit code=${result.exitCode}`);
		}
		if (typeof result.signal === 'string') {
			parts.push(`signal=${result.signal}`);
		}
		if (typeof result.timedOut === 'boolean') {
			parts.push(`timed out=${result.timedOut ? 'yes' : 'no'}`);
		}
		return parts.length > 0 ? `(${parts.join(', ')})` : null;
	}

	/**
	 * Print command output with stdout/stderr separation
	 */
	private printCommandOutput(result: ToolResult): void {
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
					output +=
						chalk.bold.yellow(
							'#'.repeat(element.level || 1) + ' ' + element.content,
						) + '\n';
					break;

				case 'mixed-line': {
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
				}

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
		return new Promise(resolve => {
			this.rl.question(prompt, resolve);
		});
	}

	/**
	 * Read user input where Enter sends the line and Ctrl+J inserts a newline.
	 * Returns the full string entered by the user.
	 */
	private readLineInput(): Promise<string> {
		return new Promise(resolve => {
			const promptPrimary = chalk.cyan('> ');
			let buffer = '';
			let lastKeyTime = 0;
			let pendingEnterTimeout: NodeJS.Timeout | null = null;

			// Enable raw mode to capture individual keypresses
			readline.emitKeypressEvents(process.stdin);
			if (process.stdin.isTTY) process.stdin.setRawMode(true);

			const cleanup = () => {
				process.stdin.removeListener('keypress', onKey);
				if (process.stdin.isTTY) process.stdin.setRawMode(false);
				if (pendingEnterTimeout) {
					clearTimeout(pendingEnterTimeout);
					pendingEnterTimeout = null;
				}
			};

			const finishInput = () => {
				cleanup();
				resolve(buffer);
			};

			const onKey = (str: string, key: readline.Key) => {
				const now = Date.now();
				const timeSinceLastKey = now - lastKeyTime;
				lastKeyTime = now;

				// Clear any pending enter timeout since we got more input
				if (pendingEnterTimeout) {
					clearTimeout(pendingEnterTimeout);
					pendingEnterTimeout = null;
				}

				// Ctrl+C – let the existing SIGINT handler deal with it
				if (key.sequence === '\x03') {
					cleanup();
					process.emit('SIGINT');
					return;
				}
				// Ctrl+J – insert a newline into the buffer
				if (key.name === 'j' && key.ctrl) {
					buffer += '\n';
					return;
				}
				// Enter/Return key
				if (key.name === 'return') {
					// If this Enter comes quickly after other input (< 50ms), it's likely part of a paste
					// In that case, add newline to buffer and wait for more input
					if (timeSinceLastKey < 50 && buffer.length > 0) {
						buffer += '\n';
						// Set a timeout to finish input if no more keys come
						pendingEnterTimeout = setTimeout(finishInput, 100);
						return;
					}
					// Otherwise, it's a manual Enter - finish input
					finishInput();
					return;
				}
				// Backspace – remove last character from the buffer
				if (key.name === 'backspace' || key.name === 'delete') {
					if (buffer.length > 0) {
						buffer = buffer.slice(0, -1);
					}
					return;
				}
				// Printable characters – add to buffer
				// Exclude standalone newline/carriage return (handled by 'return' key)
				if (str && str !== '\n' && str !== '\r') {
					buffer += str;
				}
			};

			// Show initial prompt
			process.stdout.write(promptPrimary);
			process.stdin.on('keypress', onKey);
		});
	}

	/**
	 * Main chat loop
	 */
	async run(): Promise<void> {
		// [学習用ログ] 対話ループ開始
		learn.log('SimpleCLI.run() started');
		console.log(chalk.gray('Type /help for commands, Ctrl+C to exit\n'));

		// [学習用ログ] ループカウンター
		let loopCount = 0;

		for (;;) {
			loopCount++;
			// [学習用ログ] ループ開始
			learn.divider(`ループ ${loopCount} 回目`);
			learn.log('ユーザー入力待ち...');

			// Read user input: Enter sends the line, Ctrl+J inserts a newline in the buffer
			const rawInput = await this.readLineInput();

			// [学習用ログ] 入力を受け取った
			learn.value(
				'rawInput',
				rawInput.substring(0, 50) + (rawInput.length > 50 ? '...' : ''),
			);

			// Convert escaped '\n' literals to real newlines for processing
			const input = rawInput.replace(/\\n/g, '\n');

			if (!input.trim()) {
				learn.log('空入力のためスキップ');
				continue;
			}

			// Handle slash commands
			if (input.startsWith('/')) {
				learn.warn(`スラッシュコマンド検出: ${input}`);
				await this.handleSlashCommand(input);
				continue;
			}

			// Regular chat
			learn.log('通常チャット処理開始');
			learn.value('呼び出し', 'agent.chat()');

			this.isProcessing = true;
			this.spinner = createSpinner('Thinking...');

			try {
				await this.agent.chat(input);
				learn.success('agent.chat() 完了');
			} catch (error) {
				this.spinner?.stop();
				learn.error(`エラー発生: ${error}`);
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

			case 'prompt': {
				// Usage: /prompt <name>
				// Loads prompt from ~/.config/cli-code/prompts/<name>.txt
				const promptName = parts[1];
				if (!promptName) {
					console.log(chalk.yellow('Usage: /prompt <prompt_name>'));
					console.log(
						chalk.gray(
							'Prompts are loaded from ~/.config/cli-code/prompts/<name>.txt',
						),
					);
					break;
				}
				const promptContent = this.agent.loadUserPrompt(promptName);
				if (!promptContent) {
					console.log(chalk.red(`Prompt '${promptName}' not found.`));
					console.log(
						chalk.gray(
							`Create it at: ~/.config/cli-code/prompts/${promptName}.txt`,
						),
					);
					break;
				}
				try {
					// Send prompt content as a chat message to the agent
					this.isProcessing = true;
					this.spinner = createSpinner('Sending prompt...');
					await this.agent.chat(promptContent);
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					console.log(
						chalk.red(`Failed to send prompt '${promptName}': ${message}`),
					);
				} finally {
					this.spinner?.stop();
					this.isProcessing = false;
				}
				break;
			}

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
		console.log('  /model          - Select AI model');
		console.log('  /login          - Set API key for a provider');
		console.log('  /clear          - Clear chat history');
		console.log('  /stats          - Show token usage statistics');
		console.log(
			'  /prompt <name>  - Load and send prompt from ~/.config/cli-code/prompts/<name>.txt',
		);
		console.log('  /help           - Show this help message');
		console.log('');
	}

	/**
	 * Show session statistics
	 */
	private showStats(): void {
		console.log(chalk.cyan('\nSession Statistics:'));
		console.log(`  Requests:          ${this.sessionStats.requestCount}`);
		console.log(
			`  Prompt tokens:     ${this.sessionStats.promptTokens.toLocaleString()}`,
		);
		console.log(
			`  Completion tokens: ${this.sessionStats.completionTokens.toLocaleString()}`,
		);
		console.log(
			`  Total tokens:      ${this.sessionStats.totalTokens.toLocaleString()}`,
		);
		console.log(`  Current model:     ${this.agent.getCurrentModel()}`);
		console.log('');
	}

	/**
	 * Select model using number selection
	 */
	private async selectModel(): Promise<void> {
		// [学習用ログ] モデル選択
		learn.log('selectModel() called');

		// Build model list with provider prefixes
		const modelList: string[] = [];
		for (const [provider, models] of Object.entries(MODELS)) {
			for (const model of models) {
				modelList.push(`${provider}:${model}`);
			}
		}

		const selected = await selectWithNumbers(modelList, 'Select model');
		learn.value('selected', selected || '(キャンセル)');

		if (selected) {
			const [provider, model] = selected.split(':');
			learn.warn(`分解結果: provider="${provider}", model="${model}"`);
			// [Issue #11 修正] provider も一緒に渡す
			this.agent.setModel(model, provider as 'groq' | 'anthropic' | 'gemini');
			console.log(chalk.green(` Switched to ${model} (${provider})`));
		}
	}

	/**
	 * Login to set API key for a provider
	 */
	private async login(): Promise<void> {
		const providers = ['groq', 'anthropic', 'gemini'];
		const selected = await selectWithNumbers(providers, 'Select provider');

		if (!selected) return;

		const providerUrls: Record<string, string> = {
			groq: 'https://console.groq.com/keys',
			anthropic: 'https://console.anthropic.com/settings/keys',
			gemini: 'https://aistudio.google.com/apikey',
		};

		console.log(chalk.dim(`Get your API key from: ${providerUrls[selected]}`));

		let apiKey = await this.question(chalk.cyan('API Key: '));

		// selectWithNumbers で押した数字が末尾に残るバグの対処
		const selectedIndex = providers.indexOf(selected) + 1;
		if (apiKey.endsWith(String(selectedIndex))) {
			apiKey = apiKey.slice(0, -1);
		}

		if (apiKey.trim()) {
			this.agent.saveApiKey(
				apiKey.trim(),
				selected as 'groq' | 'anthropic' | 'gemini',
			);
			console.log(chalk.green(` API key saved for ${selected}`));
		} else {
			console.log(chalk.yellow(' No API key provided'));
		}
	}
}
