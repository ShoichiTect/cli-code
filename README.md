# CLI Code

A lightweight, terminal-based coding CLI forked from groq-code-cli. This version uses standard terminal I/O instead of React Ink for a simpler, more portable implementation.

## Overview

CLI Code is a streamlined version of groq-code-cli that replaces the React Ink TUI with standard terminal input/output. This makes it:

- **Lighter** - No React/Ink dependencies
- **More portable** - Works in any terminal environment
- **Easier to customize** - Simpler codebase to understand and modify


## Installation

### For Development
```bash
git clone <your-repo-url>
cd cli-code
npm install
npm run build
npm link        # Enables the `cli` command in any directory
```

```bash
# Run this in the background during development to automatically apply any changes to the source code
npm run dev
```

## Usage
```bash
# Start chat session
cli
```

### Command Line Options

```bash
cli [options]

Options:
  -t, --temperature <temp>      Temperature for generation (default: 1)
  -s, --system <message>        Custom system message
  -d, --debug                   Enable debug logging to debug-agent.log in current directory
  -p, --proxy <url>             Proxy URL (e.g. http://proxy:8080 or socks5://proxy:1080)
  -h, --help                    Display help
  -V, --version                 Display version number
```

### Authentication

On first use, start a chat with `cli` and type the `/login` command to configure your API key.

You can choose between **Groq**, **Anthropic**, or **Gemini** as your AI provider:

- **Groq**: Get your API key from the [Groq Console](https://console.groq.com/keys)
- **Anthropic**: Get your API key from the [Anthropic Console](https://console.anthropic.com/keys)
- **Gemini**: Get your API key from [Google AI Studio](https://aistudio.google.com/apikey)

This creates a .groq/ folder in your home directory that stores your API keys, default model selection, and any other config you wish to add.

You can also set your API keys via environment variables:
```bash
export GROQ_API_KEY=your_groq_api_key_here
export ANTHROPIC_API_KEY=your_anthropic_api_key_here
export GEMINI_API_KEY=your_gemini_api_key_here
```

### Proxy Configuration

Supports HTTP/HTTPS/SOCKS5 proxies via CLI flag or environment variables:

```bash
# CLI flag (highest priority)
cli --proxy http://proxy:8080
cli --proxy socks5://proxy:1080

# Environment variables
export HTTP_PROXY=http://proxy:8080
export HTTPS_PROXY=socks5://proxy:1080
```

Priority: `--proxy` > `HTTPS_PROXY` > `HTTP_PROXY`

### Available Commands
- `/help` - Show help and available commands
- `/login` - Set API key for a provider
- `/model` - Switch AI provider and select model
- `/clear` - Clear chat history and context
- `/stats` - Display session statistics and token usage


## Development

### Testing Locally
```bash
# Run this in the background during development to automatically apply any changes to the source code
npm run dev
```

### Available Scripts
```bash
npm run build      # Build TypeScript to dist/
npm run dev        # Build in watch mode
```

### Project Structure

```
cli-code/
├── src/
│   ├── commands/
│   │   ├── definitions/        # Individual command implementations
│   │   ├── base.ts             # Base command interface
│   │   └── index.ts            # Command exports
│   ├── core/
│   │   ├── agent.ts            # AI agent implementation
│   │   ├── cli-simple.ts       # CLI entry point
│   │   ├── simple-cli.ts       # Main CLI class (terminal I/O)
│   │   ├── cli-utils.ts        # CLI utility functions (fzf, spinner, etc.)
│   │   └── diff-utils.ts       # Diff display utilities
│   ├── tools/
│   │   ├── tool-schemas.ts     # Tool schema definitions
│   │   ├── tools.ts            # Tool implementations
│   │   ├── security-filter.ts  # Security filtering for tool execution
│   │   └── validators.ts       # Input validation utilities
│   └── utils/
│       ├── constants.ts        # Application constants
│       ├── file-ops.ts         # File system operations
│       ├── local-settings.ts   # Local configuration management
│       ├── markdown.ts         # Markdown processing utilities
│       └── tool-schema-converter.ts # Convert tool schemas between provider formats
├── package.json
├── tsconfig.json
└── LICENSE
```

**TL;DR:** Start with `src/core/cli-simple.ts` (entry point) and `src/core/simple-cli.ts` (main CLI class). The agent logic is in `src/core/agent.ts`. Tools are in `src/tools/`.

## Multi-Provider Support

The CLI supports multiple AI providers. Use `/model` to switch between them:

### Supported Providers & Models

**Groq:**
- moonshotai/kimi-k2-instruct
- meta-llama/llama-4-maverick-17b-128e-instruct
- qwen/qwen3-32b
- deepseek-r1-distill-llama-70b
- llama-3.3-70b-versatile
- llama-3.1-8b-instant

**Anthropic:**
- claude-opus-4-5-20251101
- claude-sonnet-4-5-20250514
- claude-3-5-haiku-20241022

**Gemini:**
- gemini-2.5-pro
- gemini-2.5-flash
- gemini-2.0-flash
- gemini-2.0-flash-lite

## Customization

#### Adding New Tools

Tools are AI-callable functions that extend the CLI's capabilities. To add a new tool:

1. **Define the tool schema** in `src/tools/tool-schemas.ts`:
```typescript
export const YOUR_TOOL_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'your_tool_name',
    description: 'What your tool does',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Parameter description' }
      },
      required: ['param1']
    }
  }
};
```

2. **Implement the tool function** in `src/tools/tools.ts`:
```typescript
export async function yourToolName(param1: string): Promise<ToolResult> {
  // Your implementation here
  return createToolResponse(true, result, 'Success message');
}
```

3. **Register the tool** in the `TOOL_REGISTRY` object and `executeTool` switch statement in `src/tools/tools.ts`.

4. **Add the schema** to `ALL_TOOL_SCHEMAS` array in `src/tools/tool-schemas.ts`.

#### Changing Start Command
To change the start command from `cli`, change `"cli"` in `"bin"` of `package.json` to your global command of choice.

Re-run `npm run build` and `npm link`.

## Differences from groq-code-cli

This project is forked from [groq-code-cli](https://github.com/build-with-groq/groq-code-cli) with the following changes:

- **Removed React Ink** - Uses standard terminal I/O via readline instead of React Ink TUI
- **Simplified dependencies** - No React, Ink, or related packages
- **Added Gemini support** - Google's Gemini models are now available as a provider
- **fzf integration** - Model selection uses fzf for fuzzy finding (falls back to numbered list)

## License

MIT
