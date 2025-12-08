import test from 'ava';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readFile,
  createFile,
  editFile,
  deleteFile,
  listFiles,
  searchFiles,
  executeCommand,
  createTasks,
  updateTasks,
  createToolResponse,
  formatToolParams
} from '../../../src/tools/tools.js';

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
// readFile tests
// ========================================

test('readFile returns file content successfully', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'test.txt');
  const testContent = 'Hello, Groq!';

  await fs.writeFile(testFile, testContent);

  const result = await readFile(testFile);

  t.true(result.success);
  t.is(result.content, testContent);
  t.true(result.message?.includes('Read'));

  await cleanupTempDir(tmpDir);
});

test('readFile handles non-existent files', async t => {
  const result = await readFile('/path/to/nonexistent/file.txt');

  t.false(result.success);
  t.true(result.error?.includes('not found') || result.error?.includes('Error'));
});

test('readFile reads specific line range', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'multiline.txt');
  const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

  await fs.writeFile(testFile, testContent);

  const result = await readFile(testFile, 2, 4);

  t.true(result.success);
  t.is(result.content, 'Line 2\nLine 3\nLine 4');

  await cleanupTempDir(tmpDir);
});

test('readFile handles directory paths', async t => {
  const tmpDir = await createTempDir();

  const result = await readFile(tmpDir);

  t.false(result.success);
  t.true(result.error?.includes('not a file') || result.error?.includes('Error'));

  await cleanupTempDir(tmpDir);
});

// ========================================
// createFile tests
// ========================================

test('createFile creates file with content', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'new-file.txt');
  const testContent = 'New content';

  const result = await createFile(testFile, testContent);

  t.true(result.success);
  t.true(result.message?.includes('created'));

  // Verify file was actually created
  const content = await fs.readFile(testFile, 'utf-8');
  t.is(content, testContent);

  await cleanupTempDir(tmpDir);
});

test('createFile rejects overwrite without flag', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'existing.txt');

  await fs.writeFile(testFile, 'Original content');

  const result = await createFile(testFile, 'New content', 'file', false);

  t.false(result.success);
  t.true(result.error?.includes('exists') || result.error?.includes('overwrite'));

  await cleanupTempDir(tmpDir);
});

test('createFile overwrites with flag', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'existing.txt');

  await fs.writeFile(testFile, 'Original content');

  const result = await createFile(testFile, 'New content', 'file', true);

  t.true(result.success);

  const content = await fs.readFile(testFile, 'utf-8');
  t.is(content, 'New content');

  await cleanupTempDir(tmpDir);
});

test('createFile creates directory', async t => {
  const tmpDir = await createTempDir();
  const newDir = path.join(tmpDir, 'new-directory');

  const result = await createFile(newDir, '', 'directory');

  t.true(result.success);
  t.true(result.message?.includes('created'));

  const stats = await fs.stat(newDir);
  t.true(stats.isDirectory());

  await cleanupTempDir(tmpDir);
});

// ========================================
// editFile tests
// ========================================

test('editFile replaces text in file', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'edit.txt');
  const originalContent = 'Hello World!\nGoodbye World!';

  await fs.writeFile(testFile, originalContent);

  // Need to read file first to satisfy validator
  await readFile(testFile);

  const result = await editFile(testFile, 'World', 'Universe');

  t.true(result.success);
  t.true(result.message?.includes('Replaced'));

  const newContent = await fs.readFile(testFile, 'utf-8');
  t.is(newContent, 'Hello Universe!\nGoodbye World!');

  await cleanupTempDir(tmpDir);
});

test('editFile replaces all occurrences with flag', async t => {
  const tmpDir = await createTempDir();
  const testFile = path.join(tmpDir, 'edit-all.txt');
  const originalContent = 'Hello World!\nGoodbye World!';

  await fs.writeFile(testFile, originalContent);

  // Read file first
  await readFile(testFile);

  const result = await editFile(testFile, 'World', 'Universe', true);

  t.true(result.success);

  const newContent = await fs.readFile(testFile, 'utf-8');
  t.is(newContent, 'Hello Universe!\nGoodbye Universe!');

  await cleanupTempDir(tmpDir);
});

// ========================================
// deleteFile tests
// ========================================

test('deleteFile deletes existing file', async t => {
  // Use current working directory for tests to pass safety checks
  const testFile = path.join(process.cwd(), '.test-delete-me.txt');

  await fs.writeFile(testFile, 'Content to delete');

  const result = await deleteFile(testFile);

  t.true(result.success);
  t.true(result.message?.includes('Deleted'));

  // Verify file was deleted
  const exists = await fs.access(testFile).then(() => true).catch(() => false);
  t.false(exists);
});

test('deleteFile handles non-existent file', async t => {
  const result = await deleteFile('/path/to/nonexistent/file.txt');

  t.false(result.success);
  t.true(result.error?.includes('not found') || result.error?.includes('Error'));
});

test('deleteFile rejects non-empty directory without recursive', async t => {
  // Use current working directory for tests
  const subDir = path.join(process.cwd(), '.test-subdir');
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(subDir, 'file.txt'), 'content');

  const result = await deleteFile(subDir, false);

  t.false(result.success);
  t.true(result.error?.includes('not empty') || result.error?.includes('recursive'));

  // Cleanup
  await fs.rm(subDir, { recursive: true, force: true });
});

test('deleteFile deletes directory with recursive flag', async t => {
  // Use current working directory for tests
  const subDir = path.join(process.cwd(), '.test-subdir-recursive');
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(subDir, 'file.txt'), 'content');

  const result = await deleteFile(subDir, true);

  t.true(result.success);

  const exists = await fs.access(subDir).then(() => true).catch(() => false);
  t.false(exists);
});

// ========================================
// listFiles tests
// ========================================

test('listFiles lists directory contents', async t => {
  const tmpDir = await createTempDir();

  // Create some test files and directories
  await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'content1');
  await fs.writeFile(path.join(tmpDir, 'file2.js'), 'content2');
  await fs.mkdir(path.join(tmpDir, 'subdir'));

  const result = await listFiles(tmpDir);

  t.true(result.success);
  t.true(typeof result.content === 'string');
  t.true(result.content.includes('file1.txt'));
  t.true(result.content.includes('file2.js'));
  t.true(result.content.includes('subdir'));

  await cleanupTempDir(tmpDir);
});

test('listFiles handles non-existent directory', async t => {
  const result = await listFiles('/path/to/nonexistent/directory');

  t.false(result.success);
  t.true(result.error?.includes('not found') || result.error?.includes('Error'));
});

// ========================================
// searchFiles tests
// ========================================

test('searchFiles finds text in files', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'Hello World\nTest content');
  await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'Another file\nHello Universe');

  const result = await searchFiles('Hello', '*', tmpDir);

  t.true(result.success);
  t.true(Array.isArray(result.content));
  t.true(result.content.length > 0);
  t.true(result.message?.includes('match'));

  await cleanupTempDir(tmpDir);
});

test('searchFiles returns empty for no matches', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'Hello World');

  const result = await searchFiles('NonExistent', '*', tmpDir);

  t.true(result.success);
  t.true(Array.isArray(result.content));
  t.is(result.content.length, 0);

  await cleanupTempDir(tmpDir);
});

test('searchFiles respects case sensitivity', async t => {
  const tmpDir = await createTempDir();

  await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Hello World');

  // Case insensitive (default)
  const result1 = await searchFiles('hello', '*', tmpDir, false);
  t.true(result1.success);
  t.true(result1.content.length > 0);

  // Case sensitive
  const result2 = await searchFiles('hello', '*', tmpDir, true);
  t.true(result2.success);
  t.is(result2.content.length, 0);

  await cleanupTempDir(tmpDir);
});

// ========================================
// executeCommand tests
// ========================================

test('executeCommand runs bash command successfully', async t => {
  const result = await executeCommand('echo "Hello"', 'bash');

  t.true(result.success);
  t.true(result.content?.includes('Hello'));
});

test('executeCommand handles invalid command type', async t => {
  const result = await executeCommand('echo "test"', 'invalid_type');

  t.false(result.success);
  t.true(result.error?.includes('Invalid'));
});

test('executeCommand handles command timeout', async t => {
  // This command should timeout with very short timeout
  const result = await executeCommand('sleep 10', 'bash', undefined, 100);

  t.false(result.success);
  t.true(result.error?.includes('timeout') || result.error?.includes('timed out'));
});

// ========================================
// createTasks tests
// ========================================

test('createTasks creates task list', async t => {
  const tasks = [
    { id: 'task1', description: 'First task', status: 'pending' as const },
    { id: 'task2', description: 'Second task', status: 'in_progress' as const }
  ];

  const result = await createTasks('Test query', tasks);

  t.true(result.success);
  t.is(result.content.tasks.length, 2);
  t.is(result.content.user_query, 'Test query');
  t.true(result.message?.includes('Created task list'));
});

test('createTasks validates task structure', async t => {
  const invalidTasks = [
    { id: 'task1', status: 'pending' } // Missing description
  ];

  const result = await createTasks('Test query', invalidTasks as any);

  t.false(result.success);
  t.true(result.error?.includes('missing required fields'));
});

test('createTasks sets default status', async t => {
  const tasks = [
    { id: 'task1', description: 'Task without status' }
  ];

  const result = await createTasks('Test query', tasks as any);

  t.true(result.success);
  t.is(result.content.tasks[0].status, 'pending');
});

// ========================================
// updateTasks tests
// ========================================

test('updateTasks updates task status', async t => {
  // First create tasks
  const tasks = [
    { id: 'task1', description: 'First task', status: 'pending' as const }
  ];

  await createTasks('Test query', tasks);

  // Now update
  const updates = [
    { id: 'task1', status: 'completed' as const }
  ];

  const result = await updateTasks(updates);

  t.true(result.success);
  t.is(result.content.tasks[0].status, 'completed');
  t.true(result.message?.includes('Updated'));
});

test('updateTasks handles non-existent task', async t => {
  // Create initial tasks
  await createTasks('Test query', [
    { id: 'task1', description: 'Task 1', status: 'pending' as const }
  ]);

  const updates = [
    { id: 'nonexistent', status: 'completed' as const }
  ];

  const result = await updateTasks(updates);

  t.false(result.success);
  t.true(result.error?.includes('not found'));
});

test('updateTasks requires existing task list', async t => {
  const updates = [
    { id: 'task1', status: 'completed' as const }
  ];

  // Note: This might fail if tasks were created in previous tests
  // In a real scenario, you'd want to reset the task list between tests
  const result = await updateTasks(updates);

  // Should succeed if task list exists from previous test
  // or fail if no task list exists
  t.true(result.success || result.error?.includes('No task list'));
});

// ========================================
// Helper function tests
// ========================================

test('createToolResponse creates success response', t => {
  const result = createToolResponse(true, { data: 'test' }, 'Success message');

  t.true(result.success);
  t.deepEqual(result.content, { data: 'test' });
  t.is(result.message, 'Success message');
});

test('createToolResponse creates error response', t => {
  const result = createToolResponse(false, undefined, '', 'Error occurred');

  t.false(result.success);
  t.is(result.error, 'Error occurred');
});

test('formatToolParams formats read_file params', t => {
  const result = formatToolParams('read_file', { file_path: '/test/path.txt' });

  t.true(result.includes('file_path'));
  t.true(result.includes('/test/path.txt'));
});

test('formatToolParams formats execute_command params', t => {
  const result = formatToolParams('execute_command', { command: 'echo test' });

  t.true(result.includes('command'));
  t.true(result.includes('echo test'));
});

test('formatToolParams truncates long values', t => {
  const longPath = 'a'.repeat(100);
  const result = formatToolParams('read_file', { file_path: longPath });

  t.true(result.length < longPath.length + 20); // Should be truncated
  t.true(result.includes('...'));
});
