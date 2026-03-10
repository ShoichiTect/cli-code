export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
    [key: string]: JsonValue;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolFunctionDefinition {
    name: string;
    description: string;
    parameters: JsonObject;
}

export interface ChatCompletionToolDefinition {
    type: "function";
    function: ToolFunctionDefinition;
}

export interface AssistantToolCallFunction {
    name: string;
    arguments: string;
}

export interface AssistantToolCall {
    id: string;
    type: "function";
    function: AssistantToolCallFunction;
}

export interface BaseMessage {
    role: ChatRole;
}

export interface SystemMessage extends BaseMessage {
    role: "system";
    content: string;
}

export interface UserMessage extends BaseMessage {
    role: "user";
    content: string;
}

export interface AssistantMessage extends BaseMessage {
    role: "assistant";
    content?: string | null;
    tool_calls?: AssistantToolCall[];
}

export interface ToolMessage extends BaseMessage {
    role: "tool";
    tool_call_id: string;
    content: string;
}

export type ModelMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface OpenAIChatCompletionRequest {
    model: string;
    messages: ModelMessage[];
    tools?: ChatCompletionToolDefinition[];
    tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
    temperature?: number;
    parallel_tool_calls?: boolean;
}

export interface OpenAIChatCompletionChoice {
    index: number;
    finish_reason: string | null;
    message: AssistantMessage;
}

export interface OpenAIChatCompletionUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

export interface OpenAIChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: OpenAIChatCompletionChoice[];
    usage?: OpenAIChatCompletionUsage;
}

export interface ParsedCliOptions {
    model: string;
    apiKey: string;
    baseUrl: string;
    workingDirectory: string;
    temperature: number;
    maxSteps: number;
    timeoutMs: number;
    debug: boolean;
}

export interface BashToolInput {
    command: string;
    timeoutMs?: number;
    reason?: string;
}

export interface BashExecutionResult {
    command: string;
    cwd: string;
    code: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
}

export interface AgentTurnStats {
    apiCalls: number;
    toolCalls: number;
    approvalPrompts: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
}

export interface SessionState {
    messages: ModelMessage[];
    stats: AgentTurnStats;
    approveAllBashCommands: boolean;
    workingDirectory: string;
}

export interface UserCommandResult {
    handled: boolean;
    shouldExit: boolean;
}

export type ApprovalDecision = "allow-once" | "allow-session" | "deny";
