/**
 * Groq プロバイダー
 * Groq API を使用したチャット処理
 */

import type Groq from 'groq-sdk';
import type {
  ChatContext,
  ChatResult,
  Message,
  ExecuteToolCallFn,
  DebugLogFn,
  GenerateCurlCommandFn,
} from './types.js';
import { ALL_TOOL_SCHEMAS } from '../../tools/tool-schemas.js';

/**
 * Groq API を使用してチャット処理を実行
 */
export async function chatWithGroq(
  ctx: ChatContext,
  executeToolCall: ExecuteToolCallFn,
  debugLog: DebugLogFn,
  generateCurlCommand: GenerateCurlCommandFn
): Promise<ChatResult> {
  const client = ctx.client as Groq;
  const messages = [...ctx.messages];

  debugLog('Making API call to Groq with model:', ctx.model);
  debugLog('Messages count:', messages.length);
  debugLog('Last few messages:', messages.slice(-3));

  // リクエストボディを準備
  const requestBody = {
    model: ctx.model,
    messages: messages,
    tools: ALL_TOOL_SCHEMAS,
    tool_choice: 'auto' as const,
    temperature: ctx.temperature,
    max_tokens: 8000,
    stream: false as const,
  };

  // curlコマンドをログ出力
  ctx.requestCount++;
  const curlCommand = generateCurlCommand(
    ctx.apiKey!,
    requestBody,
    ctx.requestCount
  );
  if (curlCommand) {
    debugLog('Equivalent curl command:', curlCommand);
  }

  // AbortController を設定
  ctx.currentAbortController = new AbortController();

  // API 呼び出し
  const response = await client.chat.completions.create(
    {
      model: ctx.model,
      messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
      tools: ALL_TOOL_SCHEMAS,
      tool_choice: 'auto',
      temperature: ctx.temperature,
      max_tokens: 8000,
      stream: false,
    },
    {
      signal: ctx.currentAbortController.signal,
    }
  );

  debugLog('Full API response received:', response);
  debugLog('Response usage:', response.usage);
  debugLog('Response finish_reason:', response.choices[0].finish_reason);
  debugLog('Response choices length:', response.choices.length);

  const message = response.choices[0].message;

  // reasoning があれば抽出
  const reasoning = (message as { reasoning?: string }).reasoning;

  // API使用量をコールバックに通知
  if (response.usage && ctx.onApiUsage) {
    ctx.onApiUsage({
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
      total_time: response.usage.total_time,
    });
  }

  debugLog('Message content length:', message.content?.length || 0);
  debugLog('Message has tool_calls:', !!message.tool_calls);
  debugLog('Message tool_calls count:', message.tool_calls?.length || 0);

  if (
    response.choices[0].finish_reason !== 'stop' &&
    response.choices[0].finish_reason !== 'tool_calls'
  ) {
    debugLog(
      'WARNING - Unexpected finish_reason:',
      response.choices[0].finish_reason
    );
  }

  // ツール呼び出しがある場合
  if (message.tool_calls) {
    // thinking text または reasoning を表示
    if (message.content || reasoning) {
      if (ctx.onThinkingText) {
        ctx.onThinkingText(message.content || '', reasoning);
      }
    }

    // アシスタントメッセージを履歴に追加
    const assistantMsg: Message = {
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls,
    };
    messages.push(assistantMsg);

    // 各ツールを実行
    for (const toolCall of message.tool_calls) {
      // 中断チェック
      if (ctx.isInterrupted) {
        debugLog('Tool execution interrupted by user');
        ctx.currentAbortController = null;
        return {
          shouldContinue: false,
          messages,
        };
      }

      const result = await executeToolCall(toolCall, ctx);

      // ツール結果を会話に追加
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

      // ユーザーがツールを拒否した場合
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

    // ツール結果を受けて継続
    return {
      shouldContinue: true,
      incrementIteration: true,
      messages,
    };
  }

  // ツール呼び出しがない場合は最終レスポンス
  const content = message.content || '';
  debugLog('Final response - no tool calls detected');
  debugLog('Final content length:', content.length);
  debugLog('Final content preview:', content.substring(0, 200));

  if (ctx.onFinalMessage) {
    debugLog('Calling onFinalMessage callback');
    ctx.onFinalMessage(content, reasoning);
  } else {
    debugLog('No onFinalMessage callback set');
  }

  // 最終レスポンスを会話履歴に追加
  messages.push({
    role: 'assistant',
    content: content,
  });

  debugLog('Final response added to conversation history, exiting chat loop');
  ctx.currentAbortController = null;

  return {
    shouldContinue: false,
    messages,
  };
}
