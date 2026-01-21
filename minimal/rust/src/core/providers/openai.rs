use crate::config::ResolvedLlmConfig;
use crate::types::{Message, Role, Tool, ToolCall, Usage};
use crate::core::providers::{ChatProvider, ChatResponse, CreateChatParams};
use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub struct OpenAIProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    tool_calls: Vec<OpenAIToolCall>,
}

#[derive(Serialize, Deserialize)]
struct OpenAIToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: OpenAIToolFunction,
}

#[derive(Serialize, Deserialize)]
struct OpenAIToolFunction {
    name: String,
    arguments: String,
}

#[derive(Serialize)]
struct OpenAITool {
    #[serde(rename = "type")]
    tool_type: String,
    function: OpenAIToolSchema,
}

#[derive(Serialize)]
struct OpenAIToolSchema {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    temperature: f64,
    max_tokens: i32,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    tools: Vec<OpenAITool>,
    tool_choice: String,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
    error: Option<OpenAIError>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Deserialize)]
struct OpenAIResponseMessage {
    role: String,
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAIToolCall>,
}

#[derive(Deserialize, Serialize)]
struct OpenAIUsage {
    prompt_tokens: i32,
    completion_tokens: i32,
    total_tokens: i32,
}

#[derive(Deserialize)]
struct OpenAIError {
    message: Option<String>,
}

impl OpenAIProvider {
    pub fn new(cfg: &ResolvedLlmConfig) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key: cfg.api_key.clone(),
            base_url: cfg.base_url.clone(),
        }
    }
}

impl ChatProvider for OpenAIProvider {
    fn create_chat_completion(&self, params: CreateChatParams) -> Result<ChatResponse, String> {
        let request_params = OpenAIRequest {
            model: params.model.clone(),
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            messages: to_openai_messages(&params.messages),
            tools: to_openai_tools(&params.tools),
            tool_choice: "auto".to_string(),
        };

        let payload = serde_json::to_vec(&request_params)
            .map_err(|err| format!("Failed to encode request: {}", err))?;

        let endpoint = Url::parse(&self.base_url)
            .and_then(|base| base.join("chat/completions"))
            .map_err(|err| format!("Invalid base_url: {}", err))?;

        let mut req = self
            .client
            .post(endpoint)
            .header("Content-Type", "application/json");

        if let Some(api_key) = &self.api_key {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        let resp = req
            .body(payload)
            .send()
            .map_err(|err| format!("Request failed: {}", err))?;

        let status = resp.status();
        let body = resp
            .text()
            .map_err(|err| format!("Failed to read response: {}", err))?;

        let decoded: OpenAIResponse = serde_json::from_str(&body)
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

        let mut message = Message {
            role: Role::Assistant,
            content: String::new(),
            thinking: None,
            tool_call_id: None,
            tool_calls: Vec::new(),
        };

        let mut tool_calls: Vec<ToolCall> = Vec::new();
        if let Some(choice) = decoded.choices.first() {
            message.content = choice.message.content.clone().unwrap_or_default();
            for call in &choice.message.tool_calls {
                if call.call_type != "function" {
                    continue;
                }
                tool_calls.push(ToolCall {
                    id: call.id.clone(),
                    name: call.function.name.clone(),
                    input: parse_tool_input(&call.function.arguments),
                });
            }
        }

        if !tool_calls.is_empty() {
            message.tool_calls = tool_calls;
        }

        let (usage, raw_usage) = match decoded.usage {
            Some(usage) => {
                let raw = serde_json::to_value(&usage).unwrap_or(json!({}));
                (
                    Some(Usage {
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                    }),
                    Some(raw),
                )
            }
            None => (None, None),
        };

        Ok(ChatResponse {
            message,
            usage,
            raw_usage,
            raw_request: serde_json::to_value(&request_params).unwrap_or(json!({})),
            raw_headers: None,
        })
    }
}

fn to_openai_tools(tools: &[Tool]) -> Vec<OpenAITool> {
    tools
        .iter()
        .map(|tool| OpenAITool {
            tool_type: "function".to_string(),
            function: OpenAIToolSchema {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: tool.input_schema.clone(),
            },
        })
        .collect()
}

fn to_openai_messages(messages: &[Message]) -> Vec<OpenAIMessage> {
    let mut result = Vec::new();
    for message in messages {
        match message.role {
            Role::Tool => {
                result.push(OpenAIMessage {
                    role: "tool".to_string(),
                    content: message.content.clone(),
                    tool_call_id: message.tool_call_id.clone(),
                    tool_calls: Vec::new(),
                });
            }
            Role::Assistant => {
                if !message.tool_calls.is_empty() {
                    let mut calls = Vec::new();
                    for call in &message.tool_calls {
                        let args = serde_json::to_string(&call.input).unwrap_or("{}".to_string());
                        calls.push(OpenAIToolCall {
                            id: call.id.clone(),
                            call_type: "function".to_string(),
                            function: OpenAIToolFunction {
                                name: call.name.clone(),
                                arguments: args,
                            },
                        });
                    }
                    result.push(OpenAIMessage {
                        role: "assistant".to_string(),
                        content: message.content.clone(),
                        tool_call_id: None,
                        tool_calls: calls,
                    });
                } else {
                    result.push(OpenAIMessage {
                        role: "assistant".to_string(),
                        content: message.content.clone(),
                        tool_call_id: None,
                        tool_calls: Vec::new(),
                    });
                }
            }
            _ => {
                result.push(OpenAIMessage {
                    role: match message.role {
                        Role::System => "system".to_string(),
                        Role::User => "user".to_string(),
                        Role::Assistant => "assistant".to_string(),
                        Role::Tool => "tool".to_string(),
                    },
                    content: message.content.clone(),
                    tool_call_id: None,
                    tool_calls: Vec::new(),
                });
            }
        }
    }

    result
}

fn parse_tool_input(raw: &str) -> Value {
    if raw.is_empty() {
        return json!({});
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}
