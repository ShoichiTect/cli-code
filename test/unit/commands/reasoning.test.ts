import test from 'ava';
import { reasoningCommand } from '../../../src/commands/definitions/reasoning.js';
import type { CommandContext } from '../../../src/commands/base.js';

test('reasoningCommand toggles display state when toggleReasoning is available', t => {
  let showReasoning = false;
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
    showReasoning,
    toggleReasoning: () => {
      showReasoning = !showReasoning;
    }
  };

  reasoningCommand.handler(context);

  // Verify confirmation message was added
  t.not(addedMessage, null, 'A message should be added');
  t.is(addedMessage.role, 'system', 'Message should have system role');
  t.true(addedMessage.content.includes('enabled'), 'Message should indicate reasoning was enabled');
});

test('reasoningCommand shows appropriate message when toggled off', t => {
  let showReasoning = true;
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
    showReasoning,
    toggleReasoning: () => {
      showReasoning = !showReasoning;
    }
  };

  reasoningCommand.handler(context);

  // Verify message indicates reasoning was disabled
  t.not(addedMessage, null, 'A message should be added');
  t.true(addedMessage.content.includes('disabled'), 'Message should indicate reasoning was disabled');
});

test('reasoningCommand shows error when toggleReasoning is not available', t => {
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
    // toggleReasoning is undefined
  };

  reasoningCommand.handler(context);

  // Verify error message was added
  t.not(addedMessage, null, 'A message should be added');
  t.is(addedMessage.role, 'system', 'Message should have system role');
  t.true(addedMessage.content.includes('not available'), 'Message should indicate feature is not available');
});

test('reasoningCommand has correct metadata', t => {
  t.is(reasoningCommand.command, 'reasoning', 'Command name should be "reasoning"');
  t.is(typeof reasoningCommand.description, 'string', 'Description should be a string');
  t.true(reasoningCommand.description.length > 0, 'Description should not be empty');
  t.is(typeof reasoningCommand.handler, 'function', 'Handler should be a function');
});
