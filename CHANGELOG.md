# Changelog

## Unreleased

- 7cc3852 feat: Add /prompt command and externalize system prompts
  - `/prompt <name>` コマンドで `src/prompts/<name>.txt` からプロンプトを読み込んで送信
  - デフォルトシステムプロンプトを `src/prompts/default-system-prompt.txt` に外部化
  - `/help` に `/prompt` コマンドを追加
- 670aca0 Improve multiline input handling and display newlines
- 324fed5 fix
- e12bc7d chore: update changelog with recent commits and cleanup,author:Assistant <assistant@example.com>
- 974d7ff chore: Remove docs directory with groq-code assets
- 59f1f0b refactor: Remove React Ink UI, rename to CLI Code

## [0.1.1] - 2025-12-08

- 08c7be6 Refactor cli-utils: remove fzf dependency and improve number selection UI
