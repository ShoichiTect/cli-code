package providers

import (
	"minimal-go/internal/config"
	"minimal-go/internal/types"
)

type CreateChatParams struct {
	Model       string
	Temperature float64
	MaxTokens   int
	Messages    []types.Message
	Tools       []types.Tool
}

type ChatResponse struct {
	Message    types.Message
	Usage      *types.Usage
	RawUsage   interface{}
	RawRequest interface{}
	RawHeaders map[string]string
}

type ChatProvider interface {
	CreateChatCompletion(params CreateChatParams) (ChatResponse, error)
}

func CreateProvider(cfg config.ResolvedLlmConfig) ChatProvider {
	if cfg.SchemaType == config.SchemaAnthropic {
		return NewAnthropicProvider(cfg)
	}
	return NewOpenAIProvider(cfg)
}
