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
