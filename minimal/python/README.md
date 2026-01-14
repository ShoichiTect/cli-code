# Mini Python Agent

Minimal Groq CLI agent with bash tool calls and approval flow.

## Setup (uv recommended)

1) Install with uv:
```
cd minimal/python
uv tool install -e .
```

2) Ensure the tool path is on PATH (run once):
```
uv tool update-shell
```

3) Set your API key:
```
export GROQ_API_KEY="your-key"
```

4) Run:
```
mini-py
```

## Notes

- The app reads `.env` in the current directory and `~/.zshrc` for env vars.
- `WORKSPACE_ROOT` controls the directory for shell commands (default: current dir).
- To uninstall: `uv tool uninstall mini-py`.
