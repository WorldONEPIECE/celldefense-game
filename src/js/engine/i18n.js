import EventBus, { EVENTS } from './event-bus.js';

class I18nClass {
  constructor() { this._locale = 'zh-CN'; this._strings = {}; this._fallback = {}; this._loaded = false; }

  async load(locale) {
    try {
      const response = await fetch(`./data/i18n/${locale}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (locale === 'zh-CN') this._fallback = data;
      if (locale !== 'zh-CN' && Object.keys(this._fallback).length === 0) await this.load('zh-CN');
      this._strings = data; this._locale = locale; this._loaded = true;
      console.log(`[I18n] Loaded: ${locale}`);
      EventBus.emit(EVENTS.LANGUAGE_CHANGED, { locale });
    } catch (err) {
      console.error(`[I18n] Failed to load "${locale}":`, err);
      if (locale !== 'zh-CN') { console.warn('[I18n] Fallback zh-CN'); await this.load('zh-CN'); }
    }
  }

  get(key, vars) {
    let value = this._resolve(key, this._strings) ?? this._resolve(key, this._fallback) ?? `[${key}]`;
    if (vars) value = value.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
    return value;
  }

  get locale() { return this._locale; }
  get isLoaded() { return this._loaded; }

  _resolve(key, obj) {
    if (!obj) return undefined;
    let cur = obj;
    for (const part of key.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return typeof cur === 'string' ? cur : undefined;
  }
}

const i18n = new I18nClass();
export default i18n;
