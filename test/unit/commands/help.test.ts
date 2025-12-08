import test from 'ava';
// Import from index to avoid circular dependency issues
import { getAvailableCommands } from '../../../src/commands/index.js';
import type { CommandContext } from '../../../src/commands/base.js';

test('helpCommand adds help message with available commands', t => {
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
  };

  // Get helpCommand from the command registry
  const commands = getAvailableCommands();
  const helpCommand = commands.find(cmd => cmd.command === 'help');

  t.truthy(helpCommand, 'Help command should be registered');

  if (helpCommand) {
    helpCommand.handler(context);

    // Verify help message was added
    t.not(addedMessage, null, 'A message should be added');
    t.is(addedMessage.role, 'system', 'Message should have system role');

    // Verify message contains expected sections
    t.true(addedMessage.content.includes('Available Commands'), 'Should include available commands section');
    t.true(addedMessage.content.includes('Navigation'), 'Should include navigation section');
    t.true(addedMessage.content.includes('Keyboard Shortcuts'), 'Should include keyboard shortcuts section');
  }
});

test('helpCommand includes keyboard shortcuts documentation', t => {
  let addedMessage: any = null;

  const context: CommandContext = {
    addMessage: (msg) => {
      addedMessage = msg;
    },
    clearHistory: () => {},
    setShowLogin: () => {},
  };

  const commands = getAvailableCommands();
  const helpCommand = commands.find(cmd => cmd.command === 'help');

  t.truthy(helpCommand, 'Help command should be registered');

  if (helpCommand) {
    helpCommand.handler(context);

    // Verify keyboard shortcuts are documented
    t.true(addedMessage.content.includes('Esc'), 'Should document Esc key');
    t.true(addedMessage.content.includes('Shift+Tab'), 'Should document Shift+Tab');
    t.true(addedMessage.content.includes('Ctrl+C'), 'Should document Ctrl+C');
  }
});

test('helpCommand has correct metadata', t => {
  const commands = getAvailableCommands();
  const helpCommand = commands.find(cmd => cmd.command === 'help');

  t.truthy(helpCommand, 'Help command should be registered');

  if (helpCommand) {
    t.is(helpCommand.command, 'help', 'Command name should be "help"');
    t.is(typeof helpCommand.description, 'string', 'Description should be a string');
    t.true(helpCommand.description.length > 0, 'Description should not be empty');
    t.is(typeof helpCommand.handler, 'function', 'Handler should be a function');
  }
});
