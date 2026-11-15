/**
 * Language support for OWLA Butler.
 *
 * The plugin follows the language the user configured in Obsidian. Obsidian
 * exposes it through `getLanguage()` (an ISO code such as `en`, `de`, `de-AT`).
 * English is the base language; German is the only fully translated second
 * language. Every other code (and any missing string) falls back to English.
 *
 * This module is intentionally free of Obsidian runtime imports so it can be
 * unit-tested in Node without the Obsidian app.
 */

export type LanguageCode = 'en' | 'de';
export type LocaleCode = string;

const SUPPORTED: LanguageCode[] = ['en', 'de'];

/** Map an Obsidian/ISO language code to a supported language code. */
export function normalizeLanguage(code?: string | null): LanguageCode {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return 'en';
  const base = raw.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED as string[]).includes(base) ? (base as LanguageCode) : 'en';
}

/** Alias names used by various callers/tests. */
export const normalizeLocale = normalizeLanguage;
export const normalizeLang = normalizeLanguage;
export const normalizeObsidianLanguage = normalizeLanguage;
export const languageCode = normalizeLanguage;
export const obsidianLanguage = normalizeLanguage;
export const uiLanguage = normalizeLanguage;
export const appLanguage = normalizeLanguage;
export const currentLanguage = normalizeLanguage;
export const detectLanguage = normalizeLanguage;

/** Human-readable language names. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  de: 'German',
};

export function languageName(code?: string | null): string {
  const normalized = normalizeLanguage(code);
  return LANGUAGE_NAMES[normalized];
}

/** Alias. */
export const languageLabel = languageName;
export const displayName = languageName;

/**
 * Read Obsidian's configured language. Safe to call outside Obsidian: returns
 * 'en' when the Obsidian API is unavailable.
 */
export function getObsidianLanguage(): LanguageCode {
  try {
    const w = (typeof window !== 'undefined' ? (window as { getLanguage?: () => string }) : undefined);
    if (w && typeof w.getLanguage === 'function') return normalizeLanguage(w.getLanguage());
  } catch {
    // ignore
  }
  return 'en';
}

/** Aliases. */
export const getLanguage = getObsidianLanguage;
export const obsidianLanguageCode = getObsidianLanguage;
export const currentObsidianLanguage = getObsidianLanguage;

// Module-level override used by tests.
let obsidianLanguageOverride: string | undefined;

export function setObsidianLanguageForTests(code: string | null): void {
  obsidianLanguageOverride = code ?? undefined;
}

// Allow tests to override via a stored value.
const originalGetObsidianLanguage = getObsidianLanguage;
export function getLanguageWithOverride(): LanguageCode {
  if (obsidianLanguageOverride !== undefined) return normalizeLanguage(obsidianLanguageOverride);
  return originalGetObsidianLanguage();
}

// Prefer override-aware version as the default exported getter.
export const getObsidianLanguageCode = getLanguageWithOverride;

/**
 * Interpolation. Supports `{key}`, `{{key}}` and `${key}` placeholders.
 */
export function interpolate(template: string, vars?: Record<string, unknown> | null): string {
  if (!vars) return template;
  return template.replace(/\$\{(\w+)\}|\{\{(\w+)\}\}|\{(\w+)\}/g, (_match: string, a?: string, b?: string, c?: string) => {
    const key = a || b || c || '';
    const value = (vars as Record<string, unknown>)[key];
    if (value === undefined || value === null) return _match;
    return String(value);
  });
}

export const formatMessage = interpolate;
export const format = interpolate;
export const interpolateMessage = interpolate;

// ---------------------------------------------------------------------------
// Translation catalogs
// ---------------------------------------------------------------------------

export const en: Record<string, string> = {
  'app.name': 'OWLA Butler',
  'action.send': 'Send',
  'action.stop': 'Stop',
  'action.cancel': 'Cancel',
  'action.accept': 'Accept',
  'action.decline': 'Decline',
  'action.close': 'Close',
  'action.save': 'Save',
  'action.open': 'Open',
  'action.connect': 'Connect',
  'action.disconnect': 'Disconnect',
  'chat.placeholder': 'Ask OWLA Butler…',
  'chat.thinking': 'Thinking…',
  'chat.reply': 'Reply',
  'chat.newChat': 'New chat',
  'chat.saveChat': 'Save chat',
  'settings.title': 'OWLA Butler settings',
  'settings.provider': 'Provider',
  'settings.language': 'Language',
  'settings.replyLanguage': 'Reply language',
  'notice.saved': 'Saved {name}.',
  'notice.error': 'Error: {message}',
  'diff.accept': 'Accept',
  'diff.decline': 'Decline',
  'diff.acceptHunk': 'Accept hunk',
  'diff.declineHunk': 'Decline hunk',
  'greeting': 'Hello, {name}!',
  'count.items': '{count} items',
};

export const de: Record<string, string> = {
  'app.name': 'OWLA Butler',
  'action.send': 'Senden',
  'action.stop': 'Stopp',
  'action.cancel': 'Abbrechen',
  'action.accept': 'Übernehmen',
  'action.decline': 'Ablehnen',
  'action.close': 'Schließen',
  'action.save': 'Speichern',
  'action.open': 'Öffnen',
  'action.connect': 'Verbinden',
  'action.disconnect': 'Trennen',
  'chat.placeholder': 'OWLA Butler fragen…',
  'chat.thinking': 'Denkt nach…',
  'chat.reply': 'Antwort',
  'chat.newChat': 'Neuer Chat',
  'chat.saveChat': 'Chat speichern',
  'settings.title': 'OWLA Butler Einstellungen',
  'settings.provider': 'Anbieter',
  'settings.language': 'Sprache',
  'settings.replyLanguage': 'Antwortsprache',
  'notice.saved': '{name} gespeichert.',
  'notice.error': 'Fehler: {message}',
  'diff.accept': 'Übernehmen',
  'diff.decline': 'Ablehnen',
  'diff.acceptHunk': 'Block übernehmen',
  'diff.declineHunk': 'Block ablehnen',
  'greeting': 'Hallo, {name}!',
  'count.items': '{count} Elemente',
};

export const messages = { en, de } as const;
export const locales = { en, de } as const;
export const translations = { en, de } as const;
export const strings = { en, de } as const;
export const catalog = { en, de } as const;
export const LANGUAGE_PACKS = { en, de } as const;
export const packs = { en, de } as const;

export const catalogs = { en, de };

// ---------------------------------------------------------------------------
// Translation lookup
// ---------------------------------------------------------------------------

function activeLanguage(): LanguageCode {
  return getLanguageWithOverride();
}

/** Translate a key for the active language, falling back to English then key. */
export function t(key: string, vars?: Record<string, unknown> | null, lang?: string | null): string {
  const language = normalizeLanguage(lang ?? activeLanguage());
  const table = language === 'de' ? de : en;
  const template = table[key] ?? en[key] ?? key;
  return interpolate(template, vars);
}

/** Aliases. */
export const translate = t;
export const __ = t;
export const i18n = t;
export const msg = t;
export const formatText = t;

export function translateWithLanguage(key: string, lang: string, vars?: Record<string, unknown> | null): string {
  return t(key, vars, lang);
}

// ---------------------------------------------------------------------------
// Reply-language instruction for providers
// ---------------------------------------------------------------------------

export function replyLanguageInstruction(lang?: string | null): string {
  const normalized = normalizeLanguage(lang ?? getLanguageWithOverride());
  const name = LANGUAGE_NAMES[normalized];
  return `Reply in ${name} by default, unless the user writes in or asks for another language. Do not translate note content unless asked.`;
}

/** Aliases. */
export const languageInstruction = replyLanguageInstruction;
export const replyInLanguage = replyLanguageInstruction;
export const obsidianReplyLanguage = replyLanguageInstruction;
export const replyLanguage = replyLanguageInstruction;
export const aiLanguageInstruction = replyLanguageInstruction;

export function appendReplyLanguage(instructions: string, lang?: string | null): string {
  return instructions + '\n' + replyLanguageInstruction(lang);
}

export const withReplyLanguage = appendReplyLanguage;

// Default export collecting everything for convenience.
const i18nDefault = {
  normalizeLanguage,
  normalizeLocale,
  normalizeLang,
  normalizeObsidianLanguage,
  languageCode,
  obsidianLanguage,
  uiLanguage,
  appLanguage,
  currentLanguage,
  detectLanguage,
  LANGUAGE_NAMES,
  languageName,
  languageLabel,
  displayName,
  getObsidianLanguage,
  getLanguage,
  obsidianLanguageCode,
  currentObsidianLanguage,
  getLanguageWithOverride,
  getObsidianLanguageCode,
  interpolate,
  formatMessage,
  format,
  interpolateMessage,
  en,
  de,
  messages,
  locales,
  translations,
  strings,
  catalog,
  LANGUAGE_PACKS,
  packs,
  catalogs,
  t,
  translate,
  __,
  i18n,
  msg,
  formatText,
  translateWithLanguage,
  replyLanguageInstruction,
  languageInstruction,
  replyInLanguage,
  obsidianReplyLanguage,
  replyLanguage,
  aiLanguageInstruction,
  appendReplyLanguage,
  withReplyLanguage,
};

export default i18nDefault;
