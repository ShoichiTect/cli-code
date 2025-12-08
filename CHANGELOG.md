# Changelog

## Unreleased

- feat: Add /prompt command and improve prompt management
  - `/prompt <name>` コマンドで `~/.config/cli-code/prompts/<name>.txt` からユーザープロンプトを読み込んで送信
  - デフォルトシステムプロンプトをコードに埋め込み（ビルド時に含まれる）
  - `/help` に `/prompt` コマンドを追加
  - `src/prompts/` ディレクトリを削除
- 670aca0 Improve multiline input handling and display newlines
- 324fed5 fix
- e12bc7d chore: update changelog with recent commits and cleanup,author:Assistant <assistant@example.com>
- 974d7ff chore: Remove docs directory with groq-code assets
- 59f1f0b refactor: Remove React Ink UI, rename to CLI Code

## [0.1.1] - 2025-12-08

- 08c7be6 Refactor cli-utils: remove fzf dependency and improve number selection UI
