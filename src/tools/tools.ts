import * as fs from 'fs';
import * as path from 'path';
import {exec} from 'child_process';
import {promisify} from 'util';
import {displayTree} from '../utils/file-ops.js';
import {
	validateCommandOperation,
	validateFileOperation,
} from './security-filter.js';
import type {ToolArgsByName, ToolName} from './tool-types.js';

const execAsync = promisify(exec);

// Debug logging utilities (shared with agent.ts)
const DEBUG_LOG_FILE = path.join(process.cwd(), 'debug-agent.log');
let debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
	debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
	return debugEnabled;
}

export function toolDebugLog(message: string, data?: any): void {
	if (!debugEnabled) return;

	const timestamp = new Date().toISOString();
	const logEntry = `[${timestamp}] [TOOL] ${message}${
		data ? '\n' + JSON.stringify(data, null, 2) : ''
	}\\n`;
	fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
}

export interface ToolResult {
	success: boolean;
	content?: unknown;
	data?: unknown;
	message?: string;
	error?: string;
	stack?: string;
	exitCode?: number | null;
	signal?: string | null;
	timedOut?: boolean;
	userRejected?: boolean;
}

/**
 * Format key parameters for tool call display
 */
export function formatToolParams(
	toolName: ToolName,
	toolArgs: ToolArgsByName[ToolName],
	options: {includePrefix?: boolean; separator?: string} = {},
): string {
	const {includePrefix = true, separator = '='} = options;

	const paramMappings: Record<string, string[]> = {
		read_file: ['file_path'],
		list_files: ['directory'],
		search_files: ['pattern'],
		execute_command: ['command'],
	};

	const keyParams = paramMappings[toolName] || [];

	if (keyParams.length === 0) {
		return '';
	}

	const paramParts = keyParams
		.filter(param => param in toolArgs)
		.map(param => {
			let value = (toolArgs as Record<string, unknown>)[param];
			// Truncate long values
			if (typeof value === 'string' && value.length > 50) {
				value = value.substring(0, 47) + '...';
			} else if (Array.isArray(value) && value.length > 3) {
				value = `[${value.length} items]`;
			}
			return `${param}${separator}${JSON.stringify(value)}`;
		});

	if (paramParts.length === 0) {
		return includePrefix
			? `Arguments: ${JSON.stringify(toolArgs)}`
			: JSON.stringify(toolArgs);
	}

	const formattedParams = paramParts.join(', ');
	return includePrefix ? `Parameters: ${formattedParams}` : formattedParams;
}

/**
 * Create a standardized tool response format
 */
export function createToolResponse(
	success: boolean,
	data?: any,
	message: string = '',
	error: string = '',
): ToolResult {
	const response: ToolResult = {success};

	if (success) {
		if (data !== undefined) {
			response.content = data;
		}
		if (message) {
			response.message = message;
		}
	} else {
		response.error = error;
		if (message) {
			response.message = message;
		}
	}

	return response;
}

/**
 * Read the contents of a file, optionally specifying line range
 */
export async function readFile(
	filePath: string,
	startLine?: number,
	endLine?: number,
): Promise<ToolResult> {
	try {
		// Security check: Block reading dangerous files
		const validation = validateFileOperation(filePath, 'read');
		if (!validation.allowed) {
			return createToolResponse(false, undefined, '', validation.reason);
		}

		const resolvedPath = path.resolve(filePath);

		// Check if file exists
		try {
			await fs.promises.access(resolvedPath);
		} catch {
			return createToolResponse(false, undefined, '', 'Error: File not found');
		}

		const stats = await fs.promises.stat(resolvedPath);
		if (!stats.isFile()) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Path is not a file',
			);
		}

		// Check file size (50MB limit)
		if (stats.size > 50 * 1024 * 1024) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: File too large (max 50MB)',
			);
		}

		const content = await fs.promises.readFile(resolvedPath, 'utf-8');
		const lines = content.split('\n');

		// Handle line range if specified
		if (startLine !== undefined) {
			const startIdx = Math.max(0, startLine - 1); // Convert to 0-indexed
			let endIdx = lines.length;

			if (endLine !== undefined) {
				endIdx = Math.min(lines.length, endLine);
			}

			if (startIdx >= lines.length) {
				return createToolResponse(
					false,
					undefined,
					'',
					'Error: Start line exceeds file length',
				);
			}

			const selectedLines = lines.slice(startIdx, endIdx);
			const selectedContent = selectedLines.join('\n');
			const message = `Read lines ${startLine}-${endIdx} from ${filePath}`;

			return createToolResponse(true, selectedContent, message);
		} else {
			const message = `Read ${lines.length} lines from ${filePath}`;
			return createToolResponse(true, content, message);
		}
	} catch (error) {
		if ((error as any).code === 'ENOENT') {
			return createToolResponse(false, undefined, '', 'Error: File not found');
		}
		return createToolResponse(
			false,
			undefined,
			'',
			'Error: Failed to read file',
		);
	}
}

/**
 * List files and directories in a path with tree-style display
 */
export async function listFiles(
	directory: string = '.',
	pattern: string = '*',
	recursive: boolean = false,
	showHidden: boolean = false,
): Promise<ToolResult> {
	try {
		const dirPath = path.resolve(directory);

		const exists = await fs.promises
			.access(dirPath)
			.then(() => true)
			.catch(() => false);
		if (!exists) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Directory not found',
			);
		}

		const stats = await fs.promises.stat(dirPath);
		if (!stats.isDirectory()) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Path is not a directory',
			);
		}

		// Get tree display output
		const treeOutput = await displayTree(
			directory,
			pattern,
			recursive,
			showHidden,
		);

		return createToolResponse(true, treeOutput, `Listed ${directory}`);
	} catch (error) {
		return createToolResponse(
			false,
			undefined,
			'',
			'Error: Failed to list files',
		);
	}
}

/**
 * Search for text patterns in files with advanced filtering and matching options
 */
export async function searchFiles(
	pattern: string,
	filePattern: string = '*',
	directory: string = '.',
	caseSensitive: boolean = false,
	patternType: 'substring' | 'regex' | 'exact' | 'fuzzy' = 'substring',
	fileTypes?: string[],
	excludeDirs?: string[],
	excludeFiles?: string[],
	maxResults: number = 100,
	contextLines: number = 0,
	groupByFile: boolean = false,
): Promise<ToolResult> {
	try {
		const searchDir = path.resolve(directory);

		// Check if directory exists
		const exists = await fs.promises
			.access(searchDir)
			.then(() => true)
			.catch(() => false);
		if (!exists) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Directory not found',
			);
		}

		const stats = await fs.promises.stat(searchDir);
		if (!stats.isDirectory()) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Path is not a directory',
			);
		}

		// Default exclusions
		const defaultExcludeDirs = [
			'.git',
			'node_modules',
			'.next',
			'dist',
			'build',
			'.cache',
		];
		const defaultExcludeFiles = ['*.log', '*.tmp', '*.cache', '*.lock'];

		const finalExcludeDirs = [...defaultExcludeDirs, ...(excludeDirs || [])];
		const finalExcludeFiles = [...defaultExcludeFiles, ...(excludeFiles || [])];

		// Prepare search regex
		let searchRegex: RegExp;
		try {
			switch (patternType) {
				case 'exact':
					searchRegex = new RegExp(
						escapeRegex(pattern),
						caseSensitive ? 'g' : 'gi',
					);
					break;
				case 'regex':
					searchRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
					break;
				case 'fuzzy':
					// Simple fuzzy search, insert .* between characters
					const fuzzyPattern = pattern.split('').map(escapeRegex).join('.*');
					searchRegex = new RegExp(fuzzyPattern, caseSensitive ? 'g' : 'gi');
					break;
				case 'substring':
				default:
					searchRegex = new RegExp(
						escapeRegex(pattern),
						caseSensitive ? 'g' : 'gi',
					);
					break;
			}
		} catch (error) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Invalid regex pattern',
			);
		}

		// Collect all files to search
		const filesToSearch = await collectFiles(
			searchDir,
			filePattern,
			fileTypes,
			finalExcludeDirs,
			finalExcludeFiles,
		);

		if (filesToSearch.length === 0) {
			return createToolResponse(true, [], 'No files found matching criteria');
		}

		// Search through files
		const results: SearchResult[] = [];
		let totalMatches = 0;

		for (const filePath of filesToSearch) {
			if (totalMatches >= maxResults) {
				break;
			}

			try {
				const content = await fs.promises.readFile(filePath, 'utf-8');
				const lines = content.split('\n');
				const fileMatches: SearchMatch[] = [];

				for (let i = 0; i < lines.length && totalMatches < maxResults; i++) {
					const line = lines[i];
					const matches = Array.from(line.matchAll(searchRegex));

					if (matches.length > 0) {
						const contextStart = Math.max(0, i - contextLines);
						const contextEnd = Math.min(lines.length - 1, i + contextLines);

						const contextLinesArray: string[] = [];
						for (let j = contextStart; j <= contextEnd; j++) {
							contextLinesArray.push(lines[j]);
						}

						fileMatches.push({
							lineNumber: i + 1,
							lineContent: line,
							contextLines: contextLines > 0 ? contextLinesArray : undefined,
							matchPositions: matches.map(match => ({
								start: match.index || 0,
								end: (match.index || 0) + match[0].length,
								text: match[0],
							})),
						});

						totalMatches++;
					}
				}

				if (fileMatches.length > 0) {
					results.push({
						filePath: path.relative(process.cwd(), filePath),
						matches: fileMatches,
						totalMatches: fileMatches.length,
					});
				}
			} catch (error) {
				// Skip files that can't be read (binary files, permission issues, etc.)
				continue;
			}
		}

		// Format results
		let formattedResults: any;
		if (groupByFile) {
			formattedResults = results;
		} else {
			// Flatten results
			formattedResults = results.flatMap(fileResult =>
				fileResult.matches.map(match => ({
					filePath: fileResult.filePath,
					lineNumber: match.lineNumber,
					lineContent: match.lineContent,
					contextLines: match.contextLines,
					matchPositions: match.matchPositions,
				})),
			);
		}

		const message = `Found ${totalMatches} match(es) in ${results.length} file(s)`;
		return createToolResponse(true, formattedResults, message);
	} catch (error) {
		return createToolResponse(
			false,
			undefined,
			'',
			'Error: Failed to search files',
		);
	}
}

// Helper interfaces for search results
interface SearchMatch {
	lineNumber: number;
	lineContent: string;
	contextLines?: string[];
	matchPositions: Array<{
		start: number;
		end: number;
		text: string;
	}>;
}

interface SearchResult {
	filePath: string;
	matches: SearchMatch[];
	totalMatches: number;
}

// Helper function to escape regex special characters
function escapeRegex(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to collect files based on patterns and filters
async function collectFiles(
	directory: string,
	filePattern: string,
	fileTypes?: string[],
	excludeDirs?: string[],
	excludeFiles?: string[],
): Promise<string[]> {
	const files: string[] = [];

	async function walkDirectory(dir: string): Promise<void> {
		try {
			const entries = await fs.promises.readdir(dir, {withFileTypes: true});

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					// Check if directory should be excluded
					if (
						excludeDirs &&
						excludeDirs.some(pattern => matchesPattern(entry.name, pattern))
					) {
						continue;
					}
					// Skip hidden directories unless explicitly included
					if (
						entry.name.startsWith('.') &&
						!entry.name.match(/^\.(config|env)$/)
					) {
						continue;
					}
					await walkDirectory(fullPath);
				} else if (entry.isFile()) {
					// Check file type filters
					if (fileTypes && fileTypes.length > 0) {
						const ext = path.extname(entry.name).slice(1);
						if (!fileTypes.includes(ext)) {
							continue;
						}
					}

					// Check file pattern
					if (!matchesPattern(entry.name, filePattern)) {
						continue;
					}

					// Check exclusions
					if (
						excludeFiles &&
						excludeFiles.some(pattern => matchesPattern(entry.name, pattern))
					) {
						continue;
					}

					// Skip obviously binary files
					if (isBinaryFile(entry.name)) {
						continue;
					}

					files.push(fullPath);
				}
			}
		} catch (error) {
			// Skip directories we can't read
		}
	}

	await walkDirectory(directory);
	return files;
}

// Helper function to match glob-like patterns
function matchesPattern(filename: string, pattern: string): boolean {
	if (pattern === '*') return true;

	// Simple glob matching, convert * to .* and ? to .
	const regexPattern = pattern
		.replace(/\./g, '\\.')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');

	return new RegExp(`^${regexPattern}$`, 'i').test(filename);
}

// Helper function to detect binary files
function isBinaryFile(filename: string): boolean {
	const binaryExtensions = [
		'.exe',
		'.dll',
		'.so',
		'.dylib',
		'.bin',
		'.obj',
		'.o',
		'.a',
		'.lib',
		'.jpg',
		'.jpeg',
		'.png',
		'.gif',
		'.bmp',
		'.ico',
		'.svg',
		'.webp',
		'.mp3',
		'.mp4',
		'.avi',
		'.mov',
		'.wmv',
		'.flv',
		'.webm',
		'.zip',
		'.tar',
		'.gz',
		'.bz2',
		'.rar',
		'.7z',
		'.pdf',
		'.doc',
		'.docx',
		'.xls',
		'.xlsx',
		'.ppt',
		'.pptx',
	];

	const ext = path.extname(filename).toLowerCase();
	return binaryExtensions.includes(ext);
}

/**
 * Execute a shell command or run code
 */
export async function executeCommand(
	command: string,
	commandType: string,
	workingDirectory?: string,
	timeout: number = 30000,
): Promise<ToolResult> {
	try {
		const validation = validateCommandOperation(command);
		if (!validation.allowed) {
			return createToolResponse(false, undefined, '', validation.reason);
		}

		// Validate command type
		if (!['bash', 'python', 'setup', 'run'].includes(commandType)) {
			return createToolResponse(
				false,
				undefined,
				'',
				'Error: Invalid command_type',
			);
		}

		let originalCwd: string | undefined;
		if (workingDirectory) {
			const wdPath = path.resolve(workingDirectory);
			const exists = await fs.promises
				.access(wdPath)
				.then(() => true)
				.catch(() => false);
			if (!exists) {
				return createToolResponse(
					false,
					undefined,
					'',
					'Error: Working directory not found',
				);
			}
			originalCwd = process.cwd();
			process.chdir(workingDirectory);
		}

		try {
			let execCommand: string;
			if (commandType === 'python') {
				execCommand = `python -c "${command.replace(/"/g, '\\"')}"`;
			} else {
				execCommand = command;
			}

			const {stdout, stderr} = await execAsync(execCommand, {timeout});
			const success = true; // If no error was thrown, consider it successful

			return createToolResponse(
				success,
				`stdout: ${stdout}\nstderr: ${stderr}`,
				`Command executed successfully`,
			);
		} finally {
			// Restore original working directory
			if (originalCwd) {
				process.chdir(originalCwd);
			}
		}
	} catch (error: any) {
		const isTimeout = error.killed && error.signal === 'SIGTERM';
		const stdout =
			typeof error?.stdout === 'string' ? error.stdout : undefined;
		const stderr =
			typeof error?.stderr === 'string' ? error.stderr : undefined;
		const content =
			stdout || stderr
				? `stdout: ${stdout ?? ''}\nstderr: ${stderr ?? ''}`
				: undefined;
		const exitCode =
			typeof error?.code === 'number' ? error.code : undefined;
		const signal = typeof error?.signal === 'string' ? error.signal : undefined;
		if (isTimeout) {
			return {
				success: false,
				content,
				error: 'Error: Command timed out',
				stack: error instanceof Error ? error.stack : undefined,
				exitCode,
				signal,
				timedOut: true,
			};
		}
		return {
			success: false,
			content,
			error: 'Error: Failed to execute command',
			stack: error instanceof Error ? error.stack : undefined,
			exitCode,
			signal,
			timedOut: false,
		};
	}
}

// Tool Registry: maps tool names to functions
export const TOOL_REGISTRY = {
	read_file: readFile,
	list_files: listFiles,
	search_files: searchFiles,
	execute_command: executeCommand,
};

/**
 * Execute a tool by name with given arguments
 */
export async function executeTool<T extends ToolName>(
	toolName: T,
	toolArgs: ToolArgsByName[T],
): Promise<ToolResult> {
	if (!(toolName in TOOL_REGISTRY)) {
		const errorMsg = `Unknown tool: ${toolName}`;
		toolDebugLog(errorMsg);
		return createToolResponse(false, undefined, '', 'Error: ' + errorMsg);
	}

	try {
		// Debug: log tool execution start
		toolDebugLog(`Executing tool: ${toolName}`, {
			args: toolArgs,
		});

		let result: ToolResult;

		// Call the function with the appropriate arguments based on the tool
		switch (toolName) {
			case 'read_file': {
				const args = toolArgs as ToolArgsByName['read_file'];
				result = await readFile(
					args.file_path,
					args.start_line,
					args.end_line,
				);
				break;
			}
			case 'list_files': {
				const args = toolArgs as ToolArgsByName['list_files'];
				result = await listFiles(
					args.directory,
					args.pattern,
					args.recursive,
					args.show_hidden,
				);
				break;
			}
			case 'search_files': {
				const args = toolArgs as ToolArgsByName['search_files'];
				result = await searchFiles(
					args.pattern,
					args.file_pattern,
					args.directory,
					args.case_sensitive,
					args.pattern_type,
					args.file_types,
					args.exclude_dirs,
					args.exclude_files,
					args.max_results,
					args.context_lines,
					args.group_by_file,
				);
				break;
			}
			case 'execute_command': {
				const args = toolArgs as ToolArgsByName['execute_command'];
				result = await executeCommand(
					args.command,
					args.command_type,
					args.working_directory,
					args.timeout,
				);
				break;
			}
			default:
				result = createToolResponse(
					false,
					undefined,
					'',
					'Error: Tool not implemented',
				);
		}

		// Debug: log tool execution result
		toolDebugLog(`Tool execution completed: ${toolName}`, {
			success: result.success,
			hasError: !!result.error,
			errorMsg: result.error ? result.error.substring(0, 100) : undefined,
			hasData: !!result.data || !!result.content,
		});

		return result;
	} catch (error) {
		const errorMsg =
			error instanceof TypeError
				? 'Invalid tool arguments'
				: 'Unexpected tool error';

		toolDebugLog(`Tool execution error: ${toolName}`, {
			errorType: error instanceof TypeError ? 'TypeError' : 'Error',
			message: String(error),
		});

		return {
			success: false,
			error: 'Error: ' + errorMsg,
			stack: error instanceof Error ? error.stack : undefined,
		};
	}
}
