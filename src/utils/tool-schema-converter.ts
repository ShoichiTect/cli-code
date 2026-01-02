import {Type} from '@google/genai';
import type {FunctionDeclaration, Schema} from '@google/genai';
import type {ToolSchema, JsonSchema} from '../tools/tool-schemas.js';

/**
 * Groq (OpenAI形式) のツールスキーマを Anthropic 形式に変換
 *
 * Groq形式:
 * {
 *   type: 'function',
 *   function: {
 *     name: 'tool_name',
 *     description: 'Tool description',
 *     parameters: {
 *       type: 'object',
 *       properties: { ... },
 *       required: [...]
 *     }
 *   }
 * }
 *
 * Anthropic形式:
 * {
 *   name: 'tool_name',
 *   description: 'Tool description',
 *   input_schema: {
 *     type: 'object',
 *     properties: { ... },
 *     required: [...]
 *   }
 * }
 */
type AnthropicToolSchema = {
	name: string;
	description: string;
	input_schema: {
		type: 'object';
		properties: Record<string, JsonSchema>;
		required?: string[];
	};
};

export function convertToolSchemaForAnthropic(
	groqSchema: ToolSchema,
): AnthropicToolSchema {
	return {
		name: groqSchema.function.name,
		description: groqSchema.function.description,
		input_schema: {
			type: groqSchema.function.parameters.type,
			properties: groqSchema.function.parameters.properties,
			required: groqSchema.function.parameters.required,
		},
	};
}

/**
 * すべてのツールスキーマを Anthropic 形式に変換
 */
export function convertAllToolSchemasForAnthropic(
	groqSchemas: ToolSchema[],
): AnthropicToolSchema[] {
	return groqSchemas.map(convertToolSchemaForAnthropic);
}

/**
 * Groq (OpenAI形式) のツールスキーマを Gemini 形式に変換
 *
 * Gemini形式 (functionDeclarations):
 * {
 *   name: 'tool_name',
 *   description: 'Tool description',
 *   parameters: {
 *     type: 'OBJECT',
 *     properties: { ... },
 *     required: [...]
 *   }
 * }
 */
function convertTypeToGemini(type: string): Type {
	const typeMap: Record<string, Type> = {
		string: Type.STRING,
		number: Type.NUMBER,
		integer: Type.INTEGER,
		boolean: Type.BOOLEAN,
		array: Type.ARRAY,
		object: Type.OBJECT,
	};
	return typeMap[type] || Type.STRING;
}

function convertPropertyForGemini(prop: JsonSchema): Schema {
	const converted: Schema = {
		type: convertTypeToGemini(prop.type),
		description: prop.description,
	};

	if (prop.enum) {
		converted.enum = prop.enum;
	}

	if (prop.type === 'array' && prop.items) {
		converted.items = convertPropertyForGemini(prop.items);
	}

	if (prop.type === 'object' && prop.properties) {
		converted.properties = {};
		for (const [key, value] of Object.entries(prop.properties)) {
			converted.properties[key] = convertPropertyForGemini(value);
		}
		if (prop.required) {
			converted.required = prop.required;
		}
	}

	return converted;
}

export function convertToolSchemaForGemini(
	groqSchema: ToolSchema,
): FunctionDeclaration {
	const properties: Record<string, Schema> = {};

	for (const [key, value] of Object.entries(
		groqSchema.function.parameters.properties,
	)) {
		properties[key] = convertPropertyForGemini(value);
	}

	return {
		name: groqSchema.function.name,
		description: groqSchema.function.description,
		parameters: {
			type: Type.OBJECT,
			properties,
			required: groqSchema.function.parameters.required,
		},
	};
}

/**
 * すべてのツールスキーマを Gemini 形式に変換
 */
export function convertAllToolSchemasForGemini(
	groqSchemas: ToolSchema[],
): FunctionDeclaration[] {
	return groqSchemas.map(convertToolSchemaForGemini);
}
