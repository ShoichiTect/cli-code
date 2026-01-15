# Mini TypeScript Agent

Minimal CLI agent with bash tool calls, approval flow, and OpenAI-compatible providers.

## Setup

1. Install dependencies:

```
cd minimal/typescript
npm install
```

2. Build:

```
npm run build
```

3. Link and run globally:

```
npm link
mini-ts
```

## Notes

- The app reads `.env` from the current directory.
- `WORKSPACE_ROOT` controls the directory for shell commands (default: current dir).
- The app requires `~/.minimal/system.md` and optional `~/.minimal/config.json`.

## Config

Create `~/.minimal/system.md` with your system prompt, and optionally
`~/.minimal/config.json` to select provider/model settings.

Example (Groq via OpenAI-compatible endpoint):

```
{
  "llm": {
    "provider": "groq",
    "model": "llama3-8b-8192",
    "apiKeyEnv": "GROQ_API_KEY",
    "baseUrl": "https://api.groq.com/openai/v1"
  }
}
```

Example (OpenAI):

```
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "OPENAI_API_KEY",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```
