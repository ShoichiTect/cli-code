import test from 'ava';
import { clearCommand } from '../../../src/commands/definitions/clear.js';
import type { CommandContext } from '../../../src/commands/base.js';

test('clearCommand calls clearHistory and adds confirmation message', t => {
  const messages: any[] = [
    { role: 'user', content: 'test message 1' },
    { role: 'assistant', content: 'test response 1' }
  ];

  let clearHistoryCalled = false;
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {
      clearHistoryCalled = true;
    },
    setShowLogin: () => {},
  };

  clearCommand.handler(context);

  // Verify clearHistory was called
  t.true(clearHistoryCalled, 'clearHistory should be called');

  // Verify confirmation message was added
  t.not(addedMessage, null, 'A message should be added');
  t.is(addedMessage.role, 'system', 'Message should have system role');
  t.true(addedMessage.content.toLowerCase().includes('cleared'), 'Message should mention clearing');
});

test('clearCommand has correct metadata', t => {
  t.is(clearCommand.command, 'clear', 'Command name should be "clear"');
  t.is(typeof clearCommand.description, 'string', 'Description should be a string');
  t.true(clearCommand.description.length > 0, 'Description should not be empty');
  t.is(typeof clearCommand.handler, 'function', 'Handler should be a function');
});
