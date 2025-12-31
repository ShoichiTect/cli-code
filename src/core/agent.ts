import Groq from 'groq-sdk';
import type { ClientOptions } from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { convertAllToolSchemasForAnthropic, convertAllToolSchemasForGemini } from '../utils/tool-schema-converter.js';
import { executeTool, setDebugEnabled, isDebugEnabled, toolDebugLog } from '../tools/tools.js';
import { validateReadBeforeEdit, getReadBeforeEditError } from '../tools/validators.js';
import { ALL_TOOL_SCHEMAS, DANGEROUS_TOOLS, APPROVAL_REQUIRED_TOOLS } from '../tools/tool-schemas.js';
import { ConfigManager } from '../utils/local-settings.js';
import { getProxyAgent, getProxyInfo } from '../utils/proxy-config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_SYSTEM_PROMPT } from './default-prompt.js';

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
  thoughtSignature?: string;  // Gemini Thinking Modelのthought signatureを保持
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

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
  private onToolStart?: (name: string, args: Record<string, any>) => void;
  private onToolEnd?: (name: string, result: any) => void;
  private onToolApproval?: (toolName: string, toolArgs: Record<string, any>) => Promise<{ approved: boolean; autoApproveSession?: boolean }>;
  private onThinkingText?: (content: string, reasoning?: string) => void;
  private onFinalMessage?: (content: string, reasoning?: string) => void;
  private onMaxIterations?: (maxIterations: number) => Promise<boolean>;
  private onApiUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => void;
  private onError?: (error: string) => Promise<boolean>;
  private requestCount: number = 0;
  private currentAbortController: AbortController | null = null;
  private isInterrupted: boolean = false;

  private constructor(
    model: string,
    temperature: number,
    systemMessage: string | null,
    debug?: boolean,
    proxyOverride?: string
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
    this.messages.push({ role: 'system', content: this.systemMessage });

    // Load project context if available
    try {
      const explicitContextFile = process.env.GROQ_CONTEXT_FILE;
      const baseDir = process.env.GROQ_CONTEXT_DIR || process.cwd();
      const contextPath = explicitContextFile || path.join(baseDir, '.groq', 'context.md');
      const contextLimit = parseInt(process.env.GROQ_CONTEXT_LIMIT || '20000', 10);
      if (fs.existsSync(contextPath)) {
        const ctx = fs.readFileSync(contextPath, 'utf-8');
        const trimmed = ctx.length > contextLimit ? ctx.slice(0, contextLimit) + '\n... [truncated]' : ctx;
        const contextSource = explicitContextFile ? contextPath : '.groq/context.md';
        this.messages.push({
          role: 'system',
          content: `Project context loaded from ${contextSource}. Use this as high-level reference when reasoning about the repository.\n\n${trimmed}`
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
    proxyOverride?: string
  ): Promise<Agent> {
    // [学習用デバッグログ] モデル選択ロジックを追跡
    console.log(chalk.cyan('[DEBUG] Agent.create() called'));
    console.log(chalk.gray(`  引数で渡されたmodel: ${model}`));

    // Check for default model in config if model not explicitly provided
    const configManager = new ConfigManager();
    const defaultModel = configManager.getDefaultModel();
    const savedProvider = configManager.getProvider();

    // [学習用デバッグログ] 設定ファイルからの読み込み結果
    console.log(chalk.gray(`  設定ファイルのdefaultModel: ${defaultModel || '(未設定)'}`));
    console.log(chalk.gray(`  設定ファイルのprovider: ${savedProvider || '(未設定)'}`));

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
        console.log(chalk.red(`[DEBUG] ⚠️ 不整合検出！`));
        console.log(chalk.red(`  設定ファイルの provider: "${savedProvider}"`));
        console.log(chalk.red(`  設定ファイルの model: "${defaultModel}" → 期待される provider: "${expectedProvider}"`));
        console.log(chalk.red(`  → この状態で API リクエストを送ると 404 エラーになる可能性があります`));
      } else {
        console.log(chalk.green(`[DEBUG] ✓ provider と model は整合しています`));
      }
    }

    const selectedModel = defaultModel || model;

    // [学習用デバッグログ] 最終的に選択されたモデル
    console.log(chalk.yellow(`  → 最終選択されたmodel: ${selectedModel}`));
    if (defaultModel) {
      console.log(chalk.gray('    (設定ファイルの値が優先されました)'));
    } else {
      console.log(chalk.gray('    (引数の値がそのまま使用されました)'));
    }

    const agent = new Agent(
      selectedModel,
      temperature,
      systemMessage,
      debug,
      proxyOverride
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
      const promptPath = path.join(this.getUserPromptsDir(), `${promptName}.txt`);
      return fs.readFileSync(promptPath, { encoding: 'utf-8' });
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
    onToolStart?: (name: string, args: Record<string, any>) => void;
    onToolEnd?: (name: string, result: any) => void;
    onToolApproval?: (toolName: string, toolArgs: Record<string, any>) => Promise<{ approved: boolean; autoApproveSession?: boolean }>;
    onThinkingText?: (content: string) => void;
    onFinalMessage?: (content: string) => void;
    onMaxIterations?: (maxIterations: number) => Promise<boolean>;
    onApiUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => void;
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

  public setApiKey(apiKey: string, provider?: 'groq' | 'anthropic' | 'gemini'): void {
    debugLog('Setting API key in agent...');
    debugLog('API key provided:', apiKey ? `${apiKey.substring(0, 8)}...` : 'empty');
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
      const clientOptions: ClientOptions = { apiKey };
      if (proxyAgent) {
        clientOptions.httpAgent = proxyAgent;
      }

      this.client = new Groq(clientOptions);
      debugLog('Groq client initialized with provided API key' + (proxyInfo.enabled ? ' and proxy' : ''));
    } else if (this.provider === 'anthropic') {
      // Initialize Anthropic client
      // Note: Anthropic SDK doesn't support custom http agents yet
      this.client = new Anthropic({ apiKey });
      debugLog('Anthropic client initialized with provided API key');
    } else if (this.provider === 'gemini') {
      // Initialize Gemini client
      this.geminiClient = new GoogleGenAI({ apiKey });
      debugLog('Gemini client initialized with provided API key');
    }
  }

  public saveApiKey(apiKey: string, provider?: 'groq' | 'anthropic' | 'gemini'): void {
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

  public setModel(model: string, provider?: 'groq' | 'anthropic' | 'gemini'): void {
    console.log(chalk.cyan('[DEBUG] agent.setModel() called'));
    console.log(chalk.gray(`  引数 model: "${model}"`));
    console.log(chalk.gray(`  引数 provider: "${provider || '(未指定)'}"`));
    console.log(chalk.gray(`  現在の this.provider: "${this.provider}"`));

    this.model = model;
    // Save as default model
    this.configManager.setDefaultModel(model);
    console.log(chalk.yellow(`[DEBUG] configManager.setDefaultModel("${model}") 実行`));

    // [Issue #11 修正] provider が指定されていれば保存し、クライアントも再初期化
    if (provider && provider !== this.provider) {
      console.log(chalk.yellow(`[DEBUG] provider が変更されました: "${this.provider}" → "${provider}"`));
      this.configManager.setProvider(provider);

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
        console.log(chalk.green(`[DEBUG] ✓ ${provider} の API クライアントを再初期化`));
        this.setApiKey(apiKey, provider);
      } else {
        console.log(chalk.red(`[DEBUG] ⚠️ ${provider} の API キーが設定されていません`));
        this.provider = provider; // provider だけは更新
      }
    } else if (provider) {
      console.log(chalk.gray(`[DEBUG] provider は同じなので変更なし`));
    } else {
      console.log(chalk.yellow(`[DEBUG] provider は未指定のため更新されません`));
    }

    // Update system message to reflect new model
    const newSystemMessage = this.buildDefaultSystemMessage();
    this.systemMessage = newSystemMessage;
    // Update the system message in the conversation
    const systemMsgIndex = this.messages.findIndex(msg => msg.role === 'system' && msg.content.includes('coding assistant'));
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
      content: 'User has interrupted the request.'
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
          debugLog('Environment variable GROQ_API_KEY not found, checking config file');
          apiKey = this.configManager.getApiKey();
          if (apiKey) {
            debugLog('Using Groq API key from config file');
          }
        }

        if (!apiKey) {
          throw new Error('No Groq API key available. Please use /login to set your Groq API key.');
        }
      } else if (this.provider === 'anthropic') {
        // Try environment variable first
        apiKey = process.env.ANTHROPIC_API_KEY || null;
        if (apiKey) {
          debugLog('Using Anthropic API key from environment variable');
        } else {
          // Try config file
          debugLog('Environment variable ANTHROPIC_API_KEY not found, checking config file');
          apiKey = this.configManager.getAnthropicApiKey();
          if (apiKey) {
            debugLog('Using Anthropic API key from config file');
          }
        }

        if (!apiKey) {
          throw new Error('No Anthropic API key available. Please use /login to set your Anthropic API key.');
        }
      } else if (this.provider === 'gemini') {
        // Try environment variable first
        apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
        if (apiKey) {
          debugLog('Using Gemini API key from environment variable');
        } else {
          // Try config file
          debugLog('Environment variable GEMINI_API_KEY not found, checking config file');
          apiKey = this.configManager.getGeminiApiKey();
          if (apiKey) {
            debugLog('Using Gemini API key from config file');
          }
        }

        if (!apiKey) {
          throw new Error('No Gemini API key available. Please use /login to set your Gemini API key.');
        }
      }

      if (apiKey) {
        this.setApiKey(apiKey, this.provider);
        debugLog(`${this.provider} client initialized successfully`);
      }
    }

    // Add user message
    this.messages.push({ role: 'user', content: userInput });

    const maxIterations = 50;
    let iteration = 0;

    while (true) { // Outer loop for iteration reset
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

          if (this.provider === 'groq') {
            // ===== Groq API呼び出し =====
            debugLog('Making API call to Groq with model:', this.model);
            debugLog('Messages count:', this.messages.length);
            debugLog('Last few messages:', this.messages.slice(-3));

            // Prepare request body for curl logging
            const requestBody = {
              model: this.model,
              messages: this.messages,
              tools: ALL_TOOL_SCHEMAS,
              tool_choice: 'auto' as const,
              temperature: this.temperature,
              max_tokens: 8000,
              stream: false as const
            };

            // Log equivalent curl command
            this.requestCount++;
            const curlCommand = generateCurlCommand(this.apiKey!, requestBody, this.requestCount);
            if (curlCommand) {
              debugLog('Equivalent curl command:', curlCommand);
            }

            // Create AbortController for this request
            this.currentAbortController = new AbortController();

            const response = await (this.client as Groq).chat.completions.create({
              model: this.model,
              messages: this.messages as any,
              tools: ALL_TOOL_SCHEMAS,
              tool_choice: 'auto',
              temperature: this.temperature,
              max_tokens: 8000,
              stream: false
            }, {
              signal: this.currentAbortController.signal
            });

            debugLog('Full API response received:', response);
            debugLog('Response usage:', response.usage);
            debugLog('Response finish_reason:', response.choices[0].finish_reason);
            debugLog('Response choices length:', response.choices.length);

            const message = response.choices[0].message;

            // Extract reasoning if present
            const reasoning = (message as any).reasoning;

            // Pass usage data to callback if available
            if (response.usage && this.onApiUsage) {
              this.onApiUsage({
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
                total_time: response.usage.total_time
              });
            }
            debugLog('Message content length:', message.content?.length || 0);
            debugLog('Message has tool_calls:', !!message.tool_calls);
            debugLog('Message tool_calls count:', message.tool_calls?.length || 0);

            if (response.choices[0].finish_reason !== 'stop' && response.choices[0].finish_reason !== 'tool_calls') {
              debugLog('WARNING - Unexpected finish_reason:', response.choices[0].finish_reason);
            }

            // Handle tool calls if present
            if (message.tool_calls) {
              // Show thinking text or reasoning if present
              if (message.content || reasoning) {
                if (this.onThinkingText) {
                  this.onThinkingText(message.content || '', reasoning);
                }
              }

              // Add assistant message to history
              const assistantMsg: Message = {
                role: 'assistant',
                content: message.content || ''
              };
              assistantMsg.tool_calls = message.tool_calls;
              this.messages.push(assistantMsg);

              // Execute tool calls
              for (const toolCall of message.tool_calls) {
                // Check for interruption before each tool execution
                if (this.isInterrupted) {
                  debugLog('Tool execution interrupted by user');
                  this.currentAbortController = null;
                  return;
                }

                const result = await this.executeToolCall(toolCall);

                // Add tool result to conversation (including rejected ones)
                this.messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result)
                });

                // Check if user rejected the tool, if so, stop processing
                if (result.userRejected) {
                  // Add a note to the conversation that the user rejected the tool
                  this.messages.push({
                    role: 'system',
                    content: `The user rejected the ${toolCall.function.name} tool execution. The response has been terminated. Please wait for the user's next instruction.`
                  });
                  return;
                }
              }

              // Continue loop to get model response to tool results
              iteration++;
              continue;
            }

            // No tool calls, this is the final response
            const content = message.content || '';
            debugLog('Final response - no tool calls detected');
            debugLog('Final content length:', content.length);
            debugLog('Final content preview:', content.substring(0, 200));

            if (this.onFinalMessage) {
              debugLog('Calling onFinalMessage callback');
              this.onFinalMessage(content, reasoning);
            } else {
              debugLog('No onFinalMessage callback set');
            }

            // Add final response to conversation history
            this.messages.push({
              role: 'assistant',
              content: content
            });

            debugLog('Final response added to conversation history, exiting chat loop');
            this.currentAbortController = null; // Clear abort controller
            return; // Successfully completed, exit both loops

          } else if (this.provider === 'anthropic') {
            // ===== Anthropic API呼び出し =====
            debugLog('Making API call to Anthropic with model:', this.model);
            debugLog('Messages count:', this.messages.length);

            // Anthropic用にメッセージを変換（systemロールを分離）
            const systemContent = this.messages
              .filter(msg => msg.role === 'system')
              .map(msg => msg.content)
              .join('\n\n');

            // システムプロンプトとツール定義をキャッシュ対象として配列形式で構築
            const anthropicTools = convertAllToolSchemasForAnthropic(ALL_TOOL_SCHEMAS);
            const systemMessages = [
              {
                type: 'text' as const,
                text: systemContent,
                cache_control: { type: 'ephemeral' as const }
              },
              {
                type: 'text' as const,
                text: '\n\n## Available Tools\n\n' + JSON.stringify(anthropicTools, null, 2),
                cache_control: { type: 'ephemeral' as const }
              }
            ];

            // 会話履歴をAnthropic形式に変換（最新メッセージ以外をキャッシュ対象にする）
            const filteredMessages = this.messages.filter(msg => msg.role !== 'system');
            const conversationMessages = filteredMessages.map((msg, index) => {
                // 最新メッセージの1つ前（＝最後のやり取り）にcache_controlを付与
                // これにより、過去の会話履歴全体がキャッシュ対象になる
                const isLastCacheable = index === filteredMessages.length - 2;

                if (msg.role === 'tool') {
                  // Anthropicではtoolロールは"user"として扱い、tool_result形式にする
                  const toolResult: any = {
                    type: 'tool_result' as const,
                    tool_use_id: msg.tool_call_id!,
                    content: msg.content
                  };
                  if (isLastCacheable) {
                    toolResult.cache_control = { type: 'ephemeral' as const };
                  }
                  return {
                    role: 'user' as const,
                    content: [toolResult]
                  };
                } else if (msg.role === 'assistant' && msg.tool_calls) {
                  // Tool callsをAnthropicのtool_use形式に変換
                  const toolUses = msg.tool_calls.map((tc: any, tcIndex: number) => {
                    const toolUse: any = {
                      type: 'tool_use' as const,
                      id: tc.id,
                      name: tc.function.name,
                      input: JSON.parse(tc.function.arguments)
                    };
                    // 最後のtool_useにcache_controlを付与
                    if (isLastCacheable && tcIndex === msg.tool_calls!.length - 1) {
                      toolUse.cache_control = { type: 'ephemeral' as const };
                    }
                    return toolUse;
                  });
                  return {
                    role: 'assistant' as const,
                    content: toolUses
                  };
                } else {
                  // テキストメッセージ
                  if (isLastCacheable) {
                    return {
                      role: msg.role as 'user' | 'assistant',
                      content: [{
                        type: 'text' as const,
                        text: msg.content,
                        cache_control: { type: 'ephemeral' as const }
                      }]
                    };
                  }
                  return {
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content
                  };
                }
              });

            // Prepare request body for curl logging
            const anthropicRequestBody = {
              model: this.model,
              system: systemMessages,
              messages: conversationMessages,
              tools: anthropicTools,
              max_tokens: 8000,
              temperature: this.temperature
            };

            // Log equivalent curl command
            this.requestCount++;
            const curlCommand = generateCurlCommand(this.apiKey!, anthropicRequestBody, this.requestCount, 'anthropic');
            if (curlCommand) {
              debugLog('Equivalent curl command:', curlCommand);
            }

            this.currentAbortController = new AbortController();

            const response = await (this.client as Anthropic).messages.create({
              model: this.model,
              system: systemMessages,
              messages: conversationMessages as any,
              tools: anthropicTools,  // ツール定義はsystemにも含まれているが、API呼び出しにも必要
              max_tokens: 8000,
              temperature: this.temperature
            }, {
              signal: this.currentAbortController.signal as any
            });

            debugLog('Full Anthropic API response received:', response);

            // Log cache information explicitly
            if (response.usage) {
              const usage = response.usage as any;
              debugLog('Anthropic API Usage:', {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: usage.cache_read_input_tokens || 0,
              });
            }

            // Pass usage data to callback if available
            if (response.usage && this.onApiUsage) {
              this.onApiUsage({
                prompt_tokens: response.usage.input_tokens,
                completion_tokens: response.usage.output_tokens,
                total_tokens: response.usage.input_tokens + response.usage.output_tokens,
                total_time: undefined
              });
            }

            // Anthropicのレスポンスを処理
            const content = response.content;

            // テキストコンテンツとtool_useを分離
            const textContent = content
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text)
              .join('');

            const toolUses = content.filter((block: any) => block.type === 'tool_use');

            if (toolUses.length > 0) {
              // Tool callsがある場合
              if (textContent) {
                if (this.onThinkingText) {
                  this.onThinkingText(textContent);
                }
              }

              // Anthropicのtool_useをGroq形式のtool_callsに変換して保存
              const toolCalls = toolUses.map((toolUse: any) => ({
                id: toolUse.id,
                type: 'function',
                function: {
                  name: toolUse.name,
                  arguments: JSON.stringify(toolUse.input)
                }
              }));

              const assistantMsg: Message = {
                role: 'assistant',
                content: textContent,
                tool_calls: toolCalls
              };
              this.messages.push(assistantMsg);

              // Execute tool calls
              for (const toolCall of toolCalls) {
                if (this.isInterrupted) {
                  debugLog('Tool execution interrupted by user');
                  this.currentAbortController = null;
                  return;
                }

                const result = await this.executeToolCall(toolCall);

                this.messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result)
                });

                if (result.userRejected) {
                  this.messages.push({
                    role: 'system',
                    content: `The user rejected the ${toolCall.function.name} tool execution. The response has been terminated. Please wait for the user's next instruction.`
                  });
                  return;
                }
              }

              iteration++;
              continue;
            }

            // Tool callsがない場合は最終レスポンス
            if (this.onFinalMessage) {
              this.onFinalMessage(textContent);
            }

            this.messages.push({
              role: 'assistant',
              content: textContent
            });

            this.currentAbortController = null;
            return;
          } else if (this.provider === 'gemini') {
            // ===== Gemini API呼び出し =====
            debugLog('Making API call to Gemini with model:', this.model);
            debugLog('Messages count:', this.messages.length);

            if (!this.geminiClient) {
              throw new Error('Gemini client not initialized');
            }

            // Gemini用にメッセージを変換
            const systemMessages = this.messages
              .filter(msg => msg.role === 'system')
              .map(msg => msg.content)
              .join('\n\n');

            // 会話履歴をGemini形式に変換
            const geminiHistory: any[] = [];

            for (const msg of this.messages) {
              if (msg.role === 'system') {
                continue; // systemメッセージはsystemInstructionとして別途渡す
              } else if (msg.role === 'user') {
                geminiHistory.push({
                  role: 'user',
                  parts: [{ text: msg.content }]
                });
              } else if (msg.role === 'assistant') {
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                  // ツール呼び出しを含むassistantメッセージ
                  const parts: any[] = [];
                  if (msg.content) {
                    parts.push({ text: msg.content });
                  }
                  for (const tc of msg.tool_calls) {
                    // functionCallにthoughtSignatureも含める（Gemini Thinking Modelで必須）
                    const functionCallPart: any = {
                      functionCall: {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments)
                      }
                    };
                    // thoughtSignatureがあれば含める
                    if (tc.thoughtSignature) {
                      functionCallPart.thoughtSignature = tc.thoughtSignature;
                    }
                    parts.push(functionCallPart);
                  }
                  geminiHistory.push({
                    role: 'model',
                    parts
                  });
                } else {
                  geminiHistory.push({
                    role: 'model',
                    parts: [{ text: msg.content }]
                  });
                }
              } else if (msg.role === 'tool') {
                // ツール結果
                geminiHistory.push({
                  role: 'user',
                  parts: [{
                    functionResponse: {
                      name: this.getToolNameFromId(msg.tool_call_id!),
                      response: JSON.parse(msg.content)
                    }
                  }]
                });
              }
            }

            // 最後のuserメッセージを取り出す（generateContentに渡すため）
            let currentMessage: any = null;
            if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
              currentMessage = geminiHistory.pop();
            }

            const geminiTools = convertAllToolSchemasForGemini(ALL_TOOL_SCHEMAS);

            this.currentAbortController = new AbortController();

            const response = await this.geminiClient.models.generateContent({
              model: this.model,
              contents: currentMessage ? [...geminiHistory, currentMessage] : geminiHistory,
              config: {
                systemInstruction: systemMessages,
                temperature: this.temperature,
                maxOutputTokens: 8000,
                tools: [{
                  functionDeclarations: geminiTools
                }]
              }
            });

            debugLog('Full Gemini API response received:', response);

            // Pass usage data to callback if available
            if (response.usageMetadata && this.onApiUsage) {
              this.onApiUsage({
                prompt_tokens: response.usageMetadata.promptTokenCount || 0,
                completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
                total_tokens: response.usageMetadata.totalTokenCount || 0,
                total_time: undefined
              });
            }

            // Geminiのレスポンスを処理
            const candidate = response.candidates?.[0];
            if (!candidate || !candidate.content) {
              throw new Error('No valid response from Gemini');
            }

            const parts = candidate.content.parts || [];

            // テキストとfunctionCallを分離
            const textParts = parts.filter((p: any) => p.text);
            const functionCalls = parts.filter((p: any) => p.functionCall);

            const textContent = textParts.map((p: any) => p.text).join('');

            if (functionCalls.length > 0) {
              // Function callsがある場合
              if (textContent) {
                if (this.onThinkingText) {
                  this.onThinkingText(textContent);
                }
              }

              // GeminiのfunctionCallをGroq形式のtool_callsに変換して保存
              // thoughtSignatureも保存（Gemini Thinking Modelで必須）
              const toolCalls: ToolCall[] = functionCalls.map((fc: any, index: number) => ({
                id: `gemini_call_${Date.now()}_${index}`,
                type: 'function',
                function: {
                  name: fc.functionCall.name,
                  arguments: JSON.stringify(fc.functionCall.args || {})
                },
                thoughtSignature: fc.thoughtSignature  // Thinking Modelの署名を保持
              }));

              const assistantMsg: Message = {
                role: 'assistant',
                content: textContent,
                tool_calls: toolCalls
              };
              this.messages.push(assistantMsg);

              // Execute tool calls
              for (const toolCall of toolCalls) {
                if (this.isInterrupted) {
                  debugLog('Tool execution interrupted by user');
                  this.currentAbortController = null;
                  return;
                }

                const result = await this.executeToolCall(toolCall);

                this.messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result)
                });

                if (result.userRejected) {
                  this.messages.push({
                    role: 'system',
                    content: `The user rejected the ${toolCall.function.name} tool execution. The response has been terminated. Please wait for the user's next instruction.`
                  });
                  return;
                }
              }

              iteration++;
              continue;
            }

            // Function callsがない場合は最終レスポンス
            if (this.onFinalMessage) {
              this.onFinalMessage(textContent);
            }

            this.messages.push({
              role: 'assistant',
              content: textContent
            });

            this.currentAbortController = null;
            return;
          }

        } catch (error) {
          this.currentAbortController = null; // Clear abort controller
          
          // Check if this is an abort error due to user interruption
          if (error instanceof Error && (
            error.message.includes('Request was aborted') ||
            error.message.includes('The operation was aborted') ||
            error.name === 'AbortError'
          )) {
            debugLog('API request aborted due to user interruption');
            // Don't add error message if it's an interruption - the interrupt message was already added
            return;
          }
          
          debugLog('Error occurred during API call:', error);
          debugLog('Error details:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : 'No stack available'
          });
          
          // Add API error as context message instead of terminating chat
          let errorMessage = 'Unknown error occurred';
          let is401Error = false;
          
          if (error instanceof Error) {
            // Check if it's an API error with more details
            if ('status' in error && 'error' in error) {
              const apiError = error as any;
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
            throw new Error(`${errorMessage}. Please check your API key and use /login to set a valid key.`);
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
                content: `Request failed with error: ${errorMessage}. User chose not to retry.`
              });
              return;
            }
          } else {
            // No error callback available - use old behavior
            // Add error context to conversation for model to see and potentially recover
            this.messages.push({
              role: 'system',
              content: `Previous API request failed with error: ${errorMessage}. Please try a different approach or ask the user for clarification.`
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

  // Helper method to get tool name from tool_call_id for Gemini functionResponse
  private getToolNameFromId(toolCallId: string): string {
    // Look through messages to find the tool call with this ID
    for (const msg of this.messages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id === toolCallId) {
            return tc.function.name;
          }
        }
      }
    }
    return 'unknown';
  }

  private async executeToolCall(toolCall: any): Promise<Record<string, any>> {
    // Initialize toolName outside try block so it's accessible in catch
    let toolName = 'unknown';
    try {
      // Strip 'repo_browser.' prefix if present (some models hallucinate this)
      toolName = toolCall.function.name;
      if (toolName.startsWith('repo_browser.')) {
        toolName = toolName.substring('repo_browser.'.length);
      }

      // Handle truncated tool calls
      let toolArgs: any;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        const errorMsg = `Tool arguments truncated: ${error}. Please break this into smaller pieces or use shorter content.`;
        if (debugEnabled) {
          debugLog(`Tool argument parsing error for ${toolName}:`, {
            error: String(error),
            rawArguments: toolCall.function.arguments ? toolCall.function.arguments.substring(0, 200) : 'null'
          });
        }
        return {
          error: errorMsg,
          success: false
        };
      }

      // Debug: log tool call reception
      if (debugEnabled) {
        debugLog(`Received tool call from model`, {
          toolName,
          argumentKeys: Object.keys(toolArgs)
        });
      }

      // Notify UI about tool start
      if (this.onToolStart) {
        this.onToolStart(toolName, toolArgs);
      }

      // Check read-before-edit for edit tools
      if (toolName === 'edit_file' && toolArgs.file_path) {
        if (!validateReadBeforeEdit(toolArgs.file_path)) {
          const errorMessage = getReadBeforeEditError(toolArgs.file_path);
          const result = { error: errorMessage, success: false };
          if (this.onToolEnd) {
            this.onToolEnd(toolName, result);
          }
          return result;
        }
      }

      // Check if tool needs approval (only after validation passes)
      const isDangerous = DANGEROUS_TOOLS.includes(toolName);
      const requiresApproval = APPROVAL_REQUIRED_TOOLS.includes(toolName);
      const needsApproval = isDangerous || requiresApproval;
      
      // For APPROVAL_REQUIRED_TOOLS, check if session auto-approval is enabled
      const canAutoApprove = requiresApproval && !isDangerous && this.sessionAutoApprove;
            
      if (needsApproval && !canAutoApprove) {
        let approvalResult: { approved: boolean; autoApproveSession?: boolean };
        
        if (this.onToolApproval) {
          // Check for interruption before waiting for approval
          if (this.isInterrupted) {
            const result = { error: 'Tool execution interrupted by user', success: false, userRejected: true };
            if (this.onToolEnd) {
              this.onToolEnd(toolName, result);
            }
            return result;
          }
          
          approvalResult = await this.onToolApproval(toolName, toolArgs);
          
          // Check for interruption after approval process
          if (this.isInterrupted) {
            const result = { error: 'Tool execution interrupted by user', success: false, userRejected: true };
            if (this.onToolEnd) {
              this.onToolEnd(toolName, result);
            }
            return result;
          }
        } else {
          // No approval callback available, reject by default
          approvalResult = { approved: false };
        }
        
        // Enable session auto-approval if requested (only for APPROVAL_REQUIRED_TOOLS)
        if (approvalResult.autoApproveSession && requiresApproval && !isDangerous) {
          this.sessionAutoApprove = true;
        }
        
        if (!approvalResult.approved) {
          const result = { error: 'Tool execution canceled by user', success: false, userRejected: true };
          if (this.onToolEnd) {
            this.onToolEnd(toolName, result);
          }
          return result;
        }
      }
    
      // Debug: before tool execution
      if (debugEnabled) {
        debugLog(`About to execute tool: ${toolName}`, {
          toolName,
          argCount: Object.keys(toolArgs).length,
          needsApproval: needsApproval ? 'yes' : 'no'
        });
      }

      // Execute tool
      const result = await executeTool(toolName, toolArgs);

      // Debug: after tool execution
      if (debugEnabled) {
        debugLog(`Tool execution completed: ${toolName}`, {
          success: result.success,
          hasError: !!result.error,
          hasData: !!result.data || !!result.content
        });
      }

      // Notify UI about tool completion
      if (this.onToolEnd) {
        this.onToolEnd(toolName, result);
      }

      return result;

    } catch (error) {
      const errorMsg = `Tool execution error: ${error}`;
      if (debugEnabled) {
        debugLog(`Tool execution exception: ${toolName}`, {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
      return { error: errorMsg, success: false };
    }
  }
}


// Debug logging to file
const DEBUG_LOG_FILE = path.join(process.cwd(), 'debug-agent.log');
let debugLogCleared = false;
let debugEnabled = false;

function debugLog(message: string, data?: any) {
  if (!debugEnabled) return;
  
  // Clear log file on first debug log of each session
  if (!debugLogCleared) {
    fs.writeFileSync(DEBUG_LOG_FILE, '');
    debugLogCleared = true;
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
  fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
}

function generateCurlCommand(apiKey: string, requestBody: any, requestCount: number, provider: 'groq' | 'anthropic' | 'gemini' = 'groq'): string {
  if (!debugEnabled) return '';

  const maskedApiKey = `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 8)}`;

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
