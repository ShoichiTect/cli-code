use crate::types::Tool;
use serde_json::json;

pub fn bash_tool() -> Tool {
    Tool {
        name: "bash".to_string(),
        description: "Execute a shell command in the workspace.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to run."
                }
            },
            "required": ["command"]
        }),
    }
}
