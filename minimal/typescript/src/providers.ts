import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { Config } from "./config.js";

export interface ChatProvider {
  createChatCompletion(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
}

export function createProvider(config: Config, apiKey: string): ChatProvider {
  const baseURL =
    config.llm.baseUrl ||
    (config.llm.provider === "openai"
      ? "https://api.openai.com/v1"
      : config.llm.provider === "groq"
        ? "https://api.groq.com/openai/v1"
        : "");

  if (!baseURL) {
    throw new Error("baseUrl is required for custom providers.");
  }

  const client = new OpenAI({ apiKey, baseURL });
  return {
    createChatCompletion(params: ChatCompletionCreateParamsNonStreaming) {
      return client.chat.completions.create(params);
    },
  };
}
