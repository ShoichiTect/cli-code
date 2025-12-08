import test from 'ava';
import {
  ALL_TOOL_SCHEMAS,
  DANGEROUS_TOOLS,
  APPROVAL_REQUIRED_TOOLS,
  SAFE_TOOLS,
  type ToolSchema
} from '../../../src/tools/tool-schemas.js';

// ========================================
// Basic Structure Validation Tests
// ========================================

test('ALL_TOOL_SCHEMAS is an array', t => {
  t.true(Array.isArray(ALL_TOOL_SCHEMAS));
  t.true(ALL_TOOL_SCHEMAS.length > 0, 'Should have at least one tool schema');
});

test('all tools have required type field', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.type, `Tool should have type field: ${JSON.stringify(tool)}`);
    t.is(tool.type, 'function', `Tool type should be 'function': ${JSON.stringify(tool)}`);
  }
});

test('all tools have function.name', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.function, `Tool should have function object: ${JSON.stringify(tool)}`);
    t.truthy(tool.function.name, `Tool should have function.name: ${JSON.stringify(tool)}`);
    t.is(typeof tool.function.name, 'string', `function.name should be a string: ${tool.function.name}`);
    t.true(tool.function.name.length > 0, `function.name should not be empty: ${tool.function.name}`);
  }
});

test('all tools have function.description', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.function.description, `Tool should have function.description: ${tool.function.name}`);
    t.is(typeof tool.function.description, 'string', `function.description should be a string: ${tool.function.name}`);
    t.true(tool.function.description.length > 0, `function.description should not be empty: ${tool.function.name}`);
  }
});

test('all tools have function.parameters', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.function.parameters, `Tool should have function.parameters: ${tool.function.name}`);
    t.is(typeof tool.function.parameters, 'object', `function.parameters should be an object: ${tool.function.name}`);
  }
});

// ========================================
// Parameter Structure Validation Tests
// ========================================

test('all tools have parameters.type = "object"', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.is(tool.function.parameters.type, 'object', `parameters.type should be "object": ${tool.function.name}`);
  }
});

test('all tools have parameters.properties object', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.function.parameters.properties, `parameters.properties should exist: ${tool.function.name}`);
    t.is(typeof tool.function.parameters.properties, 'object', `parameters.properties should be an object: ${tool.function.name}`);
  }
});

test('all tools have parameters.required array', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    t.truthy(tool.function.parameters.required, `parameters.required should exist: ${tool.function.name}`);
    t.true(Array.isArray(tool.function.parameters.required), `parameters.required should be an array: ${tool.function.name}`);
  }
});

test('required fields exist in properties', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    const { required, properties } = tool.function.parameters;

    for (const requiredField of required) {
      t.truthy(
        properties[requiredField],
        `Required field "${requiredField}" should exist in properties: ${tool.function.name}`
      );
    }
  }
});

test('all properties have descriptions', t => {
  for (const tool of ALL_TOOL_SCHEMAS) {
    const { properties } = tool.function.parameters;

    for (const [propName, propValue] of Object.entries(properties)) {
      t.truthy(
        propValue.description,
        `Property "${propName}" should have a description in ${tool.function.name}`
      );
      t.is(
        typeof propValue.description,
        'string',
        `Property "${propName}" description should be a string in ${tool.function.name}`
      );
      t.true(
        propValue.description.length > 0,
        `Property "${propName}" description should not be empty in ${tool.function.name}`
      );
    }
  }
});

// ========================================
// Important Tools Existence Tests
// ========================================

test('read_file tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('read_file'), 'read_file tool should exist');
});

test('create_file tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('create_file'), 'create_file tool should exist');
});

test('edit_file tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('edit_file'), 'edit_file tool should exist');
});

test('delete_file tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('delete_file'), 'delete_file tool should exist');
});

test('list_files tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('list_files'), 'list_files tool should exist');
});

test('search_files tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('search_files'), 'search_files tool should exist');
});

test('execute_command tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('execute_command'), 'execute_command tool should exist');
});

test('create_tasks tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('create_tasks'), 'create_tasks tool should exist');
});

test('update_tasks tool exists', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  t.true(toolNames.includes('update_tasks'), 'update_tasks tool should exist');
});

// ========================================
// Special Classification Tests
// ========================================

test('DANGEROUS_TOOLS is defined and is an array', t => {
  t.truthy(DANGEROUS_TOOLS, 'DANGEROUS_TOOLS should be defined');
  t.true(Array.isArray(DANGEROUS_TOOLS), 'DANGEROUS_TOOLS should be an array');
  t.true(DANGEROUS_TOOLS.length > 0, 'DANGEROUS_TOOLS should not be empty');
});

test('APPROVAL_REQUIRED_TOOLS is defined and is an array', t => {
  t.truthy(APPROVAL_REQUIRED_TOOLS, 'APPROVAL_REQUIRED_TOOLS should be defined');
  t.true(Array.isArray(APPROVAL_REQUIRED_TOOLS), 'APPROVAL_REQUIRED_TOOLS should be an array');
  t.true(APPROVAL_REQUIRED_TOOLS.length > 0, 'APPROVAL_REQUIRED_TOOLS should not be empty');
});

test('SAFE_TOOLS is defined and is an array', t => {
  t.truthy(SAFE_TOOLS, 'SAFE_TOOLS should be defined');
  t.true(Array.isArray(SAFE_TOOLS), 'SAFE_TOOLS should be an array');
  t.true(SAFE_TOOLS.length > 0, 'SAFE_TOOLS should not be empty');
});

test('dangerous tools are subset of all tools', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);

  for (const dangerousTool of DANGEROUS_TOOLS) {
    t.true(
      toolNames.includes(dangerousTool),
      `DANGEROUS_TOOLS contains "${dangerousTool}" which should exist in ALL_TOOL_SCHEMAS`
    );
  }
});

test('approval required tools are subset of all tools', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);

  for (const approvalTool of APPROVAL_REQUIRED_TOOLS) {
    t.true(
      toolNames.includes(approvalTool),
      `APPROVAL_REQUIRED_TOOLS contains "${approvalTool}" which should exist in ALL_TOOL_SCHEMAS`
    );
  }
});

test('safe tools are subset of all tools', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);

  for (const safeTool of SAFE_TOOLS) {
    t.true(
      toolNames.includes(safeTool),
      `SAFE_TOOLS contains "${safeTool}" which should exist in ALL_TOOL_SCHEMAS`
    );
  }
});

// ========================================
// Schema Consistency Tests
// ========================================

test('no duplicate tool names', t => {
  const toolNames = ALL_TOOL_SCHEMAS.map(tool => tool.function.name);
  const uniqueNames = new Set(toolNames);

  t.is(
    toolNames.length,
    uniqueNames.size,
    `Found duplicate tool names. All: ${toolNames.length}, Unique: ${uniqueNames.size}`
  );
});

test('tool names match expected format (snake_case)', t => {
  const snakeCasePattern = /^[a-z]+(_[a-z]+)*$/;

  for (const tool of ALL_TOOL_SCHEMAS) {
    t.true(
      snakeCasePattern.test(tool.function.name),
      `Tool name "${tool.function.name}" should be in snake_case format`
    );
  }
});
