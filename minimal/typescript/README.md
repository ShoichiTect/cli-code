# Mini TypeScript Agent

Minimal Groq CLI agent with bash tool calls and approval flow.

## Setup

1) Install dependencies:
```
cd minimal/typescript
npm install
```

2) Build:
```
npm run build
```

3) Link and run globally:
```
npm link
mini-ts
```

## Notes

- The app reads `.env` from the current directory.
- `WORKSPACE_ROOT` controls the directory for shell commands (default: current dir).
