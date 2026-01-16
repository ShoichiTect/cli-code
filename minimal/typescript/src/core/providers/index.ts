import type { ResolvedLlmConfig } from "../../config.js";
import type { CoreMessage, CoreTool, CoreUsage } from "../types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiProvider } from "./openai.js";

export interface CreateChatParams {
  model: string;
  temperature: number;
  maxTokens: number;
  messages: CoreMessage[];
  tools: CoreTool[];
}

export interface ChatResponse {
  message: CoreMessage;
  usage?: CoreUsage;
  rawUsage?: unknown;
  rawRequest?: unknown;
  rawHeaders?: Record<string, string>;
}

export interface ChatProvider {
  createChatCompletion(params: CreateChatParams): Promise<ChatResponse>;
}

export function createProvider(config: ResolvedLlmConfig): ChatProvider {
  if (config.schemaType === "anthropic") {
    return createAnthropicProvider(config);
  }

  return createOpenAiProvider(config);
}
