import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export function openaiOverrides(): Partial<ChatCompletionCreateParamsNonStreaming> {
  return {};
}
