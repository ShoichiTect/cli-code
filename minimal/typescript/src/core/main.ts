import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import chalk from "chalk";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import {
  ensureMinimalDir,
  loadConfig,
  loadSystemPrompt,
  resolveLlmConfig,
  SKILLS_DIR,
} from "../config.js";
import { createProvider } from "./providers/index.js";
import { checkPolicy, formatCommandResult, runBash } from "../policy-bash.js";
import type { CoreMessage, CoreTool, CoreToolCall } from "./types.js";
import { bashTool } from "../tools/bash.js";

// ============================================
// UI Helpers
// ============================================

marked.setOptions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: new TerminalRenderer({
    reflowText: true,
    width: 80,
  }) as any,
});

function printError(msg: string) {
  console.error(chalk.red(`Error: ${msg}`));
}

function printSuccess(msg: string) {
  console.log(chalk.green(msg));
}

function printMuted(msg: string) {
  console.log(chalk.gray(msg));
}

function printMarkdown(content: string) {
  console.log(marked(content));
}

function printHelp() {
  console.log("");
  console.log(chalk.bold("Commands:"));
  console.log(chalk.cyan("  /skill <name>") + chalk.gray("   Load skill from ~/.minimal/skills/"));
  console.log(chalk.cyan("  /clear, /new") + chalk.gray("    Reset conversation"));
  console.log(chalk.cyan("  /help") + chalk.gray("           Show this help"));
  console.log(chalk.cyan("  /exit, /quit") + chalk.gray("    Exit"));
  console.log("");
  console.log(chalk.cyan("  !<command>") + chalk.gray("      Execute shell command directly"));
  console.log("");
}

function printSkillList(skills: string[]) {
  console.log("");
  console.log(chalk.bold("Available skills:"));
  if (skills.length === 0) {
    console.log(chalk.gray("  (none)"));
  } else {
    skills.forEach((s, i) => {
      console.log(chalk.cyan(`  ${i + 1}.`) + ` ${s}`);
    });
  }
  console.log(chalk.gray("\nUsage: /skill <name>"));
  console.log("");
}

function printSkillLoaded(name: string, content: string) {
  console.log(chalk.green(`✓ Loaded: ${name}`));
  console.log(chalk.gray("─".repeat(40)));
  const preview = content.slice(0, 200) + (content.length > 200 ? "..." : "");
  console.log(chalk.gray(preview));
  console.log(chalk.gray("─".repeat(40)));
}

function printDenied(command: string) {
  console.log("");
  console.log(chalk.red.bold("✗ Denied by policy:"));
  console.log(chalk.gray(`  ${command}`));
  console.log("");
}

function printAutoApproved(command: string) {
  console.log(chalk.green(`✓ ${command}`));
}

// ============================================
// Skills
// ============================================

function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) {
    return [];
  }

  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function loadSkill(name: string): string | null {
  const skillPath = path.join(SKILLS_DIR, `${name}.md`);
  if (!existsSync(skillPath)) {
    return null;
  }
  return readFileSync(skillPath, "utf-8");
}

// ============================================
// Main
// ============================================

export interface MainOptions {
  debug?: boolean;
}

export async function main(options: MainOptions = {}) {
  const { debug = false } = options;

  function debugLog(label: string, data?: unknown) {
    if (!debug) return;
    console.log(chalk.magenta(`[DEBUG] ${label}`));
    if (data !== undefined) {
      console.log(chalk.magenta(JSON.stringify(data, null, 2)));
    }
  }
  // Setup
  ensureMinimalDir();
  const config = loadConfig();
  const systemPrompt = loadSystemPrompt();
  const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());

  let llmConfig: ReturnType<typeof resolveLlmConfig>;
  try {
    llmConfig = resolveLlmConfig(config);
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (!llmConfig.apiKey) {
    const missing = llmConfig.apiKeyEnv
      ? `${llmConfig.apiKeyEnv} is not set.`
      : "API key is not set in config.json.";
    printError(missing);
    process.exit(1);
  }

  let provider: ReturnType<typeof createProvider>;
  try {
    provider = createProvider(llmConfig);
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  let approvalAbort: AbortController | null = null;
  let pendingUserPreamble: string | null = null;

  const messages: CoreMessage[] = [{ role: "system", content: systemPrompt }];

  // Token usage tracking
  const sessionTokens = { prompt: 0, completion: 0, total: 0 };

  const tools: CoreTool[] = [bashTool];

  console.log(chalk.bold("Minimal Agent") + chalk.gray(` (${llmConfig.model})`));
  if (debug) {
    console.log(chalk.magenta("[DEBUG MODE ENABLED]"));
  }
  console.log(chalk.gray("Type /help for commands, /exit to quit."));
  console.log("");

  rl.on("SIGINT", () => {
    if (approvalAbort) {
      approvalAbort.abort();
      return;
    }
    rl.close();
    process.exit(0);
  });

  async function promptApproval(command: string): Promise<boolean> {
    console.log("");
    console.log(chalk.yellow("Command:"));
    console.log(chalk.bold.white(`  ${command}`));
    console.log("");
    console.log(chalk.gray("  [enter/y] Run"));
    console.log(chalk.gray("  [n]       Reject"));
    console.log(chalk.gray("  [ctrl+c]  Cancel"));
    console.log("");

    const controller = new AbortController();
    approvalAbort = controller;

    try {
      const answer = (await rl.question(chalk.cyan("> "), { signal: controller.signal }))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "y") {
        printSuccess("✓ Running...");
        return true;
      }

      console.log(chalk.yellow("✗ Rejected"));
      return false;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(chalk.yellow("\n✗ Cancelled"));
        return false;
      }
      throw error;
    } finally {
      approvalAbort = null;
    }
  }

  async function handleBashTool(command: string, callId: string): Promise<CoreMessage> {
    const policy = checkPolicy(command, config);

    if (policy === "deny") {
      printDenied(command);
      return {
        role: "tool",
        toolCallId: callId,
        content: "Command denied by policy.",
      };
    }

    if (policy === "auto") {
      printAutoApproved(command);
    } else {
      const approved = await promptApproval(command);
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

  async function runAgentTurn(): Promise<void> {
    let loopCount = 0;

    while (true) {
      loopCount++;
      printMuted(`\n─── turn ${loopCount} ───\n`);

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
          printError("Invalid API key.");
        } else if (err.status === 429) {
          printError("Rate limit exceeded. Wait and retry.");
        } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
          printError("Network error. Check your connection.");
        } else {
          printError(err.message || String(e));
        }
        return;
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
        printMarkdown(content);
      }

      if (toolCalls.length === 0) {
        return;
      }

      const toolResults = await handleToolCalls(toolCalls);
      messages.push(...toolResults);
    }
  }

  async function handleSlashCommand(line: string): Promise<boolean> {
    const parts = line.slice(1).split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1).join(" ");

    switch (cmd) {
      case "exit":
      case "quit":
        return false;

      case "clear":
      case "new":
        messages.length = 1; // Keep system prompt
        pendingUserPreamble = null;
        printSuccess("✓ Conversation cleared.");
        return true;

      case "help":
        printHelp();
        return true;

      case "skill": {
        if (!args) {
          printSkillList(listSkills());
          return true;
        }

        const skillContent = loadSkill(args);
        if (!skillContent) {
          printError(`Skill not found: ${args}`);
          printSkillList(listSkills());
          return true;
        }

        printSkillLoaded(args, skillContent);

        const additional = (await rl.question(chalk.gray("Additional input (optional): "))).trim();

        const baseContent = additional ? `${skillContent}\n\n${additional}` : skillContent;
        const userContent = pendingUserPreamble
          ? `${pendingUserPreamble}\n\n${baseContent}`
          : baseContent;
        pendingUserPreamble = null;

        messages.push({ role: "user", content: userContent });

        try {
          await runAgentTurn();
        } catch (e) {
          printError(e instanceof Error ? e.message : String(e));
        }

        return true;
      }

      default:
        printError(`Unknown command: /${cmd}`);
        printHelp();
        return true;
    }
  }

  // REPL
  while (true) {
    if (sessionTokens.total > 0) {
      console.log(chalk.dim(`[session] ${sessionTokens.total} tokens`));
    }
    const line = (await rl.question(chalk.cyan("> "))).trim();

    if (!line) {
      continue;
    }

    // User direct command execution
    if (line.startsWith("!")) {
      const command = line.slice(1).trim();
      if (!command) continue;

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

      const formatted = formatCommandResult(command, result);
      pendingUserPreamble = pendingUserPreamble
        ? `${pendingUserPreamble}\n\n${formatted}`
        : formatted;

      continue;
    }

    if (line.startsWith("/")) {
      const shouldContinue = await handleSlashCommand(line);
      if (!shouldContinue) {
        break;
      }
      continue;
    }

    const userContent = pendingUserPreamble ? `${pendingUserPreamble}\n\n${line}` : line;
    pendingUserPreamble = null;
    messages.push({ role: "user", content: userContent });

    try {
      await runAgentTurn();
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
    }
  }

  rl.close();
}
