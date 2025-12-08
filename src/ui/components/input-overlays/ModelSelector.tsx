import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ModelSelectorProps {
  onSubmit: (model: string, provider: 'groq' | 'anthropic' | 'gemini') => void;
  onCancel: () => void;
  currentModel?: string;
  currentProvider?: 'groq' | 'anthropic' | 'gemini';
}

const GROQ_MODELS = [
  { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 09-05', description: 'Enhanced coding capabilities' },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', description: 'Fast, capable, and cheap model' },
  { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B', description: 'Fastest and cheapest model' },
  { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', description: '' },
  { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', description: '' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', description: '' },
];

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most capable for complex work and deep reasoning' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Smartest model for complex agents and coding' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fastest model with near-frontier intelligence' },
  { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', description: 'Specialized reasoning tasks' },
];

const GEMINI_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)', description: 'Latest and most capable Gemini model' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'State-of-the-art thinking model for complex problems' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Best price-performance for large scale tasks' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Fast, low-cost, high-performance' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: '1M token context window workhorse' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Fastest and most cost-efficient' },
];

const providers: Array<'groq' | 'anthropic' | 'gemini'> = ['groq', 'anthropic', 'gemini'];

export default function ModelSelector({ onSubmit, onCancel, currentModel, currentProvider = 'groq' }: ModelSelectorProps) {
  const [provider, setProvider] = useState<'groq' | 'anthropic' | 'gemini'>(currentProvider);

  const getAvailableModels = () => {
    switch (provider) {
      case 'groq':
        return GROQ_MODELS;
      case 'anthropic':
        return ANTHROPIC_MODELS;
      case 'gemini':
        return GEMINI_MODELS;
    }
  };

  const availableModels = getAvailableModels();

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const currentIndex = availableModels.findIndex(model => model.id === currentModel);
    return currentIndex >= 0 ? currentIndex : 0;
  });

  useInput((input, key) => {
    if (key.return) {
      onSubmit(availableModels[selectedIndex].id, provider);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    // Tab でプロバイダー切り替え
    if (key.tab) {
      const currentIndex = providers.indexOf(provider);
      const nextIndex = (currentIndex + 1) % providers.length;
      setProvider(providers[nextIndex]);
      setSelectedIndex(0); // リセット
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(availableModels.length - 1, prev + 1));
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>Select Model</Text>
      </Box>

      <Box marginBottom={1} flexDirection="row" gap={2}>
        <Box
          borderStyle="round"
          borderColor={provider === 'groq' ? 'cyan' : 'gray'}
          paddingX={1}
        >
          <Text color={provider === 'groq' ? 'cyan' : 'gray'} bold={provider === 'groq'}>
            Groq
          </Text>
        </Box>
        <Box
          borderStyle="round"
          borderColor={provider === 'anthropic' ? 'cyan' : 'gray'}
          paddingX={1}
        >
          <Text color={provider === 'anthropic' ? 'cyan' : 'gray'} bold={provider === 'anthropic'}>
            Anthropic
          </Text>
        </Box>
        <Box
          borderStyle="round"
          borderColor={provider === 'gemini' ? 'cyan' : 'gray'}
          paddingX={1}
        >
          <Text color={provider === 'gemini' ? 'cyan' : 'gray'} bold={provider === 'gemini'}>
            Gemini
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Choose a model for your conversation. The chat will be cleared when you switch models.
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Visit{' '}
          <Text underline>
            {provider === 'groq' ? 'https://groq.com/pricing' : provider === 'anthropic' ? 'https://anthropic.com/claude' : 'https://ai.google.dev/pricing'}
          </Text>
          {' '}for more information.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {availableModels.map((model, index) => (
          <Box key={model.id} marginBottom={index === availableModels.length - 1 ? 0 : 1}>
            <Text
              color={index === selectedIndex ? 'black' : 'white'}
              backgroundColor={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? <Text bold>{">"}</Text> : "  "} {""}
              {model.name}
              {model.id === currentModel && provider === currentProvider ? ' (current)' : ''}
            </Text>
            {index === selectedIndex && model.description && (
              <Box marginLeft={4} marginTop={0}>
                <Text color="gray" dimColor>
                  {model.description}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box>
        <Text color="gray" dimColor>
          Tab to switch provider • ↑↓ to navigate • Enter to select • Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
