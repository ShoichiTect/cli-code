import { spawn } from "node:child_process";
import type { Config } from "./config.js";

export type PolicyResult = "auto" | "ask" | "deny";

const BASH_TIMEOUT = 30000;

// Dangerous file patterns - deny reading these files
const DANGEROUS_FILE_PATTERNS: RegExp[] = [
  // Secret files
  /\.env$/,
  /\.env\./,
  /\.dev\.vars$/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  // Large/binary files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.DS_Store$/,
  /node_modules/,
];

// Destructive command patterns - always deny
const BUILTIN_DENY_PATTERNS: RegExp[] = [
  /rm\s+(-[rf]+\s+)*\//,
  /rm\s+-rf?\s+\*/,
  /rm\s+-rf?\s+\.\*/,
  /mkfs/,
  /dd\s+if=.*of=\/dev/,
  />\s*\/dev\/sd/,
  /gcloud\s+.*delete/,
  /gcloud\s+.*destroy/,
  /aws\s+.*delete/,
  /aws\s+.*terminate/,
  /kubectl\s+delete/,
  /:\(\)\s*\{.*\|.*&.*\}/,
  /chmod\s+-R\s+777\s+\//,
  /chown\s+-R.*\//,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
];

const BUILTIN_AUTO_COMMANDS = [
  "ls",
  "pwd",
  "whoami",
  "date",
  "which",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "file",
  "stat",
  "tree",
  "find",
  "fd",
  "grep",
  "rg",
  "git status",
  "git diff",
  "git log",
  "git branch",
];

const FORCE_ASK_PATTERN = /[|;&`$()]/;

export function checkPolicy(command: string, config: Config): PolicyResult {
  const cmd = command.trim();

  // Build deny patterns
  const denyPatterns = [
    ...BUILTIN_DENY_PATTERNS,
    ...config.policy.denyPatterns.map((p) => new RegExp(p)),
  ];

  // Build auto commands
  const autoCommands = [...BUILTIN_AUTO_COMMANDS, ...config.policy.autoCommands];

  // 1. Check destructive command patterns
  for (const pattern of denyPatterns) {
    if (pattern.test(cmd)) {
      return "deny";
    }
  }

  // 2. Check dangerous file patterns in args
  const args = cmd.split(/\s+/).slice(1).join(" ");
  for (const pattern of DANGEROUS_FILE_PATTERNS) {
    if (pattern.test(args)) {
      return "deny";
    }
  }

  // 3. Force ask for complex commands
  if (FORCE_ASK_PATTERN.test(cmd)) {
    return "ask";
  }

  // 4. Check auto
  for (const autoCmd of autoCommands) {
    if (cmd === autoCmd || cmd.startsWith(autoCmd + " ")) {
      return "auto";
    }
  }

  // 5. Default action
  return config.policy.defaultAction;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function formatCommandResult(command: string, result: BashResult): string {
  let content = `[command] ${command}`;
  if (result.stdout) content += `\n[stdout]\n${result.stdout.trimEnd()}`;
  if (result.stderr) content += `\n[stderr]\n${result.stderr.trimEnd()}`;
  if (result.code !== 0) content += `\n[exit_code] ${result.code}`;
  return content;
}

export function runBash(command: string, workspaceRoot: string): Promise<BashResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: workspaceRoot,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, BASH_TIMEOUT);

    child.stdout.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ stdout, stderr: "Command timed out (30s)", code: 124 });
      } else {
        resolve({ stdout, stderr, code: code ?? 0 });
      }
    });
  });
}
