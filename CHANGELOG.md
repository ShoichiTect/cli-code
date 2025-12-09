# Changelog

## Unreleased

- refactor: デフォルトシステムプロンプトを「コード分析・学習支援エージェント」に変更
  - 役割を「コード実装」から「コードベース調査・分析・デバッグ支援・学習支援」に変更
  - ユーザーの理解を優先し、修正前に方針・理由を説明して許可を取るフローに
  - 複数の解決策がある場合はトレードオフを含めて提示
  - 「なぜ」を常に意識した説明スタイルに
- fix: create_tasks と update_tasks ツールを完全削除
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
- bacbc3f refactor: Embed default prompt and use ~/.config/cli-code/prompts/ for user prompts
- 992d8c5 fix: remove deprecated command definitions and related files
- e7d216d fix: extensive test and utils cleanup

## [0.1.1] - 2025-12-08

- 08c7be6 Refactor cli-utils: remove fzf dependency and improve number selection UI
