import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Config {
  groqApiKey?: string;
  defaultModel?: string;
  groqProxy?: string;
  provider?: 'groq' | 'anthropic' | 'gemini';
  anthropicApiKey?: string;
  geminiApiKey?: string;
}

const CONFIG_DIR = '.groq'; // In home directory
const CONFIG_FILE = 'local-settings.json';

export class ConfigManager {
  private configPath: string;

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
    } else {
      const homeDir = os.homedir();
      this.configPath = path.join(homeDir, CONFIG_DIR, CONFIG_FILE);
    }
  }

  private ensureConfigDir(): void {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  private readConfig(): Config {
    try {
      if (!fs.existsSync(this.configPath)) {
        return {};
      }
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.warn('Failed to read config file:', error);
      return {};
    }
  }

  private writeConfig(config: Config): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600 // Read/write for owner only
    });
    // Ensure restrictive perms even if file already existed
    try {
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // noop (esp. on Windows where chmod may not be supported)
    }
  }

  public getApiKey(): string | null {
    const config = this.readConfig();
    return config.groqApiKey || null;
  }

  public setApiKey(apiKey: string): void {
    try {
      // Validate API key input
      const trimmed = apiKey?.trim?.() ?? '';
      if (!trimmed) {
        throw new Error('API key must be a non-empty string');
      }

      const config = this.readConfig();
      config.groqApiKey = trimmed;
      this.writeConfig(config);
    } catch (error) {
      throw new Error(`Failed to save API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public clearApiKey(): void {
    try {
      const config = this.readConfig();
      delete config.groqApiKey;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfig(config);
      }
    } catch (error) {
      console.warn('Failed to clear API key:', error);
    }
  }

  public getDefaultModel(): string | null {
    const config = this.readConfig();
    return config.defaultModel || null;
  }

  public setDefaultModel(model: string): void {
    try {
      const config = this.readConfig();
      config.defaultModel = model;
      this.writeConfig(config);
    } catch (error) {
      throw new Error(`Failed to save default model: ${error}`);
    }
  }

  public getProxy(): string | null {
    const config = this.readConfig();
    return config.groqProxy || null;
  }

  public setProxy(proxy: string): void {
    try {
      // Validate proxy input
      const trimmed = proxy?.trim?.() ?? '';
      if (!trimmed) {
        throw new Error('Proxy must be a non-empty string');
      }
      
      // Validate URL format and protocol
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        throw new Error(`Invalid proxy URL: ${trimmed}`);
      }
      
      const allowedProtocols = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:']);
      if (!allowedProtocols.has(parsedUrl.protocol)) {
        throw new Error(`Unsupported proxy protocol: ${parsedUrl.protocol}`);
      }
      
      const config = this.readConfig();
      config.groqProxy = trimmed;
      this.writeConfig(config);
    } catch (error) {
      // Preserve original error via cause for better debugging
      throw new Error(`Failed to save proxy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public clearProxy(): void {
    try {
      const config = this.readConfig();
      delete config.groqProxy;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfig(config);
      }
    } catch (error) {
      console.warn('Failed to clear proxy:', error);
    }
  }

  // Provider Management
  public getProvider(): 'groq' | 'anthropic' | 'gemini' | null {
    const config = this.readConfig();
    return config.provider || null;
  }

  public setProvider(provider: 'groq' | 'anthropic' | 'gemini'): void {
    try {
      const config = this.readConfig();
      config.provider = provider;
      this.writeConfig(config);
    } catch (error) {
      throw new Error(`Failed to save provider: ${error}`);
    }
  }

  // Anthropic API Key Management
  public getAnthropicApiKey(): string | null {
    const config = this.readConfig();
    return config.anthropicApiKey || null;
  }

  public setAnthropicApiKey(apiKey: string): void {
    try {
      const trimmed = apiKey?.trim?.() ?? '';
      if (!trimmed) {
        throw new Error('API key must be a non-empty string');
      }

      const config = this.readConfig();
      config.anthropicApiKey = trimmed;
      this.writeConfig(config);
    } catch (error) {
      throw new Error(`Failed to save Anthropic API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public clearAnthropicApiKey(): void {
    try {
      const config = this.readConfig();
      delete config.anthropicApiKey;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfig(config);
      }
    } catch (error) {
      console.warn('Failed to clear Anthropic API key:', error);
    }
  }

  // Gemini API Key Management
  public getGeminiApiKey(): string | null {
    const config = this.readConfig();
    return config.geminiApiKey || null;
  }

  public setGeminiApiKey(apiKey: string): void {
    try {
      const trimmed = apiKey?.trim?.() ?? '';
      if (!trimmed) {
        throw new Error('API key must be a non-empty string');
      }

      const config = this.readConfig();
      config.geminiApiKey = trimmed;
      this.writeConfig(config);
    } catch (error) {
      throw new Error(`Failed to save Gemini API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public clearGeminiApiKey(): void {
    try {
      const config = this.readConfig();
      delete config.geminiApiKey;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfig(config);
      }
    } catch (error) {
      console.warn('Failed to clear Gemini API key:', error);
    }
  }
}