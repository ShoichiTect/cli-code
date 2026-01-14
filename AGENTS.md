# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript source. Entry point is `src/core/main.ts`, with core CLI logic in `src/core/`.
- Provider integrations live in `src/core/providers/`.
- Tools and tool schemas are in `src/tools/`.
- Shared utilities live in `src/utils/` (for example `src/utils/proxy-config.ts`).
- Tests live under `test/` with `test/unit/` mirroring `src/` and `test/integration/` for provider flows.
- Build output goes to `dist/`; coverage reports go to `coverage/`.

## Build, Test, and Development Commands
- `npm run build`: compile TypeScript to `dist/`.
- `npm run dev`: watch mode TypeScript build for local development.
- `npm run lint` / `npm run lint:fix`: run ESLint (fixes on `lint:fix`).
- `npm run format`: format with Prettier.
- `npm test`: run unit tests only (Vitest).
- `npm run test:integration`: run integration tests.
- `npm run test:all`: run all tests (CI-style).
- `npm run test:coverage`: generate coverage report.

## Coding Style & Naming Conventions
- Language: TypeScript (ES2022, ESM). Keep modules in `.ts` and avoid CommonJS patterns.
- Formatting: follow Prettier (`npm run format`) and ESLint (`npm run lint`).
- Filenames are kebab-case (for example `src/utils/tool-schema-converter.ts`).
- Functions and variables use `camelCase`; classes use `PascalCase`.

## Testing Guidelines
- Framework: Vitest (see `test/README.md` for strategy). Coverage target is 80%.
- Test files use `{filename}.test.ts` and mirror the source path, e.g. `src/utils/markdown.ts` → `test/unit/utils/markdown.test.ts`.
- New test files should include the TSDoc header pattern described in `test/README.md`.

## Commit & Pull Request Guidelines
- Recent commits follow a conventional prefix like `test:`, `docs:`, or `chore:`. Use `type: short summary` when possible.
- Keep commits focused and write imperative, specific messages.
- PRs should include a concise description, testing notes (commands and results), and any linked issues. Screenshots are usually unnecessary for this CLI.

## Security & Configuration Tips
- API keys are stored in `~/.groq/` by the CLI or provided via environment variables (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).
- Proxy support uses `--proxy`, `HTTPS_PROXY`, or `HTTP_PROXY` (in that order).
- Test secrets belong in `.env.test` (gitignored).
