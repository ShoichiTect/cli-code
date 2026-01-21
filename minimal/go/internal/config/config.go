package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type SchemaType string

const (
	SchemaOpenAI    SchemaType = "openai"
	SchemaAnthropic SchemaType = "anthropic"
)

type LlmVariant struct {
	SchemaType  SchemaType
	APIKey      string
	APIKeyEnv   string
	BaseURL     string
	Model       string
	Temperature float64
	MaxTokens   int
}

type LlmConfig struct {
	CurrentProvider string
	CurrentModel    string
	Variants        map[string]LlmVariant
}

type PolicyConfig struct {
	DefaultAction string   `json:"defaultAction"`
	DenyPatterns  []string `json:"denyPatterns"`
	AutoCommands  []string `json:"autoCommands"`
}

type Config struct {
	LLM    LlmConfig
	Policy PolicyConfig
}

type ResolvedLlmConfig struct {
	Provider    string
	SchemaType  SchemaType
	Model       string
	Temperature float64
	MaxTokens   int
	APIKey      string
	APIKeyEnv   string
	BaseURL     string
}

const (
	defaultTemperature = 0.7
	defaultMaxTokens   = 4096
)

var (
	MinimalDir   = filepath.Join(userHomeDir(), ".minimal")
	ConfigPath   = filepath.Join(MinimalDir, "config.json")
	SystemMDPath = filepath.Join(MinimalDir, "system.md")
	SkillsDir    = filepath.Join(MinimalDir, "skills")
)

func DefaultConfig() Config {
	return Config{
		LLM: LlmConfig{
			CurrentProvider: "groq",
			CurrentModel:    "moonshotai/kimi-k2-instruct",
			Variants: map[string]LlmVariant{
				"groq": {
					SchemaType:  SchemaOpenAI,
					APIKeyEnv:   "GROQ_API_KEY",
					BaseURL:     "https://api.groq.com/openai/v1",
					Temperature: defaultTemperature,
					MaxTokens:   defaultMaxTokens,
				},
			},
		},
		Policy: PolicyConfig{
			DefaultAction: "ask",
			DenyPatterns:  []string{},
			AutoCommands:  []string{},
		},
	}
}

func normalizeSchemaType(value string) (SchemaType, bool) {
	switch value {
	case string(SchemaOpenAI):
		return SchemaOpenAI, true
	case string(SchemaAnthropic):
		return SchemaAnthropic, true
	default:
		return "", false
	}
}

func defaultBaseURL(provider string, schemaType SchemaType) string {
	if schemaType == SchemaOpenAI {
		switch provider {
		case "openai":
			return "https://api.openai.com/v1"
		case "groq":
			return "https://api.groq.com/openai/v1"
		case "deepseek":
			return "https://api.deepseek.com"
		}
	}
	if schemaType == SchemaAnthropic {
		switch provider {
		case "anthropic":
			return "https://api.anthropic.com"
		case "minimax":
			return "https://api.minimax.io/anthropic"
		}
	}
	return ""
}

type rawVariant struct {
	SchemaType      string  `json:"schema_type"`
	SchemaTypeCamel string  `json:"schemaType"`
	APIKey          string  `json:"api_key"`
	APIKeyCamel     string  `json:"apiKey"`
	APIKeyEnv       string  `json:"api_key_env"`
	APIKeyEnvCamel  string  `json:"apiKeyEnv"`
	BaseURL         string  `json:"base_url"`
	BaseURLCamel    string  `json:"baseUrl"`
	Model           string  `json:"model"`
	Temperature     float64 `json:"temperature"`
	MaxTokens       int     `json:"max_tokens"`
	MaxTokensCamel  int     `json:"maxTokens"`
}

type rawLLM struct {
	CurrentProvider      string                `json:"current_provider"`
	CurrentProviderCamel string                `json:"currentProvider"`
	CurrentModel         string                `json:"current_model"`
	CurrentModelCamel    string                `json:"currentModel"`
	Variants             map[string]rawVariant `json:"variants"`
}

type rawConfig struct {
	LLM    rawLLM       `json:"llm"`
	Policy PolicyConfig `json:"policy"`
}

func normalizeVariants(variants map[string]rawVariant) map[string]LlmVariant {
	normalized := map[string]LlmVariant{}
	for name, variant := range variants {
		schemaValue := variant.SchemaType
		if schemaValue == "" {
			schemaValue = variant.SchemaTypeCamel
		}
		schemaType, ok := normalizeSchemaType(schemaValue)
		if !ok {
			continue
		}

		apiKey := variant.APIKey
		if apiKey == "" {
			apiKey = variant.APIKeyCamel
		}
		apiKeyEnv := variant.APIKeyEnv
		if apiKeyEnv == "" {
			apiKeyEnv = variant.APIKeyEnvCamel
		}
		baseURL := variant.BaseURL
		if baseURL == "" {
			baseURL = variant.BaseURLCamel
		}
		maxTokens := variant.MaxTokens
		if maxTokens == 0 {
			maxTokens = variant.MaxTokensCamel
		}

		normalized[name] = LlmVariant{
			SchemaType:  schemaType,
			APIKey:      apiKey,
			APIKeyEnv:   apiKeyEnv,
			BaseURL:     baseURL,
			Model:       variant.Model,
			Temperature: variant.Temperature,
			MaxTokens:   maxTokens,
		}
	}

	return normalized
}

func normalizeConfig(raw rawConfig) (Config, error) {
	defaults := DefaultConfig()
	policy := defaults.Policy
	if raw.Policy.DefaultAction != "" {
		policy.DefaultAction = raw.Policy.DefaultAction
	}
	if raw.Policy.DenyPatterns != nil {
		policy.DenyPatterns = raw.Policy.DenyPatterns
	}
	if raw.Policy.AutoCommands != nil {
		policy.AutoCommands = raw.Policy.AutoCommands
	}

	currentProvider := raw.LLM.CurrentProvider
	if currentProvider == "" {
		currentProvider = raw.LLM.CurrentProviderCamel
	}
	if currentProvider == "" {
		currentProvider = defaults.LLM.CurrentProvider
	}

	currentModel := raw.LLM.CurrentModel
	if currentModel == "" {
		currentModel = raw.LLM.CurrentModelCamel
	}

	variants := normalizeVariants(raw.LLM.Variants)
	if len(variants) == 0 {
		return Config{}, errors.New("llm.variants is required in config.json")
	}

	return Config{
		LLM: LlmConfig{
			CurrentProvider: currentProvider,
			CurrentModel:    currentModel,
			Variants:        variants,
		},
		Policy: policy,
	}, nil
}

func LoadConfig() (Config, error) {
	if _, err := os.Stat(ConfigPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfig(), nil
		}
		return Config{}, err
	}

	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return Config{}, err
	}

	var raw rawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return Config{}, fmt.Errorf("invalid config.json: %w", err)
	}

	return normalizeConfig(raw)
}

func ResolveLlmConfig(config Config) (ResolvedLlmConfig, error) {
	provider := config.LLM.CurrentProvider
	variant, ok := config.LLM.Variants[provider]
	if !ok {
		return ResolvedLlmConfig{}, fmt.Errorf("unknown provider: %s", provider)
	}

	schemaType, ok := normalizeSchemaType(string(variant.SchemaType))
	if !ok {
		return ResolvedLlmConfig{}, fmt.Errorf("invalid schema type for %s. Use \"openai\" or \"anthropic\"", provider)
	}

	baseURL := variant.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL(provider, schemaType)
	}
	if baseURL == "" {
		return ResolvedLlmConfig{}, fmt.Errorf("base_url is required for provider: %s", provider)
	}

	model := config.LLM.CurrentModel
	if model == "" {
		model = variant.Model
	}
	if model == "" {
		return ResolvedLlmConfig{}, fmt.Errorf("model is required for provider: %s", provider)
	}

	apiKey := variant.APIKey
	if apiKey == "" && variant.APIKeyEnv != "" {
		apiKey = os.Getenv(variant.APIKeyEnv)
	}

	temperature := variant.Temperature
	if temperature == 0 {
		temperature = defaultTemperature
	}
	maxTokens := variant.MaxTokens
	if maxTokens == 0 {
		maxTokens = defaultMaxTokens
	}

	return ResolvedLlmConfig{
		Provider:    provider,
		SchemaType:  schemaType,
		Model:       model,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		APIKey:      apiKey,
		APIKeyEnv:   variant.APIKeyEnv,
		BaseURL:     baseURL,
	}, nil
}

func LoadSystemPrompt() (string, error) {
	data, err := os.ReadFile(SystemMDPath)
	if err != nil {
		return "", err
	}
	content := strings.TrimSpace(string(data))
	if content == "" {
		return "", errors.New("~/.minimal/system.md is empty")
	}
	return content, nil
}

func EnsureMinimalDir() error {
	if _, err := os.Stat(MinimalDir); err != nil {
		return err
	}
	return nil
}

func userHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}
