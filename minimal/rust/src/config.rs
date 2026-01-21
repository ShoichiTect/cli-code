use serde::Deserialize;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SchemaType {
    OpenAI,
    Anthropic,
}

#[derive(Clone, Debug)]
pub struct LlmVariant {
    pub schema_type: SchemaType,
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct LlmConfig {
    pub current_provider: String,
    pub current_model: Option<String>,
    pub variants: std::collections::HashMap<String, LlmVariant>,
}

#[derive(Clone, Debug)]
pub struct PolicyConfig {
    pub default_action: String,
    pub deny_patterns: Vec<String>,
    pub auto_commands: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub llm: LlmConfig,
    pub policy: PolicyConfig,
}

#[derive(Clone, Debug)]
pub struct ResolvedLlmConfig {
    pub provider: String,
    pub schema_type: SchemaType,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: i32,
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
    pub base_url: String,
}

const DEFAULT_TEMPERATURE: f64 = 0.7;
const DEFAULT_MAX_TOKENS: i32 = 4096;

pub fn minimal_dir() -> PathBuf {
    let home = env::var("HOME").unwrap_or_default();
    Path::new(&home).join(".minimal")
}

pub fn config_path() -> PathBuf {
    minimal_dir().join("config.json")
}

pub fn system_md_path() -> PathBuf {
    minimal_dir().join("system.md")
}

pub fn skills_dir() -> PathBuf {
    minimal_dir().join("skills")
}

pub fn default_config() -> Config {
    let mut variants = std::collections::HashMap::new();
    variants.insert(
        "groq".to_string(),
        LlmVariant {
            schema_type: SchemaType::OpenAI,
            api_key: None,
            api_key_env: Some("GROQ_API_KEY".to_string()),
            base_url: Some("https://api.groq.com/openai/v1".to_string()),
            model: None,
            temperature: Some(DEFAULT_TEMPERATURE),
            max_tokens: Some(DEFAULT_MAX_TOKENS),
        },
    );

    Config {
        llm: LlmConfig {
            current_provider: "groq".to_string(),
            current_model: Some("moonshotai/kimi-k2-instruct".to_string()),
            variants,
        },
        policy: PolicyConfig {
            default_action: "ask".to_string(),
            deny_patterns: Vec::new(),
            auto_commands: Vec::new(),
        },
    }
}

fn normalize_schema_type(value: &str) -> Option<SchemaType> {
    match value {
        "openai" => Some(SchemaType::OpenAI),
        "anthropic" => Some(SchemaType::Anthropic),
        _ => None,
    }
}

fn default_base_url(provider: &str, schema_type: &SchemaType) -> Option<String> {
    match schema_type {
        SchemaType::OpenAI => match provider {
            "openai" => Some("https://api.openai.com/v1".to_string()),
            "groq" => Some("https://api.groq.com/openai/v1".to_string()),
            "deepseek" => Some("https://api.deepseek.com".to_string()),
            _ => None,
        },
        SchemaType::Anthropic => match provider {
            "anthropic" => Some("https://api.anthropic.com".to_string()),
            "minimax" => Some("https://api.minimax.io/anthropic".to_string()),
            _ => None,
        },
    }
}

#[derive(Default, Deserialize)]
struct RawVariant {
    #[serde(rename = "schema_type")]
    schema_type: Option<String>,
    #[serde(rename = "schemaType")]
    schema_type_camel: Option<String>,
    #[serde(rename = "api_key")]
    api_key: Option<String>,
    #[serde(rename = "apiKey")]
    api_key_camel: Option<String>,
    #[serde(rename = "api_key_env")]
    api_key_env: Option<String>,
    #[serde(rename = "apiKeyEnv")]
    api_key_env_camel: Option<String>,
    #[serde(rename = "base_url")]
    base_url: Option<String>,
    #[serde(rename = "baseUrl")]
    base_url_camel: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    #[serde(rename = "max_tokens")]
    max_tokens: Option<i32>,
    #[serde(rename = "maxTokens")]
    max_tokens_camel: Option<i32>,
}

#[derive(Default, Deserialize)]
struct RawLlm {
    #[serde(rename = "current_provider")]
    current_provider: Option<String>,
    #[serde(rename = "currentProvider")]
    current_provider_camel: Option<String>,
    #[serde(rename = "current_model")]
    current_model: Option<String>,
    #[serde(rename = "currentModel")]
    current_model_camel: Option<String>,
    variants: Option<std::collections::HashMap<String, RawVariant>>,
}

#[derive(Default, Deserialize)]
struct RawConfig {
    llm: Option<RawLlm>,
    policy: Option<RawPolicy>,
}

#[derive(Default, Deserialize)]
struct RawPolicy {
    #[serde(rename = "defaultAction")]
    default_action: Option<String>,
    #[serde(rename = "default_action")]
    default_action_snake: Option<String>,
    #[serde(rename = "denyPatterns")]
    deny_patterns: Option<Vec<String>>,
    #[serde(rename = "deny_patterns")]
    deny_patterns_snake: Option<Vec<String>>,
    #[serde(rename = "autoCommands")]
    auto_commands: Option<Vec<String>>,
    #[serde(rename = "auto_commands")]
    auto_commands_snake: Option<Vec<String>>,
}

fn normalize_variants(
    variants: std::collections::HashMap<String, RawVariant>,
) -> std::collections::HashMap<String, LlmVariant> {
    let mut normalized = std::collections::HashMap::new();
    for (name, variant) in variants {
        let schema_value = variant
            .schema_type
            .or(variant.schema_type_camel)
            .unwrap_or_default();
        let Some(schema_type) = normalize_schema_type(schema_value.as_str()) else {
            continue;
        };

        let api_key = variant.api_key.or(variant.api_key_camel);
        let api_key_env = variant.api_key_env.or(variant.api_key_env_camel);
        let base_url = variant.base_url.or(variant.base_url_camel);
        let max_tokens = variant.max_tokens.or(variant.max_tokens_camel);

        normalized.insert(
            name,
            LlmVariant {
                schema_type,
                api_key,
                api_key_env,
                base_url,
                model: variant.model,
                temperature: variant.temperature,
                max_tokens,
            },
        );
    }
    normalized
}

fn normalize_config(raw: RawConfig) -> Result<Config, String> {
    let defaults = default_config();
    let policy = match raw.policy {
        Some(policy) => PolicyConfig {
            default_action: policy
                .default_action
                .or(policy.default_action_snake)
                .unwrap_or_else(|| defaults.policy.default_action.clone()),
            deny_patterns: policy
                .deny_patterns
                .or(policy.deny_patterns_snake)
                .unwrap_or_else(|| defaults.policy.deny_patterns.clone()),
            auto_commands: policy
                .auto_commands
                .or(policy.auto_commands_snake)
                .unwrap_or_else(|| defaults.policy.auto_commands.clone()),
        },
        None => defaults.policy,
    };

    let llm = raw.llm.unwrap_or_default();

    let current_provider = llm
        .current_provider
        .or(llm.current_provider_camel)
        .unwrap_or_else(|| defaults.llm.current_provider.clone());

    let current_model = llm
        .current_model
        .or(llm.current_model_camel)
        .or(defaults.llm.current_model);

    let variants_raw = llm.variants.unwrap_or_default();
    let variants = normalize_variants(variants_raw);

    if variants.is_empty() {
        return Err("llm.variants is required in config.json".to_string());
    }

    Ok(Config {
        llm: LlmConfig {
            current_provider,
            current_model,
            variants,
        },
        policy,
    })
}

pub fn load_config() -> Result<Config, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(default_config());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read config.json: {}", err))?;

    let parsed: RawConfig = serde_json::from_str(&raw)
        .map_err(|err| format!("Invalid config.json: {}", err))?;

    normalize_config(parsed)
}

pub fn resolve_llm_config(config: &Config) -> Result<ResolvedLlmConfig, String> {
    let provider = config.llm.current_provider.clone();
    let Some(variant) = config.llm.variants.get(&provider) else {
        return Err(format!("Unknown provider: {}", provider));
    };

    let schema_type = variant.schema_type.clone();
    let base_url = variant
        .base_url
        .clone()
        .or_else(|| default_base_url(&provider, &schema_type))
        .ok_or_else(|| format!("base_url is required for provider: {}", provider))?;

    let model = config
        .llm
        .current_model
        .clone()
        .or_else(|| variant.model.clone())
        .ok_or_else(|| format!("model is required for provider: {}", provider))?;

    let api_key = match (&variant.api_key, &variant.api_key_env) {
        (Some(value), _) => Some(value.clone()),
        (None, Some(env_key)) if !env_key.is_empty() => env::var(env_key).ok(),
        _ => None,
    };

    let temperature = variant.temperature.unwrap_or(DEFAULT_TEMPERATURE);
    let max_tokens = variant.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);

    Ok(ResolvedLlmConfig {
        provider,
        schema_type,
        model,
        temperature,
        max_tokens,
        api_key,
        api_key_env: variant.api_key_env.clone(),
        base_url,
    })
}

pub fn load_system_prompt() -> Result<String, String> {
    let data = std::fs::read_to_string(system_md_path())
        .map_err(|_| "~/.minimal/system.md not found or empty.".to_string())?;
    let content = data.trim();
    if content.is_empty() {
        return Err("~/.minimal/system.md is empty".to_string());
    }
    Ok(content.to_string())
}

pub fn ensure_minimal_dir() -> Result<(), String> {
    if minimal_dir().exists() {
        Ok(())
    } else {
        Err("~/.minimal directory not found.".to_string())
    }
}
