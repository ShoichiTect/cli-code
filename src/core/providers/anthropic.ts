/**
 * Anthropic プロバイダー
 * Anthropic Claude API を使用したチャット処理
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  ChatContext,
  ChatResult,
  Message,
  ToolCall,
  ExecuteToolCallFn,
  DebugLogFn,
  GenerateCurlCommandFn,
} from './types.js';
import { ALL_TOOL_SCHEMAS } from '../../tools/tool-schemas.js';
import { convertAllToolSchemasForAnthropic } from '../../utils/tool-schema-converter.js';

/**
 * Anthropic API を使用してチャット処理を実行
 */
export async function chatWithAnthropic(
  ctx: ChatContext,
  executeToolCall: ExecuteToolCallFn,
  debugLog: DebugLogFn,
  generateCurlCommand: GenerateCurlCommandFn
): Promise<ChatResult> {
  const client = ctx.client as Anthropic;
  const messages = [...ctx.messages];

  debugLog('Making API call to Anthropic with model:', ctx.model);
  debugLog('Messages count:', messages.length);

  // システムメッセージを抽出
  const systemContent = messages
    .filter((msg) => msg.role === 'system')
    .map((msg) => msg.content)
    .join('\n\n');

  // ツール定義を変換
  const anthropicTools = convertAllToolSchemasForAnthropic(ALL_TOOL_SCHEMAS);

  // システムプロンプトとツール定義をキャッシュ対象として配列形式で構築
  const systemMessages = [
    {
      type: 'text' as const,
      text: systemContent,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: '\n\n## Available Tools\n\n' + JSON.stringify(anthropicTools, null, 2),
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  // 会話履歴をAnthropic形式に変換
  const filteredMessages = messages.filter((msg) => msg.role !== 'system');
  const conversationMessages = filteredMessages.map((msg, index) => {
    // 最新メッセージの1つ前にcache_controlを付与
    const isLastCacheable = index === filteredMessages.length - 2;

    if (msg.role === 'tool') {
      // toolロールは"user"として扱い、tool_result形式にする
      const toolResult: {
        type: 'tool_result';
        tool_use_id: string;
        content: string;
        cache_control?: { type: 'ephemeral' };
      } = {
        type: 'tool_result' as const,
        tool_use_id: msg.tool_call_id!,
        content: msg.content,
      };
      if (isLastCacheable) {
        toolResult.cache_control = { type: 'ephemeral' as const };
      }
      return {
        role: 'user' as const,
        content: [toolResult],
      };
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Tool callsをAnthropicのtool_use形式に変換
      const toolUses = msg.tool_calls.map((tc, tcIndex) => {
        const toolUse: {
          type: 'tool_use';
          id: string;
          name: string;
          input: unknown;
          cache_control?: { type: 'ephemeral' };
        } = {
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        };
        // 最後のtool_useにcache_controlを付与
        if (isLastCacheable && tcIndex === msg.tool_calls!.length - 1) {
          toolUse.cache_control = { type: 'ephemeral' as const };
        }
        return toolUse;
      });
      return {
        role: 'assistant' as const,
        content: toolUses,
      };
    } else {
      // テキストメッセージ
      if (isLastCacheable) {
        return {
          role: msg.role as 'user' | 'assistant',
          content: [
            {
              type: 'text' as const,
              text: msg.content,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
        };
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    }
  });

  // リクエストボディを準備
  const anthropicRequestBody = {
    model: ctx.model,
    system: systemMessages,
    messages: conversationMessages,
    tools: anthropicTools,
    max_tokens: 8000,
    temperature: ctx.temperature,
  };

  // curlコマンドをログ出力
  ctx.requestCount++;
  const curlCommand = generateCurlCommand(
    ctx.apiKey!,
    anthropicRequestBody,
    ctx.requestCount,
    'anthropic'
  );
  if (curlCommand) {
    debugLog('Equivalent curl command:', curlCommand);
  }

  ctx.currentAbortController = new AbortController();

  // API 呼び出し
  const response = await client.messages.create(
    {
      model: ctx.model,
      system: systemMessages,
      messages: conversationMessages as Parameters<typeof client.messages.create>[0]['messages'],
      tools: anthropicTools,
      max_tokens: 8000,
      temperature: ctx.temperature,
    },
    {
      signal: ctx.currentAbortController.signal as AbortSignal,
    }
  );

  debugLog('Full Anthropic API response received:', response);

  // キャッシュ情報をログ出力
  if (response.usage) {
    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    debugLog('Anthropic API Usage:', {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    });
  }

  // API使用量をコールバックに通知
  if (response.usage && ctx.onApiUsage) {
    ctx.onApiUsage({
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      total_time: undefined,
    });
  }

  // レスポンスを処理
  const content = response.content;

  // テキストコンテンツとtool_useを分離
  const textContent = content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  const toolUses = content
    .filter((block) => block.type === 'tool_use')
    .map((block) => block as { type: 'tool_use'; id: string; name: string; input: unknown });

  if (toolUses.length > 0) {
    // ツール呼び出しがある場合
    if (textContent) {
      if (ctx.onThinkingText) {
        ctx.onThinkingText(textContent);
      }
    }

    // Anthropicのtool_useをGroq形式のtool_callsに変換
    const toolCalls: ToolCall[] = toolUses.map((toolUse) => ({
      id: toolUse.id,
      type: 'function',
      function: {
        name: toolUse.name,
        arguments: JSON.stringify(toolUse.input),
      },
    }));

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

  // ツール呼び出しがない場合は最終レスポンス
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
