/**
 * @fileoverview tool-schemas.ts のユニットテスト
 *
 * ## 対象モジュールの概要
 *
 * `tool-schemas.ts` は、Groq function calling APIで使用される
 * ツールスキーマを定義するモジュールです。
 *
 * ### 主要なエクスポート
 *
 * | エクスポート | 種類 | 説明 |
 * |--------------|------|------|
 * | {@link JsonSchema} | 型 | JSONスキーマの型定義 |
 * | {@link ToolSchema} | インターフェース | ツールスキーマの構造定義 |
 * | {@link READ_FILE_SCHEMA} | 定数 | ファイル読み取りツールのスキーマ |
 * | {@link EXECUTE_COMMAND_SCHEMA} | 定数 | コマンド実行ツールのスキーマ |
 * | {@link SEARCH_FILES_SCHEMA} | 定数 | ファイル検索ツールのスキーマ |
 * | {@link LIST_FILES_SCHEMA} | 定数 | ディレクトリ一覧ツールのスキーマ |
 * | {@link ALL_TOOL_SCHEMAS} | 配列 | 全ツールスキーマの配列 |
 * | {@link SAFE_TOOLS} | 配列 | 自動実行可能な安全なツール名 |
 * | {@link APPROVAL_REQUIRED_TOOLS} | 配列 | 承認が必要なツール名 |
 * | {@link DANGEROUS_TOOLS} | 配列 | 常に承認が必要な危険なツール名 |
 *
 * ---
 *
 * ## テスト設計方針
 *
 * ### 1. スキーマ構造の検証
 *
 * 各スキーマが以下の要件を満たすことを確認:
 * - `type` が 'function' であること
 * - `function.name` が存在すること
 * - `function.description` が存在すること
 * - `function.parameters` が正しい構造を持つこと
 *
 * ### 2. パラメータ定義の検証
 *
 * 各ツールのパラメータが:
 * - 必須パラメータが `required` 配列に含まれること
 * - 型定義が正しいこと（string, integer, boolean, array）
 * - 制約（minimum, maximum, enum）が適切に設定されていること
 *
 * ### 3. ツール分類の検証
 *
 * ツールが適切に分類されていることを確認:
 * - `SAFE_TOOLS`: 読み取り専用の安全なツール
 * - `DANGEROUS_TOOLS`: 副作用を持つ危険なツール
 * - 各ツールが重複なく分類されていること
 *
 * ---
 *
 * ## 実装判断の根拠
 *
 * ### Q: なぜ execute_command のみが DANGEROUS_TOOLS に分類される？
 *
 * **A**: `execute_command` はシステムコマンドを実行でき、
 * ファイルの削除、システム設定の変更など、不可逆な操作が可能なため。
 * 他のツール（read_file, list_files, search_files）は読み取り専用で副作用がない。
 *
 * ### Q: なぜ timeout の最大値は300秒？
 *
 * **A**: 長時間実行されるコマンドはハングアップのリスクがあり、
 * 5分（300秒）は一般的なビルドやテストコマンドに十分な時間。
 * これ以上長いコマンドは分割して実行すべき。
 *
 * @module test/unit/tools/tool-schemas.test
 * @author Claude (AI Assistant)
 * @see {@link src/tools/tool-schemas.ts} 対象モジュール
 */

import {describe, it, expect} from 'vitest';
import {
	READ_FILE_SCHEMA,
	EXECUTE_COMMAND_SCHEMA,
	SEARCH_FILES_SCHEMA,
	LIST_FILES_SCHEMA,
	ALL_TOOL_SCHEMAS,
	SAFE_TOOLS,
	APPROVAL_REQUIRED_TOOLS,
	DANGEROUS_TOOLS,
	type ToolSchema,
	type JsonSchema,
} from '../../../src/tools/tool-schemas.js';

/**
 * ツールスキーマが基本構造を満たすことを検証するヘルパー関数
 *
 * @param schema - 検証対象のツールスキーマ
 * @param expectedName - 期待されるツール名
 */
function validateBasicSchemaStructure(
	schema: ToolSchema,
	expectedName: string,
): void {
	expect(schema.type).toBe('function');
	expect(schema.function).toBeDefined();
	expect(schema.function.name).toBe(expectedName);
	expect(typeof schema.function.description).toBe('string');
	expect(schema.function.description.length).toBeGreaterThan(0);
	expect(schema.function.parameters).toBeDefined();
	expect(schema.function.parameters.type).toBe('object');
	expect(schema.function.parameters.properties).toBeDefined();
	expect(Array.isArray(schema.function.parameters.required)).toBe(true);
}

/**
 * パラメータがJsonSchema型の要件を満たすことを検証するヘルパー関数
 *
 * @param param - 検証対象のパラメータ
 * @param expectedType - 期待される型
 */
function validateParameterType(
	param: JsonSchema,
	expectedType: JsonSchema['type'],
): void {
	expect(param.type).toBe(expectedType);
	expect(typeof param.description).toBe('string');
}

describe('tool-schemas', () => {
	describe('READ_FILE_SCHEMA', () => {
		it('should have correct basic structure', () => {
			validateBasicSchemaStructure(READ_FILE_SCHEMA, 'read_file');
		});

		it('should have file_path as required parameter', () => {
			expect(READ_FILE_SCHEMA.function.parameters.required).toContain(
				'file_path',
			);
		});

		it('should define file_path parameter correctly', () => {
			const filePathParam =
				READ_FILE_SCHEMA.function.parameters.properties.file_path;
			validateParameterType(filePathParam, 'string');
		});

		it('should define optional start_line and end_line parameters', () => {
			const {properties, required} = READ_FILE_SCHEMA.function.parameters;

			expect(properties.start_line).toBeDefined();
			validateParameterType(properties.start_line, 'integer');
			expect(properties.start_line.minimum).toBe(1);

			expect(properties.end_line).toBeDefined();
			validateParameterType(properties.end_line, 'integer');
			expect(properties.end_line.minimum).toBe(1);

			// start_line と end_line はオプション
			expect(required).not.toContain('start_line');
			expect(required).not.toContain('end_line');
		});

		it('should have exactly 3 parameters', () => {
			const paramCount = Object.keys(
				READ_FILE_SCHEMA.function.parameters.properties,
			).length;
			expect(paramCount).toBe(3);
		});
	});

	describe('EXECUTE_COMMAND_SCHEMA', () => {
		it('should have correct basic structure', () => {
			validateBasicSchemaStructure(EXECUTE_COMMAND_SCHEMA, 'execute_command');
		});

		it('should have command and command_type as required parameters', () => {
			const {required} = EXECUTE_COMMAND_SCHEMA.function.parameters;
			expect(required).toContain('command');
			expect(required).toContain('command_type');
		});

		it('should define command parameter correctly', () => {
			const commandParam =
				EXECUTE_COMMAND_SCHEMA.function.parameters.properties.command;
			validateParameterType(commandParam, 'string');
		});

		it('should define command_type with correct enum values', () => {
			const commandTypeParam =
				EXECUTE_COMMAND_SCHEMA.function.parameters.properties.command_type;
			validateParameterType(commandTypeParam, 'string');
			expect(commandTypeParam.enum).toBeDefined();
			expect(commandTypeParam.enum).toEqual(['bash', 'python', 'setup', 'run']);
		});

		it('should define optional working_directory parameter', () => {
			const {properties, required} =
				EXECUTE_COMMAND_SCHEMA.function.parameters;
			expect(properties.working_directory).toBeDefined();
			validateParameterType(properties.working_directory, 'string');
			expect(required).not.toContain('working_directory');
		});

		it('should define timeout parameter with correct constraints', () => {
			const {properties, required} =
				EXECUTE_COMMAND_SCHEMA.function.parameters;
			const timeoutParam = properties.timeout;

			expect(timeoutParam).toBeDefined();
			validateParameterType(timeoutParam, 'integer');
			expect(timeoutParam.minimum).toBe(1);
			expect(timeoutParam.maximum).toBe(300);
			expect(required).not.toContain('timeout');
		});

		it('should have exactly 4 parameters', () => {
			const paramCount = Object.keys(
				EXECUTE_COMMAND_SCHEMA.function.parameters.properties,
			).length;
			expect(paramCount).toBe(4);
		});

		it('should include safety warning in description', () => {
			expect(EXECUTE_COMMAND_SCHEMA.function.description).toContain(
				'SAFETY WARNING',
			);
		});
	});

	describe('SEARCH_FILES_SCHEMA', () => {
		it('should have correct basic structure', () => {
			validateBasicSchemaStructure(SEARCH_FILES_SCHEMA, 'search_files');
		});

		it('should have pattern as the only required parameter', () => {
			const {required} = SEARCH_FILES_SCHEMA.function.parameters;
			expect(required).toEqual(['pattern']);
		});

		it('should define pattern parameter correctly', () => {
			const patternParam =
				SEARCH_FILES_SCHEMA.function.parameters.properties.pattern;
			validateParameterType(patternParam, 'string');
		});

		it('should define pattern_type with correct enum values', () => {
			const patternTypeParam =
				SEARCH_FILES_SCHEMA.function.parameters.properties.pattern_type;
			validateParameterType(patternTypeParam, 'string');
			expect(patternTypeParam.enum).toEqual([
				'substring',
				'regex',
				'exact',
				'fuzzy',
			]);
			expect(patternTypeParam.default).toBe('substring');
		});

		it('should define max_results with correct constraints', () => {
			const maxResultsParam =
				SEARCH_FILES_SCHEMA.function.parameters.properties.max_results;
			validateParameterType(maxResultsParam, 'integer');
			expect(maxResultsParam.minimum).toBe(1);
			expect(maxResultsParam.maximum).toBe(1000);
			expect(maxResultsParam.default).toBe(100);
		});

		it('should define context_lines with correct constraints', () => {
			const contextLinesParam =
				SEARCH_FILES_SCHEMA.function.parameters.properties.context_lines;
			validateParameterType(contextLinesParam, 'integer');
			expect(contextLinesParam.minimum).toBe(0);
			expect(contextLinesParam.maximum).toBe(10);
			expect(contextLinesParam.default).toBe(0);
		});

		it('should define array parameters correctly', () => {
			const {properties} = SEARCH_FILES_SCHEMA.function.parameters;

			// file_types
			expect(properties.file_types.type).toBe('array');
			expect(properties.file_types.items).toEqual({type: 'string'});

			// exclude_dirs
			expect(properties.exclude_dirs.type).toBe('array');
			expect(properties.exclude_dirs.items).toEqual({type: 'string'});

			// exclude_files
			expect(properties.exclude_files.type).toBe('array');
			expect(properties.exclude_files.items).toEqual({type: 'string'});
		});

		it('should define boolean parameters correctly', () => {
			const {properties} = SEARCH_FILES_SCHEMA.function.parameters;

			expect(properties.case_sensitive.type).toBe('boolean');
			expect(properties.case_sensitive.default).toBe(false);

			expect(properties.group_by_file.type).toBe('boolean');
			expect(properties.group_by_file.default).toBe(false);
		});

		it('should have exactly 11 parameters', () => {
			const paramCount = Object.keys(
				SEARCH_FILES_SCHEMA.function.parameters.properties,
			).length;
			expect(paramCount).toBe(11);
		});
	});

	describe('LIST_FILES_SCHEMA', () => {
		it('should have correct basic structure', () => {
			validateBasicSchemaStructure(LIST_FILES_SCHEMA, 'list_files');
		});

		it('should have no required parameters', () => {
			const {required} = LIST_FILES_SCHEMA.function.parameters;
			expect(required).toEqual([]);
		});

		it('should define directory parameter with default', () => {
			const directoryParam =
				LIST_FILES_SCHEMA.function.parameters.properties.directory;
			validateParameterType(directoryParam, 'string');
			expect(directoryParam.default).toBe('.');
		});

		it('should define pattern parameter with default', () => {
			const patternParam =
				LIST_FILES_SCHEMA.function.parameters.properties.pattern;
			validateParameterType(patternParam, 'string');
			expect(patternParam.default).toBe('*');
		});

		it('should define boolean parameters with defaults', () => {
			const {properties} = LIST_FILES_SCHEMA.function.parameters;

			expect(properties.recursive.type).toBe('boolean');
			expect(properties.recursive.default).toBe(false);

			expect(properties.show_hidden.type).toBe('boolean');
			expect(properties.show_hidden.default).toBe(false);
		});

		it('should have exactly 4 parameters', () => {
			const paramCount = Object.keys(
				LIST_FILES_SCHEMA.function.parameters.properties,
			).length;
			expect(paramCount).toBe(4);
		});
	});

	describe('ALL_TOOL_SCHEMAS', () => {
		it('should contain exactly 4 schemas', () => {
			expect(ALL_TOOL_SCHEMAS).toHaveLength(4);
		});

		it('should contain all defined schemas', () => {
			expect(ALL_TOOL_SCHEMAS).toContain(READ_FILE_SCHEMA);
			expect(ALL_TOOL_SCHEMAS).toContain(SEARCH_FILES_SCHEMA);
			expect(ALL_TOOL_SCHEMAS).toContain(LIST_FILES_SCHEMA);
			expect(ALL_TOOL_SCHEMAS).toContain(EXECUTE_COMMAND_SCHEMA);
		});

		it('should have unique tool names', () => {
			const names = ALL_TOOL_SCHEMAS.map((schema) => schema.function.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it('should have all schemas with valid structure', () => {
			for (const schema of ALL_TOOL_SCHEMAS) {
				expect(schema.type).toBe('function');
				expect(schema.function).toBeDefined();
				expect(schema.function.name).toBeDefined();
				expect(schema.function.description).toBeDefined();
				expect(schema.function.parameters).toBeDefined();
			}
		});
	});

	describe('Tool classification arrays', () => {
		describe('SAFE_TOOLS', () => {
			it('should contain read-only tools', () => {
				expect(SAFE_TOOLS).toEqual(['read_file', 'list_files', 'search_files']);
			});

			it('should not contain execute_command', () => {
				expect(SAFE_TOOLS).not.toContain('execute_command');
			});

			it('should have 3 tools', () => {
				expect(SAFE_TOOLS).toHaveLength(3);
			});
		});

		describe('APPROVAL_REQUIRED_TOOLS', () => {
			it('should be empty array', () => {
				expect(APPROVAL_REQUIRED_TOOLS).toEqual([]);
			});
		});

		describe('DANGEROUS_TOOLS', () => {
			it('should contain only execute_command', () => {
				expect(DANGEROUS_TOOLS).toEqual(['execute_command']);
			});

			it('should have 1 tool', () => {
				expect(DANGEROUS_TOOLS).toHaveLength(1);
			});
		});

		describe('Tool classification consistency', () => {
			it('should have no overlap between SAFE_TOOLS and DANGEROUS_TOOLS', () => {
				const safeSet = new Set(SAFE_TOOLS);
				const dangerousSet = new Set(DANGEROUS_TOOLS);

				for (const tool of SAFE_TOOLS) {
					expect(dangerousSet.has(tool)).toBe(false);
				}

				for (const tool of DANGEROUS_TOOLS) {
					expect(safeSet.has(tool)).toBe(false);
				}
			});

			it('should classify all tools in ALL_TOOL_SCHEMAS', () => {
				const allToolNames = ALL_TOOL_SCHEMAS.map(
					(schema) => schema.function.name,
				);
				const classifiedTools = [
					...SAFE_TOOLS,
					...APPROVAL_REQUIRED_TOOLS,
					...DANGEROUS_TOOLS,
				];

				for (const toolName of allToolNames) {
					expect(classifiedTools).toContain(toolName);
				}
			});

			it('should have all classified tools exist in ALL_TOOL_SCHEMAS', () => {
				const allToolNames = ALL_TOOL_SCHEMAS.map(
					(schema) => schema.function.name,
				);
				const classifiedTools = [
					...SAFE_TOOLS,
					...APPROVAL_REQUIRED_TOOLS,
					...DANGEROUS_TOOLS,
				];

				for (const toolName of classifiedTools) {
					expect(allToolNames).toContain(toolName);
				}
			});
		});
	});

	describe('Schema descriptions', () => {
		it('should have descriptions with usage examples', () => {
			for (const schema of ALL_TOOL_SCHEMAS) {
				expect(schema.function.description).toContain('Example:');
			}
		});

		it('should have parameter descriptions for all properties', () => {
			for (const schema of ALL_TOOL_SCHEMAS) {
				const {properties} = schema.function.parameters;
				for (const [paramName, paramSchema] of Object.entries(properties)) {
					expect(paramSchema.description).toBeDefined();
					expect(
						paramSchema.description!.length,
						`Parameter '${paramName}' in '${schema.function.name}' should have non-empty description`,
					).toBeGreaterThan(0);
				}
			}
		});
	});
});
