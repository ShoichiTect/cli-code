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

The config uses `current_provider` and `current_model` to pick a variant.
Each variant declares a `schema_type` (`openai` or `anthropic`), plus
`api_key` or `api_key_env`, `base_url`, and optional defaults.

Notes:
- `api_key` is used first when present.
- If `api_key` is missing, `api_key_env` is treated as the name of an
  environment variable to read.
- When both are missing, the app exits with an error.

Example (Groq via OpenAI-compatible endpoint):

```
{
  "llm": {
    "current_provider": "groq",
    "current_model": "llama3-8b-8192",
    "variants": {
      "groq": {
        "schema_type": "openai",
        "api_key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1"
      }
    }
  }
}
```

Example (OpenAI):

```
{
  "llm": {
    "current_provider": "openai",
    "current_model": "gpt-4o-mini",
    "variants": {
      "openai": {
        "schema_type": "openai",
        "api_key_env": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1"
      }
    }
  }
}
```
