#!/usr/bin/env -S npx tsx
import { spawn } from "node:child_process";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import type {
	Agent,
	AgentOptions,
	ApiConfig,
	ApiResponse,
	BashResult,
	ColorStyle,
	Message,
	SlashCtx,
	SlashResult,
	ToolCall,
	ToolDef,
	Usage,
} from "./types.js";

export const BASH_TIMEOUT_MS = 30_000;
export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful coding assistant with access to a bash tool.\n" +
	"Execute shell commands to help the user. Explain before executing. Be concise.";
export const BASH_TOOL: ToolDef = {
	name: "bash",
	description: "Execute a shell command in the workspace. Runs in bash with a 30s timeout.",
	parameters: {
		type: "object",
		properties: { command: { type: "string", description: "Shell command to execute." } },
		required: ["command"],
	},
};
const CC: Record<ColorStyle, string> = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
};
export function c(style: ColorStyle, text: string): string {
	return `${CC[style]}${text}${CC.reset}`;
}
export function bold(text: string): string {
	return `${CC.bold}${text}${CC.reset}`;
}
export function dim(text: string): string {
	return `${CC.dim}${text}${CC.reset}`;
}

const DENY_RE = [
	/rm\s+(-[rf]+\s+)*\//,
	/rm\s+-rf?\s+(\*|\.\*)/,
	/mkfs/,
	/dd\s+if=.*of=\/dev/,
	/gcloud\s+.*(delete|destroy)/,
	/aws\s+.*(delete|terminate)/,
	/kubectl\s+delete/,
	/ch(mod\s+-R\s+777\s+|own\s+-R.*)\//,
	/(curl|wget).*\|\s*(ba)?sh/,
	/ls\s+-\S*R/,
	/ls\s+-R/,
	/sed\s.*-i/,
];
const FILE_RE = [
	/\.(env|dev\.vars|pem|key|DS_Store)$/,
	/\.env\./,
	/credentials|secret/i,
	/id_(rsa|ed25519)/,
	/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
	/node_modules/,
];
const AUTO_CMD = (
	"ls|ls -la|ls -l|ls -a|pwd|whoami|date|which|cat|head|tail|wc|file|stat|tree|" +
	"find|fd|grep|rg|sed -n|git status|git diff|git log|git branch|" +
	"echo|uname|df|du|ps|uptime|hostname|id"
).split("|");

export function checkPolicy(command: string): import("./types.js").PolicyResult {
	const cmd = command.trim();
	for (const p of DENY_RE) if (p.test(cmd)) return "deny";
	const args = cmd.split(/\s+/).slice(1).join(" ");
	for (const p of FILE_RE) if (p.test(args)) return "deny";
	if (/[|;&`$()]/.test(cmd)) return "ask";
	for (const a of AUTO_CMD) if (cmd === a || cmd.startsWith(`${a} `)) return "auto";
	return "ask";
}

export function runBash(command: string, cwd: string): Promise<BashResult> {
	return new Promise((resolve) => {
		const child = spawn(command, { shell: true, cwd, env: process.env });
		let so = "",
			se = "";
		let killed = false;
		const tm = setTimeout(() => {
			killed = true;
			child.kill("SIGTERM");
		}, BASH_TIMEOUT_MS);
		child.stdout.on("data", (d: Buffer) => {
			so += d.toString();
		});
		child.stderr.on("data", (d: Buffer) => {
			se += d.toString();
		});
		child.on("close", (code: number | null) => {
			clearTimeout(tm);
			resolve(
				killed
					? {
							stdout: so,
							stderr: `Command timed out (${BASH_TIMEOUT_MS / 1000}s)`,
							code: 124,
						}
					: { stdout: so, stderr: se, code: code ?? 0 },
			);
		});
		child.on("error", (e: Error) => {
			clearTimeout(tm);
			resolve({ stdout: "", stderr: `Failed to spawn: ${e.message}`, code: 127 });
		});
	});
}

export function buildRequestBody(
	msgs: Message[],
	tools: ToolDef[],
	cfg: ApiConfig,
): Record<string, unknown> {
	const messages = msgs.map((m) => {
		if (m.role === "tool")
			return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
		if (m.role === "assistant" && m.toolCalls?.length)
			return {
				role: "assistant",
				content: m.content || null,
				tool_calls: m.toolCalls.map((tc) => ({
					id: tc.id,
					type: "function",
					function: { name: tc.name, arguments: JSON.stringify(tc.input) },
				})),
			};
		return { role: m.role, content: m.content };
	});
	return {
		model: cfg.model,
		temperature: cfg.temperature,
		max_completion_tokens: cfg.maxTokens,
		messages,
		tool_choice: "auto",
		tools: tools.map((t) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.parameters },
		})),
	};
}

export function parseApiResponse(data: Record<string, unknown>): ApiResponse {
	const ch = data.choices as Array<Record<string, unknown>> | undefined;
	if (!ch?.length) return { message: { role: "assistant", content: "(no response)" } };
	const rm = ch[0].message as Record<string, unknown> | undefined;
	if (!rm) return { message: { role: "assistant", content: "(no response)" } };
	const content = (rm.content as string) ?? "";
	const rtc = rm.tool_calls as Array<Record<string, unknown>> | undefined;
	let toolCalls: ToolCall[] | undefined;
	if (rtc?.length) {
		toolCalls = rtc
			.filter((t) => t.type === "function")
			.map((t) => {
				const fn = t.function as Record<string, unknown>;
				let pi: Record<string, unknown> = {};
				try {
					pi = JSON.parse((fn.arguments as string) ?? "{}") as Record<string, unknown>;
				} catch {
					pi = { command: (fn.arguments as string) ?? "" };
				}
				return { id: (t.id as string) ?? "", name: (fn.name as string) ?? "", input: pi };
			});
	}
	const ru = data.usage as Record<string, unknown> | undefined;
	let usage: Usage | undefined;
	if (ru)
		usage = {
			promptTokens: (ru.prompt_tokens as number) ?? 0,
			completionTokens: (ru.completion_tokens as number) ?? 0,
			totalTokens: (ru.total_tokens as number) ?? 0,
		};
	return {
		message: {
			role: "assistant",
			content,
			toolCalls: toolCalls?.length ? toolCalls : undefined,
		},
		usage,
	};
}

export function extractCommand(ti: unknown): string {
	if (typeof ti === "string") {
		try {
			return ((JSON.parse(ti) as Record<string, unknown>).command as string) ?? "";
		} catch {
			return ti;
		}
	}
	if (ti && typeof ti === "object")
		return ((ti as Record<string, unknown>).command as string) ?? "";
	return "";
}

export function formatCommandResult(cmd: string, r: BashResult): string {
	let s = `[command] ${cmd}`;
	if (r.stdout) s += `\n[stdout]\n${r.stdout.trimEnd()}`;
	if (r.stderr) s += `\n[stderr]\n${r.stderr.trimEnd()}`;
	if (r.code !== 0) s += `\n[exit_code] ${r.code}`;
	return s;
}

async function callApi(
	msgs: Message[],
	tools: ToolDef[],
	cfg: ApiConfig,
	dbg: boolean,
): Promise<ApiResponse> {
	const url = `${cfg.baseUrl}/chat/completions`;
	const body = buildRequestBody(msgs, tools, cfg);
	if (dbg) console.log(c("magenta", `[DEBUG] ${url}\n${JSON.stringify(body, null, 2)}`));
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const txt = await res.text();
		let msg: string;
		try {
			const e = (JSON.parse(txt) as Record<string, unknown>).error as Record<string, unknown>;
			msg = (e?.message as string) ?? txt;
		} catch {
			msg = txt;
		}
		throw new Error(`API error (${res.status}): ${msg}`);
	}
	const data = (await res.json()) as Record<string, unknown>;
	if (dbg) console.log(c("magenta", `[DEBUG] Response:\n${JSON.stringify(data, null, 2)}`));
	return parseApiResponse(data);
}

function createAgent(opts: AgentOptions): Agent {
	const { apiConfig: cfg, systemPrompt, workspaceRoot, debug, promptApproval } = opts;
	const msgs: Message[] = [{ role: "system", content: systemPrompt }];
	const tok = { prompt: 0, completion: 0, total: 0 };
	const tools: ToolDef[] = [BASH_TOOL];
	async function handleBash(cmd: string, cid: string): Promise<Message> {
		const pol = checkPolicy(cmd);
		if (pol === "deny") {
			console.log(c("red", bold("\n✗ Denied:")));
			console.log(dim(`  ${cmd}\n`));
			return { role: "tool", toolCallId: cid, content: "Command denied by policy." };
		}
		if (pol === "auto") console.log(c("green", `✓ ${cmd}`));
		else if (!(await promptApproval(cmd)))
			return { role: "tool", toolCallId: cid, content: "User rejected command." };
		const r = await runBash(cmd, workspaceRoot);
		if (r.stdout) console.log(r.stdout.trimEnd());
		if (r.stderr)
			console.error(r.code !== 0 ? c("red", r.stderr.trimEnd()) : r.stderr.trimEnd());
		return {
			role: "tool",
			toolCallId: cid,
			content: JSON.stringify(
				{ command: cmd, exitCode: r.code, stdout: r.stdout, stderr: r.stderr },
				null,
				2,
			),
		};
	}
	async function handleToolCalls(tcs: ToolCall[]): Promise<Message[]> {
		const out: Message[] = [];
		for (const tc of tcs) {
			if (tc.name !== "bash") {
				out.push({ role: "tool", toolCallId: tc.id, content: `Unknown tool: ${tc.name}` });
				continue;
			}
			const cmd = extractCommand(tc.input);
			if (!cmd) {
				out.push({ role: "tool", toolCallId: tc.id, content: "No command." });
				continue;
			}
			out.push(await handleBash(cmd, tc.id));
		}
		return out;
	}
	async function runAgentTurn(): Promise<void> {
		let turn = 0;
		while (true) {
			console.log(dim(`\n─── turn ${++turn} ───\n`));
			let resp: ApiResponse;
			try {
				resp = await callApi(msgs, tools, cfg, debug);
			} catch (e: unknown) {
				throw new Error(`API failed: ${(e as Error).message}`);
			}
			if (resp.usage) {
				const u = resp.usage;
				tok.prompt += u.promptTokens;
				tok.completion += u.completionTokens;
				tok.total += u.totalTokens;
				console.log(
					dim(
						`[tokens] in:${u.promptTokens} out:${u.completionTokens} total:${tok.total}`,
					),
				);
			}
			const ct = resp.message.content ?? "";
			const tcs = resp.message.toolCalls ?? [];
			msgs.push({
				role: "assistant",
				content: ct || "",
				toolCalls: tcs.length ? tcs : undefined,
			});
			if (ct) console.log(`\n${ct}\n`);
			if (!tcs.length) return;
			msgs.push(...(await handleToolCalls(tcs)));
		}
	}
	return {
		runAgentTurn,
		addUserMessage(content: string) {
			msgs.push({ role: "user", content });
		},
		clear() {
			msgs.length = 1;
		},
		getTokens: () => ({ ...tok }),
		getModel: () => cfg.model,
	};
}

function loadConfig(): ApiConfig {
	const apiKey = process.env.OPENAI_API_KEY ?? "";
	if (!apiKey) {
		console.error(c("red", "OPENAI_API_KEY required."));
		process.exit(1);
	}
	return {
		apiKey,
		baseUrl: (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
		model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
		temperature: process.env.OPENAI_TEMPERATURE
			? Number.parseFloat(process.env.OPENAI_TEMPERATURE)
			: DEFAULT_TEMPERATURE,
		maxTokens: process.env.OPENAI_MAX_TOKENS
			? Number.parseInt(process.env.OPENAI_MAX_TOKENS, 10)
			: DEFAULT_MAX_TOKENS,
	};
}

function handleSlash(line: string, ctx: SlashCtx): SlashResult {
	const cmd = line.slice(1).split(/\s+/)[0];
	let buf = ctx.bufferedShellOutput;
	switch (cmd) {
		case "exit":
		case "quit":
			return { shouldContinue: false, bufferedShellOutput: buf };
		case "clear":
		case "new":
			ctx.agent.clear();
			buf = null;
			console.log(c("green", "✓ Cleared."));
			return { shouldContinue: true, bufferedShellOutput: buf };
		case "help":
			console.log(`\n${bold("Commands:")}
  ${c("cyan", "/clear")} ${dim("Reset")}  ${c("cyan", "/model")} ${dim("Model")}  ${c("cyan", "/tokens")} ${dim("Usage")}
  ${c("cyan", "/help")} ${dim("Help")}  ${c("cyan", "/exit")} ${dim("Exit")}  ${c("cyan", "!cmd")} ${dim("Shell")}\n`);
			return { shouldContinue: true, bufferedShellOutput: buf };
		case "model":
			console.log(dim(`Model: ${ctx.agent.getModel()}`));
			return { shouldContinue: true, bufferedShellOutput: buf };
		case "tokens": {
			const t = ctx.agent.getTokens();
			console.log(dim(`in:${t.prompt} out:${t.completion} total:${t.total}`));
			return { shouldContinue: true, bufferedShellOutput: buf };
		}
		default:
			console.error(c("red", `Unknown: /${cmd}`));
			return { shouldContinue: true, bufferedShellOutput: buf };
	}
}

async function main(): Promise<void> {
	const dbg = process.argv.includes("-d") || process.argv.includes("--debug");
	const cfg = loadConfig();
	const sp = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
	const wr = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());
	const rl = readline.createInterface({ input, output });
	let abort: AbortController | null = null;
	let buf: string | null = null;
	async function approve(command: string): Promise<boolean> {
		console.log(`\n${c("yellow", "Command:")} ${bold(command)}`);
		console.log(dim("  [enter/y] Run  [n] Reject  [ctrl+c] Cancel"));
		const ctrl = new AbortController();
		abort = ctrl;
		try {
			const a = (await rl.question(c("cyan", "? "), { signal: ctrl.signal }))
				.trim()
				.toLowerCase();
			if (a === "" || a === "y" || a === "yes") {
				console.log(c("green", "✓"));
				return true;
			}
			console.log(c("yellow", "✗ Rejected"));
			return false;
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") {
				console.log(c("yellow", "\n✗"));
				return false;
			}
			throw e;
		} finally {
			abort = null;
		}
	}
	const agent = createAgent({
		apiConfig: cfg,
		systemPrompt: sp,
		workspaceRoot: wr,
		debug: dbg,
		promptApproval: approve,
	});
	console.log(`\n${bold("Minimal Agent")} ${dim(agent.getModel())} ${dim(cfg.baseUrl)}`);
	if (dbg) console.log(c("magenta", "[DEBUG]"));
	console.log(dim("/help for commands, /exit to quit.\n"));
	rl.on("SIGINT", () => {
		if (abort) {
			abort.abort();
			return;
		}
		rl.close();
		process.exit(0);
	});
	while (true) {
		const t = agent.getTokens();
		if (t.total > 0) console.log(dim(`[${t.total} tokens]`));
		let line: string;
		try {
			line = (await rl.question(c("cyan", "> "))).trim();
		} catch {
			break;
		}
		if (!line) continue;
		if (line.startsWith("!")) {
			const cmd = line.slice(1).trim();
			if (!cmd) continue;
			const r = await runBash(cmd, wr);
			if (r.stdout) console.log(r.stdout.trimEnd());
			if (r.stderr) console.error(r.code ? c("red", r.stderr.trimEnd()) : r.stderr.trimEnd());
			buf = buf ? `${buf}\n\n${formatCommandResult(cmd, r)}` : formatCommandResult(cmd, r);
			continue;
		}
		if (line.startsWith("/")) {
			const res = handleSlash(line, { agent, bufferedShellOutput: buf });
			buf = res.bufferedShellOutput;
			if (!res.shouldContinue) break;
			continue;
		}
		const content = buf ? `${buf}\n\n${line}` : line;
		buf = null;
		agent.addUserMessage(content);
		try {
			await agent.runAgentTurn();
		} catch (e) {
			console.error(c("red", `Error: ${e instanceof Error ? e.message : String(e)}`));
		}
	}
	console.log(dim("Bye!"));
	rl.close();
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain)
	main().catch((e) => {
		console.error(c("red", `Fatal: ${e instanceof Error ? e.message : String(e)}`));
		process.exit(1);
	});
