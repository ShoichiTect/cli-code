/**
 * Gemini プロバイダー
 * Google Gemini API を使用したチャット処理
 */

import type { GoogleGenAI } from '@google/genai';
import type {
  ChatContext,
  ChatResult,
  Message,
  ToolCall,
  ExecuteToolCallFn,
  DebugLogFn,
} from './types.js';
import { ALL_TOOL_SCHEMAS } from '../../tools/tool-schemas.js';
import { convertAllToolSchemasForGemini } from '../../utils/tool-schema-converter.js';

/**
 * tool_call_id からツール名を取得するヘルパー
 */
function getToolNameFromId(messages: Message[], toolCallId: string): string {
  for (const msg of messages) {
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

/**
 * Gemini API を使用してチャット処理を実行
 */
export async function chatWithGemini(
  ctx: ChatContext,
  executeToolCall: ExecuteToolCallFn,
  debugLog: DebugLogFn
): Promise<ChatResult> {
  const geminiClient = ctx.geminiClient as GoogleGenAI;
  const messages = [...ctx.messages];

  debugLog('Making API call to Gemini with model:', ctx.model);
  debugLog('Messages count:', messages.length);

  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  // システムメッセージを抽出
  const systemMessages = messages
    .filter((msg) => msg.role === 'system')
    .map((msg) => msg.content)
    .join('\n\n');

  // 会話履歴をGemini形式に変換
  const geminiHistory: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      continue; // systemメッセージはsystemInstructionとして別途渡す
    } else if (msg.role === 'user') {
      geminiHistory.push({
        role: 'user',
        parts: [{ text: msg.content }],
      });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // ツール呼び出しを含むassistantメッセージ
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          // functionCallにthoughtSignatureも含める（Gemini Thinking Modelで必須）
          const functionCallPart: Record<string, unknown> = {
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          };
          // thoughtSignatureがあれば含める
          if (tc.thoughtSignature) {
            functionCallPart.thoughtSignature = tc.thoughtSignature;
          }
          parts.push(functionCallPart);
        }
        geminiHistory.push({
          role: 'model',
          parts,
        });
      } else {
        geminiHistory.push({
          role: 'model',
          parts: [{ text: msg.content }],
        });
      }
    } else if (msg.role === 'tool') {
      // ツール結果
      geminiHistory.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: getToolNameFromId(messages, msg.tool_call_id!),
              response: JSON.parse(msg.content),
            },
          },
        ],
      });
    }
  }

  // 最後のuserメッセージを取り出す（generateContentに渡すため）
  let currentMessage: (typeof geminiHistory)[0] | null = null;
  if (
    geminiHistory.length > 0 &&
    geminiHistory[geminiHistory.length - 1].role === 'user'
  ) {
    currentMessage = geminiHistory.pop()!;
  }

  const geminiTools = convertAllToolSchemasForGemini(ALL_TOOL_SCHEMAS);

  ctx.currentAbortController = new AbortController();

  // API 呼び出し
  const response = await geminiClient.models.generateContent({
    model: ctx.model,
    contents: currentMessage
      ? [...geminiHistory, currentMessage]
      : geminiHistory,
    config: {
      systemInstruction: systemMessages,
      temperature: ctx.temperature,
      maxOutputTokens: 8000,
      tools: [
        {
          functionDeclarations: geminiTools,
        },
      ],
    },
  });

  debugLog('Full Gemini API response received:', response);

  // API使用量をコールバックに通知
  if (response.usageMetadata && ctx.onApiUsage) {
    ctx.onApiUsage({
      prompt_tokens: response.usageMetadata.promptTokenCount || 0,
      completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
      total_tokens: response.usageMetadata.totalTokenCount || 0,
      total_time: undefined,
    });
  }

  // レスポンスを処理
  const candidate = response.candidates?.[0];
  if (!candidate || !candidate.content) {
    throw new Error('No valid response from Gemini');
  }

  const parts = candidate.content.parts || [];

  // テキストとfunctionCallを分離
  const textParts = parts.filter(
    (p) => 'text' in p && typeof (p as { text?: string }).text === 'string'
  );
  const functionCalls = parts.filter((p) => 'functionCall' in p);

  const textContent = textParts
    .map((p) => (p as { text: string }).text)
    .join('');

  if (functionCalls.length > 0) {
    // Function callsがある場合
    if (textContent) {
      if (ctx.onThinkingText) {
        ctx.onThinkingText(textContent);
      }
    }

    // GeminiのfunctionCallをGroq形式のtool_callsに変換
    // thoughtSignatureも保存（Gemini Thinking Modelで必須）
    const toolCalls: ToolCall[] = functionCalls.map((fc, index) => {
      const fcTyped = fc as {
        functionCall?: { name?: string; args?: unknown };
        thoughtSignature?: string;
      };
      return {
        id: `gemini_call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: fcTyped.functionCall?.name || 'unknown',
          arguments: JSON.stringify(fcTyped.functionCall?.args || {}),
        },
        thoughtSignature: fcTyped.thoughtSignature,
      };
    });

    const assistantMsg: Message = {
      role: 'assistant',
      content: textContent,
      tool_calls: toolCalls,
    };
    messages.push(assistantMsg);

    // 各ツールを実行
    for (const toolCall of toolCalls) {
      if (ctx.isInterrupted) {
        debugLog('Tool execution interrupted by user');
        ctx.currentAbortController = null;
        return {
          shouldContinue: false,
          messages,
        };
      }

      const result = await executeToolCall(toolCall, ctx);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

      if (result.userRejected) {
        messages.push({
          role: 'system',
          content: `The user rejected the ${toolCall.function.name} tool execution. The response has been terminated. Please wait for the user's next instruction.`,
        });
        return {
          shouldContinue: false,
          userRejected: true,
          messages,
        };
      }
    }

    return {
      shouldContinue: true,
      incrementIteration: true,
      messages,
    };
  }

  // Function callsがない場合は最終レスポンス
  if (ctx.onFinalMessage) {
    ctx.onFinalMessage(textContent);
  }

  messages.push({
    role: 'assistant',
    content: textContent,
  });

  ctx.currentAbortController = null;

  return {
    shouldContinue: false,
    messages,
  };
}
