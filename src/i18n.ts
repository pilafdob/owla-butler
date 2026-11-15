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
const normalizeLocale = normalizeLanguage;
const normalizeLang = normalizeLanguage;
const normalizeObsidianLanguage = normalizeLanguage;
const languageCode = normalizeLanguage;
const obsidianLanguage = normalizeLanguage;
const uiLanguage = normalizeLanguage;
const appLanguage = normalizeLanguage;
const currentLanguage = normalizeLanguage;
const detectLanguage = normalizeLanguage;

/** Human-readable language names. */
const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  de: 'German',
};

function languageName(code?: string | null): string {
  const normalized = normalizeLanguage(code);
  return LANGUAGE_NAMES[normalized];
}

/** Alias. */
const languageLabel = languageName;
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

/** Raw Obsidian language code (e.g. 'de-AT'), for Intl/date formatting. */
export function getObsidianLanguageRaw(): string {
  try {
    const w = (typeof window !== 'undefined' ? (window as { getLanguage?: () => string }) : undefined);
    if (w && typeof w.getLanguage === 'function') {
      const code = w.getLanguage();
      if (typeof code === 'string' && code.trim()) return code.trim();
    }
  } catch {
    // ignore
  }
  return 'en';
}

/** Aliases. */
const getLanguage = getObsidianLanguage;
const obsidianLanguageCode = getObsidianLanguage;
const currentObsidianLanguage = getObsidianLanguage;
export const getLanguageRaw = getObsidianLanguageRaw;
export const obsidianLanguageRaw = getObsidianLanguageRaw;

// Module-level override used by tests.
let obsidianLanguageOverride: string | undefined;

export function setObsidianLanguageForTests(code: string | null): void {
  obsidianLanguageOverride = code ?? undefined;
}

// Allow tests to override via a stored value.
const originalGetObsidianLanguage = getObsidianLanguage;
function getLanguageWithOverride(): LanguageCode {
  if (obsidianLanguageOverride !== undefined) return normalizeLanguage(obsidianLanguageOverride);
  return originalGetObsidianLanguage();
}

// Prefer override-aware version as the default exported getter.
const getObsidianLanguageCode = getLanguageWithOverride;

/**
 * Interpolation. Supports `{key}`, `{{key}}` and `${key}` placeholders.
 */
function interpolate(template: string, vars?: Record<string, unknown> | null): string {
  if (!vars) return template;
  return template.replace(/\$\{(\w+)\}|\{\{(\w+)\}\}|\{(\w+)\}/g, (_match: string, a?: string, b?: string, c?: string) => {
    const key = a || b || c || '';
    const value = (vars as Record<string, unknown>)[key];
    if (value === undefined || value === null) return _match;
    return String(value);
  });
}

const formatMessage = interpolate;
export const format = interpolate;
const interpolateMessage = interpolate;

// ---------------------------------------------------------------------------
// Translation catalogs
// ---------------------------------------------------------------------------

export const en = {
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
  'chat.options': 'Chat options',
  'chat.saveRecentChat': 'Save recent chat',
  'chat.openSavedChat': 'Open saved chat',
  'chat.restoreDraft': 'Restore draft',
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
  'diff.acceptChange': 'Accept this change',
  'diff.declineChange': 'Decline this change',
  'diff.acceptLine': 'Accept this line',
  'diff.declineLine': 'Decline this line',
  'greeting': 'Hello, {name}!',
  'count.items': '{count} items',
  'command.openChat': 'Open chat',
  'command.addSelection': 'Add selection to chat',
  'command.imageToNote': 'Turn an image into note content',
  'command.reviewLatestEdit': 'Review latest suggested edit',
  'command.undoLatestEdit': 'Undo last accepted edit',
  'command.saveChat': 'Save recent chat',
  'command.openSavedChat': 'Open saved chat',
  'command.connectCodex': 'Connect Codex',
  'command.connectOpencode': 'Connect OpenCode',
  'command.connectClaude': 'Connect Claude',
  'command.clearRoutingHistory': 'Clear automatic selection history',
  'command.reloadRoutingCalibration': 'Reload automatic selection calibration',
  'notice.clearedRoutingHistory': 'Cleared automatic selection history.',
  'notice.resolvePendingBeforeNewChat': 'Accept or decline pending changes before starting a new chat.',
  'notice.copiedToClipboard': 'Copied to clipboard.',
  'notice.copyFailed': 'Could not copy. Select the message text and copy it manually.',
  'notice.sourceUnavailable': 'This source is unavailable.',
  'notice.waitBeforeSaving': 'Wait for the reply or stop before saving.',
  'notice.sendBeforeSaving': 'Send a message before saving.',
  'notice.chatSaved': 'Recent chat saved locally. Only the last three exchanges are saved; attachments are not stored.',
  'notice.finishReplyFirst': 'Finish or stop this reply first.',
  'notice.noSavedChats': 'No saved chats yet.',
  'notice.savedChatDeleted': 'Saved chat deleted.',
  'notice.noAttachable': 'No allowed files or folders to attach.',
  'notice.maxImages': 'Attach up to 12 images per message.',
  'notice.annotatedCopyCreated': 'Annotated copy created',
  'notice.noPendingEdits': 'No pending edits.',
  'notice.acceptDeclineFirst': 'Accept or decline pending changes first.',
  'notice.noAcceptedUndo': 'No accepted edit to undo in this chat.',
  'notice.acceptedUndo': 'Accepted edit undone.',
  'notice.finishReplyResolvePending': 'Finish the current reply and resolve pending changes first.',
  'notice.resolvePendingBeforeSend': 'Accept or decline pending changes before sending another message.',
  'notice.contextShortened': 'Older chat context was shortened. Current note and attachments take priority.',
  'notice.codexContextTrimmed': 'Codex now uses the latest six exchanges as chat context. Earlier messages remain visible.',
  'notice.clearDraftBeforeRestore': 'Send or clear the current draft before restoring this one.',
  'notice.noPendingChanges': 'No pending changes.',
  'notice.acceptDeclineIcons': 'Accept or decline each change with the icons below, or use the chat buttons for the whole batch.',
  'notice.savedPath': 'Saved {path}',
  'notice.noteNotFound': 'Note not found: {link}',
  'notice.reloadedCalibration': 'Reloaded automatic selection calibration from {path}.',
  'notice.noCalibrationFile': 'No calibration file at {path}. Using the built-in calibration.',
  'notice.providerSwitched': 'OWLA now uses {name}.',
  'exhaustion.codex': 'Codex usage limit reached.',
  'exhaustion.opencode': 'OpenCode usage limit reached.',
  'exhaustion.opencode.free': 'The OpenCode free models’ shared limit is reached.',
  'exhaustion.claude': 'Claude usage limit reached.',
  'exhaustion.reset': ' It resets {date}.',
  'exhaustion.resets': ' Resets {date}.',
  'exhaustion.opencode.noReset': 'The free models’ shared limit is reached. OpenCode did not say when it resets.',
  'exhaustion.opencode.noLimits': 'OpenCode reports no plan limits for your connected providers. Free models share one limit that OpenCode reports only when it is reached; it will appear here then.',
  'availability.region': 'not allowed in your workspace’s privacy regions',
  'availability.freeLimit': 'free models’ shared limit reached',
  'availability.noCredit': 'no credit balance',
  'availability.unavailable': 'not available on your plan',
  'availability.usageLimit': 'usage limit reached',
  'availability.auth': 'sign-in refused',
  'availability.goUsage': 'OpenCode Go usage limit reached',
} as const;

type MessageKey = keyof typeof en;

export const de: { [K in MessageKey]: string } = {
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
  'chat.options': 'Chat-Optionen',
  'chat.saveRecentChat': 'Chat speichern',
  'chat.openSavedChat': 'Gespeicherten Chat öffnen',
  'chat.restoreDraft': 'Entwurf wiederherstellen',
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
  'diff.acceptChange': 'Diese Änderung übernehmen',
  'diff.declineChange': 'Diese Änderung ablehnen',
  'diff.acceptLine': 'Diese Zeile übernehmen',
  'diff.declineLine': 'Diese Zeile ablehnen',
  'greeting': 'Hallo, {name}!',
  'count.items': '{count} Elemente',
  'command.openChat': 'Chat öffnen',
  'command.addSelection': 'Auswahl zu OWLA Butler hinzufügen',
  'command.imageToNote': 'Bild in Notizinhalt umwandeln',
  'command.reviewLatestEdit': 'Letzte vorgeschlagene Bearbeitung prüfen',
  'command.undoLatestEdit': 'Letzte übernommene Bearbeitung rückgängig machen',
  'command.saveChat': 'Chat speichern',
  'command.openSavedChat': 'Gespeicherten Chat öffnen',
  'command.connectCodex': 'Codex verbinden',
  'command.connectOpencode': 'OpenCode verbinden',
  'command.connectClaude': 'Claude Code verbinden',
  'command.clearRoutingHistory': 'Verlauf der automatischen Auswahl löschen',
  'command.reloadRoutingCalibration': 'Kalibrierung der automatischen Auswahl neu laden',
  'notice.clearedRoutingHistory': 'Verlauf der automatischen Auswahl gelöscht.',
  'notice.resolvePendingBeforeNewChat': 'Übernehme oder lehne ausstehende Änderungen ab, bevor du einen neuen Chat startest.',
  'notice.copiedToClipboard': 'In die Zwischenablage kopiert.',
  'notice.copyFailed': 'Kopieren fehlgeschlagen. Markiere den Nachrichtentext und kopiere ihn manuell.',
  'notice.sourceUnavailable': 'Diese Quelle ist nicht verfügbar.',
  'notice.waitBeforeSaving': 'Warte auf die Antwort oder stoppe sie, bevor du speicherst.',
  'notice.sendBeforeSaving': 'Sende eine Nachricht, bevor du speicherst.',
  'notice.chatSaved': 'Chat lokal gespeichert. Es werden nur die letzten drei Austausche gespeichert; Anhänge werden nicht gespeichert.',
  'notice.finishReplyFirst': 'Beende oder stoppe zuerst diese Antwort.',
  'notice.noSavedChats': 'Noch keine gespeicherten Chats.',
  'notice.savedChatDeleted': 'Gespeicherter Chat gelöscht.',
  'notice.noAttachable': 'Keine erlaubten Dateien oder Ordner zum Anhängen.',
  'notice.maxImages': 'Bis zu 12 Bilder pro Nachricht anhängen.',
  'notice.annotatedCopyCreated': 'Annotierte Kopie erstellt',
  'notice.noPendingEdits': 'Keine ausstehenden Bearbeitungen.',
  'notice.acceptDeclineFirst': 'Übernehme oder lehne zuerst ausstehende Änderungen ab.',
  'notice.noAcceptedUndo': 'Keine übernommene Bearbeitung zum Rückgängigmachen in diesem Chat.',
  'notice.acceptedUndo': 'Übernommene Bearbeitung rückgängig gemacht.',
  'notice.finishReplyResolvePending': 'Beende die aktuelle Antwort und löse ausstehende Änderungen auf.',
  'notice.resolvePendingBeforeSend': 'Übernehme oder lehne ausstehende Änderungen ab, bevor du eine weitere Nachricht sendest.',
  'notice.contextShortened': 'Älterer Chat-Kontext wurde gekürzt. Aktuelle Notiz und Anhänge haben Vorrang.',
  'notice.codexContextTrimmed': 'Codex verwendet jetzt die letzten sechs Austausche als Chat-Kontext. Frühere Nachrichten bleiben sichtbar.',
  'notice.clearDraftBeforeRestore': 'Sende oder leere den aktuellen Entwurf, bevor du diesen wiederherstellst.',
  'notice.noPendingChanges': 'Keine ausstehenden Änderungen.',
  'notice.acceptDeclineIcons': 'Übernehme oder lehne jede Änderung mit den Symbolen unten ab, oder nutze die Chat-Schaltflächen für den gesamten Stapel.',
  'notice.savedPath': 'Gespeichert: {path}',
  'notice.noteNotFound': 'Notiz nicht gefunden: {link}',
  'notice.reloadedCalibration': 'Kalibrierung der automatischen Auswahl aus {path} neu geladen.',
  'notice.noCalibrationFile': 'Keine Kalibrierungsdatei unter {path}. Verwende die eingebaute Kalibrierung.',
  'notice.providerSwitched': 'OWLA verwendet jetzt {name}.',
  'exhaustion.codex': 'Codex-Nutzungslimit erreicht.',
  'exhaustion.opencode': 'OpenCode-Nutzungslimit erreicht.',
  'exhaustion.opencode.free': 'Das gemeinsame Limit der kostenlosen OpenCode-Modelle ist erreicht.',
  'exhaustion.claude': 'Claude-Nutzungslimit erreicht.',
  'exhaustion.reset': ' Setzt sich zurück am {date}.',
  'exhaustion.resets': ' Setzt sich zurück am {date}.',
  'exhaustion.opencode.noReset': 'Das gemeinsame Limit der kostenlosen OpenCode-Modelle ist erreicht. OpenCode nannte kein Zurücksetzungsdatum.',
  'exhaustion.opencode.noLimits': 'OpenCode meldet keine Plan-Limits für verbundene Anbieter. Kostenlose Modelle teilen sich ein Limit, das erst beim Erreichen gemeldet wird.',
  'availability.region': 'in den Datenschutzregionen deines Arbeitsbereichs nicht erlaubt',
  'availability.freeLimit': 'gemeinsames Limit der kostenlosen Modelle erreicht',
  'availability.noCredit': 'kein Guthaben',
  'availability.unavailable': 'nicht in deinem Plan enthalten',
  'availability.usageLimit': 'Nutzungslimit erreicht',
  'availability.auth': 'Anmeldung abgelehnt',
  'availability.goUsage': 'OpenCode Go-Nutzungslimit erreicht',
};

export const messages = { en, de } as const;
const locales = { en, de } as const;
export const translations = { en, de } as const;
export const strings = { en, de } as const;
export const catalog = { en, de } as const;
const LANGUAGE_PACKS = { en, de } as const;
const packs = { en, de } as const;

const catalogs = { en, de };

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
  const template = (table as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  return interpolate(template, vars);
}

/** Aliases. */
export const translate = t;
export const __ = t;
export const i18n = t;
export const msg = t;
const formatText = t;

function translateWithLanguage(key: string, lang: string, vars?: Record<string, unknown> | null): string {
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
const languageInstruction = replyLanguageInstruction;
const replyInLanguage = replyLanguageInstruction;
const obsidianReplyLanguage = replyLanguageInstruction;
const replyLanguage = replyLanguageInstruction;
const aiLanguageInstruction = replyLanguageInstruction;

export function appendReplyLanguage(instructions: string, lang?: string | null): string {
  return instructions + '\n' + replyLanguageInstruction(lang);
}

const withReplyLanguage = appendReplyLanguage;

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
