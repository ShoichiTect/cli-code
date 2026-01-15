import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { FunctionParameters } from "openai/resources/shared";
import type { ResolvedLlmConfig } from "../../../config.js";
import type { CoreMessage, CoreTool, CoreToolCall, CoreUsage } from "../../types.js";
import type { ChatProvider, ChatResponse, CreateChatParams } from "../index.js";
import { groqOverrides } from "./groq.js";
import { openaiOverrides } from "./openai.js";

function toOpenAiTools(tools: CoreTool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as FunctionParameters,
    },
  }));
}

function toOpenAiMessages(messages: CoreMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input ?? {}),
          },
        })),
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

function parseToolInput(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isFunctionToolCall(
  call: ChatCompletionMessageToolCall
): call is ChatCompletionMessageToolCall & { type: "function" } {
  return call.type === "function";
}

function fromOpenAiResponse(response: ChatCompletion): ChatResponse {
  const message = response.choices?.[0]?.message;
  const toolCalls: CoreToolCall[] =
    message?.tool_calls
      ?.filter(isFunctionToolCall)
      .map((call) => ({
        id: call.id,
        name: call.function?.name ?? "",
        input: parseToolInput(call.function?.arguments),
      })) ?? [];

  const usage: CoreUsage | undefined = response.usage
    ? {
        promptTokens: response.usage.prompt_tokens ?? 0,
        completionTokens: response.usage.completion_tokens ?? 0,
        totalTokens: response.usage.total_tokens ?? 0,
      }
    : undefined;

  return {
    message: {
      role: "assistant",
      content: message?.content ?? "",
      toolCalls: toolCalls.length ? toolCalls : undefined,
    },
    usage,
    rawUsage: response.usage ?? undefined,
  };
}

export function createOpenAiProvider(config: ResolvedLlmConfig): ChatProvider {
  const client = new OpenAI({ apiKey: config.apiKey ?? "", baseURL: config.baseUrl });
  const overrides =
    config.provider === "groq" ? groqOverrides() : config.provider === "openai" ? openaiOverrides() : {};

  return {
    async createChatCompletion(params: CreateChatParams) {
      const requestParams: ChatCompletionCreateParamsNonStreaming = {
        model: params.model,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        messages: toOpenAiMessages(params.messages),
        tools: toOpenAiTools(params.tools),
        tool_choice: "auto",
        ...overrides,
      };

      const response = await client.chat.completions.create(requestParams);
      const result = fromOpenAiResponse(response);
      return {
        ...result,
        rawRequest: requestParams,
      };
    },
  };
}
