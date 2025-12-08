import test from 'ava';
import {
  isDangerousFile,
  isDangerousDirectory,
  isPathDangerous,
  validateFileOperation
} from '../../../src/tools/security-filter.js';

// ========================================
// isDangerousFile tests
// ========================================

test('isDangerousFile detects .env file', t => {
  t.true(isDangerousFile('.env'));
  t.true(isDangerousFile('/path/to/.env'));
  t.true(isDangerousFile('some/path/.env'));
});

test('isDangerousFile detects .env.local file', t => {
  t.true(isDangerousFile('.env.local'));
  t.true(isDangerousFile('/path/to/.env.local'));
});

test('isDangerousFile detects .env.production file', t => {
  t.true(isDangerousFile('.env.production'));
  t.true(isDangerousFile('/path/to/.env.production'));
});

test('isDangerousFile detects .env.development file', t => {
  t.true(isDangerousFile('.env.development'));
  t.true(isDangerousFile('/path/to/.env.development'));
});

test('isDangerousFile detects .aws directory file', t => {
  t.true(isDangerousFile('.aws'));
  t.true(isDangerousFile('/home/user/.aws'));
  t.true(isDangerousFile('.aws/credentials'));
});

test('isDangerousFile detects .ssh directory file', t => {
  t.true(isDangerousFile('.ssh'));
  t.true(isDangerousFile('/home/user/.ssh'));
  t.true(isDangerousFile('.ssh/id_rsa'));
});

test('isDangerousFile detects .credentials file', t => {
  t.true(isDangerousFile('.credentials'));
  t.true(isDangerousFile('/path/to/.credentials'));
});

test('isDangerousFile detects secrets.json file', t => {
  t.true(isDangerousFile('secrets.json'));
  t.true(isDangerousFile('/path/to/secrets.json'));
  t.true(isDangerousFile('secrets.prod.json'));
});

test('isDangerousFile detects api-key file', t => {
  t.true(isDangerousFile('api-key'));
  t.true(isDangerousFile('/path/to/api-key'));
});

test('isDangerousFile detects api-keys.json file', t => {
  t.true(isDangerousFile('api-keys.json'));
  t.true(isDangerousFile('/path/to/api-keys.json'));
});

test('isDangerousFile detects private_key file', t => {
  t.true(isDangerousFile('private_key'));
  t.true(isDangerousFile('private_key.pem'));
  t.true(isDangerousFile('/path/to/private_key'));
});

test('isDangerousFile detects .npmrc file', t => {
  t.true(isDangerousFile('.npmrc'));
  t.true(isDangerousFile('/home/user/.npmrc'));
});

test('isDangerousFile detects .yarnrc file', t => {
  t.true(isDangerousFile('.yarnrc'));
  t.true(isDangerousFile('/home/user/.yarnrc'));
});

test('isDangerousFile detects .git/config file', t => {
  t.true(isDangerousFile('.git/config'));
  t.true(isDangerousFile('/path/to/.git/config'));
});

test('isDangerousFile detects credentials file', t => {
  t.true(isDangerousFile('credentials'));
  t.true(isDangerousFile('/path/to/credentials'));
});

test('isDangerousFile allows safe files', t => {
  t.false(isDangerousFile('app.js'));
  t.false(isDangerousFile('README.md'));
  t.false(isDangerousFile('package.json'));
  t.false(isDangerousFile('src/index.ts'));
  t.false(isDangerousFile('/path/to/normal-file.txt'));
});

test('isDangerousFile is case-insensitive', t => {
  t.true(isDangerousFile('.ENV'));
  t.true(isDangerousFile('.Env'));
  t.true(isDangerousFile('.SSH'));
  t.true(isDangerousFile('.AWS'));
});

// ========================================\n// isDangerousDirectory tests\n// ========================================\n\ntest('isDangerousDirectory detects .git directory', t => {\n  t.true(isDangerousDirectory('.git'));\n  t.true(isDangerousDirectory('/path/to/.git'));\n});\n\ntest('isDangerousDirectory detects .ssh directory', t => {\n  t.true(isDangerousDirectory('.ssh'));\n  t.true(isDangerousDirectory('/home/user/.ssh'));\n});\n\ntest('isDangerousDirectory detects .aws directory', t => {\n  t.true(isDangerousDirectory('.aws'));\n  t.true(isDangerousDirectory('/home/user/.aws'));\n});\n\ntest('isDangerousDirectory detects .credentials directory', t => {\n  t.true(isDangerousDirectory('.credentials'));\n  t.true(isDangerousDirectory('/path/to/.credentials'));\n});\n\ntest('isDangerousDirectory detects node_modules directory', t => {\n  t.true(isDangerousDirectory('node_modules'));\n  t.true(isDangerousDirectory('/path/to/node_modules'));\n});\n\ntest('isDangerousDirectory allows safe directories', t => {\n  t.false(isDangerousDirectory('src'));\n  t.false(isDangerousDirectory('lib'));\n  t.false(isDangerousDirectory('test'));\n  t.false(isDangerousDirectory('/path/to/safe-dir'));\n});\n\n// ========================================\n// isPathDangerous tests\n// ========================================\n\ntest('isPathDangerous combines file and directory checks', t => {\n  // Files\n  t.true(isPathDangerous('.env'));\n  t.true(isPathDangerous('secrets.json'));\n  \n  // Directories\n  t.true(isPathDangerous('.git'));\n  t.true(isPathDangerous('node_modules'));\n  \n  // Safe paths\n  t.false(isPathDangerous('app.js'));\n  t.false(isPathDangerous('src/index.ts'));\n});\n\ntest('isPathDangerous detects nested dangerous paths', t => {\n  t.true(isPathDangerous('/root/.ssh/id_rsa'));\n  t.true(isPathDangerous('/home/user/.aws/credentials'));\n  t.true(isPathDangerous('/project/.git/config'));\n});\n\n// ========================================\n// validateFileOperation tests\n// ========================================\n\ntest('validateFileOperation blocks read on dangerous file', t => {\n  const result = validateFileOperation('.env', 'read');\n  \n  t.false(result.allowed);\n  t.true(result.reason?.includes('read'));\n  t.true(result.reason?.includes('.env'));\n});\n\ntest('validateFileOperation blocks write on dangerous file', t => {\n  const result = validateFileOperation('secrets.json', 'write');\n  \n  t.false(result.allowed);\n  t.true(result.reason?.includes('write'));\n  t.true(result.reason?.includes('secrets.json'));\n});\n\ntest('validateFileOperation blocks delete on dangerous file', t => {\n  const result = validateFileOperation('.ssh', 'delete');\n  \n  t.false(result.allowed);\n  t.true(result.reason?.includes('delete'));\n  t.true(result.reason?.includes('.ssh'));\n});\n\ntest('validateFileOperation allows operations on safe files', t => {\n  const readResult = validateFileOperation('app.js', 'read');\n  const writeResult = validateFileOperation('config.json', 'write');\n  const deleteResult = validateFileOperation('temp.txt', 'delete');\n  \n  t.true(readResult.allowed);\n  t.true(writeResult.allowed);\n  t.true(deleteResult.allowed);\n  \n  t.is(readResult.reason, undefined);\n  t.is(writeResult.reason, undefined);\n  t.is(deleteResult.reason, undefined);\n});\n\ntest('validateFileOperation handles complex paths', t => {\n  const dangerousResult = validateFileOperation('/root/.aws/credentials', 'read');\n  const safeResult = validateFileOperation('/project/src/index.ts', 'read');\n  \n  t.false(dangerousResult.allowed);\n  t.true(safeResult.allowed);\n});\n\n// ========================================\n// Edge cases\n// ========================================\n\ntest('isDangerousFile handles empty string', t => {\n  t.false(isDangerousFile(''));\n});\n\ntest('isDangerousDirectory handles empty string', t => {\n  t.false(isDangerousDirectory(''));\n});\n\ntest('isDangerousFile handles paths with multiple slashes', t => {\n  t.true(isDangerousFile('/path//to//.env'));\n  t.true(isDangerousFile('/home///user///.ssh'));\n});\n\ntest('isDangerousFile handles backslashes (Windows paths)', t => {\n  // Note: The function uses forward slashes, but we test that it handles various formats\n  t.true(isDangerousFile('.env'));\n  t.true(isDangerousFile('C:\\\\Users\\\\.env'));\n});\n\ntest('isDangerousFile with pattern matching for .env.* variants', t => {\n  t.true(isDangerousFile('.env.test'));\n  t.true(isDangerousFile('.env.staging'));\n  t.true(isDangerousFile('.env.custom'));\n});\n\ntest('isDangerousFile with pattern matching for secrets.* variants', t => {\n  t.true(isDangerousFile('secrets.dev.json'));\n  t.true(isDangerousFile('secrets.backup.json'));\n});\n"
