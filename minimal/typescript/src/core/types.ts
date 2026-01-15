export type CoreRole = "system" | "user" | "assistant" | "tool";

export interface CoreToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface CoreMessage {
  role: CoreRole;
  content: string;
  toolCallId?: string;
  toolCalls?: CoreToolCall[];
}

export interface CoreTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CoreUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
