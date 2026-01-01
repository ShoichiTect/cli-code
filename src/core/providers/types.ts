/**
 * プロバイダー共通型定義
 * agent.tsから分離したチャット処理で使用する型
 */

import type Groq from 'groq-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';

/** ツール呼び出し情報 */
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
  thoughtSignature?: string; // Gemini Thinking Modelのthought signature
}

/** メッセージ */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** API使用量 */
export interface ApiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_time?: number;
}

/** チャット処理に必要なコンテキスト */
export interface ChatContext {
  // クライアント
  client: Groq | Anthropic | null;
  geminiClient: GoogleGenAI | null;
  apiKey: string | null;

  // 設定
  model: string;
  temperature: number;
  messages: Message[];
  systemMessage: string;

  // コールバック
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: unknown) => void;
  onToolApproval?: (
    toolName: string,
    toolArgs: Record<string, unknown>
  ) => Promise<{ approved: boolean; autoApproveSession?: boolean }>;
  onThinkingText?: (content: string, reasoning?: string) => void;
  onFinalMessage?: (content: string, reasoning?: string) => void;
  onApiUsage?: (usage: ApiUsage) => void;

  // 状態
  sessionAutoApprove: boolean;
  isInterrupted: boolean;
  currentAbortController: AbortController | null;

  // リクエストカウント（curlログ用）
  requestCount: number;
}

/** ツール実行関数の型 */
export type ExecuteToolCallFn = (
  toolCall: ToolCall,
  ctx: ChatContext
) => Promise<Record<string, unknown> & { userRejected?: boolean }>;

/** デバッグログ関数の型 */
export type DebugLogFn = (message: string, data?: unknown) => void;

/** curlコマンド生成関数の型 */
export type GenerateCurlCommandFn = (
  apiKey: string,
  requestBody: unknown,
  requestCount: number,
  provider?: 'groq' | 'anthropic' | 'gemini'
) => string | null;

/** チャット処理の結果 */
export interface ChatResult {
  /** ツール実行後に継続するか */
  shouldContinue: boolean;
  /** 次のイテレーションに進むか（ツール実行後） */
  incrementIteration?: boolean;
  /** ユーザーがツールを拒否したか */
  userRejected?: boolean;
  /** 更新されたメッセージ配列 */
  messages: Message[];
}
