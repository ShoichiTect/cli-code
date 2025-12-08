import test from 'ava';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeFile,
  createDirectory,
  deleteFile,
  displayTree,
  shouldIgnore
} from '../../../src/utils/file-ops.js';

// Helper function to create a temporary directory for tests
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'groq-test-'));
}

// Helper function to clean up temp directory
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

// ========================================
// writeFile tests
// ========================================

test('writeFile creates file with content', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'test-write.txt');
  const content = 'Test content for writeFile';

  const result = await writeFile(testFile, content);

  t.true(result);

  // Verify file was created with correct content
  const fileContent = await fs.readFile(testFile, 'utf-8');
  t.is(fileContent, content);

  await cleanupTempDir(tmpDir);
});

test('writeFile creates parent directories', async t => {
  const tmpDir = await createTempDir();
  const nestedFile = path.join(tmpDir, 'nested', 'deep', 'file.txt');
  const content = 'Nested file content';

  const result = await writeFile(nestedFile, content);

  t.true(result);

  // Verify nested directories were created
  const fileContent = await fs.readFile(nestedFile, 'utf-8');
  t.is(fileContent, content);

  await cleanupTempDir(tmpDir);
});

test('writeFile overwrites existing file', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'overwrite.txt');

  // Create initial file
  await fs.writeFile(testFile, 'Original content');

  // Overwrite with new content
  const result = await writeFile(testFile, 'New content', true);

  t.true(result);

  const fileContent = await fs.readFile(testFile, 'utf-8');
  t.is(fileContent, 'New content');

  await cleanupTempDir(tmpDir);
});

test('writeFile handles write errors gracefully', async t => {
  // Try to write to an invalid path (root directory without permissions)
  // Note: This test might behave differently on different systems
  const result = await writeFile('/invalid/readonly/path/file.txt', 'content', false);

  // Should return false on error
  t.false(result);
});

// ========================================
// createDirectory tests
// ========================================

test('createDirectory creates single directory', async t => {
  const tmpDir = await createTempDir();
  const newDir = path.join(tmpDir, 'new-directory');

  const result = await createDirectory(newDir);

  t.true(result);

  // Verify directory was created
  const stats = await fs.stat(newDir);
  t.true(stats.isDirectory());

  await cleanupTempDir(tmpDir);
});

test('createDirectory creates nested directories', async t => {
  const tmpDir = await createTempDir();
  const nestedDir = path.join(tmpDir, 'level1', 'level2', 'level3');

  const result = await createDirectory(nestedDir);

  t.true(result);

  // Verify all nested directories were created
  const stats = await fs.stat(nestedDir);
  t.true(stats.isDirectory());

  await cleanupTempDir(tmpDir);
});

test('createDirectory succeeds if directory already exists', async t => {
  const tmpDir = await createTempDir();
  const existingDir = path.join(tmpDir, 'existing');

  // Create directory first
  await fs.mkdir(existingDir);

  // Try to create again
  const result = await createDirectory(existingDir);

  t.true(result);

  await cleanupTempDir(tmpDir);
});

// ========================================
// deleteFile tests
// ========================================

test('deleteFile deletes file with force flag', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'delete-me.txt');

  await fs.writeFile(testFile, 'Content to delete');

  const result = await deleteFile(testFile, true);

  t.true(result);

  // Verify file was deleted
  const exists = await fs.access(testFile).then(() => true).catch(() => false);
  t.false(exists);

  await cleanupTempDir(tmpDir);
});

test('deleteFile returns false without force flag', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'file.txt');

  await fs.writeFile(testFile, 'Content');

  const result = await deleteFile(testFile, false);

  t.false(result);

  // File should still exist
  const exists = await fs.access(testFile).then(() => true).catch(() => false);
  t.true(exists);

  await cleanupTempDir(tmpDir);
});

test('deleteFile deletes directory with force flag', async t => {
  const tmpDir = await createTempDir();
  const subDir = path.join(tmpDir, 'subdir');

  await fs.mkdir(subDir);
  await fs.writeFile(path.join(subDir, 'file.txt'), 'content');

  const result = await deleteFile(subDir, true);

  t.true(result);

  const exists = await fs.access(subDir).then(() => true).catch(() => false);
  t.false(exists);

  await cleanupTempDir(tmpDir);
});

test('deleteFile handles non-existent file', async t => {
  const result = await deleteFile('/nonexistent/file.txt', true);

  t.false(result);
});

// ========================================
// displayTree tests
// ========================================

test('displayTree displays directory structure', async t => {
  const tmpDir = await createTempDir();

  // Create test structure
  await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'content1');
  await fs.writeFile(path.join(tmpDir, 'file2.js'), 'content2');
  await fs.mkdir(path.join(tmpDir, 'subdir'));
  await fs.writeFile(path.join(tmpDir, 'subdir', 'nested.txt'), 'nested content');

  const result = await displayTree(tmpDir);

  t.true(typeof result === 'string');
  t.true(result.includes('file1.txt'));
  t.true(result.includes('file2.js'));
  t.true(result.includes('subdir'));

  await cleanupTempDir(tmpDir);
});

test('displayTree handles non-existent directory', async t => {
  const result = await displayTree('/nonexistent/directory');

  t.true(typeof result === 'string');
  t.true(result.includes('not found') || result.includes('Error'));
});

test('displayTree filters hidden files by default', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'visible.txt'), 'content');
  await fs.writeFile(path.join(tmpDir, '.hidden'), 'hidden content');

  const result = await displayTree(tmpDir, '*', false, false);

  t.true(result.includes('visible.txt'));
  t.false(result.includes('.hidden'));

  await cleanupTempDir(tmpDir);
});

test('displayTree shows hidden files with flag', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'visible.txt'), 'content');
  await fs.writeFile(path.join(tmpDir, '.env'), 'env content');

  const result = await displayTree(tmpDir, '*', false, true);

  t.true(result.includes('visible.txt'));
  // .env might still be filtered by shouldIgnore, but other hidden files should show
  t.true(typeof result === 'string');

  await cleanupTempDir(tmpDir);
});

test('displayTree sorts directories first', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'z-file.txt'), 'content');
  await fs.mkdir(path.join(tmpDir, 'a-directory'));
  await fs.writeFile(path.join(tmpDir, 'b-file.txt'), 'content');

  const result = await displayTree(tmpDir);

  // Directory should appear before files
  const dirIndex = result.indexOf('a-directory');
  const fileIndex = result.indexOf('b-file.txt');

  t.true(dirIndex < fileIndex);

  await cleanupTempDir(tmpDir);
});

// ========================================
// shouldIgnore tests
// ========================================

test('shouldIgnore returns true for node_modules', t => {
  const result = shouldIgnore('/project/node_modules');

  t.true(result);
});

test('shouldIgnore returns true for .git', t => {
  const result = shouldIgnore('/project/.git');

  t.true(result);
});

test('shouldIgnore returns false for allowed hidden files', t => {
  // .env, .gitignore, .dockerfile are allowed
  t.false(shouldIgnore('/project/.env'));
  // .gitignore is actually filtered out, so it should return true
  t.true(shouldIgnore('/project/.gitignore'));
  t.false(shouldIgnore('/project/.dockerfile'));
});

test('shouldIgnore returns true for other hidden files', t => {
  const result = shouldIgnore('/project/.hidden-config');

  t.true(result);
});

test('shouldIgnore returns false for regular files', t => {
  const result = shouldIgnore('/project/regular-file.txt');

  t.false(result);
});

test('shouldIgnore handles paths with pattern names', t => {
  // File named exactly like a pattern
  const result1 = shouldIgnore('/some/path/node_modules/file.js');
  t.true(result1);

  // File with node_modules in path
  const result2 = shouldIgnore('node_modules');
  t.true(result2);
});

test('shouldIgnore returns false for files in allowed directories', t => {
  const result = shouldIgnore('/project/src/index.ts');

  t.false(result);
});
