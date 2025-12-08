/**
 * Diff Utilities for Simple CLI
 * LCS-based diff algorithm ported from DiffPreview.tsx
 * Generates colored unified diff output for terminal display
 */

import chalk from 'chalk';

/**
 * Compute the Longest Common Subsequence (LCS) matrix
 * Uses dynamic programming to find common lines between two text arrays
 */
export function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const lcs = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  return lcs;
}

interface DiffOperation {
  type: 'equal' | 'delete' | 'insert';
  oldLine?: string;
  newLine?: string;
  oldIndex?: number;
  newIndex?: number;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  operations: DiffOperation[];
}

/**
 * Generate unified diff lines from original and new content
 */
export function generateUnifiedDiff(
  originalLines: string[],
  newLines: string[],
  fromFile: string,
  toFile: string,
  context: number = 3
): string[] {
  const result: string[] = [];

  if (originalLines.join('\n') === newLines.join('\n')) {
    return result;
  }

  // Compute LCS to find actual changes
  const lcs = computeLCS(originalLines, newLines);

  // Generate diff operations by backtracking through LCS matrix
  const operations: DiffOperation[] = [];

  let i = originalLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
      operations.unshift({
        type: 'equal',
        oldLine: originalLines[i - 1],
        newLine: newLines[j - 1],
        oldIndex: i - 1,
        newIndex: j - 1,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      operations.unshift({
        type: 'insert',
        newLine: newLines[j - 1],
        newIndex: j - 1,
      });
      j--;
    } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
      operations.unshift({
        type: 'delete',
        oldLine: originalLines[i - 1],
        oldIndex: i - 1,
      });
      i--;
    }
  }

  // Group operations into hunks with context
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (let k = 0; k < operations.length; k++) {
    const op = operations[k];

    if (op.type !== 'equal') {
      // Start a new hunk if needed
      if (!currentHunk) {
        const contextStart = Math.max(0, k - context);
        const oldStart =
          operations[contextStart].oldIndex !== undefined
            ? operations[contextStart].oldIndex! + 1
            : 1;
        const newStart =
          operations[contextStart].newIndex !== undefined
            ? operations[contextStart].newIndex! + 1
            : 1;

        currentHunk = {
          oldStart,
          oldCount: 0,
          newStart,
          newCount: 0,
          operations: operations.slice(contextStart, k + 1),
        };
      } else {
        // Extend current hunk
        currentHunk.operations.push(op);
      }
    } else if (currentHunk) {
      // Add context after changes
      currentHunk.operations.push(op);

      // Check if we should close this hunk
      let contextAfter = 0;
      for (let l = k + 1; l < operations.length && l <= k + context; l++) {
        if (operations[l].type === 'equal') {
          contextAfter++;
          currentHunk.operations.push(operations[l]);
        } else {
          break;
        }
      }

      // Close hunk if no more changes within context
      let hasMoreChanges = false;
      for (
        let l = k + contextAfter + 1;
        l < Math.min(operations.length, k + context * 2);
        l++
      ) {
        if (operations[l].type !== 'equal') {
          hasMoreChanges = true;
          break;
        }
      }

      if (!hasMoreChanges) {
        // Calculate counts
        currentHunk.oldCount = currentHunk.operations.filter(
          (op) => op.type === 'equal' || op.type === 'delete'
        ).length;
        currentHunk.newCount = currentHunk.operations.filter(
          (op) => op.type === 'equal' || op.type === 'insert'
        ).length;

        hunks.push(currentHunk);
        currentHunk = null;
        k += contextAfter; // Skip the context we already processed
      }
    }
  }

  // Close any remaining hunk
  if (currentHunk) {
    currentHunk.oldCount = currentHunk.operations.filter(
      (op) => op.type === 'equal' || op.type === 'delete'
    ).length;
    currentHunk.newCount = currentHunk.operations.filter(
      (op) => op.type === 'equal' || op.type === 'insert'
    ).length;
    hunks.push(currentHunk);
  }

  // Generate unified diff output
  result.push(`--- ${fromFile}`);
  result.push(`+++ ${toFile}`);

  for (const hunk of hunks) {
    result.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    );

    for (const op of hunk.operations) {
      if (op.type === 'equal') {
        result.push(` ${op.oldLine}`);
      } else if (op.type === 'delete') {
        result.push(`-${op.oldLine}`);
      } else if (op.type === 'insert') {
        result.push(`+${op.newLine}`);
      }
    }
  }

  return result;
}

/**
 * Print colored diff to terminal
 * @param oldText - Original text content
 * @param newText - New text content
 * @param filePath - File path for header display
 */
export function printColoredDiff(
  oldText: string,
  newText: string,
  filePath: string
): void {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const diffLines = generateUnifiedDiff(
    oldLines,
    newLines,
    `${filePath} (original)`,
    `${filePath} (new)`,
    5 // 5 lines of context
  );

  if (diffLines.length === 0) {
    console.log(chalk.dim('No changes to show'));
    return;
  }

  console.log(chalk.bold.cyan(`\nDiff Preview: ${filePath}`));

  for (const line of diffLines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      console.log(chalk.bold.blue(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.cyan(line));
    } else if (line.startsWith('+')) {
      console.log(chalk.bgGreen.black(`+ ${line.slice(1)}`));
    } else if (line.startsWith('-')) {
      console.log(chalk.bgRed.black(`- ${line.slice(1)}`));
    } else if (line.startsWith(' ')) {
      console.log(chalk.dim(`  ${line.slice(1)}`));
    } else {
      console.log(chalk.dim(line));
    }
  }
}

/**
 * Generate diff preview for edit_file operation
 * Shows what changes will be made to a file
 */
export function generateEditFileDiff(
  currentContent: string,
  oldText: string,
  newText: string,
  filePath: string,
  replaceAll: boolean = false
): void {
  let newContent: string;

  if (!currentContent.includes(oldText)) {
    console.log(chalk.yellow(`Warning: old_text not found in file`));
    console.log(chalk.dim(`Looking for:`));
    console.log(chalk.dim(oldText.substring(0, 100) + (oldText.length > 100 ? '...' : '')));
    return;
  }

  if (replaceAll) {
    newContent = currentContent.split(oldText).join(newText);
  } else {
    newContent = currentContent.replace(oldText, newText);
  }

  printColoredDiff(currentContent, newContent, filePath);
}

/**
 * Generate diff preview for create_file operation
 * Shows all content as additions
 */
export function generateCreateFileDiff(
  content: string,
  filePath: string
): void {
  printColoredDiff('', content, filePath);
}
