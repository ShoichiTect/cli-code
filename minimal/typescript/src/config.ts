import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import chalk from "chalk";

export type SchemaType = "openai" | "anthropic";

export interface LlmVariant {
  schemaType: SchemaType;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmConfig {
  currentProvider: string;
  currentModel?: string;
  variants: Record<string, LlmVariant>;
}

export interface Config {
  llm: LlmConfig;
  policy: {
    defaultAction: "ask" | "deny";
    denyPatterns: string[];
    autoCommands: string[];
  };
}

export interface ResolvedLlmConfig {
  provider: string;
  schemaType: SchemaType;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl: string;
}

export const MINIMAL_DIR = path.join(homedir(), ".minimal");
export const CONFIG_PATH = path.join(MINIMAL_DIR, "config.json");
export const SYSTEM_MD_PATH = path.join(MINIMAL_DIR, "system.md");
export const SKILLS_DIR = path.join(MINIMAL_DIR, "skills");

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 4096;

export const DEFAULT_CONFIG: Config = {
  llm: {
    currentProvider: "groq",
    currentModel: "moonshotai/kimi-k2-instruct",
    variants: {
      groq: {
        schemaType: "openai",
        apiKeyEnv: "GROQ_API_KEY",
        baseUrl: "https://api.groq.com/openai/v1",
        temperature: DEFAULT_TEMPERATURE,
        maxTokens: DEFAULT_MAX_TOKENS,
      },
    },
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

function normalizeSchemaType(value: unknown): SchemaType | null {
  if (value === "openai" || value === "anthropic") {
    return value;
  }
  return null;
}

function defaultBaseUrl(provider: string, schemaType: SchemaType): string | undefined {
  if (schemaType === "openai") {
    if (provider === "openai") return "https://api.openai.com/v1";
    if (provider === "groq") return "https://api.groq.com/openai/v1";
    if (provider === "deepseek") return "https://api.deepseek.com";
  }
  return undefined;
}

type RawVariant = {
  schema_type?: string;
  schemaType?: string;
  api_key?: string;
  apiKey?: string;
  api_key_env?: string;
  apiKeyEnv?: string;
  base_url?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  maxTokens?: number;
};

type RawConfig = {
  llm?: {
    current_provider?: string;
    currentProvider?: string;
    current_model?: string;
    currentModel?: string;
    variants?: Record<string, RawVariant>;
  };
  policy?: Config["policy"];
};

function normalizeVariants(variants: Record<string, RawVariant>): Record<string, LlmVariant> {
  const normalized: Record<string, LlmVariant> = {};
  for (const [name, variant] of Object.entries(variants)) {
    const schemaType =
      normalizeSchemaType(variant.schema_type) ??
      normalizeSchemaType(variant.schemaType) ??
      null;
    if (!schemaType) {
      continue;
    }

    normalized[name] = {
      schemaType,
      apiKey: variant.api_key ?? variant.apiKey,
      apiKeyEnv: variant.api_key_env ?? variant.apiKeyEnv,
      baseUrl: variant.base_url ?? variant.baseUrl,
      model: variant.model,
      temperature: variant.temperature,
      maxTokens: variant.max_tokens ?? variant.maxTokens,
    };
  }
  return normalized;
}

function normalizeConfig(raw: RawConfig): Config {
  const policy = { ...DEFAULT_CONFIG.policy, ...raw.policy };
  const llmRaw = raw.llm ?? {};

  const currentProvider =
    llmRaw.current_provider ?? llmRaw.currentProvider ?? DEFAULT_CONFIG.llm.currentProvider;
  const currentModel = llmRaw.current_model ?? llmRaw.currentModel;
  const variantsRaw = llmRaw.variants ?? {};
  const variants = normalizeVariants(variantsRaw);

  if (Object.keys(variants).length === 0) {
    throw new Error("llm.variants is required in config.json.");
  }

  return {
    llm: {
      currentProvider,
      currentModel,
      variants,
    },
    policy,
  };
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as RawConfig;
    return normalizeConfig(parsed);
  } catch (e) {
    printError(`Invalid config.json: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

export function resolveLlmConfig(config: Config): ResolvedLlmConfig {
  const provider = config.llm.currentProvider;
  const variant = config.llm.variants[provider];

  if (!variant) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const schemaType = normalizeSchemaType(variant.schemaType);
  if (!schemaType) {
    throw new Error(`Invalid schema type for ${provider}. Use "openai" or "anthropic".`);
  }

  const baseUrl = variant.baseUrl ?? defaultBaseUrl(provider, schemaType);
  if (!baseUrl) {
    throw new Error(`base_url is required for provider: ${provider}`);
  }

  const model = config.llm.currentModel ?? variant.model;
  if (!model) {
    throw new Error(`model is required for provider: ${provider}`);
  }

  return {
    provider,
    schemaType,
    model,
    temperature: variant.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: variant.maxTokens ?? DEFAULT_MAX_TOKENS,
    apiKey: variant.apiKey ?? (variant.apiKeyEnv ? process.env[variant.apiKeyEnv] : undefined),
    apiKeyEnv: variant.apiKeyEnv,
    baseUrl,
  };
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
