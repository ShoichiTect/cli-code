package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"minimal-go/internal/config"
	"minimal-go/internal/core/providers"
	"minimal-go/internal/policy"
	"minimal-go/internal/tools"
	"minimal-go/internal/types"
	"minimal-go/internal/ui"
)

type AgentCallbacks struct {
	PromptApproval func(command string) (bool, error)
	OnAutoApproved func(command string)
	OnDenied       func(command string)
	OnDebugLog     func(label string, data interface{})
}

type AgentOptions struct {
	Config        config.Config
	SystemPrompt  string
	WorkspaceRoot string
	Debug         bool
	Callbacks     AgentCallbacks
}

type Agent interface {
	RunAgentTurn() error
	AddUserMessage(content string)
	Clear()
	GetTokens() TokenUsage
	GetModel() string
}

type TokenUsage struct {
	Prompt     int
	Completion int
	Total      int
}

type agent struct {
	llmConfig     config.ResolvedLlmConfig
	provider      providers.ChatProvider
	messages      []types.Message
	sessionTokens TokenUsage
	tools         []types.Tool
	callbacks     AgentCallbacks
	workspaceRoot string
	debug         bool
	config        config.Config
}

func CreateAgent(options AgentOptions) (Agent, error) {
	llmConfig, err := config.ResolveLlmConfig(options.Config)
	if err != nil {
		return nil, err
	}

	return &agent{
		llmConfig:     llmConfig,
		provider:      providers.CreateProvider(llmConfig),
		messages:      []types.Message{{Role: types.RoleSystem, Content: options.SystemPrompt}},
		sessionTokens: TokenUsage{},
		tools:         []types.Tool{tools.BashTool},
		callbacks:     options.Callbacks,
		workspaceRoot: options.WorkspaceRoot,
		debug:         options.Debug,
		config:        options.Config,
	}, nil
}

func (a *agent) debugLog(label string, data interface{}) {
	if a.debug && a.callbacks.OnDebugLog != nil {
		a.callbacks.OnDebugLog(label, data)
	}
}

func (a *agent) handleBashTool(command string, callID string) types.Message {
	policyResult := policy.CheckPolicy(command, a.config)

	switch policyResult {
	case policy.PolicyDeny:
		if a.callbacks.OnDenied != nil {
			a.callbacks.OnDenied(command)
		}
		return types.Message{Role: types.RoleTool, ToolCallID: callID, Content: "Command denied by policy."}
	case policy.PolicyAuto:
		if a.callbacks.OnAutoApproved != nil {
			a.callbacks.OnAutoApproved(command)
		}
	default:
		approved, err := a.callbacks.PromptApproval(command)
		if err != nil || !approved {
			return types.Message{Role: types.RoleTool, ToolCallID: callID, Content: "User rejected command."}
		}
	}

	result := policy.RunBash(command, a.workspaceRoot)
	if strings.TrimSpace(result.Stdout) != "" {
		fmt.Println(strings.TrimRight(result.Stdout, "\n"))
	}
	if strings.TrimSpace(result.Stderr) != "" {
		if result.Code != 0 {
			fmt.Println(ui.Red(strings.TrimRight(result.Stderr, "\n")))
		} else {
			fmt.Println(strings.TrimRight(result.Stderr, "\n"))
		}
	}

	payload, _ := json.MarshalIndent(map[string]interface{}{
		"command":  command,
		"exitCode": result.Code,
		"stdout":   result.Stdout,
		"stderr":   result.Stderr,
	}, "", "  ")

	return types.Message{Role: types.RoleTool, ToolCallID: callID, Content: string(payload)}
}

func (a *agent) handleToolCalls(toolCalls []types.ToolCall) []types.Message {
	results := make([]types.Message, 0, len(toolCalls))
	for _, call := range toolCalls {
		if call.Name != "bash" {
			results = append(results, types.Message{
				Role:       types.RoleTool,
				ToolCallID: call.ID,
				Content:    fmt.Sprintf("Unknown tool: %s", call.Name),
			})
			continue
		}

		command := extractCommand(call.Input)
		if command == "" {
			results = append(results, types.Message{
				Role:       types.RoleTool,
				ToolCallID: call.ID,
				Content:    "No command provided.",
			})
			continue
		}

		results = append(results, a.handleBashTool(command, call.ID))
	}
	return results
}

func (a *agent) RunAgentTurn() error {
	loopCount := 0
	for {
		loopCount++
		fmt.Println(ui.Gray(fmt.Sprintf("\n─── turn %d ───\n", loopCount)))

		requestParams := providers.CreateChatParams{
			Model:       a.llmConfig.Model,
			Temperature: a.llmConfig.Temperature,
			MaxTokens:   a.llmConfig.MaxTokens,
			Messages:    a.messages,
			Tools:       a.tools,
		}
		a.debugLog("API Request", requestParams)

		response, err := a.provider.CreateChatCompletion(requestParams)
		if err != nil {
			return mapProviderError(err)
		}
		a.debugLog("API Response", response)

		if response.Usage != nil {
			a.sessionTokens.Prompt += response.Usage.PromptTokens
			a.sessionTokens.Completion += response.Usage.CompletionTokens
			a.sessionTokens.Total += response.Usage.TotalTokens
			fmt.Println(ui.Gray(fmt.Sprintf("[tokens] in:%d out:%d | session:%d", response.Usage.PromptTokens, response.Usage.CompletionTokens, a.sessionTokens.Total)))
		}

		assistant := response.Message
		content := assistant.Content
		thinking := assistant.Thinking
		toolCalls := assistant.ToolCalls
		a.debugLog("Assistant message", map[string]interface{}{"content": content, "thinking": thinking, "toolCalls": toolCalls})

		msg := types.Message{Role: types.RoleAssistant, Content: content}
		if thinking != "" {
			msg.Thinking = thinking
		}
		if len(toolCalls) > 0 {
			msg.ToolCalls = toolCalls
		}
		a.messages = append(a.messages, msg)

		if thinking != "" {
			fmt.Println(ui.Gray("─── thinking ───"))
			fmt.Println(ui.Gray(thinking))
			fmt.Println(ui.Gray("────────────────"))
		}

		if content != "" {
			fmt.Println(content)
		}

		if len(toolCalls) == 0 {
			return nil
		}

		toolResults := a.handleToolCalls(toolCalls)
		a.messages = append(a.messages, toolResults...)
	}
}

func (a *agent) AddUserMessage(content string) {
	a.messages = append(a.messages, types.Message{Role: types.RoleUser, Content: content})
}

func (a *agent) Clear() {
	if len(a.messages) > 0 {
		a.messages = a.messages[:1]
	}
}

func (a *agent) GetTokens() TokenUsage {
	return a.sessionTokens
}

func (a *agent) GetModel() string {
	return a.llmConfig.Model
}

func extractCommand(input interface{}) string {
	switch value := input.(type) {
	case string:
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(value), &parsed); err == nil {
			if cmd, ok := parsed["command"].(string); ok {
				return cmd
			}
		}
		return value
	case map[string]interface{}:
		if cmd, ok := value["command"].(string); ok {
			return cmd
		}
	default:
		return ""
	}
	return ""
}

func mapProviderError(err error) error {
	msg := err.Error()
	if strings.Contains(msg, "401") {
		return errors.New("Invalid API key.")
	}
	if strings.Contains(msg, "429") {
		return errors.New("Rate limit exceeded. Wait and retry.")
	}
	if strings.Contains(msg, "ECONNREFUSED") || strings.Contains(msg, "ENOTFOUND") {
		return errors.New("Network error. Check your connection.")
	}
	return err
}
