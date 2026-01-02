/**
 * Tool schemas for Groq function calling API.
 * These define the available tools that the LLM can call.
 */

export interface ToolSchema {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, unknown>;
			required: string[];
		};
	};
}

// File Operation Tools

export const READ_FILE_SCHEMA: ToolSchema = {
	type: 'function',
	function: {
		name: 'read_file',
		description:
			'Read file contents with optional line range. Use to check if files exist and examine current code before making changes. Example: {"file_path": "src/app.js", "start_line": 10, "end_line": 20}',
		parameters: {
			type: 'object',
			properties: {
				file_path: {
					type: 'string',
					description:
						'Path to file. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
				},
				start_line: {
					type: 'integer',
					description: 'Starting line number (1-indexed, optional)',
					minimum: 1,
				},
				end_line: {
					type: 'integer',
					description: 'Ending line number (1-indexed, optional)',
					minimum: 1,
				},
			},
			required: ['file_path'],
		},
	},
};

// Code Execution Tools

export const EXECUTE_COMMAND_SCHEMA: ToolSchema = {
	type: 'function',
	function: {
		name: 'execute_command',
		description:
			'Run shell commands, scripts, or code. SAFETY WARNING: Only use for commands that COMPLETE and EXIT (test scripts, build commands, short-running scripts). NEVER use for commands that run indefinitely (flask server, node app starting, python -m http.server, etc.). Always prefer short-running commands that exit. Example: {"command": "npm test", "command_type": "bash"}',
		parameters: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description:
						'Shell command to execute. Only use commands that exit/stop automatically. Examples: "python my_script.py", "npm test", "ls -la". Avoid: long-running commands, "npm start" (starts servers), etc.',
				},
				command_type: {
					type: 'string',
					enum: ['bash', 'python', 'setup', 'run'],
					description:
						'Command type: bash (shell), python (script), setup (auto-run), run (needs approval)',
				},
				working_directory: {
					type: 'string',
					description: 'Directory to run command in (optional)',
				},
				timeout: {
					type: 'integer',
					description: 'Max execution time in seconds (1-300)',
					minimum: 1,
					maximum: 300,
				},
			},
			required: ['command', 'command_type'],
		},
	},
};

// Information Tools

export const SEARCH_FILES_SCHEMA: ToolSchema = {
	type: 'function',
	function: {
		name: 'search_files',
		description:
			'Find text patterns in files across the codebase. Perfect for locating functions, classes, or specific code. Example: {"pattern": "function handleClick", "file_pattern": "*.js", "context_lines": 3}',
		parameters: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description:
						'Text to search for (can be function names, classes, strings, etc.)',
				},
				file_pattern: {
					type: 'string',
					description: 'File pattern filter (e.g., "*.py", "*.js", "src/*.ts")',
					default: '*',
				},
				directory: {
					type: 'string',
					description:
						'Directory to search in. Use "." or "" for current directory, "src" for subdirectory. DO NOT include leading slash.',
					default: '.',
				},
				case_sensitive: {
					type: 'boolean',
					description: 'Case-sensitive search',
					default: false,
				},
				pattern_type: {
					type: 'string',
					enum: ['substring', 'regex', 'exact', 'fuzzy'],
					description:
						'Match type: substring (partial), regex (patterns), exact (whole), fuzzy (similar)',
					default: 'substring',
				},
				file_types: {
					type: 'array',
					items: {type: 'string'},
					description: 'File extensions to include (["py", "js", "ts"])',
				},
				exclude_dirs: {
					type: 'array',
					items: {type: 'string'},
					description: 'Directories to skip (["node_modules", ".git", "dist"])',
				},
				exclude_files: {
					type: 'array',
					items: {type: 'string'},
					description: 'File patterns to skip (["*.min.js", "*.log"])',
				},
				max_results: {
					type: 'integer',
					description: 'Maximum results to return (1-1000)',
					default: 100,
					minimum: 1,
					maximum: 1000,
				},
				context_lines: {
					type: 'integer',
					description: 'Lines of context around matches (0-10)',
					default: 0,
					minimum: 0,
					maximum: 10,
				},
				group_by_file: {
					type: 'boolean',
					description: 'Group results by filename',
					default: false,
				},
			},
			required: ['pattern'],
		},
	},
};

export const LIST_FILES_SCHEMA: ToolSchema = {
	type: 'function',
	function: {
		name: 'list_files',
		description:
			'Browse directory contents and file structure. Use to explore project layout. Example: {"directory": "src", "pattern": "*.js", "recursive": true}',
		parameters: {
			type: 'object',
			properties: {
				directory: {
					type: 'string',
					description:
						'Directory path to list. Use "." or "" for current directory, "src" for subdirectory. DO NOT include leading slash.',
					default: '.',
				},
				pattern: {
					type: 'string',
					description: 'File pattern filter ("*.py", "test_*", etc.)',
					default: '*',
				},
				recursive: {
					type: 'boolean',
					description: 'List subdirectories recursively',
					default: false,
				},
				show_hidden: {
					type: 'boolean',
					description: 'Include hidden files (.gitignore, .env, etc.)',
					default: false,
				},
			},
			required: [],
		},
	},
};

// All tools combined
export const ALL_TOOL_SCHEMAS = [
	READ_FILE_SCHEMA,
	SEARCH_FILES_SCHEMA,
	LIST_FILES_SCHEMA,
	EXECUTE_COMMAND_SCHEMA,
];

// Safe tools that can be auto-executed without approval
export const SAFE_TOOLS = ['read_file', 'list_files', 'search_files'];

// Tools that require approval, unless auto-approval is enabled
export const APPROVAL_REQUIRED_TOOLS: string[] = [];

// Dangerous tools that always require approval
export const DANGEROUS_TOOLS = ['execute_command'];
