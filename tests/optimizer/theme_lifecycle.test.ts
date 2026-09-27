import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Theme Lifecycle & Persistence Flow', () => {
  // Mock localStorage
  class MockLocalStorage {
    private store: Record<string, string> = {};
    getItem(key: string): string | null {
      return this.store[key] !== undefined ? this.store[key] : null;
    }
    setItem(key: string, val: string): void {
      this.store[key] = String(val);
    }
    removeItem(key: string): void {
      delete this.store[key];
    }
    clear(): void {
      this.store = {};
    }
  }

  // Lifecycle simulator matching index.html exact logic
  class ThemeEnvironment {
    localStorage = new MockLocalStorage();
    attributes: Record<string, string> = {};
    buttons: Record<string, { active: boolean; ariaPressed: string }> = {
      light: { active: false, ariaPressed: 'false' },
      dark: { active: false, ariaPressed: 'false' },
      system: { active: false, ariaPressed: 'false' },
    };
    systemPrefersDark = false;

    // Head script execution
    runHeadScript() {
      try {
        const setting = this.localStorage.getItem('chorematrix_theme') || 'system';
        const isDark = setting === 'dark' || (setting === 'system' && this.systemPrefersDark);
        this.attributes['data-theme'] = isDark ? 'dark' : 'light';
        this.attributes['data-theme-setting'] = setting;
      } catch (e) {}
    }

    // Module initTheme
    initTheme() {
      const saved = this.localStorage.getItem('chorematrix_theme') || 'system';
      this.applyTheme(saved);
    }

    // applyTheme
    applyTheme(choice: string) {
      const isDark = choice === 'dark' || (choice === 'system' && this.systemPrefersDark);
      this.attributes['data-theme'] = isDark ? 'dark' : 'light';
      this.attributes['data-theme-setting'] = choice;

      for (const key of ['light', 'dark', 'system']) {
        const active = key === choice;
        this.buttons[key].active = active;
        this.buttons[key].ariaPressed = active ? 'true' : 'false';
      }
    }

    // setTheme
    setTheme(choice: string) {
      try {
        this.localStorage.setItem('chorematrix_theme', choice);
      } catch (e) {}
      this.applyTheme(choice);
    }

    simulatePageReload() {
      // Attributes and button UI reset on reload, storage persists
      this.attributes = {};
      this.buttons = {
        light: { active: false, ariaPressed: 'false' },
        dark: { active: false, ariaPressed: 'false' },
        system: { active: false, ariaPressed: 'false' },
      };
      this.runHeadScript();
      this.initTheme();
    }
  }

  it('Requirement 16 flow: choose Dark -> refresh -> Dark remains', () => {
    const env = new ThemeEnvironment();
    // 1. Initial load (default system, e.g. system is light)
    env.simulatePageReload();
    assert.strictEqual(env.attributes['data-theme'], 'light');
    assert.strictEqual(env.attributes['data-theme-setting'], 'system');
    assert.strictEqual(env.buttons.system.active, true);

    // 2. User chooses Dark
    env.setTheme('dark');
    assert.strictEqual(env.localStorage.getItem('chorematrix_theme'), 'dark');
    assert.strictEqual(env.attributes['data-theme'], 'dark');
    assert.strictEqual(env.attributes['data-theme-setting'], 'dark');
    assert.strictEqual(env.buttons.dark.active, true);
    assert.strictEqual(env.buttons.dark.ariaPressed, 'true');
    assert.strictEqual(env.buttons.light.active, false);

    // 3. User refreshes
    env.simulatePageReload();
    assert.strictEqual(env.attributes['data-theme'], 'dark', 'Dark mode must remain immediately after refresh');
    assert.strictEqual(env.attributes['data-theme-setting'], 'dark');
    assert.strictEqual(env.buttons.dark.active, true);
  });

  it('Requirement 16 flow: choose Light -> refresh -> Light remains', () => {
    const env = new ThemeEnvironment();
    // System is dark
    env.systemPrefersDark = true;
    env.simulatePageReload();
    // Default system in dark environment
    assert.strictEqual(env.attributes['data-theme'], 'dark');

    // User explicitly chooses Light
    env.setTheme('light');
    assert.strictEqual(env.localStorage.getItem('chorematrix_theme'), 'light');
    assert.strictEqual(env.attributes['data-theme'], 'light');
    assert.strictEqual(env.attributes['data-theme-setting'], 'light');
    assert.strictEqual(env.buttons.light.active, true);
    assert.strictEqual(env.buttons.dark.active, false);

    // User refreshes
    env.simulatePageReload();
    assert.strictEqual(env.attributes['data-theme'], 'light', 'Light mode must remain even if system prefers dark');
    assert.strictEqual(env.attributes['data-theme-setting'], 'light');
    assert.strictEqual(env.buttons.light.active, true);
  });

  it('Requirement 16 flow: choose System -> system preference is respected dynamically', () => {
    const env = new ThemeEnvironment();
    env.systemPrefersDark = false;
    env.simulatePageReload();

    env.setTheme('system');
    assert.strictEqual(env.localStorage.getItem('chorematrix_theme'), 'system');
    assert.strictEqual(env.attributes['data-theme'], 'light');
    assert.strictEqual(env.buttons.system.active, true);

    // System switches to dark mode
    env.systemPrefersDark = true;
    env.applyTheme('system'); // listener trigger
    assert.strictEqual(env.attributes['data-theme'], 'dark', 'Must update to dark when OS theme switches');

    // Refresh while system is dark
    env.simulatePageReload();
    assert.strictEqual(env.attributes['data-theme'], 'dark', 'Must restore as dark in head script on refresh');
    assert.strictEqual(env.buttons.system.active, true);
  });
});
