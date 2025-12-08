import test from 'ava';
import { convertToolSchemaForAnthropic, convertAllToolSchemasForAnthropic } from '../../../src/utils/tool-schema-converter.js';
import { ALL_TOOL_SCHEMAS } from '../../../src/tools/tool-schemas.js';

test('convertToolSchemaForAnthropic converts Groq format to Anthropic format', t => {
  const groqSchema = {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to file'
          }
        },
        required: ['file_path']
      }
    }
  };

  const anthropicSchema = convertToolSchemaForAnthropic(groqSchema);

  t.is(anthropicSchema.name, 'read_file');
  t.is(anthropicSchema.description, 'Read a file');
  t.truthy(anthropicSchema.input_schema);
  t.is(anthropicSchema.input_schema.type, 'object');
  t.deepEqual(anthropicSchema.input_schema.properties, groqSchema.function.parameters.properties);
  t.deepEqual(anthropicSchema.input_schema.required, ['file_path']);
});

test('convertAllToolSchemasForAnthropic converts all schemas', t => {
  const anthropicSchemas = convertAllToolSchemasForAnthropic(ALL_TOOL_SCHEMAS);

  t.is(anthropicSchemas.length, ALL_TOOL_SCHEMAS.length);

  // Verify all schemas have the correct structure
  for (const schema of anthropicSchemas) {
    t.truthy(schema.name);
    t.truthy(schema.description);
    t.truthy(schema.input_schema);
    t.is(schema.input_schema.type, 'object');
    t.truthy(schema.input_schema.properties);
    t.true(Array.isArray(schema.input_schema.required));
  }
});
