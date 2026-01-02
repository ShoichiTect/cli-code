import Groq from 'groq-sdk';
import type {ClientOptions} from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import {GoogleGenAI} from '@google/genai';
import {
	executeTool,
	setDebugEnabled,
	type ToolResult,
} from '../tools/tools.js';
import {
	isToolName,
	type ToolArgsByName,
	type ToolName,
} from '../tools/tool-types.js';
import {
	DANGEROUS_TOOLS,
	APPROVAL_REQUIRED_TOOLS,
} from '../tools/tool-schemas.js';
import {ConfigManager} from '../utils/local-settings.js';
import {getProxyAgent, getProxyInfo} from '../utils/proxy-config.js';
import {learn} from '../utils/learn-log.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {DEFAULT_SYSTEM_PROMPT} from './default-prompt.js';
import {
	chatWithGroq,
	chatWithAnthropic,
	chatWithGemini,
	type ChatContext,
	type ChatResult,
	type ToolCall,
	type Message,
} from './providers/index.js';

export class Agent {
	private client: Groq | Anthropic | null = null;
	private geminiClient: GoogleGenAI | null = null;
	private provider: 'groq' | 'anthropic' | 'gemini' = 'groq';
	private messages: Message[] = [];
	private apiKey: string | null = null;
	private model: string;
	private temperature: number;
	private sessionAutoApprove: boolean = false;
	private systemMessage: string;
	private configManager: ConfigManager;
	private proxyOverride?: string;
	private onToolStart?: (name: ToolName) => void;
	private onToolEnd?: (
		name: ToolName,
		result: ToolResult,
		args: ToolArgsByName[ToolName],
	) => void;
	private onToolApproval?: (
		toolName: ToolName,
		toolArgs: ToolArgsByName[ToolName],
	) => Promise<{approved: boolean; autoApproveSession?: boolean}>;
	private onThinkingText?: (content: string, reasoning?: string) => void;
	private onFinalMessage?: (content: string, reasoning?: string) => void;
	private onMaxIterations?: (maxIterations: number) => Promise<boolean>;
	private onApiUsage?: (usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		total_time?: number;
	}) => void;
	private onError?: (error: string) => Promise<boolean>;
	private requestCount: number = 0;
	private currentAbortController: AbortController | null = null;
	private isInterrupted: boolean = false;

	private constructor(
		model: string,
		temperature: number,
		systemMessage: string | null,
		debug?: boolean,
		proxyOverride?: string,
	) {
		this.model = model;
		this.temperature = temperature;
		this.configManager = new ConfigManager();
		this.proxyOverride = proxyOverride;

		// Set debug mode
		debugEnabled = debug || false;
		setDebugEnabled(debugEnabled);

		if (debugEnabled) {
			debugLog('Agent initialized with debug mode enabled');
		}

		// Build system message
		if (systemMessage) {
			this.systemMessage = systemMessage;
		} else {
			this.systemMessage = this.buildDefaultSystemMessage();
		}

		// Add system message to conversation
		this.messages.push({role: 'system', content: this.systemMessage});

		// Load project context if available
		try {
			const explicitContextFile = process.env.GROQ_CONTEXT_FILE;
			const baseDir = process.env.GROQ_CONTEXT_DIR || process.cwd();
			const contextPath =
				explicitContextFile || path.join(baseDir, '.groq', 'context.md');
			const contextLimit = parseInt(
				process.env.GROQ_CONTEXT_LIMIT || '20000',
				10,
			);
			if (fs.existsSync(contextPath)) {
				const ctx = fs.readFileSync(contextPath, 'utf-8');
				const trimmed =
					ctx.length > contextLimit
						? ctx.slice(0, contextLimit) + '\n... [truncated]'
						: ctx;
				const contextSource = explicitContextFile
					? contextPath
					: '.groq/context.md';
				this.messages.push({
					role: 'system',
					content: `Project context loaded from ${contextSource}. Use this as high-level reference when reasoning about the repository.\n\n${trimmed}`,
				});
			}
		} catch (error) {
			if (debugEnabled) {
				debugLog('Failed to load project context:', error);
			}
		}
	}

	static async create(
		model: string,
		temperature: number,
		systemMessage: string | null,
		debug?: boolean,
		proxyOverride?: string,
	): Promise<Agent> {
		// [学習用ログ] モデル選択ロジックを追跡
		learn.log('Agent.create() called');
		learn.value('引数で渡されたmodel', model);

		// Check for default model in config if model not explicitly provided
		const configManager = new ConfigManager();
		const defaultModel = configManager.getDefaultModel();
		const savedProvider = configManager.getProvider();

		// [学習用ログ] 設定ファイルからの読み込み結果
		learn.value('設定ファイルのdefaultModel', defaultModel || '(未設定)');
		learn.value('設定ファイルのprovider', savedProvider || '(未設定)');

		// [Issue #11 デバッグ] provider と model の不整合チェック
		if (defaultModel && savedProvider) {
			// モデル名からプロバイダを推定
			let expectedProvider: string | null = null;
			if (defaultModel.startsWith('claude')) {
				expectedProvider = 'anthropic';
			} else if (defaultModel.startsWith('gemini')) {
				expectedProvider = 'gemini';
			} else {
				expectedProvider = 'groq'; // その他は groq と仮定
			}

			if (expectedProvider !== savedProvider) {
				learn.error('不整合検出！');
				learn.value('設定ファイルの provider', savedProvider);
				learn.value(
					'設定ファイルの model',
					`${defaultModel} → 期待される provider: ${expectedProvider}`,
				);
				learn.error(
					'この状態で API リクエストを送ると 404 エラーになる可能性があります',
				);
			} else {
				learn.success('provider と model は整合しています');
			}
		}

		const selectedModel = defaultModel || model;

		// [学習用ログ] 最終的に選択されたモデル
		learn.warn(`最終選択されたmodel: ${selectedModel}`);
		if (defaultModel) {
			learn.value('選択理由', '設定ファイルの値が優先されました');
		} else {
			learn.value('選択理由', '引数の値がそのまま使用されました');
		}

		const agent = new Agent(
			selectedModel,
			temperature,
			systemMessage,
			debug,
			proxyOverride,
		);
		return agent;
	}

	/**
	 * Get the user prompts directory path: ~/.config/cli-code/prompts/
	 */
	private getUserPromptsDir(): string {
		return path.join(os.homedir(), '.config', 'cli-code', 'prompts');
	}

	/**
	 * Load a user prompt from ~/.config/cli-code/prompts/<name>.txt
	 * Returns null if not found.
	 */
	public loadUserPrompt(promptName: string): string | null {
		try {
			const promptPath = path.join(
				this.getUserPromptsDir(),
				`${promptName}.txt`,
			);
			return fs.readFileSync(promptPath, {encoding: 'utf-8'});
		} catch {
			return null;
		}
	}

	/**
	 * Build default system message.
	 * Uses embedded default prompt (compiled into the build).
	 */
	private buildDefaultSystemMessage(): string {
		return DEFAULT_SYSTEM_PROMPT;
	}

	public setToolCallbacks(callbacks: {
		onToolStart?: (name: ToolName) => void;
		onToolEnd?: (
			name: ToolName,
			result: ToolResult,
			args: ToolArgsByName[ToolName],
		) => void;
		onToolApproval?: (
			toolName: ToolName,
			toolArgs: ToolArgsByName[ToolName],
		) => Promise<{approved: boolean; autoApproveSession?: boolean}>;
		onThinkingText?: (content: string) => void;
		onFinalMessage?: (content: string) => void;
		onMaxIterations?: (maxIterations: number) => Promise<boolean>;
		onApiUsage?: (usage: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
			total_time?: number;
		}) => void;
		onError?: (error: string) => Promise<boolean>;
	}) {
		this.onToolStart = callbacks.onToolStart;
		this.onToolEnd = callbacks.onToolEnd;
		this.onToolApproval = callbacks.onToolApproval;
		this.onThinkingText = callbacks.onThinkingText;
		this.onFinalMessage = callbacks.onFinalMessage;
		this.onMaxIterations = callbacks.onMaxIterations;
		this.onApiUsage = callbacks.onApiUsage;
		this.onError = callbacks.onError;
	}

	public setApiKey(
		apiKey: string,
		provider?: 'groq' | 'anthropic' | 'gemini',
	): void {
		debugLog('Setting API key in agent...');
		debugLog(
			'API key provided:',
			apiKey ? `${apiKey.substring(0, 8)}...` : 'empty',
		);
		this.apiKey = apiKey;

		// プロバイダーが指定されている場合は設定、なければ既存の設定を維持
		if (provider) {
			this.provider = provider;
		} else {
			// 設定ファイルから読み込み（デフォルトは'groq'）
			const savedProvider = this.configManager.getProvider();
			this.provider = savedProvider || 'groq';
		}

		if (this.provider === 'groq') {
			// Get proxy configuration (with override if provided)
			const proxyAgent = getProxyAgent(this.proxyOverride);
			const proxyInfo = getProxyInfo(this.proxyOverride);

			if (proxyInfo.enabled) {
				debugLog(`Using ${proxyInfo.type} proxy: ${proxyInfo.url}`);
			}

			// Initialize Groq client with proxy if available
			const clientOptions: ClientOptions = {apiKey};
			if (proxyAgent) {
				clientOptions.httpAgent = proxyAgent;
			}

			this.client = new Groq(clientOptions);
			debugLog(
				'Groq client initialized with provided API key' +
					(proxyInfo.enabled ? ' and proxy' : ''),
			);
		} else if (this.provider === 'anthropic') {
			// Initialize Anthropic client
			// Note: Anthropic SDK doesn't support custom http agents yet
			this.client = new Anthropic({apiKey});
			debugLog('Anthropic client initialized with provided API key');
		} else if (this.provider === 'gemini') {
			// Initialize Gemini client
			this.geminiClient = new GoogleGenAI({apiKey});
			debugLog('Gemini client initialized with provided API key');
		}
	}

	public saveApiKey(
		apiKey: string,
		provider?: 'groq' | 'anthropic' | 'gemini',
	): void {
		const selectedProvider = provider || this.provider;

		if (selectedProvider === 'groq') {
			this.configManager.setApiKey(apiKey);
		} else if (selectedProvider === 'anthropic') {
			this.configManager.setAnthropicApiKey(apiKey);
		} else if (selectedProvider === 'gemini') {
			this.configManager.setGeminiApiKey(apiKey);
		}

		// プロバイダーも保存
		this.configManager.setProvider(selectedProvider);

		this.setApiKey(apiKey, selectedProvider);
	}

	public clearApiKey(): void {
		this.configManager.clearApiKey();
		this.apiKey = null;
		this.client = null;
	}

	public clearHistory(): void {
		// Reset messages to only contain system messages
		this.messages = this.messages.filter(msg => msg.role === 'system');
	}

	public setModel(
		model: string,
		provider?: 'groq' | 'anthropic' | 'gemini',
	): void {
		// [学習用ログ] setModel() の呼び出しを追跡
		learn.log('agent.setModel() called');
		learn.value('引数 model', model);
		learn.value('引数 provider', provider || '(未指定)');
		learn.value('現在の this.provider', this.provider);

		this.model = model;
		// Save as default model
		this.configManager.setDefaultModel(model);
		learn.warn(`configManager.setDefaultModel("${model}") 実行`);

		// [Issue #11 修正] provider が指定されていれば保存し、クライアントも再初期化
		// 注意: this.provider（メモリ上の値）ではなく、設定ファイルの値と比較する
		const savedProvider = this.configManager.getProvider();
		learn.value('設定ファイルの provider', savedProvider || '(未設定)');

		if (provider) {
			// 設定ファイルの provider と異なる場合は保存
			if (provider !== savedProvider) {
				learn.warn(
					`provider が変更されました（設定ファイル）: "${savedProvider}" → "${provider}"`,
				);
				this.configManager.setProvider(provider);
			}

			// メモリ上の provider と異なる場合はクライアント再初期化
			if (provider !== this.provider) {
				learn.warn(
					`provider が変更されました（メモリ）: "${this.provider}" → "${provider}"`,
				);

				// 新しい provider に対応する API キーを取得してクライアントを再初期化
				let apiKey: string | null = null;
				if (provider === 'groq') {
					apiKey = this.configManager.getApiKey();
				} else if (provider === 'anthropic') {
					apiKey = this.configManager.getAnthropicApiKey();
				} else if (provider === 'gemini') {
					apiKey = this.configManager.getGeminiApiKey();
				}

				if (apiKey) {
					learn.success(`${provider} の API クライアントを再初期化`);
					this.setApiKey(apiKey, provider);
				} else {
					learn.error(`${provider} の API キーが設定されていません`);
					this.provider = provider; // provider だけは更新
				}
			} else {
				learn.value('再初期化', 'メモリ上の provider は同じなので不要');
			}
		} else {
			learn.warn('provider は未指定のため更新されません');
		}

		// Update system message to reflect new model
		const newSystemMessage = this.buildDefaultSystemMessage();
		this.systemMessage = newSystemMessage;
		// Update the system message in the conversation
		const systemMsgIndex = this.messages.findIndex(
			msg => msg.role === 'system' && msg.content.includes('coding assistant'),
		);
		if (systemMsgIndex >= 0) {
			this.messages[systemMsgIndex].content = newSystemMessage;
		}
	}

	public getCurrentModel(): string {
		return this.model;
	}

	public setSessionAutoApprove(enabled: boolean): void {
		this.sessionAutoApprove = enabled;
	}

	public interrupt(): void {
		debugLog('Interrupting current request');
		this.isInterrupted = true;

		if (this.currentAbortController) {
			debugLog('Aborting current API request');
			this.currentAbortController.abort();
		}

		// Add interruption message to conversation
		this.messages.push({
			role: 'system',
			content: 'User has interrupted the request.',
		});
	}

	async chat(userInput: string): Promise<void> {
		// Reset interrupt flag at the start of a new chat
		this.isInterrupted = false;

		// Check API key on first message send
		if (!this.client && !this.geminiClient) {
			debugLog('Initializing AI client...');

			// 設定からプロバイダーを読み込み
			const savedProvider = this.configManager.getProvider() || 'groq';
			this.provider = savedProvider;

			let apiKey: string | null = null;

			if (this.provider === 'groq') {
				// Try environment variable first
				apiKey = process.env.GROQ_API_KEY || null;
				if (apiKey) {
					debugLog('Using Groq API key from environment variable');
				} else {
					// Try config file
					debugLog(
						'Environment variable GROQ_API_KEY not found, checking config file',
					);
					apiKey = this.configManager.getApiKey();
					if (apiKey) {
						debugLog('Using Groq API key from config file');
					}
				}

				if (!apiKey) {
					throw new Error(
						'No Groq API key available. Please use /login to set your Groq API key.',
					);
				}
			} else if (this.provider === 'anthropic') {
				// Try environment variable first
				apiKey = process.env.ANTHROPIC_API_KEY || null;
				if (apiKey) {
					debugLog('Using Anthropic API key from environment variable');
				} else {
					// Try config file
					debugLog(
						'Environment variable ANTHROPIC_API_KEY not found, checking config file',
					);
					apiKey = this.configManager.getAnthropicApiKey();
					if (apiKey) {
						debugLog('Using Anthropic API key from config file');
					}
				}

				if (!apiKey) {
					throw new Error(
						'No Anthropic API key available. Please use /login to set your Anthropic API key.',
					);
				}
			} else if (this.provider === 'gemini') {
				// Try environment variable first
				apiKey =
					process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
				if (apiKey) {
					debugLog('Using Gemini API key from environment variable');
				} else {
					// Try config file
					debugLog(
						'Environment variable GEMINI_API_KEY not found, checking config file',
					);
					apiKey = this.configManager.getGeminiApiKey();
					if (apiKey) {
						debugLog('Using Gemini API key from config file');
					}
				}

				if (!apiKey) {
					throw new Error(
						'No Gemini API key available. Please use /login to set your Gemini API key.',
					);
				}
			}

			if (apiKey) {
				this.setApiKey(apiKey, this.provider);
				debugLog(`${this.provider} client initialized successfully`);
			}
		}

		// Add user message
		this.messages.push({role: 'user', content: userInput});

		const maxIterations = 50;
		let iteration = 0;

		for (;;) {
			// Outer loop for iteration reset
			while (iteration < maxIterations) {
				// Check for interruption before each iteration
				if (this.isInterrupted) {
					debugLog('Chat loop interrupted by user');
					this.currentAbortController = null;
					return;
				}

				try {
					// Check client exists
					if (!this.client && !this.geminiClient) {
						throw new Error('AI client not initialized');
					}

					// ChatContext を構築
					const ctx: ChatContext = {
						client: this.client,
						geminiClient: this.geminiClient,
						apiKey: this.apiKey,
						model: this.model,
						temperature: this.temperature,
						messages: [...this.messages],
						systemMessage: this.systemMessage,
						onToolStart: this.onToolStart,
						onToolEnd: this.onToolEnd,
						onToolApproval: this.onToolApproval,
						onThinkingText: this.onThinkingText,
						onFinalMessage: this.onFinalMessage,
						onApiUsage: this.onApiUsage,
						sessionAutoApprove: this.sessionAutoApprove,
						isInterrupted: this.isInterrupted,
						currentAbortController: this.currentAbortController,
						requestCount: this.requestCount,
					};

					let result: ChatResult;

					// プロバイダー別に委譲
					if (this.provider === 'groq') {
						result = await chatWithGroq(
							ctx,
							this.executeToolCall.bind(this),
							debugLog,
							generateCurlCommand,
						);
					} else if (this.provider === 'anthropic') {
						result = await chatWithAnthropic(
							ctx,
							this.executeToolCall.bind(this),
							debugLog,
							generateCurlCommand,
						);
					} else {
						result = await chatWithGemini(
							ctx,
							this.executeToolCall.bind(this),
							debugLog,
						);
					}

					// 状態を同期
					this.messages = result.messages;
					this.requestCount = ctx.requestCount;
					this.currentAbortController = ctx.currentAbortController;

					// userRejected の場合は終了
					if (result.userRejected) {
						return;
					}

					// 継続判定
					if (!result.shouldContinue) {
						return;
					}

					if (result.incrementIteration) {
						iteration++;
					}
					continue;
				} catch (error) {
					this.currentAbortController = null; // Clear abort controller

					// Check if this is an abort error due to user interruption
					if (
						error instanceof Error &&
						(error.message.includes('Request was aborted') ||
							error.message.includes('The operation was aborted') ||
							error.name === 'AbortError')
					) {
						debugLog('API request aborted due to user interruption');
						// Don't add error message if it's an interruption - the interrupt message was already added
						return;
					}

					debugLog('Error occurred during API call:', error);
					debugLog('Error details:', {
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : 'No stack available',
					});

					// Add API error as context message instead of terminating chat
					let errorMessage = 'Unknown error occurred';
					let is401Error = false;

					if (error instanceof Error) {
						// Check if it's an API error with more details
						if (
							typeof error === 'object' &&
							error !== null &&
							'status' in error &&
							'error' in error
						) {
							const apiError = error as {
								status?: number;
								error?: {error?: {message?: string; code?: string}};
							};
							is401Error = apiError.status === 401;
							if (apiError.error?.error?.message) {
								errorMessage = `API Error (${apiError.status}): ${apiError.error.error.message}`;
								if (apiError.error.error.code) {
									errorMessage += ` (Code: ${apiError.error.error.code})`;
								}
							} else {
								errorMessage = `API Error (${apiError.status}): ${error.message}`;
							}
						} else {
							errorMessage = `Error: ${error.message}`;
						}
					} else {
						errorMessage = `Error: ${String(error)}`;
					}

					// For 401 errors (invalid API key), don't retry - terminate immediately
					if (is401Error) {
						throw new Error(
							`${errorMessage}. Please check your API key and use /login to set a valid key.`,
						);
					}

					// Ask user if they want to retry via callback
					if (this.onError) {
						const shouldRetry = await this.onError(errorMessage);
						if (shouldRetry) {
							// User wants to retry - continue the loop without adding error to conversation
							iteration++;
							continue;
						} else {
							// User chose not to retry - add error message and return
							this.messages.push({
								role: 'system',
								content: `Request failed with error: ${errorMessage}. User chose not to retry.`,
							});
							return;
						}
					} else {
						// No error callback available - use old behavior
						// Add error context to conversation for model to see and potentially recover
						this.messages.push({
							role: 'system',
							content: `Previous API request failed with error: ${errorMessage}. Please try a different approach or ask the user for clarification.`,
						});

						// Continue conversation loop to let model attempt recovery
						iteration++;
						continue;
					}
				}
			}

			// Hit max iterations, ask user if they want to continue
			if (iteration >= maxIterations) {
				let shouldContinue = false;
				if (this.onMaxIterations) {
					shouldContinue = await this.onMaxIterations(maxIterations);
				}
				if (shouldContinue) {
					iteration = 0; // Reset iteration counter
					continue; // Continue the outer loop
				} else {
					return; // Exit both loops
				}
			}
		}
	}

	private async executeToolCall(
		toolCall: ToolCall,
		ctx: ChatContext,
	): Promise<Record<string, unknown> & {userRejected?: boolean}> {
		void ctx;
		// Initialize toolName outside try block so it's accessible in catch
		let toolName = 'unknown';
		let toolArgs: ToolArgsByName[ToolName] | undefined;
		try {
			// Strip 'repo_browser.' prefix if present (some models hallucinate this)
			toolName = toolCall.function.name;
			if (toolName.startsWith('repo_browser.')) {
				toolName = toolName.substring('repo_browser.'.length);
			}

			// Handle truncated tool calls
			try {
				const parsedArgs = JSON.parse(
					toolCall.function.arguments,
				) as unknown;
				if (!isToolName(toolName)) {
					return {
						error: `Unknown tool: ${toolName}`,
						success: false,
					};
				}
				toolArgs = parsedArgs as ToolArgsByName[typeof toolName];
			} catch (error) {
				const errorMsg = `Tool arguments truncated: ${error}. Please break this into smaller pieces or use shorter content.`;
				if (debugEnabled) {
					debugLog(`Tool argument parsing error for ${toolName}:`, {
						error: String(error),
						rawArguments: toolCall.function.arguments
							? toolCall.function.arguments.substring(0, 200)
							: 'null',
					});
				}
				return {
					error: errorMsg,
					success: false,
				};
			}

			// Debug: log tool call reception
			if (debugEnabled) {
				debugLog(`Received tool call from model`, {
					toolName,
					argumentKeys: Object.keys(toolArgs),
				});
			}

			// Notify UI about tool start
			if (this.onToolStart) {
				this.onToolStart(toolName);
			}

			// Check if tool needs approval (only after validation passes)
			const isDangerous = DANGEROUS_TOOLS.includes(toolName);
			const requiresApproval = APPROVAL_REQUIRED_TOOLS.includes(toolName);
			const needsApproval = isDangerous || requiresApproval;

			// For APPROVAL_REQUIRED_TOOLS, check if session auto-approval is enabled
			const canAutoApprove =
				requiresApproval && !isDangerous && this.sessionAutoApprove;

			if (needsApproval && !canAutoApprove) {
				let approvalResult: {approved: boolean; autoApproveSession?: boolean};

				if (this.onToolApproval) {
					// Check for interruption before waiting for approval
					if (this.isInterrupted) {
						const result = {
							error: 'Tool execution interrupted by user',
							success: false,
							userRejected: true,
						};
						if (this.onToolEnd) {
							this.onToolEnd(toolName, result, toolArgs!);
						}
						return result;
					}

					approvalResult = await this.onToolApproval(toolName, toolArgs);

					// Check for interruption after approval process
					if (this.isInterrupted) {
						const result = {
							error: 'Tool execution interrupted by user',
							success: false,
							userRejected: true,
						};
						if (this.onToolEnd) {
							this.onToolEnd(toolName, result, toolArgs!);
						}
						return result;
					}
				} else {
					// No approval callback available, reject by default
					approvalResult = {approved: false};
				}

				// Enable session auto-approval if requested (only for APPROVAL_REQUIRED_TOOLS)
				if (
					approvalResult.autoApproveSession &&
					requiresApproval &&
					!isDangerous
				) {
					this.sessionAutoApprove = true;
				}

				if (!approvalResult.approved) {
					const result = {
						error: 'Tool execution canceled by user',
						success: false,
						userRejected: true,
					};
					if (this.onToolEnd) {
						this.onToolEnd(toolName, result, toolArgs!);
					}
					return result;
				}
			}

			// Debug: before tool execution
			if (debugEnabled) {
				debugLog(`About to execute tool: ${toolName}`, {
					toolName,
					argCount: Object.keys(toolArgs).length,
					needsApproval: needsApproval ? 'yes' : 'no',
				});
			}

			// Execute tool
			const result = await executeTool(toolName, toolArgs);

			// Debug: after tool execution
			if (debugEnabled) {
				debugLog(`Tool execution completed: ${toolName}`, {
					success: result.success,
					hasError: !!result.error,
					hasData: !!result.data || !!result.content,
				});
			}

			// Notify UI about tool completion
			if (this.onToolEnd) {
				this.onToolEnd(toolName, result, toolArgs!);
			}

			return result as unknown as Record<string, unknown> & {
				userRejected?: boolean;
			};
		} catch (error) {
			const errorMsg = `Tool execution error: ${error}`;
			if (debugEnabled) {
				debugLog(`Tool execution exception: ${toolName}`, {
					error: String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
			return {error: errorMsg, success: false};
		}
	}
}

// Debug logging to file
const DEBUG_LOG_FILE = path.join(process.cwd(), 'debug-agent.log');
let debugLogCleared = false;
let debugEnabled = false;

function debugLog(message: string, data?: unknown) {
	if (!debugEnabled) return;

	// Clear log file on first debug log of each session
	if (!debugLogCleared) {
		fs.writeFileSync(DEBUG_LOG_FILE, '');
		debugLogCleared = true;
	}

	const timestamp = new Date().toISOString();
	const logEntry = `[${timestamp}] ${message}${
		data ? '\n' + JSON.stringify(data, null, 2) : ''
	}\n`;
	fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
}

function generateCurlCommand(
	apiKey: string,
	requestBody: unknown,
	requestCount: number,
	provider: 'groq' | 'anthropic' | 'gemini' = 'groq',
): string {
	if (!debugEnabled) return '';

	const maskedApiKey = `${apiKey.substring(0, 8)}...${apiKey.substring(
		apiKey.length - 8,
	)}`;

	// Write request body to JSON file
	const jsonFileName = `debug-request-${requestCount}.json`;
	const jsonFilePath = path.join(process.cwd(), jsonFileName);
	fs.writeFileSync(jsonFilePath, JSON.stringify(requestBody, null, 2));

	let curlCmd: string;

	if (provider === 'anthropic') {
		curlCmd = `curl -X POST "https://api.anthropic.com/v1/messages" \\
  -H "x-api-key: ${maskedApiKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d @${jsonFileName}`;
	} else {
		// Groq (default)
		curlCmd = `curl -X POST "https://api.groq.com/openai/v1/chat/completions" \\
  -H "Authorization: Bearer ${maskedApiKey}" \\
  -H "Content-Type: application/json" \\
  -d @${jsonFileName}`;
	}

	return curlCmd;
}
