# テスト方針

## 概要

- **フレームワーク**: Vitest v3.0.0
- **カバレッジ目標**: 80%
- **カバレッジプロバイダー**: v8

## ディレクトリ構造

```
test/
├── README.md           # このファイル
├── fixtures/           # テスト用ファイル（読み込みテスト等）
├── mocks/              # 共通モック（fs, API clients等）
├── helpers/            # テストユーティリティ
├── unit/               # ユニットテスト（src/をミラー）
│   ├── core/
│   ├── utils/
│   └── tools/
└── integration/        # 統合テスト
    └── providers/
```

## 実行コマンド

| コマンド | 説明 |
|----------|------|
| `npm test` | ユニットテストのみ実行 |
| `npm run test:integration` | 統合テストのみ実行 |
| `npm run test:all` | 全テスト実行（CI用） |
| `npm run test:watch` | ウォッチモード |
| `npm run test:coverage` | カバレッジレポート生成 |

## 命名規則

- テストファイル: `{filename}.test.ts`
- 例: `src/utils/markdown.ts` → `test/unit/utils/markdown.test.ts`

## テスト優先順位

| 優先度 | 対象 | 理由 |
|--------|------|------|
| **高** | `security-filter.ts` | 純粋関数、セキュリティ上重要 |
| **高** | `tool-schema-converter.ts` | 純粋関数、プロバイダー間変換 |
| **高** | `markdown.ts` | 純粋関数 |
| **中** | `tools.ts` | ツール実行、fsモック必要 |
| **中** | `local-settings.ts` | 設定管理、fsモック必要 |
| **低** | `agent.ts` | 複雑、統合テストで対応 |

## モック戦略

### ファイルシステム

```typescript
import {vi} from 'vitest';
import fs from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    // ...
  },
}));
```

### 外部API（Groq, Anthropic, Gemini）

統合テストではAPIクライアントをモックする。

```typescript
vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{message: {content: 'mocked response'}}],
        }),
      },
    },
  })),
}));
```

### ConfigManager

```typescript
vi.mock('../utils/local-settings.js', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    getApiKey: vi.fn().mockReturnValue('test-api-key'),
    // ...
  })),
}));
```

## 環境変数

テスト用の環境変数は `.env.test` で管理する（.gitignoreに追加済み）。

```bash
# .env.test（例）
GROQ_API_KEY=test-key
ANTHROPIC_API_KEY=test-key
GEMINI_API_KEY=test-key
```

## テストの書き方

### 基本構造

```typescript
import {describe, it, expect, beforeEach, vi} from 'vitest';

describe('関数名/クラス名', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('メソッド名/シナリオ', () => {
    it('期待する動作の説明', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = targetFunction(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### 純粋関数のテスト例

```typescript
// test/unit/utils/markdown.test.ts
import {describe, it, expect} from 'vitest';
import {parseMarkdown} from '../../../src/utils/markdown.js';

describe('parseMarkdown', () => {
  it('コードブロックをパースする', () => {
    const input = '```\ncode\n```';
    const result = parseMarkdown(input);

    expect(result).toContainEqual({
      type: 'code-block',
      content: 'code',
    });
  });
});
```

## TSDocによるテストドキュメント

テストファイルの先頭にTSDocを記述し、対象モジュールの概要・テスト設計・実装判断の根拠を記録する。

### 目的

1. **知識の保存**: なぜこのテスト設計にしたかの意図を残す
2. **オンボーディング**: 新規メンバーがテストの意図を理解しやすくする
3. **メンテナンス性**: 将来の変更時に設計意図を参照できる

### 必須セクション

```typescript
/**
 * @fileoverview {対象ファイル名} のユニットテスト
 *
 * ## 対象モジュールの概要
 * - モジュールの責務
 * - エクスポート関数の一覧
 * - 内部ヘルパー関数の一覧（テスト対象外でも記載）
 *
 * ## テスト設計方針
 * - モック戦略と選択理由
 * - テストカテゴリ構成（正常系/異常系/境界値）
 * - 各関数のテスト詳細（テーブル形式推奨）
 *
 * ## 実装判断の根拠
 * - Q&A形式で「なぜこの実装にしたか」を記録
 * - トレードオフや代替案があれば記載
 *
 * ## 今後の拡張案（任意）
 * - 将来追加すべきテストケース
 * - 既知の制限事項
 *
 * @module test/unit/{path}/{filename}.test
 * @author {作成者}
 * @see {@link src/{path}/{filename}.ts} 対象モジュール
 */
```

### テーブル記法の活用

複数のテストケースを整理する際はMarkdownテーブルを使用:

```typescript
/**
 * ### isDangerousFile テスト詳細
 *
 * | テストグループ | 目的 | テスト例 |
 * |----------------|------|----------|
 * | safe files | 通常ファイルが許可される | `src/index.ts` |
 * | .env files | 環境変数がブロックされる | `.env`, `.env.local` |
 */
```

### Q&A形式の実装判断記録

設計判断は Q&A 形式で記録し、将来の疑問に答える:

```typescript
/**
 * ## 実装判断の根拠
 *
 * ### Q: なぜホワイトリストではなくブラックリスト方式？
 *
 * **A**: CLIエージェントは多様なプロジェクトで使用されるため、
 * ホワイトリストでは柔軟性が失われる。ブラックリスト方式で
 * 「明らかに危険なもの」のみをブロックするアプローチが実用的。
 */
```

### 参考実装

- `test/unit/tools/security-filter.test.ts` - TSDoc運用の実例

## 統合テストのスコープ

統合テストでは以下をモックベースで検証する：

- APIキー認証フローの動作
- 簡単なプロンプトへの応答処理
- ツール呼び出しの連携

## CI/CD

（後日作成予定）

- 全テスト（ユニット + 統合）を実行
- カバレッジレポートを生成
- 80%未満でエラー
