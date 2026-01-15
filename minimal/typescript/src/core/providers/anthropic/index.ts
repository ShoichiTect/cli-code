import Anthropic from "@anthropic-ai/sdk";
import type { Message, TextBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import type { ResolvedLlmConfig } from "../../../config.js";
import type { CoreMessage, CoreTool, CoreToolCall, CoreUsage } from "../../types.js";
import type { ChatProvider, ChatResponse, CreateChatParams } from "../index.js";
import { anthropicOverrides } from "./anthropic.js";
import { minimaxOverrides } from "./minimax.js";
import { zaiOverrides } from "./zai.js";

type MessageCreateParams = Parameters<Anthropic["messages"]["create"]>[0];
type MessageParam = MessageCreateParams["messages"][number];
type MessageContent = Exclude<MessageParam["content"], string>;

function toAnthropicTools(tools: CoreTool[]): MessageCreateParams["tools"] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool.InputSchema,
  }));
}

function toAnthropicMessages(messages: CoreMessage[]): {
  systemBlocks: TextBlockParam[];
  messages: MessageCreateParams["messages"];
} {
  const systemParts = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean);

  const systemText = systemParts.join("\n\n").trim();
  const systemBlocks: TextBlockParam[] = systemText
    ? [
        {
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" },
        },
      ]
    : [];

  const filteredMessages = messages.filter((message) => message.role !== "system");
  let lastCacheableIndex = -1;
  for (let index = filteredMessages.length - 1; index >= 0; index -= 1) {
    if (filteredMessages[index]?.role !== "assistant") {
      lastCacheableIndex = index;
      break;
    }
  }
  const mapped = filteredMessages.map((message, index) => {
    const isLastCacheable = index === lastCacheableIndex;

    if (message.role === "tool") {
      const content: MessageContent = [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: message.content,
          cache_control: isLastCacheable ? { type: "ephemeral" } : undefined,
        },
      ];
      return {
        role: "user",
        content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: MessageContent = [];

      if (message.content) {
        content.push({
          type: "text",
          text: message.content,
        });
      }

      for (const [callIndex, call] of message.toolCalls.entries()) {
        const isLastToolUse = callIndex === message.toolCalls.length - 1;
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }

      return {
        role: "assistant",
        content,
      };
    }

    if (isLastCacheable && message.role === "user") {
      const content: MessageContent = [
        {
          type: "text",
          text: message.content,
          cache_control: { type: "ephemeral" },
        },
      ];
      return {
        role: message.role,
        content,
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });

  return {
    systemBlocks,
    messages: mapped as MessageCreateParams["messages"],
  };
}

function fromAnthropicResponse(response: Message): ChatResponse {
  const textParts: string[] = [];
  const toolCalls: CoreToolCall[] = [];

  for (const block of response.content ?? []) {
    if (block.type === "text") {
      textParts.push(block.text ?? "");
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  const usage: CoreUsage | undefined = response.usage
    ? {
        promptTokens: response.usage.input_tokens ?? 0,
        completionTokens: response.usage.output_tokens ?? 0,
        totalTokens: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
      }
    : undefined;

  return {
    message: {
      role: "assistant",
      content: textParts.join(""),
      toolCalls: toolCalls.length ? toolCalls : undefined,
    },
    usage,
    rawUsage: response.usage ?? undefined,
  };
}

export function createAnthropicProvider(config: ResolvedLlmConfig): ChatProvider {
  const normalizedBaseUrl = config.baseUrl.replace(/\/v1\/?$/, "");
  const defaultHeaders =
    config.provider === "anthropic"
      ? { "anthropic-beta": "prompt-caching-2024-07-31" }
      : undefined;
  const client = new Anthropic({
    apiKey: config.apiKey ?? "",
    baseURL: normalizedBaseUrl,
    defaultHeaders,
  });
  const overrides =
    config.provider === "minimax"
      ? minimaxOverrides()
      : config.provider === "zai"
        ? zaiOverrides()
        : anthropicOverrides();

  return {
    async createChatCompletion(params: CreateChatParams) {
      const { systemBlocks, messages } = toAnthropicMessages(params.messages);
      const toolsSummary = JSON.stringify(params.tools, null, 2);
      const systemWithTools: TextBlockParam[] = [
        ...systemBlocks,
        {
          type: "text",
          text: systemBlocks.length
            ? `\n\n## Available Tools\n\n${toolsSummary}`
            : `## Available Tools\n\n${toolsSummary}`,
          cache_control: { type: "ephemeral" },
        },
      ];
      const requestParams: MessageCreateParams = {
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemWithTools,
        messages,
        tools: toAnthropicTools(params.tools),
        tool_choice: { type: "auto" },
        stream: false,
        ...(overrides as Partial<MessageCreateParams>),
      };

      const response = (await client.messages.create(requestParams)) as Message;
      const result = fromAnthropicResponse(response);
      return {
        ...result,
        rawRequest: requestParams,
        rawHeaders: defaultHeaders,
      };
    },
  };
}
