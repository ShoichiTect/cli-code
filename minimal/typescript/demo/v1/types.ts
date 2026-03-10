export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface Message {
	role: Role;
	content: string;
	toolCallId?: string;
	toolCalls?: ToolCall[];
}

export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface BashResult {
	stdout: string;
	stderr: string;
	code: number;
}

export type PolicyResult = "auto" | "ask" | "deny";

export interface ApiResponse {
	message: Message;
	usage?: Usage;
}

export interface ApiConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	maxTokens: number;
}

export interface AgentOptions {
	apiConfig: ApiConfig;
	systemPrompt: string;
	workspaceRoot: string;
	debug: boolean;
	promptApproval: (command: string) => Promise<boolean>;
}

export interface Agent {
	runAgentTurn: () => Promise<void>;
	addUserMessage: (content: string) => void;
	clear: () => void;
	getTokens: () => { prompt: number; completion: number; total: number };
	getModel: () => string;
}

export interface SlashCtx {
	agent: Agent;
	bufferedShellOutput: string | null;
}

export interface SlashResult {
	shouldContinue: boolean;
	bufferedShellOutput: string | null;
}

export type ColorStyle = "reset" | "bold" | "dim" | "red" | "green" | "yellow" | "magenta" | "cyan";
