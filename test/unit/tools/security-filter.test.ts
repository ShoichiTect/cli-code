/**
 * @fileoverview security-filter.ts のユニットテスト
 *
 * ## 対象モジュールの概要
 *
 * `security-filter.ts` は、CLIエージェントが機密ファイルや危険なディレクトリに
 * アクセスすることを防ぐセキュリティフィルターです。
 *
 * ### 保護対象
 *
 * | カテゴリ | 例 | リスク |
 * |----------|-----|--------|
 * | 環境変数 | `.env`, `.env.local`, `.env.production` | APIキー、DB接続情報の漏洩 |
 * | クラウド認証 | `.aws/credentials`, `.aws/config` | AWSアカウント乗っ取り |
 * | SSH鍵 | `.ssh/id_rsa`, `.ssh/id_ed25519` | サーバーへの不正アクセス |
 * | Git設定 | `.git/config` | リポジトリ認証情報の漏洩 |
 * | パッケージマネージャー | `.npmrc`, `.yarnrc` | npm/yarnトークンの漏洩 |
 * | シークレット | `secrets.json`, `api-keys.json` | 各種APIキーの漏洩 |
 * | node_modules | `node_modules/` | 巨大ディレクトリの誤読み込み防止 |
 *
 * ### エクスポート関数
 *
 * - {@link isDangerousFile} - ファイルパスが危険かどうかを判定
 * - {@link isDangerousDirectory} - ディレクトリパスが危険かどうかを判定
 * - {@link isPathDangerous} - パス全体（ファイル/ディレクトリ）の危険性を判定
 * - {@link validateFileOperation} - ファイル操作（read/write/delete）の許可判定
 * - {@link validateCommandOperation} - シェルコマンド実行の許可判定
 *
 * ### 内部ヘルパー関数
 *
 * - `mergeConfiguredList` - デフォルトリストとユーザー設定リストをマージ
 * - `extractCommandTokens` - コマンド文字列をトークンに分割（クォート対応）
 * - `normalizeTokenForPathCheck` - トークンからパス候補を抽出（リダイレクト、環境変数対応）
 * - `findDangerousPathInCommand` - コマンド内の危険なパスを検出
 *
 * ---
 *
 * ## テスト設計方針
 *
 * ### 1. モック戦略
 *
 * `ConfigManager` をモック化し、デフォルトの危険リストのみでテストを実行。
 * これにより、ユーザー設定に依存しない純粋なロジックテストが可能。
 *
 * ```typescript
 * vi.mock('../../../src/utils/local-settings.js', () => ({
 *   ConfigManager: vi.fn().mockImplementation(() => ({
 *     getDangerousDirectories: vi.fn().mockReturnValue(null),
 *     getDangerousFiles: vi.fn().mockReturnValue(null),
 *   })),
 * }));
 * ```
 *
 * **選択理由**: ConfigManagerの実装詳細に依存せず、security-filterの
 * ロジックのみをテストするため。統合テストでは実際のConfigManagerを使用する。
 *
 * ### 2. テストカテゴリ構成
 *
 * 各関数に対して以下の観点でテストを網羅:
 *
 * - **正常系（許可）**: 安全なパス/コマンドが許可されることを確認
 * - **異常系（拒否）**: 危険なパス/コマンドがブロックされることを確認
 * - **境界値**: 空文字列、特殊文字、大文字小文字の混在
 * - **クロスプラットフォーム**: Windows（バックスラッシュ）とUnix（スラッシュ）パス
 *
 * ### 3. isDangerousFile テスト詳細
 *
 * | テストグループ | 目的 | テスト例 |
 * |----------------|------|----------|
 * | safe files | 通常のソースファイルが許可される | `src/index.ts`, `package.json` |
 * | .env files | 環境変数ファイルがブロックされる | `.env`, `.env.local`, `.env.*.local` |
 * | credential files | 認証情報がブロックされる | `.aws`, `.ssh`, `credentials` |
 * | secrets files | シークレットファイルがブロックされる | `secrets.json`, `secrets.*.json` |
 * | git config | Git設定がブロックされる | `.git/config`, `.git/HEAD` |
 * | package manager | npmrc/yarnrcがブロックされる | `.npmrc`, `.yarnrc` |
 * | case insensitivity | 大文字小文字を無視 | `.ENV`, `.Env`, `SECRETS.JSON` |
 * | Windows paths | バックスラッシュ対応 | `project\\.env`, `C:\\Users\\.ssh` |
 *
 * **設計意図**: ファイル名だけでなく、パス全体を検査することで、
 * サブディレクトリ内の機密ファイルも確実にブロックする。
 *
 * ### 4. isDangerousDirectory テスト詳細
 *
 * ディレクトリ自体へのアクセスをブロック。ファイルレベルのチェックと
 * 二重防御を提供。
 *
 * **node_modulesをブロックする理由**:
 * - 巨大なディレクトリ（数万ファイル）の誤読み込み防止
 * - 依存関係内の機密情報（.npmrcなど）へのアクセス防止
 * - パフォーマンス問題の回避
 *
 * ### 5. validateCommandOperation テスト詳細
 *
 * シェルコマンド内に埋め込まれた危険なパスを検出。
 *
 * | シナリオ | テスト例 | 検出方法 |
 * |----------|----------|----------|
 * | 直接参照 | `cat .env` | トークン分割 |
 * | クォート | `cat ".env"`, `cat '.env'` | クォート除去 |
 * | リダイレクト | `echo > .env`, `cat < .env` | リダイレクト記号処理 |
 * | パイプ | `cat .env \| grep KEY` | パイプ分割 |
 * | チェーン | `cd project && cat .env` | `&&`/`;` 分割 |
 * | 環境変数 | `ENV_FILE=.env source .env` | `=` 後の値抽出 |
 *
 * **実装上の注意点**:
 * - 完璧なシェル構文解析は不可能（bashの複雑さ）
 * - 偽陽性よりも偽陰性を避ける方針（安全側に倒す）
 * - 正規表現ベースのトークナイザーで十分な精度を確保
 *
 * ---
 *
 * ## 実装判断の根拠
 *
 * ### Q: なぜホワイトリストではなくブラックリスト方式？
 *
 * **A**: CLIエージェントは多様なプロジェクトで使用されるため、
 * ホワイトリストでは柔軟性が失われる。ブラックリスト方式で
 * 「明らかに危険なもの」のみをブロックし、それ以外は許可する
 * アプローチが実用的。
 *
 * ### Q: なぜConfigManagerでカスタマイズ可能にした？
 *
 * **A**: プロジェクト固有の機密ファイル（例: `firebase.json`）を
 * ユーザーが追加できるようにするため。デフォルトリストは
 * 一般的なケースをカバーし、拡張性を提供。
 *
 * ### Q: なぜ大文字小文字を区別しない？
 *
 * **A**: Windowsはファイル名の大文字小文字を区別しないため、
 * `.ENV` と `.env` を同じ危険ファイルとして扱う必要がある。
 * クロスプラットフォーム対応として一貫して小文字に正規化。
 *
 * ### Q: コマンド検証で完璧な構文解析をしないのはなぜ？
 *
 * **A**: Bashの構文は非常に複雑（ヒアドキュメント、プロセス置換、
 * 配列展開など）で、完璧な解析は実質不可能。トークンベースの
 * ヒューリスティックで「よくあるパターン」をカバーし、
 * エッジケースは許容する方針。これにより、メンテナンス性と
 * パフォーマンスを確保。
 *
 * ---
 *
 * ## 今後の拡張案
 *
 * 1. **ワイルドカードパターンの強化**: 現在は `*` のみ対応、`**` や `?` も追加
 * 2. **正規表現パターン対応**: より柔軟なマッチングルール
 * 3. **ログ出力**: ブロックされたアクセスのログ記録
 * 4. **ユーザー確認モード**: 危険ファイルへのアクセス時に確認プロンプト表示
 *
 * @module test/unit/tools/security-filter.test
 * @author Claude (AI Assistant)
 * @see {@link src/tools/security-filter.ts} 対象モジュール
 */

import {describe, it, expect, beforeEach, vi} from 'vitest';

/**
 * ConfigManagerのモック設定
 *
 * テスト時はユーザー設定を無効化し、デフォルトの危険リストのみで検証する。
 * これにより、security-filterのコアロジックを独立してテスト可能。
 */
vi.mock('../../../src/utils/local-settings.js', () => ({
	ConfigManager: vi.fn().mockImplementation(() => ({
		getDangerousDirectories: vi.fn().mockReturnValue(null),
		getDangerousFiles: vi.fn().mockReturnValue(null),
	})),
}));

import {
	isDangerousFile,
	isDangerousDirectory,
	isPathDangerous,
	validateFileOperation,
	validateCommandOperation,
} from '../../../src/tools/security-filter.js';

describe('security-filter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isDangerousFile', () => {
		describe('returns false for safe files', () => {
			it('should allow normal source files', () => {
				expect(isDangerousFile('src/index.ts')).toBe(false);
				expect(isDangerousFile('package.json')).toBe(false);
				expect(isDangerousFile('README.md')).toBe(false);
			});

			it('should allow files in nested directories', () => {
				expect(isDangerousFile('src/utils/helper.ts')).toBe(false);
				expect(isDangerousFile('/home/user/project/main.js')).toBe(false);
			});

			it('should return false for empty string', () => {
				expect(isDangerousFile('')).toBe(false);
			});
		});

		describe('returns true for dangerous .env files', () => {
			it('should block .env files', () => {
				expect(isDangerousFile('.env')).toBe(true);
				expect(isDangerousFile('.env.local')).toBe(true);
				expect(isDangerousFile('.env.production')).toBe(true);
				expect(isDangerousFile('.env.development')).toBe(true);
			});

			it('should block .env files in subdirectories', () => {
				expect(isDangerousFile('project/.env')).toBe(true);
				expect(isDangerousFile('/home/user/project/.env.local')).toBe(true);
			});

			it('should block wildcard .env patterns', () => {
				expect(isDangerousFile('.env.staging.local')).toBe(true);
				expect(isDangerousFile('.env.test.local')).toBe(true);
			});
		});

		describe('returns true for credential files', () => {
			it('should block AWS credentials', () => {
				expect(isDangerousFile('.aws')).toBe(true);
				expect(isDangerousFile('/home/user/.aws/credentials')).toBe(true);
			});

			it('should block SSH keys', () => {
				expect(isDangerousFile('.ssh')).toBe(true);
				expect(isDangerousFile('/home/user/.ssh/id_rsa')).toBe(true);
			});

			it('should block credential files', () => {
				expect(isDangerousFile('.credentials')).toBe(true);
				expect(isDangerousFile('credentials')).toBe(true);
			});

			it('should block private keys', () => {
				expect(isDangerousFile('private_key')).toBe(true);
				expect(isDangerousFile('private_key.pem')).toBe(true);
			});

			it('should block API keys', () => {
				expect(isDangerousFile('api-key')).toBe(true);
				expect(isDangerousFile('api-keys.json')).toBe(true);
			});
		});

		describe('returns true for secrets files', () => {
			it('should block secrets.json', () => {
				expect(isDangerousFile('secrets.json')).toBe(true);
			});

			it('should block secrets with patterns', () => {
				expect(isDangerousFile('secrets.production.json')).toBe(true);
				expect(isDangerousFile('secrets.development.json')).toBe(true);
			});
		});

		describe('returns true for git config', () => {
			it('should block .git/config', () => {
				expect(isDangerousFile('.git/config')).toBe(true);
			});

			it('should block files in .git directory', () => {
				expect(isDangerousFile('.git/HEAD')).toBe(true);
				expect(isDangerousFile('project/.git/config')).toBe(true);
			});
		});

		describe('returns true for package manager credentials', () => {
			it('should block .npmrc', () => {
				expect(isDangerousFile('.npmrc')).toBe(true);
				expect(isDangerousFile('/home/user/.npmrc')).toBe(true);
			});

			it('should block .yarnrc', () => {
				expect(isDangerousFile('.yarnrc')).toBe(true);
			});
		});

		describe('returns true for config.json', () => {
			it('should block config.json', () => {
				expect(isDangerousFile('config.json')).toBe(true);
				expect(isDangerousFile('project/config.json')).toBe(true);
			});
		});

		describe('handles case insensitivity', () => {
			it('should be case insensitive', () => {
				expect(isDangerousFile('.ENV')).toBe(true);
				expect(isDangerousFile('.Env')).toBe(true);
				expect(isDangerousFile('SECRETS.JSON')).toBe(true);
			});
		});

		describe('handles Windows paths', () => {
			it('should handle backslashes', () => {
				expect(isDangerousFile('project\\.env')).toBe(true);
				expect(isDangerousFile('C:\\Users\\user\\.ssh\\id_rsa')).toBe(true);
			});
		});
	});

	describe('isDangerousDirectory', () => {
		describe('returns false for safe directories', () => {
			it('should allow normal directories', () => {
				expect(isDangerousDirectory('src')).toBe(false);
				expect(isDangerousDirectory('lib')).toBe(false);
				expect(isDangerousDirectory('dist')).toBe(false);
			});

			it('should return false for empty string', () => {
				expect(isDangerousDirectory('')).toBe(false);
			});
		});

		describe('returns true for dangerous directories', () => {
			it('should block .git directory', () => {
				expect(isDangerousDirectory('.git')).toBe(true);
				expect(isDangerousDirectory('project/.git')).toBe(true);
			});

			it('should block .ssh directory', () => {
				expect(isDangerousDirectory('.ssh')).toBe(true);
				expect(isDangerousDirectory('/home/user/.ssh')).toBe(true);
			});

			it('should block .aws directory', () => {
				expect(isDangerousDirectory('.aws')).toBe(true);
				expect(isDangerousDirectory('/root/.aws')).toBe(true);
			});

			it('should block .credentials directory', () => {
				expect(isDangerousDirectory('.credentials')).toBe(true);
			});

			it('should block node_modules', () => {
				expect(isDangerousDirectory('node_modules')).toBe(true);
				expect(isDangerousDirectory('project/node_modules')).toBe(true);
			});

			it('should block root sensitive directories', () => {
				expect(isDangerousDirectory('/root/.ssh')).toBe(true);
				expect(isDangerousDirectory('/root/.aws')).toBe(true);
			});
		});
	});

	describe('isPathDangerous', () => {
		it('should return true for dangerous files', () => {
			expect(isPathDangerous('.env')).toBe(true);
			expect(isPathDangerous('secrets.json')).toBe(true);
		});

		it('should return true for dangerous directories', () => {
			expect(isPathDangerous('.git')).toBe(true);
			expect(isPathDangerous('node_modules')).toBe(true);
		});

		it('should return false for safe paths', () => {
			expect(isPathDangerous('src/index.ts')).toBe(false);
			expect(isPathDangerous('package.json')).toBe(false);
		});
	});

	describe('validateFileOperation', () => {
		describe('allows safe operations', () => {
			it('should allow read on safe files', () => {
				const result = validateFileOperation('src/index.ts', 'read');
				expect(result.allowed).toBe(true);
				expect(result.reason).toBeUndefined();
			});

			it('should allow write on safe files', () => {
				const result = validateFileOperation('src/helper.ts', 'write');
				expect(result.allowed).toBe(true);
			});

			it('should allow delete on safe files', () => {
				const result = validateFileOperation('temp/cache.json', 'delete');
				expect(result.allowed).toBe(true);
			});
		});

		describe('blocks dangerous operations', () => {
			it('should block read on .env files', () => {
				const result = validateFileOperation('.env', 'read');
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('Security policy blocks read operation');
				expect(result.reason).toContain('.env');
			});

			it('should block write on credentials', () => {
				const result = validateFileOperation('credentials', 'write');
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('Security policy blocks write operation');
			});

			it('should block delete on .ssh files', () => {
				const result = validateFileOperation('.ssh/id_rsa', 'delete');
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('Security policy blocks delete operation');
			});
		});
	});

	describe('validateCommandOperation', () => {
		describe('allows safe commands', () => {
			it('should allow empty command', () => {
				const result = validateCommandOperation('');
				expect(result.allowed).toBe(true);
			});

			it('should allow normal commands', () => {
				expect(validateCommandOperation('ls -la').allowed).toBe(true);
				expect(validateCommandOperation('npm install').allowed).toBe(true);
				expect(validateCommandOperation('git status').allowed).toBe(true);
			});

			it('should allow commands with safe file paths', () => {
				expect(validateCommandOperation('cat src/index.ts').allowed).toBe(true);
				expect(validateCommandOperation('rm temp/cache.json').allowed).toBe(
					true,
				);
			});
		});

		describe('blocks dangerous commands', () => {
			it('should block commands referencing .env', () => {
				const result = validateCommandOperation('cat .env');
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('Security policy blocks execute_command');
				expect(result.reason).toContain('.env');
			});

			it('should block commands with credentials', () => {
				const result = validateCommandOperation('cat ~/.aws/credentials');
				expect(result.allowed).toBe(false);
			});

			it('should block commands with SSH keys', () => {
				const result = validateCommandOperation('cat ~/.ssh/id_rsa');
				expect(result.allowed).toBe(false);
			});

			it('should block commands with secrets.json', () => {
				const result = validateCommandOperation('cat secrets.json');
				expect(result.allowed).toBe(false);
			});
		});

		describe('handles quoted paths', () => {
			it('should detect dangerous paths in double quotes', () => {
				expect(validateCommandOperation('cat ".env"').allowed).toBe(false);
			});

			it('should detect dangerous paths in single quotes', () => {
				expect(validateCommandOperation("cat '.env'").allowed).toBe(false);
			});

			it('should detect dangerous paths in backticks', () => {
				expect(validateCommandOperation('cat `.env`').allowed).toBe(false);
			});
		});

		describe('handles redirections', () => {
			it('should detect dangerous paths in output redirection', () => {
				expect(validateCommandOperation('echo test > .env').allowed).toBe(false);
			});

			it('should detect dangerous paths in input redirection', () => {
				expect(validateCommandOperation('cat < .env').allowed).toBe(false);
			});
		});

		describe('handles complex commands', () => {
			it('should detect dangerous paths in piped commands', () => {
				expect(validateCommandOperation('cat .env | grep KEY').allowed).toBe(
					false,
				);
			});

			it('should detect dangerous paths in chained commands', () => {
				expect(
					validateCommandOperation('cd project && cat .env').allowed,
				).toBe(false);
			});

			it('should detect dangerous paths in environment variables', () => {
				expect(
					validateCommandOperation('ENV_FILE=.env source .env').allowed,
				).toBe(false);
			});
		});
	});
});
