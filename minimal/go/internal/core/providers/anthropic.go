package providers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"minimal-go/internal/config"
	"minimal-go/internal/types"
)

type anthropicProvider struct {
	client       *http.Client
	apiKey       string
	baseURL      string
	providerName string
}

type anthropicTextBlock struct {
	Type         string                 `json:"type"`
	Text         string                 `json:"text,omitempty"`
	Thinking     string                 `json:"thinking,omitempty"`
	ID           string                 `json:"id,omitempty"`
	ToolUseID    string                 `json:"tool_use_id,omitempty"`
	Name         string                 `json:"name,omitempty"`
	Input        interface{}            `json:"input,omitempty"`
	Content      interface{}            `json:"content,omitempty"`
	CacheControl map[string]interface{} `json:"cache_control,omitempty"`
}

type anthropicMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type anthropicTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

type anthropicRequest struct {
	Model       string               `json:"model"`
	MaxTokens   int                  `json:"max_tokens"`
	Temperature float64              `json:"temperature"`
	System      []anthropicTextBlock `json:"system,omitempty"`
	Messages    []anthropicMessage   `json:"messages"`
	Tools       []anthropicTool      `json:"tools,omitempty"`
	ToolChoice  map[string]string    `json:"tool_choice,omitempty"`
	Stream      bool                 `json:"stream"`
}

type anthropicResponse struct {
	Content []anthropicTextBlock `json:"content"`
	Usage   *struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func NewAnthropicProvider(cfg config.ResolvedLlmConfig) ChatProvider {
	return &anthropicProvider{
		client:       &http.Client{Timeout: 60 * time.Second},
		apiKey:       cfg.APIKey,
		baseURL:      normalizeAnthropicBaseURL(cfg.BaseURL),
		providerName: cfg.Provider,
	}
}

func (p *anthropicProvider) CreateChatCompletion(params CreateChatParams) (ChatResponse, error) {
	systemBlocks, messages := toAnthropicMessages(params.Messages, p.providerName != "minimax")
	toolsSummary, _ := json.MarshalIndent(params.Tools, "", "  ")
	systemBlocks = append(systemBlocks, anthropicTextBlock{
		Type: "text",
		Text: formatToolsSummary(len(systemBlocks) > 0, toolsSummary),
		CacheControl: map[string]interface{}{
			"type": "ephemeral",
		},
	})

	requestParams := anthropicRequest{
		Model:       params.Model,
		MaxTokens:   params.MaxTokens,
		Temperature: params.Temperature,
		System:      systemBlocks,
		Messages:    messages,
		Tools:       toAnthropicTools(params.Tools),
		ToolChoice:  map[string]string{"type": "auto"},
		Stream:      false,
	}

	payload, err := json.Marshal(requestParams)
	if err != nil {
		return ChatResponse{}, err
	}

	endpoint, err := url.JoinPath(p.baseURL, "v1", "messages")
	if err != nil {
		return ChatResponse{}, err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(payload))
	if err != nil {
		return ChatResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	if p.providerName == "anthropic" || p.providerName == "minimax" {
		req.Header.Set("anthropic-beta", "prompt-caching-2024-07-31")
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChatResponse{}, err
	}

	var decoded anthropicResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return ChatResponse{}, err
	}
	if resp.StatusCode >= 300 {
		if decoded.Error != nil && decoded.Error.Message != "" {
			return ChatResponse{}, fmt.Errorf("%s (status %d)", decoded.Error.Message, resp.StatusCode)
		}
		return ChatResponse{}, fmt.Errorf("request failed with status %d", resp.StatusCode)
	}
	if decoded.Error != nil {
		return ChatResponse{}, fmt.Errorf(decoded.Error.Message)
	}

	message := types.Message{Role: types.RoleAssistant, Content: ""}
	var toolCalls []types.ToolCall
	var thinkingParts []string
	var textParts []string

	for _, block := range decoded.Content {
		switch block.Type {
		case "thinking":
			thinkingParts = append(thinkingParts, block.Thinking)
		case "text":
			textParts = append(textParts, block.Text)
		case "tool_use":
			toolCalls = append(toolCalls, types.ToolCall{
				ID:    block.ID,
				Name:  block.Name,
				Input: block.Input,
			})
		}
	}

	message.Content = strings.Join(textParts, "")
	if len(thinkingParts) > 0 {
		message.Thinking = strings.Join(thinkingParts, "")
	}
	if len(toolCalls) > 0 {
		message.ToolCalls = toolCalls
	}

	var usage *types.Usage
	if decoded.Usage != nil {
		usage = &types.Usage{
			PromptTokens:     decoded.Usage.InputTokens,
			CompletionTokens: decoded.Usage.OutputTokens,
			TotalTokens:      decoded.Usage.InputTokens + decoded.Usage.OutputTokens,
		}
	}

	headers := map[string]string{}
	if p.providerName == "anthropic" || p.providerName == "minimax" {
		headers["anthropic-beta"] = "prompt-caching-2024-07-31"
	}

	return ChatResponse{
		Message:    message,
		Usage:      usage,
		RawUsage:   decoded.Usage,
		RawRequest: requestParams,
		RawHeaders: headers,
	}, nil
}

func normalizeAnthropicBaseURL(baseURL string) string {
	trimmed := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(trimmed, "/v1") {
		return strings.TrimSuffix(trimmed, "/v1")
	}
	return trimmed
}

func toAnthropicTools(tools []types.Tool) []anthropicTool {
	result := make([]anthropicTool, 0, len(tools))
	for _, tool := range tools {
		result = append(result, anthropicTool{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: tool.InputSchema,
		})
	}
	return result
}

func toAnthropicMessages(messages []types.Message, enableMessageCache bool) ([]anthropicTextBlock, []anthropicMessage) {
	var systemParts []string
	for _, message := range messages {
		if message.Role == types.RoleSystem {
			systemParts = append(systemParts, message.Content)
		}
	}
	systemText := strings.TrimSpace(strings.Join(systemParts, "\n\n"))
	var systemBlocks []anthropicTextBlock
	if systemText != "" {
		systemBlocks = append(systemBlocks, anthropicTextBlock{
			Type: "text",
			Text: systemText,
			CacheControl: map[string]interface{}{
				"type": "ephemeral",
			},
		})
	}

	filtered := make([]types.Message, 0, len(messages))
	for _, message := range messages {
		if message.Role != types.RoleSystem {
			filtered = append(filtered, message)
		}
	}

	lastCacheableIndex := -1
	for i := len(filtered) - 1; i >= 0; i-- {
		if filtered[i].Role != types.RoleAssistant {
			lastCacheableIndex = i
			break
		}
	}

	var out []anthropicMessage
	for i, message := range filtered {
		isLastCacheable := i == lastCacheableIndex
		shouldCache := enableMessageCache && isLastCacheable

		switch message.Role {
		case types.RoleTool:
			content := []anthropicTextBlock{
				{
					Type:      "tool_result",
					Content:   message.Content,
					ToolUseID: message.ToolCallID,
				},
			}
			if shouldCache {
				content[0].CacheControl = map[string]interface{}{"type": "ephemeral"}
			}
			out = append(out, anthropicMessage{Role: "user", Content: content})
		case types.RoleAssistant:
			if len(message.ToolCalls) > 0 {
				content := []anthropicTextBlock{}
				if message.Content != "" {
					content = append(content, anthropicTextBlock{Type: "text", Text: message.Content})
				}
				for _, call := range message.ToolCalls {
					content = append(content, anthropicTextBlock{
						Type:  "tool_use",
						ID:    call.ID,
						Name:  call.Name,
						Input: call.Input,
					})
				}
				out = append(out, anthropicMessage{Role: "assistant", Content: content})
			} else {
				out = append(out, anthropicMessage{Role: "assistant", Content: message.Content})
			}
		default:
			if shouldCache && message.Role == types.RoleUser {
				content := []anthropicTextBlock{
					{
						Type: "text",
						Text: message.Content,
						CacheControl: map[string]interface{}{
							"type": "ephemeral",
						},
					},
				}
				out = append(out, anthropicMessage{Role: "user", Content: content})
			} else {
				out = append(out, anthropicMessage{Role: string(message.Role), Content: message.Content})
			}
		}
	}

	return systemBlocks, out
}

func formatToolsSummary(hasSystem bool, toolsSummary []byte) string {
	if hasSystem {
		return fmt.Sprintf("\n\n## Available Tools\n\n%s", string(toolsSummary))
	}
	return fmt.Sprintf("## Available Tools\n\n%s", string(toolsSummary))
}
