# Menüpunkt „Einstellungen“ – Design

Stand: 2026-10-19 · Branch `claude/feature/i18n` (PR #2, Version 0.12.0 unveröffentlicht) · Grundlage: `.superpowers/sdd/settings-research.md` (Konzept, Fundstellen und Dateilisten dort).

Nutzerwunsch: „ich will einen menüpunkt haben wo ich einstellungen durchführen kann. da drunter auch das umstellen der sprache (und gegebenenfalls andere)“.

## 1. Umfang

**Drin:**

1. Zahnrad-Knopf „Einstellungen“ in der Kopfzeile ganz rechts (nach „Vault sperren“), Tastenkürzel `Strg+,`, Link „Einstellungen“ im Fuß der Startkarte (vor dem Entsperren).
2. Modaler Dialog `SettingsDialog` mit Abschnitten:
   - **Allgemein:** Sprache (`LanguageSetting`, unverändert), Dateiverknüpfung (`FileTypeSetting`, in eigene Datei verschoben, unverändert).
   - **Vault** (nur entsperrt): Checkbox „Vor dem Trennen laufender Sitzungen nachfragen“ (`vault.settings.confirmBeforeClosingSession`, bisher ohne Schalter, an 7 Stellen gelesen), gespeichert über `persistVault`.
   - **KI-Assistent** (nur entsperrt): Zusammenfassung der Anbieter und Knopf „Anbieter verwalten“, der den unveränderten `AiSettingsDialog` öffnet; dessen „Fertig“ führt zurück.
   - Ohne Vault: Hinweiszeile, dass Vault- und KI-Einstellungen nach dem Entsperren erscheinen.
   - Fuß: „Schließen“. Alle Werte wirken sofort, kein „Speichern“.
3. Startkarte und Willkommensseite verlieren `LanguageSetting` und `FileTypeSetting` vollständig. „Gut zu wissen“ bekommt einen Tipp mit Verweis auf Einstellungen und Kürzel.
4. Doku (Handbuch, Manual, CHANGELOG de/en 0.12.0, Design-System-Gate).

**Nicht drin:** `autoLockMinutes` (kein Leser im Code, eigenes Feature), `theme` (kein helles Thema), Einstellungen im Nebenfenster (Setter verlangen das Hauptfenster), neuer `settings.json`-Schlüssel, Vault-Schema-Änderung, Main-/IPC-/Preload-Code, Änderung an `AiSettingsDialog.tsx`.

## 2. Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| E1 | Zahnrad-Icon statt Textknopf | Kopfzeile hat eine Sparregel für schmale Fenster; Englisch würde umbrechen | Ein Textknopf wäre ein Einzeiler |
| E2 | `Strg+,` (VS-Code-Konvention, `event.code === 'Comma'`), Capture-Listener | Terminals dürfen das Kürzel nicht schlucken | Keine |
| E3 | Dialog statt eigenem Tab oder Seitenleiste | Vier Einstellungen, Tabs sind Sitzungen, Tab wäre vor dem Entsperren nicht verfügbar | Später Navigation ergänzen |
| E4 | `confirmBeforeClosingSession` in v1 | Echte, überall wirksame Einstellung ohne Schalter; Speichern über bestehenden Weg | Keine |
| E5 | Keine verschachtelten Modale: „Anbieter verwalten“ ersetzt den Dialog, „Fertig“ kehrt zurück | `AiSettingsDialog` bleibt unverändert, keine Fokus-Probleme | Keine |
| E6 | Namespace `app` | Sprache und Dateiverknüpfung liegen schon dort | Keine |
| E7 | Bewegung: per Klick wie `.confirm-dialog`, per `Strg+,` sofort (`data-instant`), Gate-Zeile in `docs/design-system.md` | Motion-Gate (Tastatur bewegt nicht) | Keine |
| E8 | Version bleibt 0.12.0, CHANGELOG-Eintrag wird angepasst | 0.12.0 ist unveröffentlicht | Keine |

## 3. Vertrag

- `SettingsDialog` Props: `{ vault: Vault | null; busy: boolean; instant?: boolean; onClose(): void; onManageAi(): void; onSaveSettings(settings: VaultSettings): Promise<boolean> }`. Muster `AiSettingsDialog`/`WorkflowsDialog`: `useNativeSurfaceBlock(true)`, `showModal()` im Effekt, `onCancel` schließt, wenn nicht `busy`. Klassen `confirm-dialog settings-dialog`.
- `src/renderer/src/settings-sections.ts`: `settingsSections(vault: Vault | null): readonly SettingsSection[]` (`'general'` bzw. `'general' | 'vault' | 'assistant'`), `aiProviderSummary(ai?: AiSettings): string`, `withConfirmBeforeClosing(settings: VaultSettings, value: boolean): VaultSettings`.
- `src/renderer/src/shortcut-match.ts`: `matchesShortcut(event, { ctrl: boolean; shift: boolean; code: string }): boolean`; `hooks/useShortcut.ts` nutzt sie und bietet zusätzlich `useCtrlShortcut(code, action)`.
- `App.tsx`: `showAiSettings` wird `dialog: null | 'settings' | 'ai' | 'ai-from-settings'`. `Strg+,` schaltet nur zwischen `null` und `'settings'`, sonst nichts. `onSaveSettings` → `persistVault({ ...vault, settings })`, Fehler wie bei jedem `persistVault` als Hinweis.
- CSS in neuer Datei `src/renderer/src/settings-ui.css`, nur Tokens. Die Regeln `.file-type-setting, .language-setting` ziehen aus `styles.css` dorthin, `.welcome-card .file-type-setting` entfällt.
- Keys laut Konzept Abschnitt 4 (de-DE und en-US), englische Ellipse ohne Leerzeichen.

## 4. Wellen

| Welle | Task | Dateien |
|---|---|---|
| 1 | **1A Dialog** | neu `components/SettingsDialog.tsx`, neu `components/FileTypeSetting.tsx`, neu `settings-ui.css`, neu `settings-sections.ts` + Test, `components/WelcomePage.tsx`, `styles.css` |
| 1 | **1B App/Kürzel** | `App.tsx`, `hooks/useShortcut.ts`, neu `shortcut-match.ts` + Test |
| 1 | **1C Kataloge** | `src/shared/locales/{de-DE,en-US}/{app,common}.json` |
| 2 | **2A Doku** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `docs/design-system.md` |

Gate nach jeder Welle: `npm run typecheck`, `npx vitest run`. Danach Review, run-app-Prüfung (Konzept Abschnitt 5), Push.
