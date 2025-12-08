import type { ToolSchema } from '../tools/tool-schemas.js';

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
export function convertToolSchemaForAnthropic(groqSchema: ToolSchema): any {
  return {
    name: groqSchema.function.name,
    description: groqSchema.function.description,
    input_schema: {
      type: groqSchema.function.parameters.type,
      properties: groqSchema.function.parameters.properties,
      required: groqSchema.function.parameters.required
    }
  };
}

/**
 * すべてのツールスキーマを Anthropic 形式に変換
 */
export function convertAllToolSchemasForAnthropic(groqSchemas: ToolSchema[]): any[] {
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
function convertTypeToGemini(type: string): string {
  const typeMap: Record<string, string> = {
    'string': 'STRING',
    'number': 'NUMBER',
    'integer': 'INTEGER',
    'boolean': 'BOOLEAN',
    'array': 'ARRAY',
    'object': 'OBJECT'
  };
  return typeMap[type] || 'STRING';
}

function convertPropertyForGemini(prop: any): any {
  const converted: any = {
    type: convertTypeToGemini(prop.type),
    description: prop.description
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

export function convertToolSchemaForGemini(groqSchema: ToolSchema): any {
  const properties: Record<string, any> = {};

  for (const [key, value] of Object.entries(groqSchema.function.parameters.properties)) {
    properties[key] = convertPropertyForGemini(value);
  }

  return {
    name: groqSchema.function.name,
    description: groqSchema.function.description,
    parameters: {
      type: 'OBJECT',
      properties,
      required: groqSchema.function.parameters.required
    }
  };
}

/**
 * すべてのツールスキーマを Gemini 形式に変換
 */
export function convertAllToolSchemasForGemini(groqSchemas: ToolSchema[]): any[] {
  return groqSchemas.map(convertToolSchemaForGemini);
}
