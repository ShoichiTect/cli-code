package tools

import "minimal-go/internal/types"

var BashTool = types.Tool{
	Name:        "bash",
	Description: "Execute a shell command in the workspace.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"command": map[string]interface{}{
				"type":        "string",
				"description": "Shell command to run.",
			},
		},
		"required": []string{"command"},
	},
}
