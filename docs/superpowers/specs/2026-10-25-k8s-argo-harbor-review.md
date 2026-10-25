# Kubernetes: Argo-CD-Bezug und Harbor-Links – Review (Stufe 5)

Branch `claude/feature/k8s-argo-harbor` gegen `claude/feature/k8s-ki-diagnose` (13 Commits, `5abe21d..024ddce`; `git status -- src .claude/skills/run-app` ist leer).
Grundlage: Spec `2026-10-25-k8s-argo-harbor-design.md`, der bindende Anhang `…-validation.md` (B1–B3, K1–K9, V1–V14) und das Ledger `.superpowers/sdd/2026-10-25-k8s-argo-harbor/progress.md` mit Nutzer-Ruling R-0 (nur lesend). Erlaubt ist nur `get` auf `applications.argoproj.io`: kein Sync, kein Refresh mit Wirkung, keine Harbor-API. Bestehende schreibende Aktionen bekommen nur einen Hinweis.

**Urteil: ready.** 0 Critical, 0 Important, 2 Minor.
- **M-1:** Offene Cluster-Tabs zeigen geänderte Argo- und Harbor-Adressen erst nach einem Zustandswechsel. Das ist Ledger-Beobachtung 1. Es ist kein Sicherheitsfehler, weil Main den Host beim Klick frisch aus dem Vault liest, aber der Menühinweis kann den alten Host zeigen.
- **M-2:** Der Shot `cluster-links-form.png` zeigt die beiden neuen Felder nicht, weil die Fußleiste des Formulars sie verdeckt.
- **Ohne Befund:**
  - Verben (R-0): nur ein neuer API-Aufruf, `GET …/applications/{name}`.
  - Host immer aus dem Vault, zweifach geprüft (`linkTarget` und `openableHref` direkt vor `shell.openExternal`).
  - Kein `http:`, `file:` oder `javascript:`. Pfadteile aus Cluster-Daten gehen nur über feste ASCII-Muster in den Link (eigene Probe: 0 Treffer außerhalb des Origins).
  - Self-Heal-Zeile fail-open und ohne Einfluss auf „Bestätigen“.
  - Treiber-Ersatz von `openExternal` nur in `driver.mjs`.
  - Alte Vaults laden weiter, der Validator prüft nur die Gültigkeit (K2).
  - i18n, Tokens, Doku und README-Datenschutzsatz stimmen.

**Gates:**
- `npm run typecheck`: grün (Node und Web).
- `npx vitest run`: **177 Dateien, 2 858/2 858 grün** im ersten Lauf, darin `fakes.test.mjs` mit dem Argo-Ende-zu-Ende-Test. Es gab keinen Last-Flake, darum keine Einzelwiederholung.
- Kein echter Cluster, kein Argo CD, kein Harbor, kein Build nach `out/`. Den Treiber habe ich nicht bedient.
- Gelesen wurden nur die Shots `cluster-links-form.png`, `kube-harbor-menu.png`, `kube-argo-menu.png` und `kube-argo-selfheal.png` aus `%TEMP%\shellherd-run\shots`.
- Proben im Scratchpad (`…\scratchpad\probe\probe.ts`, mit esbuild gebündelt, nur gegen `src/shared/kube-links.ts` und `links.ts`): 9 Basisadressen × 25 bösartige App-Namen und × 20 bösartige Images mit je 3 Digests, dazu 9 Fälle für die Tracking-Annotation. Siehe 1.2.

---

## 1. Sicherheit

### 1.1 Neue API-Aufrufe (Nutzer-Ruling R-0)

Gesucht wurde in allen hinzugefügten Zeilen unter `src/` nach `fetch(`, `net.request`, `makeApiClient`, `openExternal`, `patch`, `create` und `delete`.

| Stelle | Aufruf | HTTP | RBAC-Verb |
|---|---|---|---|
| `client-api.ts:601-605` `readArgoApp` ← `session.ts:667-682` `argoApp` ← `kubernetes/ipc.ts:114-118` `k8s:argo-app` | `CustomObjectsApi.getNamespacedCustomObject({ group: 'argoproj.io', version: 'v1alpha1', namespace, plural: 'applications', name })` | `GET /apis/argoproj.io/v1alpha1/namespaces/{ns}/applications/{name}` | `get` applications.argoproj.io |
| `kubernetes/ipc.ts:105-113` `k8s:open-link` | `shell.openExternal(safe)` | keine Anfrage von Shellherd; der Browser des Nutzers öffnet die Seite nach dem Klick | – |

- **Sonst nichts:**
  - kein `list`, kein `watch` und keine Discovery auf `argoproj.io`;
  - kein Aufruf an die Argo-CD- oder Harbor-API, kein Refresh (auch keine Annotation `argocd.argoproj.io/refresh`), kein Sync;
  - kein `fetch`.
- **Belege:**
  - Pflicht-Test B prüft genau einen Aufruf mit genau diesen Parametern und `clients === [CustomObjectsApi]`.
  - Der Ende-zu-Ende-Test (`fakes.test.mjs`, „reads the Argo CD application by GET only …“) läuft über den echten `createKubeApi` und den TLS-Tunnel. Er prüft, dass alle `argoproj`-Zeilen genau zwei GETs sind und alle Anfragen mit `GET ` beginnen.
  - Die Szene `kube-links` prüft, dass die Application genau einmal gelesen wird und dass keine Nicht-GET-Anfrage außer der Rechte-Vorabprüfung aus Paket 10 kommt.
  - `diagnose.test.ts` setzt `readArgoApp = forbidden`, die KI-Diagnose kann es also nicht aufrufen.
- **Bestehende schreibende Aktionen unverändert:**
  - `runAction`, `readOnly` in Main und `ClusterView.action` sind nicht im Diff.
  - `confirm` (`ClusterView.tsx:161-171`) ergänzt nur das Feld `argoApp`, `actionReason` greift weiter vorher.
  - Der Dialog bekommt nur die Hinweiszeile (`ConfirmAction.tsx:50-61`, `:90`).
- **Kein Critical.**

### 1.2 `k8s:open-link` und `openableHref`

| Frage | Ergebnis | Beleg |
|---|---|---|
| Kommt der Host immer aus dem Vault? | ja | `KubeLinkSchema` (`kubernetes-schema.ts:54-59`) ist eine `discriminatedUnion` aus zwei `.strict()`-Objekten, nur `{type:'argo', app}` bzw. `{type:'harbor', image, digest?}`. `url` und `host` werden abgelehnt (Pflicht-Test A2). `linkTarget` (`session.ts:685-700`) liest `getCluster` bei jedem Klick frisch: gesperrter Vault → Fehler, deaktivierter Cluster → `kubernetes.disabled`, keine Adresse → `noArgoUrl`/`noHarborUrl`. Den Host des Links bestimmt `argoAppUrl`/`harborImageUrl` aus `cluster.argoUrl`/`harborUrl`. |
| Zweite Sperre direkt vor dem Browser | ja, stärker als Spec 3.6 | `openableHref` (`session.ts:93-98`): `webLinkHref` (nur http/https, keine Userinfo, ≤ 2 048), dazu `startsWith('https://')` und **Host-Gleichheit** mit `httpsBase(base)`. Die Spec verlangte nur https. Mit Unit-Test (`session.test.ts:945-962`), damit ist V9 erledigt. |
| `http:`, `file:`, `javascript:`, `data:` | ausgeschlossen | `httpsBase` (`kube-links.ts:18-24`) nimmt nur `https:` ohne Userinfo, Query und Fragment. Das gilt für die Vault-Adresse (Schema, Formular) und noch einmal beim Gebrauch. Der Renderer kann kein Schema liefern. |
| Pfadteile aus Cluster-Daten kodiert (`..`, `%2F`, `\`, Unicode) | sicher | Argo: App-Name nur nach `ARGO_APP` (`[a-z0-9.-]`, `_` nur als ein Trenner, `.`/`..` am Anfang ausgeschlossen). Diese Zeichen sind im Pfad unreserviert, eine Kodierung ist nicht nötig. Harbor: Host per `REGISTRY_HOST` (ASCII) und gleich dem Vault-Host; Projekt und Segmente nach OCI-`PATH_COMPONENT` (ASCII, kein `%`, `\` oder `..`). Das Repository geht durch `encodeURIComponent` (nur `/` → `%2F`), der Digest durch `^sha256:[a-f0-9]{64}$`. |
| Eigene Probe | 0 Treffer außerhalb des Origins | Basen: normal, mit Pfad, mit Port, `…/a%2F..%2Fb`, `…/%2e%2e/x`, Punycode, Host mit Punkt am Ende, `[::1]:8443`, `https://h/\evil.com`. Apps: `a..b`, `..`, `.`, `evil.com%2F`, `shop/../../x`, kyrillisch, Fullwidth, `​`, `\n`, `a\b`, `a@b`, `a:b`, `a?b`, `a#b` und weitere. Images: `..`, `%2F`, `\`, Fullwidth, `@sha256:…/../x`, `#`, `?`, `host:8443@evil.com/…`, `evil.com#host/…`, `:08443`, Leer- und Steuerzeichen und weitere. Jede erzeugte Adresse hat den Origin der Basis und ist kanonisch (`webLinkHref(u) === u`). Die einzigen Auffälligkeiten liegen an der Vault-Adresse selbst, also beim Nutzer: `https://h/\evil.com` wird `https://h//evil.com`, und `https://h/a%2F..%2Fb` bleibt stehen. Beide bleiben auf `h`. |
| Kann eine Tracking-Annotation einen fremden App-Namespace oder Pfad erzwingen? | Pfad nein, Namespace ja (gewollt) | `kube-system_x:apps/Deployment:shop/api` an `shop/api` ergibt `argoApp = kube-system_x`. Das führt zu `GET` der Application `kube-system/x` und zum Link `…/applications/kube-system/x` auf dem Argo-Host. So arbeitet Argo CD mit Apps in beliebigen Namespaces, und Argo selbst wertet dieselbe Annotation genauso aus. Wer die Annotation setzen kann, darf das Objekt ohnehin ändern. Die Folge ist höchstens ein irreführender Hinweis, nie eine Aktion. Kopierte Annotationen aus einem anderen Namespace oder von einem anderen Objekt zählen nicht (K1, Probe „copied other ns“ → `undefined`, „cluster-scoped forged ns“ → `undefined`). `__proto__`-Schlüssel wirken nicht. |
| Exec bzw. Öffnen ohne Klick | nein | `openLink` (`ClusterView.tsx:181-184`) wird nur über `runMenuAction` `case 'link'` aufgerufen (`kube-menu-run.ts:43`), also nach Klick oder Enter im Menü. `kube-commands.ts` hat keinen Link-Befehl. |
| kubeconfig, Secrets | bleiben in Main | Neu an den Renderer gehen nur `argoUrl`/`harborUrl`, `argoApp`, `digests` und `KubeArgoState` (zwei Booleans und zwei Werte aus festen Listen, `argo.ts:23-30`). Die Application selbst (Helm-Values, Parameter) verlässt Main nie (V13). Fehler beim Lesen werden zu `null` und tragen keinen Text. |

### 1.3 Treiber

`driver.mjs:66-73`: `app.evaluate(({ shell }) => { shell.openExternal = async url => … })` im Playwright-Prozess, mit `SHELLHERD_RUN_REAL_BROWSER=1` abschaltbar. In `src/` gibt es keinen Code dafür, und es landet nichts im Paket (`grep __shellherdOpened src` ist leer). Der Ersatz gilt nur in der vom Treiber gestarteten App.

### 1.4 Self-Heal-Zeile

| Fall | Ergebnis | Beleg |
|---|---|---|
| 403, 404, fehlendes CRD | `null` → „möglicherweise“ | `.then(argoStateOf, () => null)` (`session.ts:678`). Pflicht-Tests B (403/404 → `KubeApiError`) und H2. |
| Timeout | `null` nach 5 s, Timer gelöscht | `Promise.race` mit `schedule(…, ARGO_TIMEOUT_MS)`, `finally cancel(timer)` (`:676-681`). Eine späte Ablehnung ist abgefangen, es gibt keine unbehandelte Rejection. Pflicht-Test „gives up after the timeout …“. |
| Keine Verbindung, ungültiger Name | `null` ohne Anfrage | `requireApi` im `try` (`:674`), `argoAppLocation` (`:672-673`). |
| Gesperrter Vault, deaktivierter Cluster, fremder Owner | IPC-Fehler → im Renderer `null` | `ConfirmAction.tsx:56` (zweiter Zweig). |
| Abbruch beim Schließen | Ergebnis verworfen | `live = false` im Cleanup (`:57`). Die GET-Anfrage selbst läuft aus, wie V3 angenommen. |
| „Bestätigen“ wartet nicht | ja | `canConfirm = replicasValid && typingOk && !busy` (`:49`) hängt nicht an `argo`. Shot `kube-argo-selfheal.png`: Der Knopf `Anhalten` ist nur wegen der Namenseingabe (Produktion) gesperrt. |
| Ehrlichkeit der Texte | über- statt unterwarnend | `selfHeal`-Text bedingt („Weicht es danach von Git ab“). Bei `ignoreDifferences` (etwa `replicas` mit HPA) warnt er zu viel, nie zu wenig. K3 ist wörtlich umgesetzt. |

### 1.5 Vault

- `WebAddressSchema` (`vault/schema.ts:147-148`) ist `.optional()` und verlangt `httpsBase(value) !== null`, wörtlich nach K2. Alte Vaults ohne die Felder bleiben gültig (Pflicht-Test V: `not.toHaveProperty('argoUrl')`).
- Das Formular speichert normalisiert (`connection-form.ts:213-219`), leere Felder entfallen ganz.
- Rest wie in Spec-Risiko 6: Ältere Shellherd-Versionen streifen die Felder beim Speichern ab. Das ist ohne Datenverlust für andere Felder.

## 2. Ledger-Beobachtungen

1. **Geänderte Adressen erst nach Neuöffnen:** bestätigt → **M-1**.
   - **Ursache:** `Session.status()` liest den Vault bei jedem Aufruf neu (`session.ts:494`). Gesendet wird der Status aber nur bei Zustandswechseln (`setState`, `onMetrics`, `resend`), nicht bei `onVaultChange`.
   - **Kein Sicherheitsfehler:** Main baut jeden Link beim Klick aus dem aktuellen Vault (`linkTarget`) und prüft ihn erneut (`openableHref`).
   - **Folgen im Menü:**
     - Adresse neu eingetragen: Der Eintrag bleibt gesperrt mit „Keine Argo-CD-Adresse im Cluster-Eintrag.“.
     - Adresse gelöscht: Der Eintrag ist aktiv, der Klick meldet `kubernetes.noArgoUrl` in der Statuszeile.
     - Host geändert: Der Hinweis zeigt den alten Host, geöffnet wird der neue. Das ist irreführend, aber der Nutzer hat den neuen Host selbst eingetragen.
   - **Gleiches Muster außerhalb des Pakets:** `production`, `readOnly`, `name` und `namespace` im Renderer-Status (`ClusterView.tsx:75-77`). Dass „Produktion“ nach dem Umschalten bei offenem Tab erst nach einem Zustandswechsel das Eintippen verlangt, ist älter und nicht Teil dieses Pakets. Der Fix aus M-1 behebt es mit.
2. **Szene nutzt CronJob „Anhalten…“ statt Deployment „Skalieren…“:** **kein Befund.**
   - Im Fake ist `patch` auf Workloads in `shop` per RBAC gesperrt (Shot `kube-argo-menu.png`: „Keine Berechtigung: patch auf deployments in shop“). Die Szene `kube-logs` prüft genau diese Sperre. Die Fixture zu ändern, bräche also eine andere Szene.
   - `suspend` geht durch denselben Zweig `revert` wie `scale` (`argoNoteFor`, Pflicht-Test M2 für alle vier Arten). Die Szene deckt dafür zusätzlich den Weg über die Tracking-Annotation (Argo CD 3) im Dialog ab. Den Label-Weg deckt sie im Menü ab (`api`).
   - Nicht abgedeckt ist nur das Layout der Zeile zusammen mit dem Replicas-Feld. Das prüft manueller Test 5.
3. **`innerText` bei Menüüberschriften in weiteren Szenen:** **kein Befund.**
   - Alle 24 `innerText`-Stellen in `screens.mjs` geprüft. Keine liest `[role=menu]`, `.context-menu-heading` oder ein anderes Element mit `text-transform: uppercase` (`navigation-ui.css:53`, `:59`, `:64`, `settings-ui.css:5`, `styles.css:108`).
   - `kube-logs` (`disabledWith`, `enabled`), `kube-ai` und `kube-forward` prüfen Menüs über `menuItem` bzw. `textContent` (`screens.mjs:31`, `:363-364`).
   - Die übrigen `innerText`-Prüfungen gelten Statuszeile, Weiterleitungsleiste, Diagnosekarte und Panel, alle ohne Großschreibung per CSS.
   - Die Abwesenheitsprüfung in `kube-links` (gefälschte Tracking-ID) nutzt jetzt `textContent` und ist damit wirksam.

## 3. i18n, Tokens, Doku

- **i18n:**
  - Alle neuen Texte laufen über `t()`. Sie liegen in de-DE und en-US (`connection.json` `cluster.links`, `cluster.validation.linkUrl`; `kubeActions.json` `reasons`, `menu`, `confirm.argo`; `errors/kubernetes.json` drei Codes).
  - `ARGO_REVERT_KEYS` und `LINK_FIELDS` sind Maps mit vollen Literalen.
  - Die Platzhalter in `ClusterForm.tsx` sind Beispiel-URLs, kein Sprachtext. Der Katalogtest ist grün.
  - Main wirft nur `AppError`-Codes.
- **Tokens:**
  - `.kube-confirm-argo` nutzt nur `var(--…)`, `3px` ist Geometrie (V12). Kontraste wurden in der Validierung gemessen.
  - Keine Bewegung. `design-tokens.test.ts` ist grün.
- **Doku-Wahrheit:**
  - `README.md:110`: „Argo CD and Harbor links open in your browser only after your click; Shellherd itself never contacts either.“ ist **wahr**. Das einzige neue Lesen geht an den Kubernetes-API-Server (konfigurierter Host), nicht an Argo CD oder Harbor.
  - Handbuch und Manual entsprechen K7 wörtlich: Harbor-Satz mit „sofern der Cluster dessen Digest meldet“, Grenzen ohne „Harbor 2.1“, Einfügestellen.
  - Die UI-Begriffe stimmen mit den Locales überein: „Weboberflächen (optional)“, `In Argo CD öffnen`, „Image liegt nicht in …“.
  - CHANGELOG de/en 0.30.0 mit je drei Punkten, `package.json` und `package-lock.json` auf 0.30.0, `version.test.ts` grün.
  - SKILL.md: Abschnitt „Links nach außen ersetzt“, Szenenbeschreibung, Shots. Der Neustart-Satz für `drive:sshd` steht schon da und ist nicht doppelt.

---

## 4. Befunde

### Critical

Keine.

### Important

Keine.

### Minor

**M-1 – Offene Cluster-Tabs übernehmen geänderte Argo- und Harbor-Adressen erst beim nächsten Zustandswechsel.**
- **Datei:** `src/main/kubernetes/session.ts:489-491` (`emitStatus` privat, nur bei Zustand und Metrics) und `:509-510`; `src/main/index.ts:369` (`onVaultChange` ohne Kubernetes). Eigentümer: `session.ts`, `session.test.ts`, `src/main/index.ts`.
- **Ursache:** Der Renderer baut die Menüs aus `status.argoUrl`/`harborUrl` (`kube-menus.ts:209-226`). Ein Speichern des Vaults sendet keinen neuen Status.
- **Fehlerszenario:**
  - Ein Cluster-Tab ist offen. Der Nutzer trägt `https://argocd.example.com` ein und speichert.
  - Rechtsklick auf ein Deployment: `In Argo CD öffnen` bleibt gesperrt mit „Keine Argo-CD-Adresse im Cluster-Eintrag.“, bis zu einem Reconnect oder dem Neuöffnen.
  - Umgekehrt zeigt der Hinweis nach einer Host-Änderung den alten Host, geöffnet wird der neue.
- **Fix:**

  ```ts
  // session.ts, class Session: emitStatus public machen (private entfernen).
  // session.ts, class KubeSessions:
  /** The vault changed: every open view gets its status again (names, production, read-only, Argo CD and Harbor addresses). */
  refreshStatus(): void {
    for (const session of this.sessions.values()) session.emitStatus();
  }
  ```

  - In `src/main/index.ts:369` wird daraus `onVaultChange: () => { broadcastCatalog(); ai.broadcast(); rdpSessionManager.prewarm(); kubeSessions?.refreshStatus(); },`.
  - Test in `session.test.ts`: Session öffnen, `world.cluster.argoUrl` setzen, `world.sessions.refreshStatus()`, dann `statusesOf(world, viewId).at(-1)` mit `toMatchObject({ argoUrl })`.

**M-2 – Der Shot `cluster-links-form.png` zeigt die neuen Felder nicht.**
- **Datei:** `.claude/skills/run-app/screens.mjs:513-515`. Eigentümer: `screens.mjs`.
- **Ursache:** Das Formular ist lang, und die Fußleiste (`Abbrechen`, `Verbindung speichern`, `Speichern und verbinden`) liegt über dem Fieldset „Weboberflächen (optional)“. Im Shot sind nur Legende und Hinweis angeschnitten zu sehen, die Argo-Eingabe ist verdeckt und von der Harbor-Eingabe ist nur die Unterkante sichtbar. Die Prüfungen der Szene sind davon nicht betroffen.
- **Fix:** Vor `await pause(300); await shot('cluster-links-form');` einfügen:

  ```js
      await evaluate(`(document.querySelector('input[id$="-harborUrl"]').closest('fieldset').scrollIntoView({ block: 'center' }), true)`);
  ```

---

## 5. Spec-Abdeckung

| Punkt | Stand | Beleg |
|---|---|---|
| Spec 3.1 `kube-links.ts` mit K1 | erfüllt | `kube-links.ts:11`, `:57-64` wörtlich; Pflicht-Test A1 |
| Spec 3.2 Vertrag, Schema, IPC, Preload | erfüllt | `kubernetes.ts:257-264`, `kubernetes-schema.ts:54-59`, `ipc.ts:152-153`, `:261-264`, `preload/index.ts:111-112`; A2 |
| Spec 3.3 Vault mit K2 | erfüllt | `vault/schema.ts:147-163`, `types.ts:153-156`; Test V |
| Spec 3.4 `readArgoApp`, Fakes | erfüllt | `api.ts:59-60`, `client-api.ts:601-605`; vier Fakes und K4a |
| Spec 3.5 `rows.ts` | erfüllt | `rows.ts:199-200`, `:223-230`; Test R |
| Spec 3.6 Main (`argo.ts`, Session, IPC, Fehlercodes) | erfüllt, stärker | `argo.ts`; `session.ts:667-703`; `openableHref` mit Host-Gleichheit statt nur https (Abweichung zugunsten der Sicherheit, mit Test); Tests H1, H2 |
| Spec 3.7 Formular, K4b | erfüllt | `ClusterForm.tsx:126-137`, `connection-form.ts:213-223`; Test C |
| Spec 3.8 Menüs und Texte, K3, K4c, K4d, K6 | erfüllt | `kube-menus.ts:194-235`, `:460`, `:477-478`, `:488-489`; `kube-menu-run.ts:43`; `confirm-action.ts:50-74`; Tests M1, M2 |
| Spec 3.9 Dialog und Ansicht | erfüllt | `ConfirmAction.tsx:50-61`, `:82`, `:90`; `ClusterView.tsx:164-169`, `:181-186`, `:271`, `:428`; CSS `kubernetes-ui.css:139-140` |
| Spec 3.10 Fakes und Treiber | erfüllt | `kube-fake.mjs:37`, `kube-fixtures.mjs`, `driver.mjs:66-73`; Test G |
| Spec 3.11 und 5 Doku, Version, K7 | erfüllt | 3 |
| Spec 6 Szene, K8 | erfüllt mit Abweichung | CronJob statt Deployment (Ledger, 2.2), `textContent` statt `innerText` (2.3); Shot M-2 |
| Nutzer-Ruling R-0 | erfüllt | 1.1 |
| V1–V14 | eingehalten | V9 durch `openableHref`-Test sogar geschlossen |
| Spec 11 Manuelle Tests | offen für den Nutzer | 6 |

## 6. Manuelle Tests für den Nutzer (echtes Argo CD und Harbor, nur lesend)

Nur mit einem Konto, das lesen darf. In Shellherd **nie** `Bestätigen`, `Skalieren`, `Anhalten` usw. abschließen, immer `Abbrechen`. Im Browser in Argo CD **nie** `Sync`, `Refresh`, `Rollback` oder `Delete` anklicken und in Harbor keinen Scan starten, nur Seiten ansehen.

1. **Adressen eintragen:**
   - Cluster bearbeiten → „Weboberflächen (optional)“. `http://…` wird am Feld abgelehnt, `https://argocd.<firma>/` wird ohne Schrägstrich am Ende gespeichert.
   - Tab neu öffnen (wegen M-1).
2. **Argo CD, Tracking-Annotation (Argo CD 3):** Rechtsklick auf ein verwaltetes Deployment. Oben steht „Argo CD: App …“, `In Argo CD öffnen` zeigt den Host und öffnet im Browser die App-Seite. Die Adresse muss der Vault-Host sein, gefolgt von `/applications/<app>`.
3. **Apps in beliebigen Namespaces (falls genutzt):** Eine App `team-a/shop` öffnet `…/applications/team-a/shop`. Prüfen, ob Argo CD die Seite auflöst (Spec R2.4).
4. **Nicht verwaltetes Objekt:** Ein Deployment ohne Annotation und Label hat keine Überschrift und keinen Argo-Eintrag. Nur mit `app.kubernetes.io/instance` (Argo CD 2.x Standard, Helm) ebenfalls nicht (Grenze laut Handbuch).
5. **Self-Heal-Hinweis, nur ansehen:**
   - Auf einem Argo-verwalteten Deployment `Skalieren…` öffnen. Die Zeile sagt je nach App „mit Self-Heal …“, „Self-Heal ist aus …“ oder „ohne automatischen Sync …“, mit „Stand in Argo CD: Synced, Healthy.“.
   - Zeile und Replicas-Feld dürfen sich nicht überlagern. **Abbrechen.**
   - `Neu starten…` zeigt die neutrale Zeile. **Abbrechen.**
6. **Fail-open:**
   - Mit einem Konto ohne `get applications.argoproj.io`, oder wenn Argo CD in einem anderen Cluster läuft, steht „möglicherweise zurück (Self-Heal)“.
   - Der Dialog öffnet sofort, `Abbrechen` geht ohne Warten.
   - Den Dialog direkt nach dem Öffnen schließen: keine Fehlermeldung.
7. **Harbor:**
   - Pod mit Image auf dem Harbor-Host → `In Harbor öffnen` → Artefaktseite mit `sha256:…` (Scan-Ergebnis, falls vorhanden).
   - Deployment → Repository-Seite.
   - Verschachteltes Repository (`projekt/team/api`) → Repository-Seite mit `team%2Fapi`.
   - Ein Projekt mit rein numerischem Namen (V6): Prüfen, ob Harbor das richtige Projekt zeigt.
   - Image aus anderer Registry: Eintrag gesperrt mit „Image liegt nicht in <host>.“.
8. **Container-Menü:** Rechtsklick auf einen Container eines Pods → `In Harbor öffnen` am Ende der ersten Gruppe, mit Digest.
9. **Nur lesen auf dem Server (falls Audit-Log verfügbar):** Für den Testzeitraum stehen nur `get` auf `applications.argoproj.io` (ein Eintrag je Dialog) und die üblichen `get`/`list`/`watch` der Ansicht. Kein `patch`/`update` auf Applications. In Argo CD bleibt „Last Sync“ unverändert, in Harbor ist kein neuer Scan gelaufen.
10. **Alter Vault:** Einen Vault ohne die Felder entsperren: Er öffnet sich, die Felder sind leer, die Menüs bieten `In Argo CD öffnen` gesperrt mit Grund an und `In Harbor öffnen` gar nicht.
11. **M-1 (heute):** Bei offenem Tab die Argo-Adresse ändern und speichern. Der Menühinweis zeigt den alten Host, der Klick öffnet den neuen. Nach dem Fix zeigt der Hinweis sofort den neuen Host.

## 7. Nicht geprüft

- `ClusterForm`, `ConfirmAction` und `ClusterView` nur gelesen, kompiliert und in den vier vorhandenen Shots gesehen. Kein eigener Szenenlauf, Treiber nicht bedient.
- Ob echte Harbor-Versionen die Route mit dem Projektnamen und `%2F` annehmen (Spec-Risiko 9.1) und ob Argo CD `/applications/<name>` überall auflöst (R2.4): siehe manuelle Tests 3 und 7.
- Verhalten bei sehr langsamen API-Servern über 5 s nur per Test mit Fake-Uhr.
