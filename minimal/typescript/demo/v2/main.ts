import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { cwd, env, stderr as errorOutput, exit, stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type {
    ApprovalDecision,
    AssistantMessage,
    AssistantToolCall,
    BashExecutionResult,
    BashToolInput,
    ChatCompletionToolDefinition,
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    ParsedCliOptions,
    SessionState,
    ToolMessage,
    UserCommandResult,
} from "./type.js";

const DEFAULT_MODEL = env.OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_BASE_URL = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_OUTPUT = 16_000;
const BASH_TOOL_NAME = "bash";
const ANSI = {
    reset: "\u001b[0m",
    bold: "\u001b[1m",
    dim: "\u001b[2m",
    red: "\u001b[31m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    blue: "\u001b[34m",
    magenta: "\u001b[35m",
    cyan: "\u001b[36m",
};
const DENY_PATTERNS = [
    /(^|\s)rm\s+-rf\s+(~|\/|\.\.)/i,
    /(^|\s)(mkfs|shutdown|reboot|poweroff|halt)(\s|$)/i,
    /(^|\s)(curl|wget)\b.*\|\s*(bash|sh)(\s|$)/i,
    /(^|\s)dd\s+if=.*\s+of=\/dev\//i,
    /(^|\s)git\s+reset\s+--hard(\s|$)/i,
    /(^|\s)kubectl\s+delete(\s|$)/i,
];
const SECRET_PATTERNS = [
    /(^|\/)\.env([.-]|$)/i,
    /(^|\/)id_(rsa|ed25519)([.-]|$)/i,
    /(^|\/)(credentials|secret|token|key)([.-]|$)/i,
    /(^|\/)\.(ssh|aws|gnupg|kube|docker)\//i,
];
const HELP_TEXT = [
    "",
    "Minimal TypeScript Agent Demo",
    "",
    "  /help          Show this help",
    "  /exit          Exit the program",
    "  /reset         Clear message history",
    "  /cd <path>     Change working directory",
    "  /approve bash  Allow bash for this session",
    "",
].join("\n");

const paint = (code: string, text: string): string => `${code}${text}${ANSI.reset}`;
const write = (prefix: string, color: string, message: string): void => {
    output.write(`${paint(color, prefix)}${message}\n`);
};
const info = (message: string): void => write("info> ", ANSI.blue, message);
const ok = (message: string): void => write("info> ", ANSI.green, message);
const say = (message: string): void => write("agent> ", ANSI.magenta, message);
const tool = (message: string): void => write("tool> ", ANSI.yellow, message);
const fail = (message: string): void => {
    errorOutput.write(`${paint(ANSI.red, "error> ")}${message}\n`);
};

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
export const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");
export const clampNumber = (value: number, min: number, max: number): number =>
    Math.min(Math.max(Number.isNaN(value) ? min : value, min), max);
export const trimOutput = (value: string, limit: number = DEFAULT_MAX_OUTPUT): string => {
    if (value.length <= limit) return value;
    const head = value.slice(0, Math.floor(limit * 0.7));
    const tail = value.slice(-Math.floor(limit * 0.2));
    return `${head}\n...\n[omitted ${value.length - head.length - tail.length} characters]\n...\n${tail}`;
};

export const parseCliOptions = (argv: string[], currentDirectory: string): ParsedCliOptions => {
    const options: ParsedCliOptions = {
        model: DEFAULT_MODEL,
        apiKey: env.OPENAI_API_KEY || "",
        baseUrl: normalizeBaseUrl(DEFAULT_BASE_URL),
        workingDirectory: currentDirectory,
        temperature: DEFAULT_TEMPERATURE,
        maxSteps: DEFAULT_MAX_STEPS,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        debug: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        const next = argv[index + 1];
        if (token === "--debug") options.debug = true;
        else if (token === "--model" && isNonEmptyString(next)) {
            options.model = next;
            index += 1;
        } else if (token === "--api-key" && isNonEmptyString(next)) {
            options.apiKey = next;
            index += 1;
        } else if (token === "--base-url" && isNonEmptyString(next)) {
            options.baseUrl = normalizeBaseUrl(next);
            index += 1;
        } else if (token === "--cwd" && isNonEmptyString(next)) {
            options.workingDirectory = path.resolve(
                next === "~" ? homedir() : next.startsWith("~/") ? path.join(homedir(), next.slice(2)) : next,
            );
            index += 1;
        } else if (token === "--temperature" && isNonEmptyString(next)) {
            options.temperature = clampNumber(Number.parseFloat(next), 0, 2);
            index += 1;
        } else if (token === "--max-steps" && isNonEmptyString(next)) {
            options.maxSteps = clampNumber(Number.parseInt(next, 10), 1, 20);
            index += 1;
        } else if (token === "--timeout-ms" && isNonEmptyString(next)) {
            options.timeoutMs = clampNumber(Number.parseInt(next, 10), 1000, 300_000);
            index += 1;
        }
    }
    return options;
};

export const createSystemPrompt = (workingDirectory: string): string =>
    [
        "You are a minimal CLI coding agent.",
        "Be concise and action-oriented.",
        "You can use one tool named bash.",
        "Use bash only when command execution is necessary.",
        "Never ask for shell approval yourself; the host handles approval.",
        `Current working directory: ${workingDirectory}`,
    ].join("\n");

const createBashToolDefinition = (defaultTimeoutMs: number): ChatCompletionToolDefinition => ({
    type: "function",
    function: {
        name: BASH_TOOL_NAME,
        description: "Execute a bash command in the current working directory.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The bash command to execute." },
                timeoutMs: {
                    type: "integer",
                    description: `Optional timeout in milliseconds. Default is ${defaultTimeoutMs}.`,
                },
                reason: {
                    type: "string",
                    description: "Short reason for why the command is needed.",
                },
            },
            required: ["command"],
            additionalProperties: false,
        },
    },
});

export const parseToolArguments = (rawArguments: string): BashToolInput => {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!isObject(parsed) || !isNonEmptyString(parsed.command))
        throw new Error("Tool arguments require a non-empty command string.");
    if (parsed.timeoutMs !== undefined && typeof parsed.timeoutMs !== "number")
        throw new Error("timeoutMs must be a number when provided.");
    if (parsed.reason !== undefined && typeof parsed.reason !== "string")
        throw new Error("reason must be a string when provided.");
    return { command: parsed.command, timeoutMs: parsed.timeoutMs, reason: parsed.reason };
};

export const detectDeniedCommand = (command: string): string | null => {
    const trimmed = command.trim();
    for (const pattern of DENY_PATTERNS)
        if (pattern.test(trimmed)) return `Blocked by deny pattern: ${String(pattern)}`;
    for (const token of trimmed.match(/[.~\/]?[A-Za-z0-9_./-]+/g) || [])
        for (const pattern of SECRET_PATTERNS)
            if (pattern.test(token)) return `Blocked by sensitive path pattern: ${String(pattern)}`;
    return null;
};

const requestChatCompletion = async (
    apiKey: string,
    baseUrl: string,
    request: OpenAIChatCompletionRequest,
): Promise<OpenAIChatCompletionResponse> => {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(request),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenAI API error ${response.status}: ${text}`);
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.choices))
        throw new Error(`Unexpected OpenAI response: ${JSON.stringify(parsed, null, 2)}`);
    return parsed as unknown as OpenAIChatCompletionResponse;
};

const formatToolResult = (result: BashExecutionResult): string =>
    [
        `[command] ${result.command}`,
        `[cwd] ${result.cwd}`,
        `[duration_ms] ${result.durationMs}`,
        `[timed_out] ${String(result.timedOut)}`,
        `[exit_code] ${result.code}`,
        "[stdout]",
        trimOutput(result.stdout || ""),
        "[stderr]",
        trimOutput(result.stderr || ""),
    ].join("\n");
const createToolErrorResult = (command: string, cwdValue: string, message: string): BashExecutionResult => ({
    command,
    cwd: cwdValue,
    code: 1,
    stdout: "",
    stderr: message,
    durationMs: 0,
    timedOut: false,
});
const summarizeUsage = (state: SessionState): string =>
    [
        `apiCalls=${state.stats.apiCalls}`,
        `toolCalls=${state.stats.toolCalls}`,
        `approvalPrompts=${state.stats.approvalPrompts}`,
    ].join(" ");

export const buildInitialSession = (options: ParsedCliOptions): SessionState => ({
    messages: [{ role: "system", content: createSystemPrompt(options.workingDirectory) }],
    stats: {
        apiCalls: 0,
        toolCalls: 0,
        approvalPrompts: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
    },
    approveAllBashCommands: false,
    workingDirectory: options.workingDirectory,
});
export const resetSession = (state: SessionState, workingDirectory: string): void => {
    state.messages = [{ role: "system", content: createSystemPrompt(workingDirectory) }];
    state.approveAllBashCommands = false;
};
export const countConversationMessages = (state: SessionState): number => Math.max(0, state.messages.length - 1);
export const formatAssistantText = (message: AssistantMessage): string =>
    isNonEmptyString(message.content)
        ? message.content.trim()
        : message.tool_calls?.length
          ? `[assistant requested ${message.tool_calls.length} tool call(s)]`
          : "[assistant returned no content]";

const runBashCommand = async (
    command: string,
    workingDirectory: string,
    timeoutMs: number,
): Promise<BashExecutionResult> =>
    await new Promise((resolve) => {
        const startedAt = Date.now();
        const child = spawn("bash", ["-lc", command], {
            cwd: workingDirectory,
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdoutValue = "";
        let stderrValue = "";
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 1000).unref();
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdoutValue += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderrValue += String(chunk);
        });
        child.on("error", (error) => {
            clearTimeout(timeoutHandle);
            resolve({
                command,
                cwd: workingDirectory,
                code: 1,
                stdout: stdoutValue,
                stderr: `${stderrValue}${error.message}`,
                durationMs: Date.now() - startedAt,
                timedOut,
            });
        });
        child.on("close", (code) => {
            clearTimeout(timeoutHandle);
            resolve({
                command,
                cwd: workingDirectory,
                code: timedOut ? 124 : (code ?? 0),
                stdout: stdoutValue,
                stderr: stderrValue.trim(),
                durationMs: Date.now() - startedAt,
                timedOut,
            });
        });
    });

const promptForApproval = async (
    rl: readline.Interface,
    state: SessionState,
    toolInput: BashToolInput,
    defaultTimeoutMs: number,
): Promise<ApprovalDecision> => {
    if (state.approveAllBashCommands) return "allow-once";
    output.write(
        `${paint(ANSI.cyan, "approve> ")}cwd: ${state.workingDirectory}\n${paint(ANSI.cyan, "approve> ")}timeout: ${toolInput.timeoutMs ?? defaultTimeoutMs}ms\n${paint(ANSI.yellow, "command> ")}${toolInput.command}\n${paint(ANSI.dim, "[y] allow once  [a] allow for session  [n] deny")}\n`,
    );
    state.stats.approvalPrompts += 1;
    const answer = (await rl.question(paint(ANSI.cyan, "approval? "))).trim().toLowerCase();
    return answer === "a" ? "allow-session" : answer === "" || answer === "y" ? "allow-once" : "deny";
};

const executeToolCall = async (
    rl: readline.Interface,
    state: SessionState,
    toolCall: AssistantToolCall,
    options: ParsedCliOptions,
): Promise<ToolMessage> => {
    if (toolCall.function.name !== BASH_TOOL_NAME)
        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Unsupported tool: ${toolCall.function.name}`,
        };
    let toolInput: BashToolInput;
    try {
        toolInput = parseToolArguments(toolCall.function.arguments);
    } catch (error) {
        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Invalid bash tool arguments: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    state.stats.toolCalls += 1;
    const denyReason = detectDeniedCommand(toolInput.command);
    if (denyReason)
        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: formatToolResult(createToolErrorResult(toolInput.command, state.workingDirectory, denyReason)),
        };
    const decision = await promptForApproval(rl, state, toolInput, options.timeoutMs);
    if (decision === "deny")
        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: formatToolResult(
                createToolErrorResult(toolInput.command, state.workingDirectory, "User denied bash command execution."),
            ),
        };
    if (decision === "allow-session") state.approveAllBashCommands = true;
    tool(`running: ${toolInput.command}`);
    const result = await runBashCommand(
        toolInput.command,
        state.workingDirectory,
        clampNumber(toolInput.timeoutMs ?? options.timeoutMs, 1000, 300_000),
    );
    tool(`exit=${result.code}`);
    return { role: "tool", tool_call_id: toolCall.id, content: formatToolResult(result) };
};

const runAgentLoop = async (
    rl: readline.Interface,
    state: SessionState,
    options: ParsedCliOptions,
    userInput: string,
): Promise<void> => {
    state.messages.push({ role: "user", content: userInput });
    const toolDefinition = createBashToolDefinition(options.timeoutMs);
    for (let step = 0; step < options.maxSteps; step += 1) {
        const response = await requestChatCompletion(options.apiKey, options.baseUrl, {
            model: options.model,
            messages: state.messages,
            tools: [toolDefinition],
            tool_choice: "auto",
            temperature: options.temperature,
            parallel_tool_calls: false,
        });
        state.stats.apiCalls += 1;
        const choice = response.choices[0];
        if (!choice) throw new Error("OpenAI response contained no choices.");
        state.messages.push(choice.message);
        if (!choice.message.tool_calls?.length) {
            say(formatAssistantText(choice.message));
            return;
        }
        for (const toolCall of choice.message.tool_calls)
            state.messages.push(await executeToolCall(rl, state, toolCall, options));
    }
    say("Reached max agent steps without a final assistant answer.");
};

const parseCdTarget = (inputValue: string): string | null => {
    const remainder = inputValue.trim().slice(3).trim();
    if (!remainder) return null;
    return path.resolve(
        remainder === "~"
            ? homedir()
            : remainder.startsWith("~/")
              ? path.join(homedir(), remainder.slice(2))
              : remainder,
    );
};
const handleSlashCommand = async (
    rl: readline.Interface,
    state: SessionState,
    rawInput: string,
): Promise<UserCommandResult> => {
    const trimmed = rawInput.trim();
    if (trimmed === "/help") {
        output.write(`${HELP_TEXT}\n`);
        return { handled: true, shouldExit: false };
    }
    if (trimmed === "/exit" || trimmed === "/quit") return { handled: true, shouldExit: true };
    if (trimmed === "/reset") {
        resetSession(state, state.workingDirectory);
        ok("Conversation history cleared.");
        return { handled: true, shouldExit: false };
    }
    if (trimmed === "/approve bash") {
        state.approveAllBashCommands =
            (await rl.question(paint(ANSI.cyan, "Allow all bash commands for this session? [y/N] ")))
                .trim()
                .toLowerCase() === "y";
        info(state.approveAllBashCommands ? "session-approved" : "approval unchanged");
        return { handled: true, shouldExit: false };
    }
    if (trimmed.startsWith("/cd")) {
        const target = parseCdTarget(trimmed);
        if (target) {
            state.workingDirectory = target;
            state.messages[0] = { role: "system", content: createSystemPrompt(target) };
            ok(`Changed working directory to ${target}`);
            return { handled: true, shouldExit: false };
        }
    }
    return { handled: false, shouldExit: false };
};

export async function main(): Promise<void> {
    const options = parseCliOptions(process.argv.slice(2), cwd());
    if (!options.apiKey) {
        fail("OPENAI_API_KEY is required. Set it in the environment or pass --api-key.");
        exit(1);
    }
    const state = buildInitialSession(options);
    const rl = readline.createInterface({ input, output, terminal: true });
    output.write(
        `\n${paint(`${ANSI.bold}${ANSI.cyan}`, "Minimal TypeScript Agent Demo")}\n${paint(ANSI.dim, `cwd=${state.workingDirectory}`)}\n\n`,
    );
    try {
        while (true) {
            const rawInput = await rl.question(paint(ANSI.green, "you> "));
            const trimmed = rawInput.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith("/")) {
                const result = await handleSlashCommand(rl, state, trimmed);
                if (result.shouldExit) break;
                if (result.handled) continue;
            }
            try {
                await runAgentLoop(rl, state, options, trimmed);
            } catch (error) {
                fail(error instanceof Error ? error.message : String(error));
            }
        }
    } finally {
        rl.close();
    }
    output.write(`\n${paint(ANSI.green, "bye")}\n${paint(ANSI.dim, summarizeUsage(state))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
