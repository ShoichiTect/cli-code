/**
 * CLI Utilities for Simple CLI
 * - number selection (fzf removed)
 * - Confirmation prompts
 * - ASCII spinner with elapsed time
 */

import { execSync, spawnSync } from 'child_process';
import * as readline from 'readline';

/**
 * Select an option using fzf if available, otherwise fall back to number selection
 */
/**
 * Select an option using number input (fallback when fzf is not available)
 */
export async function selectWithNumbers(
  options: string[],
  prompt?: string
): Promise<string | null> {
  // Immediate selection by pressing the number key (no need to press Enter)
  // Uses raw mode and keypress events to capture a single digit.
  // Falls back to a simple prompt if raw mode cannot be enabled.
  try {
    // Ensure keypress events are emitted
    readline.emitKeypressEvents(process.stdin);
    const wasTTY = process.stdin.isTTY;
    if (wasTTY) process.stdin.setRawMode(true);

    return new Promise((resolve) => {
      if (prompt) {
        console.log(`\n${prompt}:`);
      }
      options.forEach((opt, i) => {
        console.log(`  ${i + 1}. ${opt}`);
      });
      console.log('Press the number of your choice (or Ctrl+C to cancel)');

      const onKey = (str: string, key: any) => {
        // Handle Ctrl+C (select second option if available)
        if (key.sequence === '\x03') {
          cleanup();
          resolve(options.length >= 2 ? options[1] : null);
          return;
        }
        // Handle Escape key (select second option if available)
        if (key.name === 'escape' || key.sequence === '\x1B') {
          cleanup();
          resolve(options.length >= 2 ? options[1] : null);
          return;
        }
        // Handle Enter key: select first option as default
        if (key.name === 'return' || key.sequence === '\r' || key.sequence === '\n') {
          cleanup();
          resolve(options[0]);
          return;
        }
        // Accept digits 1-9 (or more if needed)
        const digit = Number(str);
        if (!isNaN(digit) && Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
          cleanup();
          resolve(options[digit - 1]);
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('keypress', onKey);
        if (wasTTY) process.stdin.setRawMode(false);
      };

      process.stdin.on('keypress', onKey);
    });
  } catch (e) {
    // If any error occurs (e.g., raw mode not supported), fall back to readline question
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
}

/**
 * Simple Y/n confirmation prompt using fzf selection
 */
export async function confirmPrompt(message: string): Promise<boolean> {
  const selection = await selectWithNumbers(['yes', 'no'], message);
  if (!selection) return false;
  return selection.toLowerCase() === 'yes';
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
