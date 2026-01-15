import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "groq-sdk/resources/chat/completions";
import type { Config } from "./config.js";

export interface ChatProvider {
  createChatCompletion(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
}

export function createProvider(config: Config, apiKey: string): ChatProvider {
  switch (config.llm.provider) {
    case "groq": {
      const client = new Groq({ apiKey });
      return {
        createChatCompletion(params: ChatCompletionCreateParamsNonStreaming) {
          return client.chat.completions.create(params);
        },
      };
    }
    case "openai":
      throw new Error("OpenAI provider is not implemented yet.");
    default: {
      const provider = (config.llm.provider as string) || "unknown";
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
