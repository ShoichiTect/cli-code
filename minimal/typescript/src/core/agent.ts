import chalk from "chalk";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import type { Config } from "../config.js";
import { resolveLlmConfig } from "../config.js";
import { checkPolicy, runBash } from "../policy-bash.js";
import { bashTool } from "../tools/bash.js";
import { createProvider } from "./providers/index.js";
import type { CoreMessage, CoreTool, CoreToolCall } from "./types.js";

// ============================================
// Types
// ============================================

export interface AgentCallbacks {
  /** コマンド実行の承認を求める */
  promptApproval: (command: string) => Promise<boolean>;
  /** 自動承認されたコマンドを通知 */
  onAutoApproved?: (command: string) => void;
  /** 拒否されたコマンドを通知 */
  onDenied?: (command: string) => void;
  /** デバッグログ */
  onDebugLog?: (label: string, data?: unknown) => void;
}

export interface AgentOptions {
  config: Config;
  systemPrompt: string;
  workspaceRoot: string;
  debug?: boolean;
  callbacks: AgentCallbacks;
}

export interface Agent {
  runAgentTurn: () => Promise<void>;
  addUserMessage: (content: string) => void;
  clear: () => void;
  getTokens: () => { prompt: number; completion: number; total: number };
  getModel: () => string;
}

// ============================================
// Factory
// ============================================

marked.setOptions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: new TerminalRenderer({
    reflowText: true,
    width: 80,
  }) as any,
});

export function createAgent(options: AgentOptions): Agent {
  const { config, systemPrompt, workspaceRoot, debug, callbacks } = options;

  // ─── 状態（クロージャで保持）───
  const llmConfig = resolveLlmConfig(config);
  const provider = createProvider(llmConfig);
  const messages: CoreMessage[] = [{ role: "system", content: systemPrompt }];
  const sessionTokens = { prompt: 0, completion: 0, total: 0 };
  const tools: CoreTool[] = [bashTool];

  // ─── ヘルパー ───
  function debugLog(label: string, data?: unknown) {
    if (debug && callbacks.onDebugLog) {
      callbacks.onDebugLog(label, data);
    }
  }

  // ─── Tool 処理 ───
  async function handleBashTool(command: string, callId: string): Promise<CoreMessage> {
    const policy = checkPolicy(command, config);

    if (policy === "deny") {
      callbacks.onDenied?.(command);
      return {
        role: "tool",
        toolCallId: callId,
        content: "Command denied by policy.",
      };
    }

    if (policy === "auto") {
      callbacks.onAutoApproved?.(command);
    } else {
      const approved = await callbacks.promptApproval(command);
      if (!approved) {
        return {
          role: "tool",
          toolCallId: callId,
          content: "User rejected command.",
        };
      }
    }

    const result = await runBash(command, workspaceRoot);

    if (result.stdout) {
      console.log(result.stdout.trimEnd());
    }
    if (result.stderr) {
      if (result.code !== 0) {
        console.error(chalk.red(result.stderr.trimEnd()));
      } else {
        console.error(result.stderr.trimEnd());
      }
    }

    return {
      role: "tool",
      toolCallId: callId,
      content: JSON.stringify(
        {
          command,
          exitCode: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        null,
        2
      ),
    };
  }

  async function handleToolCalls(toolCalls: CoreToolCall[]): Promise<CoreMessage[]> {
    const results: CoreMessage[] = [];

    for (const call of toolCalls) {
      if (call.name !== "bash") {
        results.push({
          role: "tool",
          toolCallId: call.id,
          content: `Unknown tool: ${call.name}`,
        });
        continue;
      }

      let command = "";
      const input = call.input;

      if (typeof input === "string") {
        try {
          const parsed = JSON.parse(input) as { command?: string };
          command = parsed.command || "";
        } catch {
          command = input;
        }
      } else if (input && typeof input === "object") {
        command = (input as { command?: string }).command || "";
      }

      if (!command) {
        results.push({
          role: "tool",
          toolCallId: call.id,
          content: "No command provided.",
        });
        continue;
      }

      const result = await handleBashTool(command, call.id);
      results.push(result);
    }

    return results;
  }

  // ─── メインループ ───
  async function runAgentTurn(): Promise<void> {
    let loopCount = 0;

    while (true) {
      loopCount++;
      console.log(chalk.gray(`\n─── turn ${loopCount} ───\n`));

      let response;
      try {
        const requestParams = {
          model: llmConfig.model,
          temperature: llmConfig.temperature,
          maxTokens: llmConfig.maxTokens,
          messages,
          tools,
        };
        debugLog("API Request", requestParams);
        response = await provider.createChatCompletion(requestParams);
        debugLog("API Response", response);
      } catch (e: unknown) {
        const err = e as { status?: number; code?: string; message?: string };
        if (err.status === 401) {
          throw new Error("Invalid API key.");
        } else if (err.status === 429) {
          throw new Error("Rate limit exceeded. Wait and retry.");
        } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
          throw new Error("Network error. Check your connection.");
        } else {
          throw new Error(err.message || String(e));
        }
      }

      // Token usage
      if (response.usage) {
        const u = response.usage;
        sessionTokens.prompt += u.promptTokens;
        sessionTokens.completion += u.completionTokens;
        sessionTokens.total += u.totalTokens;
        console.log(
          chalk.dim(
            `[tokens] in:${u.promptTokens} out:${u.completionTokens} | session:${sessionTokens.total}`
          )
        );
      }

      const assistant = response.message;
      const content = assistant.content ?? "";
      const thinking = assistant.thinking ?? "";
      const toolCalls = assistant.toolCalls ?? [];
      debugLog("Assistant message", { content, thinking, toolCalls });

      messages.push({
        role: "assistant",
        content: content || "",
        thinking: thinking || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (thinking) {
        console.log(chalk.dim("─── thinking ───"));
        console.log(chalk.dim(thinking));
        console.log(chalk.dim("────────────────"));
      }

      if (content) {
        console.log(marked(content));
      }

      if (toolCalls.length === 0) {
        return;
      }

      const toolResults = await handleToolCalls(toolCalls);
      messages.push(...toolResults);
    }
  }

  // ─── 公開 API ───
  return {
    runAgentTurn,
    addUserMessage: (content: string) => {
      messages.push({ role: "user", content });
    },
    clear: () => {
      messages.length = 1;
    },
    getTokens: () => ({ ...sessionTokens }),
    getModel: () => llmConfig.model,
  };
}
