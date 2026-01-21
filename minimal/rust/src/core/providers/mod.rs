use serde::Serialize;
use serde_json::Value;

use crate::config::{ResolvedLlmConfig, SchemaType};
use crate::types::{Message, Tool, Usage};

mod anthropic;
mod openai;

#[derive(Clone, Debug, Serialize)]
pub struct CreateChatParams {
    pub model: String,
    pub temperature: f64,
    pub max_tokens: i32,
    pub messages: Vec<Message>,
    pub tools: Vec<Tool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatResponse {
    pub message: Message,
    pub usage: Option<Usage>,
    pub raw_usage: Option<Value>,
    pub raw_request: Value,
    pub raw_headers: Option<std::collections::HashMap<String, String>>,
}

pub trait ChatProvider {
    fn create_chat_completion(&self, params: CreateChatParams) -> Result<ChatResponse, String>;
}

pub fn create_provider(cfg: &ResolvedLlmConfig) -> Box<dyn ChatProvider> {
    match cfg.schema_type {
        SchemaType::Anthropic => Box::new(anthropic::AnthropicProvider::new(cfg)),
        SchemaType::OpenAI => Box::new(openai::OpenAIProvider::new(cfg)),
    }
}
