import test from 'ava';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Agent } from '../../../src/core/agent.js';
import { ConfigManager } from '../../../src/utils/local-settings.js';

// Helper to backup and temporarily remove actual config file
function setupCleanConfig(): { cleanup: () => void } {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.groq', 'local-settings.json');
  const backupPath = path.join(homeDir, '.groq', 'local-settings.json.test-backup');

  // Backup existing config if it exists
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, backupPath);
    fs.unlinkSync(configPath);
  }

  const cleanup = () => {
    // Restore backup if it exists
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, configPath);
      fs.unlinkSync(backupPath);
    }
  };

  return { cleanup };
}

test.serial('Agent.create initializes with default model', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    t.truthy(agent, 'Agent should be created');
    t.is(agent.getCurrentModel(), 'llama-3.3-70b-versatile', 'Model should be set correctly');
  } finally {
    cleanup();
  }
});

test.serial('Agent.create loads default model from config', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    // Set a default model in config
    const configManager = new ConfigManager();
    configManager.setDefaultModel('mixtral-8x7b-32768');

    // Create agent with a different model specified
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    // Should use the model from config, not the one passed to create
    t.truthy(agent, 'Agent should be created');
    t.is(agent.getCurrentModel(), 'mixtral-8x7b-32768', 'Should load model from config');
  } finally {
    cleanup();
  }
});

test.serial('Agent.create sets custom system message', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const customMessage = 'You are a helpful test assistant.';
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, customMessage, false);

    // Access internal messages to verify system message
    const messages = (agent as any).messages;
    t.true(Array.isArray(messages), 'Messages should be an array');
    t.true(messages.length > 0, 'Should have at least one message');

    const systemMessage = messages.find((m: any) => m.role === 'system' && m.content === customMessage);
    t.truthy(systemMessage, 'Should have custom system message');
  } finally {
    cleanup();
  }
});

test.serial('setModel updates model successfully', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    // Verify initial model
    t.is(agent.getCurrentModel(), 'llama-3.3-70b-versatile', 'Initial model should be set');

    // Update model
    agent.setModel('mixtral-8x7b-32768');

    // Verify model was updated
    t.is(agent.getCurrentModel(), 'mixtral-8x7b-32768', 'Model should be updated');

    // Verify model was saved to config
    const configManager = new ConfigManager();
    const savedModel = configManager.getDefaultModel();
    t.is(savedModel, 'mixtral-8x7b-32768', 'Model should be saved to config');
  } finally {
    cleanup();
  }
});

test.serial('setApiKey initializes Groq client', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    // Initially, client should be null (no API key set)
    const initialClient = (agent as any).client;
    t.is(initialClient, null, 'Client should initially be null');

    // Set API key
    const testApiKey = 'gsk_test123456789abcdef';
    agent.setApiKey(testApiKey);

    // Client should now be initialized
    const client = (agent as any).client;
    t.truthy(client, 'Client should be initialized after setting API key');
    t.is(typeof client, 'object', 'Client should be an object');
  } finally {
    cleanup();
  }
});

test.serial('clearHistory removes all non-system messages', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    // Add some non-system messages manually
    const messages = (agent as any).messages;
    const initialSystemCount = messages.filter((m: any) => m.role === 'system').length;

    // Simulate conversation by adding messages
    messages.push({ role: 'user', content: 'Hello' });
    messages.push({ role: 'assistant', content: 'Hi there!' });
    messages.push({ role: 'user', content: 'How are you?' });

    // Verify messages were added
    t.is(messages.length, initialSystemCount + 3, 'Should have added 3 messages');

    // Clear history
    agent.clearHistory();

    // Verify only system messages remain
    const afterClear = (agent as any).messages;
    t.is(afterClear.length, initialSystemCount, 'Should only have system messages');
    t.true(afterClear.every((m: any) => m.role === 'system'), 'All remaining messages should be system messages');
  } finally {
    cleanup();
  }
});

test.serial('setSessionAutoApprove sets flag correctly', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    // Initially, sessionAutoApprove should be false
    const initialValue = (agent as any).sessionAutoApprove;
    t.is(initialValue, false, 'sessionAutoApprove should initially be false');

    // Enable session auto-approve
    agent.setSessionAutoApprove(true);

    // Verify flag was set
    const afterEnable = (agent as any).sessionAutoApprove;
    t.is(afterEnable, true, 'sessionAutoApprove should be true after enabling');

    // Disable session auto-approve
    agent.setSessionAutoApprove(false);

    // Verify flag was unset
    const afterDisable = (agent as any).sessionAutoApprove;
    t.is(afterDisable, false, 'sessionAutoApprove should be false after disabling');
  } finally {
    cleanup();
  }
});

test.serial('getCurrentModel returns current model', async t => {
  const { cleanup } = setupCleanConfig();
  try {
    // Test with initial model
    const agent = await Agent.create('llama-3.3-70b-versatile', 1.0, null, false);

    const initialModel = agent.getCurrentModel();
    t.is(initialModel, 'llama-3.3-70b-versatile', 'Should return initial model');

    // Test after model change
    agent.setModel('mixtral-8x7b-32768');
    const updatedModel = agent.getCurrentModel();
    t.is(updatedModel, 'mixtral-8x7b-32768', 'Should return updated model');

    // Test with another model change
    agent.setModel('llama-3.1-8b-instant');
    const finalModel = agent.getCurrentModel();
    t.is(finalModel, 'llama-3.1-8b-instant', 'Should return final model');
  } finally {
    cleanup();
  }
});
