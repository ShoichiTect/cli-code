/**
 * Security filter for dangerous/sensitive files
 * Prevents accidental reading of sensitive configuration files
 */

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

/**
 * Check if a file path is potentially dangerous
 * Returns true if the file should be blocked
 */
export function isDangerousFile(filePath: string): boolean {
	if (!filePath) return false;

	const lowerPath = filePath.toLowerCase();
	const fileName =
		filePath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';

	// First check if any dangerous directory is in the path
	// This catches paths like .ssh/id_rsa, /home/user/.aws/credentials, etc.
	for (const dangerousDir of DANGEROUS_DIRECTORIES) {
		// Match patterns like: .ssh/, .ssh\, /.ssh/, \.ssh\, or just .ssh at start
		if (
			lowerPath.includes('/.ssh/') ||
			lowerPath.includes('\\.ssh\\') ||
			lowerPath.startsWith('.ssh/') ||
			lowerPath.startsWith('.ssh\\') ||
			lowerPath.includes('/.aws/') ||
			lowerPath.includes('\\.aws\\') ||
			lowerPath.startsWith('.aws/') ||
			lowerPath.startsWith('.aws\\') ||
			lowerPath.includes('/.git/') ||
			lowerPath.includes('\\.git\\') ||
			lowerPath.startsWith('.git/') ||
			lowerPath.startsWith('.git\\') ||
			lowerPath.includes('/.credentials/') ||
			lowerPath.includes('\\.credentials\\') ||
			lowerPath.startsWith('.credentials/') ||
			lowerPath.startsWith('.credentials\\')
		) {
			return true;
		}
	}

	// Check exact matches and patterns in DANGEROUS_FILES
	for (const dangerous of DANGEROUS_FILES) {
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

	const lowerPath = dirPath.toLowerCase();
	const dirName =
		dirPath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';

	for (const dangerous of DANGEROUS_DIRECTORIES) {
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
