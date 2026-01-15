import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export function groqOverrides(): Partial<ChatCompletionCreateParamsNonStreaming> {
  return {};
}
