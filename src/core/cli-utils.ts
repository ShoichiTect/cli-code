/**
 * CLI Utilities for Simple CLI
 * - fzf selection with fallback to number selection
 * - Confirmation prompts
 * - ASCII spinner with elapsed time
 */

import { execSync, spawnSync } from 'child_process';
import * as readline from 'readline';

/**
 * Select an option using fzf if available, otherwise fall back to number selection
 */
export async function selectWithFzf(
  options: string[],
  prompt?: string
): Promise<string | null> {
  // Check if fzf is available
  try {
    execSync('which fzf', { stdio: 'ignore' });
  } catch {
    // fzf not available, fall back to number selection
    return selectWithNumbers(options, prompt);
  }

  try {
    const args = ['--height=40%', '--reverse'];
    if (prompt) {
      args.push(`--header=${prompt}`);
    }

    const result = spawnSync('fzf', args, {
      input: options.join('\n'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const selected = result.stdout?.trim();
    return selected || null;
  } catch {
    // Fall back to number selection on any error
    return selectWithNumbers(options, prompt);
  }
}

/**
 * Select an option using number input (fallback when fzf is not available)
 */
export async function selectWithNumbers(
  options: string[],
  prompt?: string
): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (prompt) {
      console.log(`\n${prompt}:`);
    }
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt}`);
    });

    rl.question('Enter number: ', (answer) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < options.length) {
        resolve(options[index]);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Simple Y/n confirmation prompt
 */
export async function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [Y/n]: `, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized !== 'n' && normalized !== 'no');
    });
  });
}

/**
 * Spinner interface
 */
export interface Spinner {
  update: (message: string) => void;
  stop: (finalMessage?: string) => void;
}

/**
 * Create a simple ASCII spinner with elapsed time display
 * Uses characters: - \ | /
 */
export function createSpinner(message: string): Spinner {
  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;
  let currentMessage = message;
  const startTime = Date.now();
  let intervalId: NodeJS.Timeout | null = null;
  let stopped = false;

  const render = () => {
    if (stopped) return;

    const elapsed = formatElapsedTime(Date.now() - startTime);
    const frame = frames[frameIndex % frames.length];

    // Clear current line and write spinner
    process.stdout.write(`\r${frame} ${currentMessage} (${elapsed})`);

    frameIndex++;
  };

  // Start the spinner
  render();
  intervalId = setInterval(render, 100);

  return {
    update: (newMessage: string) => {
      currentMessage = newMessage;
    },
    stop: (finalMessage?: string) => {
      if (stopped) return;
      stopped = true;

      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      // Clear the spinner line
      process.stdout.write('\r\x1b[K');

      if (finalMessage) {
        console.log(finalMessage);
      }
    },
  };
}

/**
 * Format elapsed time in a human-readable format
 * @param ms - Elapsed time in milliseconds
 * @returns Formatted time string (e.g., "1.5s", "2m 30s")
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Create a readline interface for user input
 */
export function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and get user input
 */
export async function question(
  rl: readline.Interface,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}
