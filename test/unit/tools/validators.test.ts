import test from 'ava';
import * as path from 'node:path';
import {
  validateReadBeforeEdit,
  getReadBeforeEditError,
  setReadFilesTracker
} from '../../../src/tools/validators.js';

// ========================================
// validateReadBeforeEdit tests
// ========================================

test('validateReadBeforeEdit returns true when no tracker is set', t => {
  // Reset tracker
  setReadFilesTracker(null as any);

  const result = validateReadBeforeEdit('/some/file.txt');

  t.true(result);
});

test('validateReadBeforeEdit returns true when file has been read', t => {
  const readFiles = new Set<string>();
  const testFile = path.resolve('/test/file.txt');
  readFiles.add(testFile);

  setReadFilesTracker(readFiles);

  const result = validateReadBeforeEdit('/test/file.txt');

  t.true(result);
});

test('validateReadBeforeEdit returns false when file has not been read', t => {
  const readFiles = new Set<string>();

  setReadFilesTracker(readFiles);

  const result = validateReadBeforeEdit('/test/unread-file.txt');

  t.false(result);
});

test('validateReadBeforeEdit resolves paths correctly', t => {
  const readFiles = new Set<string>();
  const testFile = path.resolve('relative/path/file.txt');
  readFiles.add(testFile);

  setReadFilesTracker(readFiles);

  // Should work with relative path too
  const result = validateReadBeforeEdit('relative/path/file.txt');

  t.true(result);
});

// ========================================
// getReadBeforeEditError tests
// ========================================

test('getReadBeforeEditError returns appropriate error message', t => {
  const filePath = '/test/file.txt';
  const error = getReadBeforeEditError(filePath);

  t.true(error.includes('must be read before editing'));
  t.true(error.includes(filePath));
  t.true(error.includes('read_file'));
});

test('getReadBeforeEditError includes file path in message', t => {
  const filePath = '/path/to/important/file.js';
  const error = getReadBeforeEditError(filePath);

  t.true(error.includes(filePath));
});
