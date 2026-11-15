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
  if (languageSource) {
    try {
      const code = languageSource();
      if (typeof code === 'string' && code.trim()) return normalizeLanguage(code);
    } catch {
      // ignore
    }
  }
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
  if (languageSource) {
    try {
      const code = languageSource();
      if (typeof code === 'string' && code.trim()) return code.trim();
    } catch {
      // ignore
    }
  }
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

// Obsidian's getLanguage() is a module export, not a global. main.ts injects
// it here at onload so i18n.ts stays free of Obsidian imports.
let languageSource: (() => string | null | undefined) | null = null;
export function setLanguageSource(source: (() => string | null | undefined) | null): void {
  languageSource = source;
}

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
  'button.cancel': 'Cancel',
  'button.checkAutomaticSelection': 'Check automatic selection',
  'button.chooseExecutable': 'Choose executable…',
  'button.connectClaudeCode': 'Connect Claude Code',
  'button.connectCodex': 'Connect Codex',
  'button.connectOpencode': 'Connect OpenCode',
  'button.deleteChat': 'Delete chat',
  'button.disconnect': 'Disconnect',
  'button.refreshUsage': 'Refresh usage',
  'button.saveChat': 'Save chat',
  'button.signIn': 'Sign in',
  'button.verifyConnection': 'Verify connection',
  'button.accept': 'Accept',
  'button.decline': 'Decline',
  'button.moveToTrash': 'Move to trash',
  'button.saveAndStartNew': 'Save and start new',
  'button.append': 'Append to note…',
  'button.reviewAnnotatedCopy': 'Review annotated copy…',
  'dialog.reviewDeletion': 'Review deletion',
  'dialog.reviewPaths': 'Review paths',
  'dialog.reviewRelatedChanges': 'Review related changes',
  'dialog.suggestedDeletion': 'Suggested deletion',
  'notice.resolveNoteChangesBeforeMoves': 'Resolve the note changes before reviewing moves.',
  'notice.noSourcesOrActivity': 'No sources or activity for this reply.',
  'notice.searchingVault': 'Searching your vault…',
  'notice.messageOwla': 'Message OWLA Butler',
  'notice.refreshFailed': 'Refresh failed; showing the last reported limits.',
  'notice.couldNotLoadOrganizationReview': 'Could not load organization review. ',
  'notice.couldNotLoadPendingChanges': 'Could not load pending changes. ',
  'notice.couldNotReadAttachedFile': 'Could not read the attached file: ',
  'button.useAutomatic': 'Use automatic',
  'button.useOnce': 'Use once',
  'button.attach': 'Attach',
  'button.addNote': 'Add note',
  'button.chooseModel': 'Choose model',
  'button.send': 'Send',
  'tooltip.attachFiles': 'Attach files',
  'option.balanced': 'Balanced',
  'option.cost': 'Cost',
  'option.highlightsInEditor': 'Highlights in editor',
  'option.intelligence': 'Intelligence',
  'option.none': 'None',
  'option.splitDiffView': 'Split diff view',
  'settings.accountPrivacy': 'Account and privacy',
  'settings.allowWebSearch': 'Allow web search',
  'settings.assistantProvider': 'Assistant provider',
  'settings.automaticModelEffort': 'Automatic model and reasoning effort',
  'settings.automaticSelectionPriority': 'Automatic selection priority',
  'settings.automaticSelectionPrivacy': 'Automatic selection privacy mode',
  'settings.claudeConnection': 'Claude Code connection',
  'settings.codexConnection': 'Codex connection',
  'settings.diffView': 'Diff view',
  'settings.excludedFolders': 'Excluded folders',
  'settings.fallbackProvider': 'Fallback provider',
  'settings.modelsAndLimits': 'Models and account limits',
  'settings.opencodeConnection': 'OpenCode connection',
  'settings.pluginInterconnectivity': 'Plugin Interconnectivity',
  'settings.showSelectionDetails': 'Show automatic selection details',
  'settings.thoroughSelection': 'Thorough automatic selection',
  'settings.desc.thoroughSelection': 'Always run the on-device classifier with chain-of-thought reasoning, attachment names and raw note previews instead of fast local heuristics.',
  'settings.desc.selectionPriority': 'Balance cost and capability, favour lower plan usage and free models, or favour higher-tier models and quality escalation.',
  'settings.desc.diffView': 'Choose how pending Markdown edits are displayed. Accept or decline changes in chat.',
  'settings.desc.modelsAndLimits': 'Choose the model and reasoning effort in the sidebar. Usage follows the limits of the selected provider. OWLA does not change global settings or sign out your other clients.',
  'settings.desc.assistantProvider': 'Choose which assistant answers your messages. Codex uses your ChatGPT login. OpenCode uses the providers you connected in OpenCode, including its free models. Claude Code uses your Claude subscription login.',
  'settings.desc.claudeConnection': 'Claude Code 2.1.322 or newer must be installed and signed in with your Claude account. OWLA starts it on demand with your CLAUDE.md, skills, plugins and built-in tools turned off. No API key is needed.',
  'settings.desc.codexConnection': 'Codex 0.162.1 or newer must be installed and signed in with ChatGPT. OWLA starts it on demand with its shell, file and MCP access turned off. No API key is needed.',
  'settings.desc.showSelectionDetails': 'Include a collapsible section under each reply with the top candidate models and their scores.',
  'settings.desc.privacyMode': 'Keep note excerpts, heading outlines, chat topics and filenames out of the on-device classifier. It still reads your request, on this Mac, so it can judge the task. The chosen assistant receives everything as usual.',
  'settings.desc.pluginInterconnectivity': 'Let OWLA use the Pilafdob plugins enabled in this vault. It can look up and propose changes to Nicons icons, Pinup pins, and Folder and Graphs Plus graph options. You review each change before it is applied.',
  'settings.desc.opencodeConnection': 'OpenCode 2.2 or newer must be installed. OWLA starts it on demand and uses the providers you connected in OpenCode.',
  'settings.desc.allowWebSearch': 'The assistant can search the web when needed. Search queries may be based on the context you provide.',
  'settings.desc.automaticModelEffort': 'Uses Apple’s on-device model on macOS 27 to select a compatible model and reasoning effort from your prompt and attachment names.',
  'settings.desc.excludedFolders': 'Vault-relative paths, one per line. Hidden/configuration files are always excluded.',
  'settings.desc.fallbackProvider': 'When the selected provider reports that its usage limit is reached, OWLA serves the next messages with this provider and switches back as soon as the limit resets. Choose None to be told instead of switched.',
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
  'notice.automaticSelectionSkipped': 'Automatic selection skipped ',
  'notice.automaticSelectionUnavailable': 'Automatic selection unavailable · ',
  'notice.automaticSelectionHeuristicFallback': 'Automatic selection used heuristic fallback · ',
  'notice.automaticSelection': 'Automatic selection · ',
  'notice.checkedPluginOption': 'Checked a Pilafdob plugin option',
  'notice.consulted': 'Consulted ',
  'notice.escalatingThinReply': 'Escalating thin reply to ',
  'notice.oneMessageOverride': 'One-message override · ',
  'notice.proposedPropertyChanges': 'Proposed property changes for ',
  'notice.read': 'Read ',
  'notice.readStagedPreview': 'Read staged preview for ',
  'notice.automaticProviderAlreadyChooses': 'The Automatic provider already chooses the model and reasoning effort for every message.',
  'notice.foundationModelsCliUnavailable': 'The Foundation Models CLI is unavailable on this Mac.',
  'tooltip.overrideModelEffort': 'Override model and reasoning effort for one message',
  'label.automaticSelection': 'Automatic selection',
  'label.sourcesAndActivity': 'Sources & activity',
  'notice.preparingAttachments': 'Preparing attachments…',
  'notice.acceptOrDecline': 'Accept or decline pending changes to continue…',
  'status.connecting': 'Connecting to {provider}…',
  'status.ready': 'Ready for your next message',
  'status.draftRestored': 'Draft restored',
  'menu.addFolderToOwla': 'Add folder to OWLA chat',
  'menu.addFilesToOwla': 'Add files to OWLA chat',
  'menu.addNoteToOwla': 'Add note to OWLA Butler',
  'menu.addPdfToOwla': 'Add PDF to OWLA',
  'dialog.newChatConfirm': 'Start a new chat? Unsaved changes will be lost.',
  'button.clearPendingEdits': 'Clear pending edit record',
  'button.copyMarkdown': 'Copy Markdown',
  'placeholder.composer': 'Ask about your note, or paste a screenshot…',
  'button.viewDiff': 'View diff',
  'button.acknowledgeRecovery': 'Acknowledge recovery record',
  'label.requires': 'Requires: ',
  'label.working': 'Working',
  'button.switchTo': 'Switch to ',
  'notice.allProvidersExhausted': 'All connected providers have been exhausted.',
  'notice.usageDepletedSuffix': ' usage is depleted.',
  'notice.automaticSelectionUsesAlternative': 'Automatic selection uses another connected provider for the next message.',
  'notice.noOtherProvider': 'No other connected provider is available.',
  'notice.availableRateLimitResets': 'Available rate-limit resets: ',
  'notice.reportedBy': 'Reported by ',
  'notice.codexNotFound': 'Codex was not found. Install it, or choose its executable.',
  'notice.opencodeNotFound': 'OpenCode was not found. Install it, or choose its executable.',
  'notice.claudeNotFound': 'Claude Code was not found. Install it, or choose its executable.',
  'notice.detectedAt': 'Detected at {path}.',
  'notice.pdfComments': 'PDF comments · {source}',
  'notice.pdfPage': 'Page {page}',
  'menu.addSelectionToOwla': 'Add selection to OWLA Butler',
  'menu.addPageToOwla': 'Add page to OWLA',
  'menu.copyLinkToPage': 'Copy link to page',
  'menu.copySelectedText': 'Copy selected text',
  'menu.deleteSavedChat': 'Delete a saved chat',
  'placeholder.addNoteAsContext': 'Add a note as context…',
  'placeholder.chooseModel': 'Choose a model…',
  'placeholder.chooseSavedChat': 'Choose a saved chat…',
  'dialog.overrideNextMessage': 'Override the next message',
  'dialog.suggestedChanges': 'Suggested changes',
  'dialog.saveRecentChat': 'Save recent chat',
  'dialog.saveRecentChatDesc': 'Save the last three exchanges locally. Images, attachments and edit buttons are not saved. Up to 20 chats can be saved. Delete an unwanted saved chat before adding more.',
  'dialog.chatName': 'Chat name',
  'dialog.deleteSavedChat': 'Delete saved chat?',
  'dialog.deleteSavedChatDesc': 'Delete “{name}” from local saved chats? This cannot be undone. Notes are not affected.',
  'dialog.reviewOrganization': 'Review organization',
  'dialog.checkingPaths': 'Checking paths and links…',
  'dialog.reviewPdfAnnotations': 'Review PDF annotations',
  'dialog.saveAnnotatedCopy': 'Save a separate annotated copy of {path}.',
  'dialog.pdfPageComment': 'Page {page} · {text}',
  'label.model': 'Model',
  'label.reasoningEffort': 'Reasoning effort',
  'label.noteDiff': 'Note diff',
  'button.acceptAnnotations': 'Accept annotations',
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
  'notice.webSearchConsent': 'This turn includes note content and web search is on. Allow web search for this turn?',
  'button.allowOnce': 'Allow once',
  'button.allowForChat': 'Always for this chat',
  'button.dontSearch': "Don't search",
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
  'button.cancel': 'Abbrechen',
  'button.checkAutomaticSelection': 'Automatische Auswahl prüfen',
  'button.chooseExecutable': 'Ausführbare Datei wählen…',
  'button.connectClaudeCode': 'Claude Code verbinden',
  'button.connectCodex': 'Codex verbinden',
  'button.connectOpencode': 'OpenCode verbinden',
  'button.deleteChat': 'Chat löschen',
  'button.disconnect': 'Trennen',
  'button.refreshUsage': 'Nutzung aktualisieren',
  'button.saveChat': 'Chat speichern',
  'button.signIn': 'Anmelden',
  'button.verifyConnection': 'Verbindung prüfen',
  'button.accept': 'Übernehmen',
  'button.decline': 'Ablehnen',
  'button.moveToTrash': 'In den Papierkorb verschieben',
  'button.saveAndStartNew': 'Speichern und neu starten',
  'button.append': 'An Notiz anhängen…',
  'button.reviewAnnotatedCopy': 'Annotierte Kopie prüfen…',
  'dialog.reviewDeletion': 'Löschung prüfen',
  'dialog.reviewPaths': 'Pfade prüfen',
  'dialog.reviewRelatedChanges': 'Verwandte Änderungen prüfen',
  'dialog.suggestedDeletion': 'Vorgeschlagene Löschung',
  'notice.resolveNoteChangesBeforeMoves': 'Löse die Notizänderungen auf, bevor du Verschiebungen prüfst.',
  'notice.noSourcesOrActivity': 'Keine Quellen oder Aktivität für diese Antwort.',
  'notice.searchingVault': 'Dein Vault wird durchsucht…',
  'notice.messageOwla': 'OWLA Butler eine Nachricht senden',
  'notice.refreshFailed': 'Aktualisierung fehlgeschlagen; zeige die zuletzt gemeldeten Limits.',
  'notice.couldNotLoadOrganizationReview': 'Organisationsprüfung konnte nicht geladen werden. ',
  'notice.couldNotLoadPendingChanges': 'Ausstehende Änderungen konnten nicht geladen werden. ',
  'notice.couldNotReadAttachedFile': 'Angehängte Datei konnte nicht gelesen werden: ',
  'button.useAutomatic': 'Automatisch verwenden',
  'button.useOnce': 'Einmal verwenden',
  'button.attach': 'Anhängen',
  'button.addNote': 'Notiz hinzufügen',
  'button.chooseModel': 'Modell wählen',
  'button.send': 'Senden',
  'tooltip.attachFiles': 'Dateien anhängen',
  'option.balanced': 'Ausgewogen',
  'option.cost': 'Kosten',
  'option.highlightsInEditor': 'Hervorhebungen im Editor',
  'option.intelligence': 'Intelligenz',
  'option.none': 'Keine',
  'option.splitDiffView': 'Geteilte Diff-Ansicht',
  'settings.accountPrivacy': 'Konto und Datenschutz',
  'settings.allowWebSearch': 'Websuche erlauben',
  'settings.assistantProvider': 'Assistenten-Anbieter',
  'settings.automaticModelEffort': 'Automatische Modell- und Aufwandswahl',
  'settings.automaticSelectionPriority': 'Priorität der automatischen Auswahl',
  'settings.automaticSelectionPrivacy': 'Datenschutzmodus der automatischen Auswahl',
  'settings.claudeConnection': 'Claude Code-Verbindung',
  'settings.codexConnection': 'Codex-Verbindung',
  'settings.diffView': 'Diff-Ansicht',
  'settings.excludedFolders': 'Ausgeschlossene Ordner',
  'settings.fallbackProvider': 'Ausweich-Anbieter',
  'settings.modelsAndLimits': 'Modelle und Kontingente',
  'settings.opencodeConnection': 'OpenCode-Verbindung',
  'settings.pluginInterconnectivity': 'Plugin-Vernetzung',
  'settings.showSelectionDetails': 'Details der automatischen Auswahl anzeigen',
  'settings.thoroughSelection': 'Gründliche automatische Auswahl',
  'settings.desc.thoroughSelection': 'Führt den Klassifikator auf dem Gerät immer mit Chain-of-Thought-Reasoning, Anhangsnamen und rohen Notizvorschauen aus, statt schneller lokaler Heuristiken.',
  'settings.desc.selectionPriority': 'Gewichtet Kosten und Leistung, begünstigt niedrige Kontingentnutzung und kostenlose Modelle oder höherwertige Modelle und Qualitätssteigerung.',
  'settings.desc.diffView': 'Legt fest, wie ausstehende Markdown-Bearbeitungen angezeigt werden. Änderungen im Chat übernehmen oder ablehnen.',
  'settings.desc.modelsAndLimits': 'Modell und Aufwand in der Seitenleiste wählen. Die Nutzung folgt den Limits des gewählten Anbieters. OWLA ändert keine globalen Einstellungen und meldet keine anderen Clients ab.',
  'settings.desc.assistantProvider': 'Wählt, welcher Assistent deine Nachrichten beantwortet. Codex nutzt deinen ChatGPT-Login. OpenCode nutzt die in OpenCode verbundenen Anbieter, inklusive kostenloser Modelle. Claude Code nutzt deinen Claude-Abonnement-Login.',
  'settings.desc.claudeConnection': 'Claude Code 2.1.322 oder neuer muss installiert und mit deinem Claude-Konto angemeldet sein. OWLA startet es bei Bedarf mit ausgeschalteten CLAUDE.md-, Skills-, Plugins- und Built-in-Tools. Kein API-Schlüssel nötig.',
  'settings.desc.codexConnection': 'Codex 0.162.1 oder neuer muss installiert und mit ChatGPT angemeldet sein. OWLA startet es bei Bedarf mit ausgeschalteten Shell-, Datei- und MCP-Zugriffen. Kein API-Schlüssel nötig.',
  'settings.desc.showSelectionDetails': 'Fügt unter jeder Antwort einen aufklappbaren Abschnitt mit den besten Kandidatenmodellen und ihren Bewertungen ein.',
  'settings.desc.privacyMode': 'Hält Notizauszüge, Überschriften, Chat-Themen und Dateinamen aus dem Klassifikator auf dem Gerät heraus. Er liest weiterhin deine Anfrage auf diesem Mac, um die Aufgabe einzuschätzen. Der gewählte Assistent erhält alles wie üblich.',
  'settings.desc.pluginInterconnectivity': 'Erlaubt OWLA, die in diesem Vault aktivierten Pilafdob-Plugins zu nutzen. Es kann Nachschlagen und Änderungsvorschläge für Nicons-Icons, Pinup-Pins und Folder-and-Graphs-Plus-Graphoptionen erstellen. Du prüfst jede Änderung vor der Anwendung.',
  'settings.desc.opencodeConnection': 'OpenCode 2.2 oder neuer muss installiert sein. OWLA startet es bei Bedarf und nutzt die in OpenCode verbundenen Anbieter.',
  'settings.desc.allowWebSearch': 'Der Assistent kann bei Bedarf im Web suchen. Suchanfragen können auf dem von dir bereitgestellten Kontext basieren.',
  'settings.desc.automaticModelEffort': 'Nutzt Apples Modell auf dem Gerät unter macOS 27, um ein kompatibles Modell und Aufwandsniveau aus deiner Anfrage und den Anhangsnamen auszuwählen.',
  'settings.desc.excludedFolders': 'Vault-relative Pfade, einer pro Zeile. Versteckte/Konfigurationsdateien werden immer ausgeschlossen.',
  'settings.desc.fallbackProvider': 'Wenn der gewählte Anbieter meldet, dass sein Nutzungslimit erreicht ist, bedient OWLA die nächsten Nachrichten mit diesem Anbieter und wechselt zurück, sobald das Limit zurückgesetzt ist. Wähle „Keiner“, um stattdessen benachrichtigt zu werden.',
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
  'notice.automaticSelectionSkipped': 'Automatische Auswahl übersprungen ',
  'notice.automaticSelectionUnavailable': 'Automatische Auswahl nicht verfügbar · ',
  'notice.automaticSelectionHeuristicFallback': 'Automatische Auswahl nutzte Heuristic-Fallback · ',
  'notice.automaticSelection': 'Automatische Auswahl · ',
  'notice.checkedPluginOption': 'Eine Pilafdob-Plugin-Option geprüft',
  'notice.consulted': 'Konsultiert ',
  'notice.escalatingThinReply': 'Dünne Antwort wird eskaliert an ',
  'notice.oneMessageOverride': 'Einmalige Überschreibung · ',
  'notice.proposedPropertyChanges': 'Vorgeschlagene Eigenschaftsänderungen für ',
  'notice.read': 'Gelesen ',
  'notice.readStagedPreview': 'Staged-Vorschau gelesen für ',
  'notice.automaticProviderAlreadyChooses': 'Der automatische Anbieter wählt Modell und Aufwandsniveau bereits für jede Nachricht.',
  'notice.foundationModelsCliUnavailable': 'Die Foundation-Models-CLI ist auf diesem Mac nicht verfügbar.',
  'tooltip.overrideModelEffort': 'Modell und Aufwandsniveau für eine Nachricht überschreiben',
  'label.automaticSelection': 'Automatische Auswahl',
  'label.sourcesAndActivity': 'Quellen & Aktivität',
  'notice.preparingAttachments': 'Anhänge werden vorbereitet…',
  'notice.acceptOrDecline': 'Nimm ausstehende Änderungen an oder lehne sie ab, um fortzufahren…',
  'status.connecting': 'Verbinde mit {provider}…',
  'status.ready': 'Bereit für deine nächste Nachricht',
  'status.draftRestored': 'Entwurf wiederhergestellt',
  'menu.addFolderToOwla': 'Ordner zu OWLA Chat hinzufügen',
  'menu.addFilesToOwla': 'Dateien zu OWLA Chat hinzufügen',
  'menu.addNoteToOwla': 'Notiz zu OWLA Butler hinzufügen',
  'menu.addPdfToOwla': 'PDF zu OWLA hinzufügen',
  'dialog.newChatConfirm': 'Neuen Chat starten? Ungespeicherte Änderungen gehen verloren.',
  'button.clearPendingEdits': 'Ausstehende Änderungsdatei leeren',
  'button.copyMarkdown': 'Markdown kopieren',
  'placeholder.composer': 'Frage zu deiner Notiz oder füge einen Screenshot ein…',
  'button.viewDiff': 'Diff anzeigen',
  'button.acknowledgeRecovery': 'Wiederherstellungseintrag bestätigen',
  'label.requires': 'Erfordert: ',
  'label.working': 'Arbeitet',
  'button.switchTo': 'Wechseln zu ',
  'notice.allProvidersExhausted': 'Alle verbundenen Anbieter sind erschöpft.',
  'notice.usageDepletedSuffix': ' Nutzung ist erschöpft.',
  'notice.automaticSelectionUsesAlternative': 'Die automatische Auswahl verwendet für die nächste Nachricht einen anderen verbundenen Anbieter.',
  'notice.noOtherProvider': 'Kein anderer verbundener Anbieter verfügbar.',
  'notice.availableRateLimitResets': 'Verfügbare Limit-Rücksetzungen: ',
  'notice.reportedBy': 'Gemeldet von ',
  'notice.codexNotFound': 'Codex wurde nicht gefunden. Installiere es oder wähle die ausführbare Datei.',
  'notice.opencodeNotFound': 'OpenCode wurde nicht gefunden. Installiere es oder wähle die ausführbare Datei.',
  'notice.claudeNotFound': 'Claude Code wurde nicht gefunden. Installiere es oder wähle die ausführbare Datei.',
  'notice.detectedAt': 'Erkannt unter {path}.',
  'notice.pdfComments': 'PDF-Kommentare · {source}',
  'notice.pdfPage': 'Seite {page}',
  'menu.addSelectionToOwla': 'Auswahl zu OWLA Butler hinzufügen',
  'menu.addPageToOwla': 'Seite zu OWLA hinzufügen',
  'menu.copyLinkToPage': 'Link zur Seite kopieren',
  'menu.copySelectedText': 'Ausgewählten Text kopieren',
  'menu.deleteSavedChat': 'Gespeicherten Chat löschen',
  'placeholder.addNoteAsContext': 'Notiz als Kontext hinzufügen…',
  'placeholder.chooseModel': 'Modell wählen…',
  'placeholder.chooseSavedChat': 'Gespeicherten Chat wählen…',
  'dialog.overrideNextMessage': 'Nächste Nachricht überschreiben',
  'dialog.suggestedChanges': 'Vorgeschlagene Änderungen',
  'dialog.saveRecentChat': 'Chat speichern',
  'dialog.saveRecentChatDesc': 'Speichert die letzten drei Austausche lokal. Bilder, Anhänge und Bearbeitungsschaltflächen werden nicht gespeichert. Bis zu 20 Chats können gespeichert werden. Lösche einen unerwünschten gespeicherten Chat, bevor du weitere hinzufügst.',
  'dialog.chatName': 'Chat-Name',
  'dialog.deleteSavedChat': 'Gespeicherten Chat löschen?',
  'dialog.deleteSavedChatDesc': '„{name}“ aus den lokal gespeicherten Chats löschen? Dies kann nicht rückgängig gemacht werden. Notizen sind nicht betroffen.',
  'dialog.reviewOrganization': 'Organisation prüfen',
  'dialog.checkingPaths': 'Pfade und Links werden geprüft…',
  'dialog.reviewPdfAnnotations': 'PDF-Anmerkungen prüfen',
  'dialog.saveAnnotatedCopy': 'Separate annotierte Kopie von {path} speichern.',
  'dialog.pdfPageComment': 'Seite {page} · {text}',
  'label.model': 'Modell',
  'label.reasoningEffort': 'Aufwandsniveau',
  'label.noteDiff': 'Notiz-Diff',
  'button.acceptAnnotations': 'Anmerkungen übernehmen',
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
  'notice.webSearchConsent': 'Diese Runde enthält Notizinhalt und Websuche ist aktiv. Websuche für diese Runde erlauben?',
  'button.allowOnce': 'Einmal erlauben',
  'button.allowForChat': 'Für diesen Chat immer',
  'button.dontSearch': 'Nicht suchen',
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
