import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { ResolvedLlmConfig } from "./config.js";

export interface ChatProvider {
  createChatCompletion(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
}

export function createProvider(config: ResolvedLlmConfig): ChatProvider {
  if (config.schemaType === "anthropic") {
    throw new Error("Anthropic schema is not implemented yet.");
  }

  const client = new OpenAI({ apiKey: config.apiKey ?? "", baseURL: config.baseUrl });
  return {
    createChatCompletion(params: ChatCompletionCreateParamsNonStreaming) {
      return client.chat.completions.create(params);
    },
  };
}
