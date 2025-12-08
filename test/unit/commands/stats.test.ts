import test from 'ava';
import { statsCommand } from '../../../src/commands/definitions/stats.js';
import type { CommandContext } from '../../../src/commands/base.js';

test('statsCommand adds stats message with usage snapshot', t => {
  let addedMessage: any = null;

  const mockStats = {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    totalRequests: 5,
    totalTime: 12345,
  };

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
    sessionStats: mockStats,
  };

  statsCommand.handler(context);

  // Verify stats message was added
  t.not(addedMessage, null, 'A message should be added');
  t.is(addedMessage.role, 'system', 'Message should have system role');
  t.is(addedMessage.content, 'SHOW_STATS', 'Content should be SHOW_STATS');
  t.is(addedMessage.type, 'stats', 'Type should be stats');

  // Verify usage snapshot
  t.not(addedMessage.usageSnapshot, undefined, 'Should include usage snapshot');
  t.is(addedMessage.usageSnapshot.prompt_tokens, 1000);
  t.is(addedMessage.usageSnapshot.completion_tokens, 500);
  t.is(addedMessage.usageSnapshot.total_tokens, 1500);
  t.is(addedMessage.usageSnapshot.total_requests, 5);
  t.is(addedMessage.usageSnapshot.total_time, 12345);
});

test('statsCommand handles missing session stats', t => {
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
    // sessionStats is undefined
  };

  statsCommand.handler(context);

  // Verify message was added
  t.not(addedMessage, null, 'A message should be added');
  t.is(addedMessage.role, 'system', 'Message should have system role');
  t.is(addedMessage.content, 'SHOW_STATS', 'Content should be SHOW_STATS');

  // Verify usage snapshot is undefined when stats are not available
  t.is(addedMessage.usageSnapshot, undefined, 'Usage snapshot should be undefined when stats not available');
});

test('statsCommand has correct metadata', t => {
  t.is(statsCommand.command, 'stats', 'Command name should be "stats"');
  t.is(typeof statsCommand.description, 'string', 'Description should be a string');
  t.true(statsCommand.description.length > 0, 'Description should not be empty');
  t.is(typeof statsCommand.handler, 'function', 'Handler should be a function');
});
