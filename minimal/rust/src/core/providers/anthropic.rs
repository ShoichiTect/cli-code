use crate::config::ResolvedLlmConfig;
use crate::core::providers::{ChatProvider, ChatResponse, CreateChatParams};
use crate::types::{Message, Role, Tool, ToolCall, Usage};
use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

pub struct AnthropicProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
    provider_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AnthropicTextBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<HashMap<String, String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: i32,
    temperature: f64,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    system: Vec<AnthropicTextBlock>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    tools: Vec<AnthropicTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<HashMap<String, String>>,
    stream: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicTextBlock>,
    usage: Option<AnthropicUsage>,
    error: Option<AnthropicError>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AnthropicUsage {
    input_tokens: i32,
    output_tokens: i32,
}

#[derive(Clone, Debug, Deserialize)]
struct AnthropicError {
    message: Option<String>,
}

impl AnthropicProvider {
    pub fn new(cfg: &ResolvedLlmConfig) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key: cfg.api_key.clone(),
            base_url: normalize_anthropic_base_url(&cfg.base_url),
            provider_name: cfg.provider.clone(),
        }
    }
}

impl ChatProvider for AnthropicProvider {
    fn create_chat_completion(&self, params: CreateChatParams) -> Result<ChatResponse, String> {
        let (mut system_blocks, messages) =
            to_anthropic_messages(&params.messages, self.provider_name != "minimax");
        let tools_summary = serde_json::to_string_pretty(&params.tools)
            .unwrap_or_else(|_| "[]".to_string());

        system_blocks.push(AnthropicTextBlock {
            block_type: "text".to_string(),
            text: Some(format_tools_summary(!system_blocks.is_empty(), &tools_summary)),
            thinking: None,
            id: None,
            tool_use_id: None,
            name: None,
            input: None,
            content: None,
            cache_control: Some(HashMap::from([(
                "type".to_string(),
                "ephemeral".to_string(),
            )])),
        });

        let request_params = AnthropicRequest {
            model: params.model.clone(),
            max_tokens: params.max_tokens,
            temperature: params.temperature,
            system: system_blocks,
            messages,
            tools: to_anthropic_tools(&params.tools),
            tool_choice: Some(HashMap::from([(String::from("type"), String::from("auto"))])),
            stream: false,
        };

        let payload = serde_json::to_vec(&request_params)
            .map_err(|err| format!("Failed to encode request: {}", err))?;

        let endpoint = Url::parse(&self.base_url)
            .and_then(|base| base.join("v1/messages"))
            .map_err(|err| format!("Invalid base_url: {}", err))?;

        let mut req = self
            .client
            .post(endpoint)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01");

        if let Some(api_key) = &self.api_key {
            req = req.header("x-api-key", api_key.clone());
        }

        if self.provider_name == "anthropic" || self.provider_name == "minimax" {
            req = req.header("anthropic-beta", "prompt-caching-2024-07-31");
        }

        let resp = req
            .body(payload)
            .send()
            .map_err(|err| format!("Request failed: {}", err))?;

        let status = resp.status();
        let body = resp
            .text()
            .map_err(|err| format!("Failed to read response: {}", err))?;

        let decoded: AnthropicResponse = serde_json::from_str(&body)
            .map_err(|err| format!("Invalid response: {}", err))?;

        if !status.is_success() {
            if let Some(err) = decoded.error.and_then(|e| e.message) {
                return Err(format!("{} (status {})", err, status.as_u16()));
            }
            return Err(format!("request failed with status {}", status.as_u16()));
        }

        if let Some(err) = decoded.error.and_then(|e| e.message) {
            return Err(err);
        }

        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut thinking_parts: Vec<String> = Vec::new();
        let mut text_parts: Vec<String> = Vec::new();

        for block in &decoded.content {
            match block.block_type.as_str() {
                "thinking" => {
                    if let Some(thinking) = &block.thinking {
                        thinking_parts.push(thinking.clone());
                    }
                }
                "text" => {
                    if let Some(text) = &block.text {
                        text_parts.push(text.clone());
                    }
                }
                "tool_use" => {
                    if let (Some(id), Some(name), Some(input)) =
                        (&block.id, &block.name, &block.input)
                    {
                        tool_calls.push(ToolCall {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                    }
                }
                _ => {}
            }
        }

        let mut message = Message {
            role: Role::Assistant,
            content: text_parts.join(""),
            thinking: None,
            tool_call_id: None,
            tool_calls: Vec::new(),
        };

        if !thinking_parts.is_empty() {
            message.thinking = Some(thinking_parts.join(""));
        }

        if !tool_calls.is_empty() {
            message.tool_calls = tool_calls;
        }

        let (usage, raw_usage) = match decoded.usage {
            Some(usage) => {
                let raw = serde_json::to_value(&usage).unwrap_or(json!({}));
                (
                    Some(Usage {
                        prompt_tokens: usage.input_tokens,
                        completion_tokens: usage.output_tokens,
                        total_tokens: usage.input_tokens + usage.output_tokens,
                    }),
                    Some(raw),
                )
            }
            None => (None, None),
        };

        let mut headers = HashMap::new();
        if self.provider_name == "anthropic" || self.provider_name == "minimax" {
            headers.insert(
                "anthropic-beta".to_string(),
                "prompt-caching-2024-07-31".to_string(),
            );
        }

        Ok(ChatResponse {
            message,
            usage,
            raw_usage,
            raw_request: serde_json::to_value(&request_params).unwrap_or(json!({})),
            raw_headers: if headers.is_empty() { None } else { Some(headers) },
        })
    }
}

fn normalize_anthropic_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if let Some(stripped) = trimmed.strip_suffix("/v1") {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

fn to_anthropic_tools(tools: &[Tool]) -> Vec<AnthropicTool> {
    tools
        .iter()
        .map(|tool| AnthropicTool {
            name: tool.name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
        })
        .collect()
}

fn to_anthropic_messages(
    messages: &[Message],
    enable_message_cache: bool,
) -> (Vec<AnthropicTextBlock>, Vec<AnthropicMessage>) {
    let mut system_parts = Vec::new();
    for message in messages {
        if message.role == Role::System {
            system_parts.push(message.content.clone());
        }
    }
    let system_text = system_parts.join("\n\n").trim().to_string();
    let mut system_blocks = Vec::new();
    if !system_text.is_empty() {
        system_blocks.push(AnthropicTextBlock {
            block_type: "text".to_string(),
            text: Some(system_text),
            thinking: None,
            id: None,
            tool_use_id: None,
            name: None,
            input: None,
            content: None,
            cache_control: Some(HashMap::from([(
                "type".to_string(),
                "ephemeral".to_string(),
            )])),
        });
    }

    let filtered: Vec<Message> = messages
        .iter()
        .filter(|message| message.role != Role::System)
        .cloned()
        .collect();

    let mut last_cacheable_index: isize = -1;
    for (index, message) in filtered.iter().enumerate().rev() {
        if message.role != Role::Assistant {
            last_cacheable_index = index as isize;
            break;
        }
    }

    let mut out = Vec::new();
    for (index, message) in filtered.iter().enumerate() {
        let is_last_cacheable = index as isize == last_cacheable_index;
        let should_cache = enable_message_cache && is_last_cacheable;

        match message.role {
            Role::Tool => {
                let mut block = AnthropicTextBlock {
                    block_type: "tool_result".to_string(),
                    text: None,
                    thinking: None,
                    id: None,
                    tool_use_id: message.tool_call_id.clone(),
                    name: None,
                    input: None,
                    content: Some(Value::String(message.content.clone())),
                    cache_control: None,
                };
                if should_cache {
                    block.cache_control = Some(HashMap::from([(
                        "type".to_string(),
                        "ephemeral".to_string(),
                    )]));
                }

                out.push(AnthropicMessage {
                    role: "user".to_string(),
                    content: Value::Array(vec![serde_json::to_value(block).unwrap_or(json!({}))]),
                });
            }
            Role::Assistant => {
                if !message.tool_calls.is_empty() {
                    let mut content = Vec::new();
                    if !message.content.is_empty() {
                        content.push(serde_json::to_value(AnthropicTextBlock {
                            block_type: "text".to_string(),
                            text: Some(message.content.clone()),
                            thinking: None,
                            id: None,
                            tool_use_id: None,
                            name: None,
                            input: None,
                            content: None,
                            cache_control: None,
                        })
                        .unwrap_or(json!({})));
                    }
                    for call in &message.tool_calls {
                        content.push(serde_json::to_value(AnthropicTextBlock {
                            block_type: "tool_use".to_string(),
                            text: None,
                            thinking: None,
                            id: Some(call.id.clone()),
                            tool_use_id: None,
                            name: Some(call.name.clone()),
                            input: Some(call.input.clone()),
                            content: None,
                            cache_control: None,
                        })
                        .unwrap_or(json!({})));
                    }

                    out.push(AnthropicMessage {
                        role: "assistant".to_string(),
                        content: Value::Array(content),
                    });
                } else {
                    out.push(AnthropicMessage {
                        role: "assistant".to_string(),
                        content: Value::String(message.content.clone()),
                    });
                }
            }
            Role::User | Role::System => {
                if should_cache && message.role == Role::User {
                    let block = AnthropicTextBlock {
                        block_type: "text".to_string(),
                        text: Some(message.content.clone()),
                        thinking: None,
                        id: None,
                        tool_use_id: None,
                        name: None,
                        input: None,
                        content: None,
                        cache_control: Some(HashMap::from([(
                            "type".to_string(),
                            "ephemeral".to_string(),
                        )])),
                    };

                    out.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: Value::Array(vec![serde_json::to_value(block).unwrap_or(json!({}))]),
                    });
                } else {
                    out.push(AnthropicMessage {
                        role: match message.role {
                            Role::User => "user".to_string(),
                            Role::System => "system".to_string(),
                            Role::Assistant => "assistant".to_string(),
                            Role::Tool => "tool".to_string(),
                        },
                        content: Value::String(message.content.clone()),
                    });
                }
            }
        }
    }

    (system_blocks, out)
}

fn format_tools_summary(has_system: bool, tools_summary: &str) -> String {
    if has_system {
        format!("\n\n## Available Tools\n\n{}", tools_summary)
    } else {
        format!("## Available Tools\n\n{}", tools_summary)
    }
}
