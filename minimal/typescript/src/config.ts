import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import chalk from "chalk";

export interface Config {
  llm: {
    provider: "groq" | "openai" | "custom";
    model: string;
    temperature: number;
    maxTokens: number;
    apiKeyEnv: string;
    baseUrl?: string;
  };
  policy: {
    defaultAction: "ask" | "deny";
    denyPatterns: string[];
    autoCommands: string[];
  };
}

export const MINIMAL_DIR = path.join(homedir(), ".minimal");
export const CONFIG_PATH = path.join(MINIMAL_DIR, "config.json");
export const SYSTEM_MD_PATH = path.join(MINIMAL_DIR, "system.md");
export const SKILLS_DIR = path.join(MINIMAL_DIR, "skills");

export const DEFAULT_CONFIG: Config = {
  llm: {
    provider: "groq",
    model: "moonshotai/kimi-k2-instruct",
    temperature: 1,
    maxTokens: 4096,
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  policy: {
    defaultAction: "ask",
    denyPatterns: [],
    autoCommands: [],
  },
};

function printError(msg: string) {
  console.error(chalk.red(`Error: ${msg}`));
}

function getProviderDefaults(provider: Config["llm"]["provider"]): Partial<Config["llm"]> {
  switch (provider) {
    case "openai":
      return {
        model: "gpt-4o-mini",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1",
      };
    case "groq":
      return {
        model: "moonshotai/kimi-k2-instruct",
        apiKeyEnv: "GROQ_API_KEY",
        baseUrl: "https://api.groq.com/openai/v1",
      };
    case "custom":
      return {};
    default:
      return {};
  }
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    const provider = parsed.llm?.provider ?? DEFAULT_CONFIG.llm.provider;
    const providerDefaults = getProviderDefaults(provider);
    return {
      llm: {
        ...DEFAULT_CONFIG.llm,
        ...providerDefaults,
        ...parsed.llm,
        provider,
      },
      policy: { ...DEFAULT_CONFIG.policy, ...parsed.policy },
    };
  } catch (e) {
    printError(`Invalid config.json: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

export function loadSystemPrompt(): string {
  if (!existsSync(SYSTEM_MD_PATH)) {
    printError("~/.minimal/system.md not found.");
    console.error(chalk.gray("Run: mkdir -p ~/.minimal && touch ~/.minimal/system.md"));
    process.exit(1);
  }

  const content = readFileSync(SYSTEM_MD_PATH, "utf-8").trim();
  if (!content) {
    printError("~/.minimal/system.md is empty.");
    process.exit(1);
  }

  return content;
}

export function ensureMinimalDir() {
  if (!existsSync(MINIMAL_DIR)) {
    printError("~/.minimal directory not found.");
    console.error(chalk.gray("Run the following to initialize:"));
    console.error(chalk.gray("  mkdir -p ~/.minimal/skills"));
    console.error(chalk.gray('  echo "You are a helpful coding assistant." > ~/.minimal/system.md'));
    process.exit(1);
  }
}
