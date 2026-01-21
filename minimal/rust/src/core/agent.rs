use crate::config::{resolve_llm_config, Config, ResolvedLlmConfig};
use crate::core::providers::{create_provider, ChatProvider, CreateChatParams};
use crate::policy_bash::{check_policy, run_bash, PolicyResult};
use crate::tools::bash_tool;
use crate::types::{Message, Role, Tool, ToolCall};
use crate::ui;
use serde_json::{json, Value};

pub struct AgentCallbacks {
    pub prompt_approval: Box<dyn Fn(&str) -> Result<bool, String>>,
    pub on_auto_approved: Option<Box<dyn Fn(&str)>>,
    pub on_denied: Option<Box<dyn Fn(&str)>>,
    pub on_debug_log: Option<Box<dyn Fn(&str, Value)>>,
}

pub struct AgentOptions {
    pub config: Config,
    pub system_prompt: String,
    pub workspace_root: String,
    pub debug: bool,
    pub callbacks: AgentCallbacks,
}

#[derive(Clone, Debug, Default)]
pub struct TokenUsage {
    pub prompt: i32,
    pub completion: i32,
    pub total: i32,
}

pub struct Agent {
    llm_config: ResolvedLlmConfig,
    provider: Box<dyn ChatProvider>,
    messages: Vec<Message>,
    session_tokens: TokenUsage,
    tools: Vec<Tool>,
    callbacks: AgentCallbacks,
    workspace_root: String,
    debug: bool,
    config: Config,
}

impl Agent {
    pub fn new(options: AgentOptions) -> Result<Self, String> {
        let llm_config = resolve_llm_config(&options.config)?;

        Ok(Self {
            llm_config: llm_config.clone(),
            provider: create_provider(&llm_config),
            messages: vec![Message {
                role: Role::System,
                content: options.system_prompt,
                thinking: None,
                tool_call_id: None,
                tool_calls: Vec::new(),
            }],
            session_tokens: TokenUsage::default(),
            tools: vec![bash_tool()],
            callbacks: options.callbacks,
            workspace_root: options.workspace_root,
            debug: options.debug,
            config: options.config,
        })
    }

    fn debug_log(&self, label: &str, data: Value) {
        if self.debug {
            if let Some(callback) = &self.callbacks.on_debug_log {
                callback(label, data);
            }
        }
    }

    fn handle_bash_tool(&self, command: &str, call_id: &str) -> Message {
        let policy_result = check_policy(command, &self.config);

        match policy_result {
            PolicyResult::Deny => {
                if let Some(callback) = &self.callbacks.on_denied {
                    callback(command);
                }
                return Message {
                    role: Role::Tool,
                    content: "Command denied by policy.".to_string(),
                    thinking: None,
                    tool_call_id: Some(call_id.to_string()),
                    tool_calls: Vec::new(),
                };
            }
            PolicyResult::Auto => {
                if let Some(callback) = &self.callbacks.on_auto_approved {
                    callback(command);
                }
            }
            PolicyResult::Ask => {
                let approved = (self.callbacks.prompt_approval)(command);
                match approved {
                    Ok(true) => {}
                    Ok(false) | Err(_) => {
                        return Message {
                            role: Role::Tool,
                            content: "User rejected command.".to_string(),
                            thinking: None,
                            tool_call_id: Some(call_id.to_string()),
                            tool_calls: Vec::new(),
                        };
                    }
                }
            }
        }

        let result = run_bash(command, &self.workspace_root);
        if !result.stdout.trim().is_empty() {
            println!("{}", result.stdout.trim_end());
        }
        if !result.stderr.trim().is_empty() {
            if result.code != 0 {
                println!("{}", ui::red(result.stderr.trim_end()));
            } else {
                println!("{}", result.stderr.trim_end());
            }
        }

        let payload = json!({
            "command": command,
            "exitCode": result.code,
            "stdout": result.stdout,
            "stderr": result.stderr,
        });

        Message {
            role: Role::Tool,
            content: serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string()),
            thinking: None,
            tool_call_id: Some(call_id.to_string()),
            tool_calls: Vec::new(),
        }
    }

    fn handle_tool_calls(&self, tool_calls: &[ToolCall]) -> Vec<Message> {
        let mut results = Vec::new();
        for call in tool_calls {
            if call.name != "bash" {
                results.push(Message {
                    role: Role::Tool,
                    content: format!("Unknown tool: {}", call.name),
                    thinking: None,
                    tool_call_id: Some(call.id.clone()),
                    tool_calls: Vec::new(),
                });
                continue;
            }

            let command = extract_command(&call.input);
            if command.is_empty() {
                results.push(Message {
                    role: Role::Tool,
                    content: "No command provided.".to_string(),
                    thinking: None,
                    tool_call_id: Some(call.id.clone()),
                    tool_calls: Vec::new(),
                });
                continue;
            }

            results.push(self.handle_bash_tool(&command, &call.id));
        }
        results
    }

    pub fn run_agent_turn(&mut self) -> Result<(), String> {
        let mut loop_count = 0;
        loop {
            loop_count += 1;
            println!("\n--- turn {} ---\n", loop_count);

            let request_params = CreateChatParams {
                model: self.llm_config.model.clone(),
                temperature: self.llm_config.temperature,
                max_tokens: self.llm_config.max_tokens,
                messages: self.messages.clone(),
                tools: self.tools.clone(),
            };

            self.debug_log(
                "API Request",
                serde_json::to_value(&request_params).unwrap_or(json!({})),
            );

            let response = self
                .provider
                .create_chat_completion(request_params)
                .map_err(map_provider_error)?;

            self.debug_log(
                "API Response",
                serde_json::to_value(&response).unwrap_or(json!({})),
            );

            if let Some(usage) = &response.usage {
                self.session_tokens.prompt += usage.prompt_tokens;
                self.session_tokens.completion += usage.completion_tokens;
                self.session_tokens.total += usage.total_tokens;
                println!(
                    "{}",
                    ui::gray(&format!(
                        "[tokens] in:{} out:{} | session:{}",
                        usage.prompt_tokens, usage.completion_tokens, self.session_tokens.total
                    ))
                );
            }

            let assistant = response.message.clone();
            let content = assistant.content.clone();
            let thinking = assistant.thinking.clone().unwrap_or_default();
            let tool_calls = assistant.tool_calls.clone();

            self.debug_log(
                "Assistant message",
                json!({
                    "content": content,
                    "thinking": thinking,
                    "tool_calls": tool_calls,
                }),
            );

            self.messages.push(assistant.clone());

            if !thinking.is_empty() {
                println!("{}", ui::gray("--- thinking ---"));
                println!("{}", ui::gray(&thinking));
                println!("{}", ui::gray("---------------"));
            }

            if !content.is_empty() {
                println!("{}", content);
            }

            if tool_calls.is_empty() {
                return Ok(());
            }

            let tool_results = self.handle_tool_calls(&tool_calls);
            self.messages.extend(tool_results);
        }
    }

    pub fn add_user_message(&mut self, content: String) {
        self.messages.push(Message {
            role: Role::User,
            content,
            thinking: None,
            tool_call_id: None,
            tool_calls: Vec::new(),
        });
    }

    pub fn clear(&mut self) {
        if !self.messages.is_empty() {
            self.messages.truncate(1);
        }
    }

    pub fn get_tokens(&self) -> TokenUsage {
        self.session_tokens.clone()
    }

    pub fn get_model(&self) -> String {
        self.llm_config.model.clone()
    }
}

fn extract_command(input: &Value) -> String {
    match input {
        Value::String(value) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(value) {
                if let Some(cmd) = parsed.get("command").and_then(|v| v.as_str()) {
                    return cmd.to_string();
                }
            }
            value.clone()
        }
        Value::Object(map) => map
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

fn map_provider_error(err: String) -> String {
    if err.contains("401") {
        return "Invalid API key.".to_string();
    }
    if err.contains("429") {
        return "Rate limit exceeded. Wait and retry.".to_string();
    }
    if err.contains("ECONNREFUSED") || err.contains("ENOTFOUND") {
        return "Network error. Check your connection.".to_string();
    }
    err
}
