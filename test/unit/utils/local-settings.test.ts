import test from 'ava';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../../../src/utils/local-settings.js';

// Helper to create a temporary ConfigManager with isolated config directory
function createTempConfigManager(): { manager: ConfigManager; cleanup: () => void; configPath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groq-config-test-'));
  const configPath = path.join(tmpDir, 'local-settings.json');

  const manager = new ConfigManager(configPath);

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error);
    }
  };

  return { manager, cleanup, configPath };
}

// API Key Management Tests
test('getApiKey returns null when not set', t => {
  const { manager, cleanup } = createTempConfigManager();
  try {
    const apiKey = manager.getApiKey();
    t.is(apiKey, null);
  } finally {
    cleanup();
  }
});

test('setApiKey stores API key successfully', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    const testApiKey = 'gsk_test123456789';
    manager.setApiKey(testApiKey);

    // Verify the key can be retrieved
    const retrievedKey = manager.getApiKey();
    t.is(retrievedKey, testApiKey);

    // Verify the config file was created
    t.true(fs.existsSync(configPath));

    // Verify the config file contains the correct data
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    t.is(configData.groqApiKey, testApiKey);
  } finally {
    cleanup();
  }
});

test('clearApiKey removes API key', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // First, set an API key
    manager.setApiKey('gsk_test123456789');
    t.is(manager.getApiKey(), 'gsk_test123456789');

    // Set another config value to ensure file is not deleted
    manager.setDefaultModel('llama-3.3-70b-versatile');

    // Clear the API key
    manager.clearApiKey();

    // Verify the key is no longer retrievable
    t.is(manager.getApiKey(), null);

    // Verify the config file still exists (because defaultModel is still there)
    t.true(fs.existsSync(configPath));

    // Verify the config file no longer contains the API key
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    t.is(configData.groqApiKey, undefined);
    t.is(configData.defaultModel, 'llama-3.3-70b-versatile');
  } finally {
    cleanup();
  }
});

test('setApiKey throws error with empty string', t => {
  const { manager, cleanup } = createTempConfigManager();
  try {
    const error = t.throws(() => {
      manager.setApiKey('');
    });
    t.is(error?.message, 'Failed to save API key: API key must be a non-empty string');
  } finally {
    cleanup();
  }
});

// Default Model Management Tests
test('getDefaultModel returns null when not set', t => {
  const { manager, cleanup } = createTempConfigManager();
  try {
    const model = manager.getDefaultModel();
    t.is(model, null);
  } finally {
    cleanup();
  }
});

test('setDefaultModel stores model successfully', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    const testModel = 'llama-3.3-70b-versatile';
    manager.setDefaultModel(testModel);

    // Verify the model can be retrieved
    const retrievedModel = manager.getDefaultModel();
    t.is(retrievedModel, testModel);

    // Verify the config file contains the correct data
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    t.is(configData.defaultModel, testModel);
  } finally {
    cleanup();
  }
});

// Proxy Management Tests
test('getProxy returns null when not set', t => {
  const { manager, cleanup } = createTempConfigManager();
  try {
    const proxy = manager.getProxy();
    t.is(proxy, null);
  } finally {
    cleanup();
  }
});

test('setProxy validates URL format', t => {
  const { manager, cleanup } = createTempConfigManager();
  try {
    // Valid proxy URLs should work
    manager.setProxy('http://proxy.example.com:8080');
    t.is(manager.getProxy(), 'http://proxy.example.com:8080');

    manager.setProxy('https://proxy.example.com:8443');
    t.is(manager.getProxy(), 'https://proxy.example.com:8443');

    manager.setProxy('socks5://proxy.example.com:1080');
    t.is(manager.getProxy(), 'socks5://proxy.example.com:1080');

    // Invalid URL should throw
    const error = t.throws(() => {
      manager.setProxy('not-a-valid-url');
    });
    t.truthy(error);

    // Empty string should throw
    const error2 = t.throws(() => {
      manager.setProxy('');
    });
    t.truthy(error2);

    // Invalid protocol should throw
    const error3 = t.throws(() => {
      manager.setProxy('ftp://proxy.example.com:8080');
    });
    t.truthy(error3);
  } finally {
    cleanup();
  }
});

test('clearProxy removes proxy setting', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // Set a proxy
    manager.setProxy('http://proxy.example.com:8080');
    t.is(manager.getProxy(), 'http://proxy.example.com:8080');

    // Set another config value to ensure file is not deleted
    manager.setApiKey('gsk_test123');

    // Clear the proxy
    manager.clearProxy();

    // Verify the proxy is no longer retrievable
    t.is(manager.getProxy(), null);

    // Verify the config file still exists
    t.true(fs.existsSync(configPath));

    // Verify the config file no longer contains the proxy
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    t.is(configData.groqProxy, undefined);
    t.is(configData.groqApiKey, 'gsk_test123');
  } finally {
    cleanup();
  }
});

// Edge Case Tests
test('config file has restrictive permissions (0o600)', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // Set an API key to create the config file
    manager.setApiKey('gsk_test123');

    // Check that the file was created
    t.true(fs.existsSync(configPath));

    // Check file permissions (only on Unix-like systems)
    if (process.platform !== 'win32') {
      const stats = fs.statSync(configPath);
      const mode = stats.mode & 0o777; // Extract permission bits
      t.is(mode, 0o600, 'Config file should have 0o600 permissions');
    } else {
      // On Windows, just verify the file exists
      t.pass('Skipping permission check on Windows');
    }
  } finally {
    cleanup();
  }
});

test('handles corrupted config file gracefully', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // Create a corrupted config file
    const configDir = path.dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, 'this is not valid JSON {{{');

    // Should return null instead of throwing
    t.is(manager.getApiKey(), null);
    t.is(manager.getDefaultModel(), null);
    t.is(manager.getProxy(), null);

    // Should be able to write new config despite corruption
    manager.setApiKey('gsk_test456');
    t.is(manager.getApiKey(), 'gsk_test456');
  } finally {
    cleanup();
  }
});

test('clearApiKey deletes file when no other config exists', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // Set only an API key
    manager.setApiKey('gsk_test123');
    t.true(fs.existsSync(configPath));

    // Clear the API key
    manager.clearApiKey();

    // Verify the config file was deleted (because no other settings exist)
    t.false(fs.existsSync(configPath));

    // Verify getApiKey still returns null
    t.is(manager.getApiKey(), null);
  } finally {
    cleanup();
  }
});

test('multiple config changes are persisted correctly', t => {
  const { manager, cleanup, configPath } = createTempConfigManager();
  try {
    // Set multiple config values
    manager.setApiKey('gsk_test123');
    manager.setDefaultModel('llama-3.3-70b-versatile');
    manager.setProxy('http://proxy.example.com:8080');

    // Create a new manager instance with the same config path
    const manager2 = new ConfigManager(configPath);

    // Verify all values are persisted
    t.is(manager2.getApiKey(), 'gsk_test123');
    t.is(manager2.getDefaultModel(), 'llama-3.3-70b-versatile');
    t.is(manager2.getProxy(), 'http://proxy.example.com:8080');

    // Clear one value
    manager2.clearProxy();
    t.is(manager2.getProxy(), null);

    // Verify other values are still there
    t.is(manager2.getApiKey(), 'gsk_test123');
    t.is(manager2.getDefaultModel(), 'llama-3.3-70b-versatile');
  } finally {
    cleanup();
  }
});
