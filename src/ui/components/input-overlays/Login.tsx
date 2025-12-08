import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface LoginProps {
  onSubmit: (apiKey: string, provider: 'groq' | 'anthropic' | 'gemini') => void;
  onCancel: () => void;
  initialProvider?: 'groq' | 'anthropic' | 'gemini';
}

const providers: Array<'groq' | 'anthropic' | 'gemini'> = ['groq', 'anthropic', 'gemini'];

export default function Login({ onSubmit, onCancel, initialProvider = 'groq' }: LoginProps) {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'groq' | 'anthropic' | 'gemini'>(initialProvider);

  useInput((input, key) => {
    if (key.return) {
      if (apiKey.trim()) {
        onSubmit(apiKey.trim(), provider);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    // 左右矢印でプロバイダー切り替え
    if (key.leftArrow) {
      const currentIndex = providers.indexOf(provider);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : providers.length - 1;
      setProvider(providers[newIndex]);
      return;
    }

    if (key.rightArrow) {
      const currentIndex = providers.indexOf(provider);
      const newIndex = currentIndex < providers.length - 1 ? currentIndex + 1 : 0;
      setProvider(providers[newIndex]);
      return;
    }

    if (key.backspace || key.delete) {
      setApiKey(prev => prev.slice(0, -1));
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    // Regular character input
    if (input && !key.meta && !key.ctrl) {
      setApiKey(prev => prev + input);
    }
  });

  const providerInfo = {
    groq: {
      name: 'Groq',
      url: 'https://console.groq.com/keys',
      keyPrefix: 'gsk_'
    },
    anthropic: {
      name: 'Anthropic',
      url: 'https://console.anthropic.com/settings/keys',
      keyPrefix: 'sk-ant-'
    },
    gemini: {
      name: 'Gemini',
      url: 'https://aistudio.google.com/apikey',
      keyPrefix: 'AIza'
    }
  };

  const currentInfo = providerInfo[provider];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>Login with API Key</Text>
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
        <Text color="gray">
          Enter your {currentInfo.name} API key. Get one from{' '}
          <Text underline>{currentInfo.url}</Text>
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="cyan">API Key: </Text>
        <Text>
          {'*'.repeat(Math.min(apiKey.length, 20))}
          {apiKey.length > 20 && '...'}
        </Text>
        <Text backgroundColor="cyan" color="cyan">▌</Text>
      </Box>

      <Box>
        <Text color="gray" dimColor>
          Use ← → to switch provider • Enter to submit • Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
