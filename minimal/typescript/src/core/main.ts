import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import chalk from "chalk";
import {
  ensureMinimalDir,
  loadConfig,
  loadSystemPrompt,
  SKILLS_DIR,
} from "../config.js";
import { runBash, formatCommandResult } from "../policy-bash.js";
import { createAgent, type Agent } from "./agent.js";

// ============================================
// UI Helpers
// ============================================

function printError(msg: string) {
  console.error(chalk.red(`Error: ${msg}`));
}

function printSuccess(msg: string) {
  console.log(chalk.green(msg));
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

  const rl = readline.createInterface({ input, output });
  let approvalAbort: AbortController | null = null;
  let bufferedShellOutput: string | null = null;

  // ─── Approval Prompt ───
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

  // ─── Create Agent ───
  let agent: Agent;
  try {
    agent = createAgent({
      config,
      systemPrompt,
      workspaceRoot,
      debug,
      callbacks: {
        promptApproval,
        onAutoApproved: printAutoApproved,
        onDenied: printDenied,
        onDebugLog: debugLog,
      },
    });
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  console.log(chalk.bold("Minimal Agent") + chalk.gray(` (${agent.getModel()})`));
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

  // ─── Slash Commands ───
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
        agent.clear();
        bufferedShellOutput = null;
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
        const userContent = bufferedShellOutput
          ? `${bufferedShellOutput}\n\n${baseContent}`
          : baseContent;
        bufferedShellOutput = null;

        agent.addUserMessage(userContent);

        try {
          await agent.runAgentTurn();
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

  // ─── REPL ───
  while (true) {
    const tokens = agent.getTokens();
    if (tokens.total > 0) {
      console.log(chalk.dim(`[session] ${tokens.total} tokens`));
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
      bufferedShellOutput = bufferedShellOutput
        ? `${bufferedShellOutput}\n\n${formatted}`
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

    const userContent = bufferedShellOutput ? `${bufferedShellOutput}\n\n${line}` : line;
    bufferedShellOutput = null;
    agent.addUserMessage(userContent);

    try {
      await agent.runAgentTurn();
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
    }
  }

  rl.close();
}
