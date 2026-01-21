package providers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"minimal-go/internal/config"
	"minimal-go/internal/types"
)

type openAIProvider struct {
	client  *http.Client
	apiKey  string
	baseURL string
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIToolFunction `json:"function"`
}

type openAIToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openAITool struct {
	Type     string           `json:"type"`
	Function openAIToolSchema `json:"function"`
}

type openAIToolSchema struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

type openAIRequest struct {
	Model       string          `json:"model"`
	Temperature float64         `json:"temperature"`
	MaxTokens   int             `json:"max_tokens"`
	Messages    []openAIMessage `json:"messages"`
	Tools       []openAITool    `json:"tools,omitempty"`
	ToolChoice  string          `json:"tool_choice,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message struct {
			Role      string           `json:"role"`
			Content   string           `json:"content"`
			ToolCalls []openAIToolCall `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

func NewOpenAIProvider(cfg config.ResolvedLlmConfig) ChatProvider {
	return &openAIProvider{
		client:  &http.Client{Timeout: 60 * time.Second},
		apiKey:  cfg.APIKey,
		baseURL: cfg.BaseURL,
	}
}

func (p *openAIProvider) CreateChatCompletion(params CreateChatParams) (ChatResponse, error) {
	requestParams := openAIRequest{
		Model:       params.Model,
		Temperature: params.Temperature,
		MaxTokens:   params.MaxTokens,
		Messages:    toOpenAIMessages(params.Messages),
		Tools:       toOpenAITools(params.Tools),
		ToolChoice:  "auto",
	}

	payload, err := json.Marshal(requestParams)
	if err != nil {
		return ChatResponse{}, err
	}

	endpoint, err := url.JoinPath(p.baseURL, "chat", "completions")
	if err != nil {
		return ChatResponse{}, err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(payload))
	if err != nil {
		return ChatResponse{}, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", p.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChatResponse{}, err
	}

	var decoded openAIResponse
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
	if len(decoded.Choices) > 0 {
		choice := decoded.Choices[0]
		message.Content = choice.Message.Content
		for _, call := range choice.Message.ToolCalls {
			if call.Type != "function" {
				continue
			}
			toolCalls = append(toolCalls, types.ToolCall{
				ID:    call.ID,
				Name:  call.Function.Name,
				Input: parseToolInput(call.Function.Arguments),
			})
		}
	}
	if len(toolCalls) > 0 {
		message.ToolCalls = toolCalls
	}

	var usage *types.Usage
	if decoded.Usage != nil {
		usage = &types.Usage{
			PromptTokens:     decoded.Usage.PromptTokens,
			CompletionTokens: decoded.Usage.CompletionTokens,
			TotalTokens:      decoded.Usage.TotalTokens,
		}
	}

	return ChatResponse{
		Message:    message,
		Usage:      usage,
		RawUsage:   decoded.Usage,
		RawRequest: requestParams,
	}, nil
}

func toOpenAITools(tools []types.Tool) []openAITool {
	result := make([]openAITool, 0, len(tools))
	for _, tool := range tools {
		result = append(result, openAITool{
			Type: "function",
			Function: openAIToolSchema{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  tool.InputSchema,
			},
		})
	}
	return result
}

func toOpenAIMessages(messages []types.Message) []openAIMessage {
	result := make([]openAIMessage, 0, len(messages))
	for _, message := range messages {
		switch message.Role {
		case types.RoleTool:
			result = append(result, openAIMessage{
				Role:       "tool",
				ToolCallID: message.ToolCallID,
				Content:    message.Content,
			})
		case types.RoleAssistant:
			if len(message.ToolCalls) > 0 {
				calls := make([]openAIToolCall, 0, len(message.ToolCalls))
				for _, call := range message.ToolCalls {
					args, _ := json.Marshal(call.Input)
					calls = append(calls, openAIToolCall{
						ID:   call.ID,
						Type: "function",
						Function: openAIToolFunction{
							Name:      call.Name,
							Arguments: string(args),
						},
					})
				}
				result = append(result, openAIMessage{
					Role:      "assistant",
					Content:   message.Content,
					ToolCalls: calls,
				})
			} else {
				result = append(result, openAIMessage{
					Role:    "assistant",
					Content: message.Content,
				})
			}
		default:
			result = append(result, openAIMessage{
				Role:    string(message.Role),
				Content: message.Content,
			})
		}
	}
	return result
}

func parseToolInput(raw string) interface{} {
	if raw == "" {
		return map[string]interface{}{}
	}
	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	return parsed
}
