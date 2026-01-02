/**
 * Security filter for dangerous/sensitive files
 * Prevents accidental reading of sensitive configuration files
 */
import {ConfigManager} from '../utils/local-settings.js';

// Files that should never be read/edited/deleted
const DANGEROUS_FILES = [
	'.env',
	'.env.local',
	'.env.*.local',
	'.env.production',
	'.env.development',
	'.aws',
	'.credentials',
	'.ssh',
	'.private',
	'secrets.json',
	'secrets.*.json',
	'api-key',
	'api-keys.json',
	'private_key',
	'private_key.pem',
	'.git/config',
	'.npmrc',
	'.yarnrc',
	'credentials',
	'config.json',
];

// Directories that should never be accessed
const DANGEROUS_DIRECTORIES = [
	'.git',
	'.ssh',
	'.aws',
	'.credentials',
	'/root/.ssh',
	'/root/.aws',
	'node_modules',
	'.env.d.ts',
];

const configManager = new ConfigManager();

function mergeConfiguredList(
	defaultList: string[],
	configuredList: string[] | null,
): string[] {
	if (!configuredList || configuredList.length === 0) {
		return defaultList;
	}
	const merged = [...defaultList];
	for (const item of configuredList) {
		if (!merged.includes(item)) {
			merged.push(item);
		}
	}
	return merged;
}

function extractCommandTokens(command: string): string[] {
	const tokens: string[] = [];
	const tokenRegex = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = tokenRegex.exec(command)) !== null) {
		const token = match[1] || match[2] || match[3] || match[4];
		if (token) {
			tokens.push(token);
		}
	}
	return tokens;
}

function normalizeTokenForPathCheck(token: string): string[] {
	const trimmed = token.replace(/^[\s"'`]+|[\s"'`]+$/g, '');
	const stripped = trimmed.replace(/^[;|&><(){}[\],]+|[;|&><(){}[\],]+$/g, '');
	const candidates: string[] = [];

	if (stripped) {
		candidates.push(stripped);
		if (stripped.startsWith('>') || stripped.startsWith('<')) {
			const redir = stripped.slice(1);
			if (redir) {
				candidates.push(redir);
			}
		}
		if (stripped.includes('=')) {
			const afterEq = stripped.split('=').slice(1).join('=');
			if (afterEq) {
				candidates.push(afterEq);
			}
		}
	}

	return candidates;
}

/**
 * Check if a file path is potentially dangerous
 * Returns true if the file should be blocked
 */
export function isDangerousFile(filePath: string): boolean {
	if (!filePath) return false;

	const dangerousDirectories = mergeConfiguredList(
		DANGEROUS_DIRECTORIES,
		configManager.getDangerousDirectories(),
	);
	const dangerousFiles = mergeConfiguredList(
		DANGEROUS_FILES,
		configManager.getDangerousFiles(),
	);

	const lowerPath = filePath.toLowerCase();
	const normalizedPath = lowerPath.replace(/\\/g, '/');
	const fileName =
		filePath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';

	// First check if any dangerous directory is in the path
	// This catches paths like .ssh/id_rsa, /home/user/.aws/credentials, etc.
	for (const dangerousDir of dangerousDirectories) {
		const dangerousLower = dangerousDir.toLowerCase().replace(/\\/g, '/');
		const escapedDir = dangerousLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		if (dangerousLower.startsWith('/')) {
			if (
				normalizedPath === dangerousLower ||
				normalizedPath.startsWith(`${dangerousLower}/`)
			) {
				return true;
			}
		} else {
			const segmentRegex = new RegExp(`(^|/)${escapedDir}(/|$)`);
			if (segmentRegex.test(normalizedPath)) {
				return true;
			}
		}
	}

	// Check exact matches and patterns in DANGEROUS_FILES
	for (const dangerous of dangerousFiles) {
		if (dangerous.includes('*')) {
			// Simple wildcard matching
			const pattern = dangerous.replace(/\./g, '\\.').replace(/\*/g, '.*');
			if (
				new RegExp(`^${pattern}$|/${pattern}$|\\${pattern}$`).test(lowerPath)
			) {
				return true;
			}
		} else {
			// Exact match or path contains
			const dangerousLower = dangerous.toLowerCase();
			if (
				fileName === dangerousLower ||
				lowerPath.includes(`/${dangerousLower}`) ||
				lowerPath.includes(`\\${dangerousLower}`) ||
				lowerPath.endsWith(dangerousLower)
			) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Check if a directory path is potentially dangerous
 */
export function isDangerousDirectory(dirPath: string): boolean {
	if (!dirPath) return false;

	const dangerousDirectories = mergeConfiguredList(
		DANGEROUS_DIRECTORIES,
		configManager.getDangerousDirectories(),
	);

	const lowerPath = dirPath.toLowerCase();
	const dirName =
		dirPath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';

	for (const dangerous of dangerousDirectories) {
		const dangerousLower = dangerous.toLowerCase();
		if (lowerPath.includes(dangerousLower) || dirName === dangerousLower) {
			return true;
		}
	}

	return false;
}

/**
 * Check both file and directory
 */
export function isPathDangerous(filePath: string): boolean {
	return isDangerousFile(filePath) || isDangerousDirectory(filePath);
}

function findDangerousPathInCommand(command: string): string | null {
	const tokens = extractCommandTokens(command);
	for (const token of tokens) {
		const candidates = normalizeTokenForPathCheck(token);
		for (const candidate of candidates) {
			if (isPathDangerous(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

/**
 * Validate file operation against security policy
 * Returns { allowed: boolean, reason?: string }
 */
export function validateFileOperation(
	filePath: string,
	operation: 'read' | 'write' | 'delete',
): {allowed: boolean; reason?: string} {
	if (isPathDangerous(filePath)) {
		return {
			allowed: false,
			reason: `Security policy blocks ${operation} operation on sensitive file: ${filePath}`,
		};
	}

	return {allowed: true};
}

/**
 * Validate command execution against security policy
 * Returns { allowed: boolean, reason?: string }
 */
export function validateCommandOperation(
	command: string,
): {allowed: boolean; reason?: string} {
	if (!command) {
		return {allowed: true};
	}

	const dangerousPath = findDangerousPathInCommand(command);
	if (dangerousPath) {
		return {
			allowed: false,
			reason: `Security policy blocks execute_command referencing sensitive path: ${dangerousPath}`,
		};
	}

	return {allowed: true};
}
