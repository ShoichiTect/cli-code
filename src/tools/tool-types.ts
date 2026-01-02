export const TOOL_NAMES = [
	'read_file',
	'list_files',
	'search_files',
	'execute_command',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ReadFileArgs = {
	file_path: string;
	start_line?: number;
	end_line?: number;
};

export type ListFilesArgs = {
	directory: string;
	pattern?: string;
	recursive?: boolean;
	show_hidden?: boolean;
};

export type SearchFilesArgs = {
	pattern: string;
	file_pattern?: string;
	directory?: string;
	case_sensitive?: boolean;
	pattern_type?: 'substring' | 'regex' | 'exact' | 'fuzzy';
	file_types?: string[];
	exclude_dirs?: string[];
	exclude_files?: string[];
	max_results?: number;
	context_lines?: number;
	group_by_file?: boolean;
};

export type ExecuteCommandArgs = {
	command: string;
	command_type: 'bash' | 'python' | 'setup' | 'run';
	working_directory?: string;
	timeout?: number;
};

export type ToolArgs =
	| ReadFileArgs
	| ListFilesArgs
	| SearchFilesArgs
	| ExecuteCommandArgs;

export type ToolArgsByName = {
	read_file: ReadFileArgs;
	list_files: ListFilesArgs;
	search_files: SearchFilesArgs;
	execute_command: ExecuteCommandArgs;
};

export function isToolName(name: string): name is ToolName {
	return (TOOL_NAMES as readonly string[]).includes(name);
}
