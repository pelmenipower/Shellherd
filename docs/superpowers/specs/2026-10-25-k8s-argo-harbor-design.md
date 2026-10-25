# Kubernetes: Argo-CD-Bezug und Harbor-Links – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/k8s-argo-harbor-research.md`). Bindend geht `2026-10-25-k8s-argo-harbor-validation.md` vor.

Branch `claude/feature/k8s-argo-harbor`, gestapelt auf 0.29.0, Ziel **0.30.0**. Nutzer-Ruling: nur lesend, kein Sync, kein Rollback, kein Scan-Start. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/k8s-argo-harbor`, Basis 0.29.0 (Port-Forward, Logs aller Pods, RBAC-Vorabprüfung, KI-Diagnose), Ziel **0.30.0**, CHANGELOG-Datum wörtlich `2026-10-25`.

Ziel des Pakets: Der Cluster-Tab erkennt Objekte, die Argo CD verwaltet, öffnet sie per Klick in Argo CD und öffnet Images in Harbor. Vor einer ändernden Aktion an einem Argo-verwalteten Objekt sagt der Bestätigungsdialog, ob Argo CD die Änderung zurücksetzt (Self-Heal).

**Bindendes Nutzer-Ruling R-0: Nur lesende Analyse, nie schreibend.**
- Kein Argo-Sync, kein Refresh (auch nicht über die Annotation `argocd.argoproj.io/refresh`), kein Hard-Refresh, kein Rollback, kein Terminate.
- Kein Harbor-Scan-Start, kein Harbor-Schreibzugriff.
- Jeder neue API-Aufruf steht mit Verb und Ziel in R5. Es gibt genau einen: `get` auf eine `applications.argoproj.io`.

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Konstanten und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen. Wo „ergänzen“ steht, bleibt der übrige Code unverändert.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Argo CD heute
- **Spec:** `docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md:100`: Label `argocd.argoproj.io/instance` → Überschrift „Argo CD: App …“ und Kopieren „Argo-App-Name“. „Argo-URL und Self-Heal-Warnung im Dialog sind Stufe 2.“ Argo-Sync und Harbor-Links standen dort ausdrücklich außerhalb (`:30`, `:284`).
- **Code:**
  - `ARGO_LABEL` steht in `src/renderer/src/kube-menus.ts:57`.
  - `argoCopy` (`:240`) hängt „Argo-App-Name“ an jede Kopieren-Gruppe (`:234`, `:262`, `:286`, `:305`, `:338`, `:354`, `:372`).
  - `rowMenu` setzt die Überschrift aus dem **rohen Label** (`:415-417`), ohne Prüfung des Werts.
  - Tests: `kube-menus.test.ts:233-247` („Argo (C28)“).
- **Was fehlt:**
  - Die Annotation `argocd.argoproj.io/tracking-id` (Standard-Tracking ab Argo CD 3) wird nicht gelesen.
  - `KubeRow` trägt keine Annotationen (`src/shared/kubernetes.ts:41-70`). `toRow` übernimmt nur Labels (`src/main/kubernetes/rows.ts:197`), obwohl list/watch die Annotationen schon liefern.
  - Es gibt keinen Link, keine Argo-Adresse und keinen Self-Heal-Hinweis.

### 0.2 Bestätigungsdialoge heute
- `confirmationFor` (`src/renderer/src/confirm-action.ts:22-48`) liefert Titel, Text, Namenseingabe bei Produktion und Knopf-Label für `restart`, `scale`, `delete`, `cordon`, `uncordon`, `suspend`, `resume` und `trigger`.
- `ConfirmAction` (`components/kubernetes/ConfirmAction.tsx:26-94`) rendert Titel, Text, Replicas-Feld und Namenseingabe. `PendingAction` (`:9-16`) kennt nur `ref`, `action` und Replicas.
- **Einstieg:** `ClusterView.confirm` (`ClusterView.tsx:161-170`) ist der einzige Weg zu `setPending`. Hotkeys (`startAction`, `:178-185`), Menü (`runnerFor.confirm`, `:254`) und `:`-Befehle gehen alle hindurch. Gerendert wird bei `:415-417`.
- **RBAC im Demo-Cluster:** `SHOP_RULES` (`.claude/skills/run-app/kube-fixtures.mjs:163-169`) verbietet `patch` auf Deployments. Neustart und Skalieren sind in `shop` gesperrt, Anhalten/Fortsetzen von CronJobs ist erlaubt. Die Szene nutzt deshalb den CronJob.

### 0.3 Cluster-Eintrag im Vault
- Typ `KubernetesConnectionNode` (`src/shared/vault/types.ts:139-152`), Schema (`src/shared/vault/schema.ts:146-157`).
- Das Schema ist bewusst nicht `.strict()` (`schema.ts:59`): Eine ältere Version öffnet einen erweiterten Vault. Neue optionale Felder sind damit formatverträglich, eine Migration ist nicht nötig.
- **Formular:**
  - `ClusterForm.tsx:55-128`: Zugang, kubeconfig, Context, Namespace, Produktion, Nur lesen.
  - Abbildung Felder ↔ Knoten: `connection-form.ts:13-58`, `:110-115` und `:197-211`.
  - Texte: `src/shared/locales/*/connection.json:187-228`.
- `ClusterStatus` (`src/shared/kubernetes.ts:119-135`) wird bei jedem Status aus dem Vault neu gebaut (`session.ts:482-499`). Damit kennt der Renderer `production` und `readOnly`.

### 0.4 Links nach außen heute
- **IPC `app:open-external`** (`src/main/index.ts:344-350`):
  - Er prüft mit `webLinkHref` (`src/shared/links.ts:3-10`): nur `http:`/`https:`, kein Benutzer, höchstens 2048 Zeichen.
  - Dann ruft er `shell.openExternal`.
  - Er erlaubt `http:` und jeden Host. Für dieses Paket ist er zu weit (R6).
- **Navigation im Fenster** ist gesperrt (`index.ts:128-129`).
- **Nutzer:** Terminal-Links mit Strg (`terminal-links.ts:14-17`), Update-Hinweis und „Im Browser öffnen“ der Port-Weiterleitung (`ClusterView.tsx:267-269`, `kube-forward.ts:24-25`).

### 0.5 Images heute
- **Pod-Zeilen:** `cells['image:<container>']` aus `spec.containers` (`rows.ts:215-219`). `status.containerStatuses[].imageID` (Digest des laufenden Images) liest niemand.
- **Workloads:** `cells.image` kommagetrennt aus dem Pod-Template (`rows.ts:34`, `:171`).
- **Menüs:** `imageLines` (`kube-menus.ts:193-198`) und „Image“ kopieren (`:228`, `:256`, `:446`).

### 0.6 API-Schicht
- `KubeApi` (`src/main/kubernetes/api.ts:33-59`) kennt keine Custom Resources.
- `createKubeApi` (`client-api.ts:453-598`) nutzt `KubernetesObjectApi` für die festen Kinds. `rulesReview` zeigt das Muster für einen eigenen API-Client (`config.makeApiClient(AuthorizationV1Api)`, `:584-597`), den der Test mit `vi.spyOn(KubeConfig.prototype, 'makeApiClient')` ersetzt (`client-api.test.ts:612-646`).
- Verwendet wird `@kubernetes/client-node` 2.0.0, Objekt-Parameter-API: `CustomObjectsApi.getNamespacedCustomObject({ group, version, namespace, plural, name })`.
- **Zeitlimit-Muster:** `KubeSessions.access` (`session.ts:627-642`) mit `options.schedule`/`cancel`, `ACCESS_TIMEOUT_MS` (`:41`).

### 0.7 run-app heute
- **Treiber** (`driver.mjs:54-65`): Er ersetzt `dialog.showSaveDialog`, `showOpenDialog` und `showMessageBox` im Main-Prozess per `app.evaluate(({ dialog }) => { dialog.x = async … })`. **`shell.openExternal` ersetzt er nicht.** Ein Klick auf „Im Browser öffnen“ einer Weiterleitung würde heute einen echten Browser öffnen. Die Szene `kube-forward` klickt ihn nur deshalb nicht.
- **Route `main`** (`driver.mjs:78`): Sie führt Main-JavaScript aus. Darüber liest eine Szene Werte aus dem Main-Prozess, ohne dass eine neue Route nötig ist.
- **Kube-Fake:**
  - `RESOURCES` (`kube-fake.mjs:32-37`) kennt keine `argoproj.io`-Gruppe.
  - Nicht-GET bekommt 403 (`:155-159`).
  - Jede Anfrage landet in `kube-requests.log` (`:146-148`).
- **Fixtures:**
  - Images liegen auf `registry.local` (`kube-fixtures.mjs:80-133`), ohne `imageID`.
  - Es gibt keine Argo-Labels, keine Annotationen und keine Application.
- **Demo-Vault:** `prod-k8s` wird über das Formular angelegt (`demo-setup.mjs:94-107`).

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Argo-Erkennung in Main: Annotation `argocd.argoproj.io/tracking-id` (Name muss passen), sonst Label `argocd.argoproj.io/instance`; geprüfter App-Name als `KubeRow.argoApp` | ★★★ | kleine Main-Änderung (`rows.ts`) |
| 1b | Menüeintrag `In Argo CD öffnen` an jeder Zeile mit `argoApp`; ohne Argo-Adresse gesperrt mit Grund | ★★★ | nur Renderer + neuer IPC |
| 2a | Self-Heal-Hinweis im Bestätigungsdialog für Skalieren, Anhalten, Fortsetzen und Job löschen; neutraler Hinweis bei Neustart | ★★★ | Renderer + kleine Main-Änderung |
| 2b | Dafür `get` auf die `Application` (fail-open: „möglicherweise“), Sync und Health in derselben Zeile | ★★ | kleine Main-Änderung (`argo.ts`, `readArgoApp`) |
| 3a | `In Harbor öffnen` an Pods, Containern, Deployments, StatefulSets und DaemonSets; nur wenn der Image-Host die Harbor-Adresse ist | ★★★ | nur Renderer + neuer IPC |
| 3b | Pods verlinken das **laufende Artefakt** (Digest aus `imageID`), Workloads die Repository-Seite | ★★ | kleine Main-Änderung (`rows.ts`) |
| 4a | Zwei optionale Felder im Cluster-Eintrag: `Argo-CD-Adresse`, `Harbor-Adresse` (nur https) | ★★★ | Vault-Schema + Formular |
| 4b | Eigener IPC `k8s:open-link`: Main baut die Adresse **nur aus dem Vault**, prüft https und öffnet erst dann | ★★★ | kleine Main-Änderung |
| 5a | run-app: Application mit Self-Heal, Harbor-Image mit Digest, gefälschte Tracking-Annotation, Treiber fängt `openExternal` ab, Szene `kube-links` | ★★★ | run-app |
| X | Sync/Health-Spalte oder Badge in der Tabelle, Harbor-API (Scans), Zugangsdaten, Argo-Namespace-Feld, eigener Label-Schlüssel | ★ | nicht jetzt (Abschnitt 8) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### R1 – Argo-Erkennung
1. **Erkennung in Main** (`argoAppOf` in `src/shared/kube-links.ts`, aufgerufen in `rows.ts`). Main setzt das Ergebnis als `KubeRow.argoApp`. Der Renderer liest **nur** `row.argoApp`, nie mehr das rohe Label.
   - Begründung: Die Annotation steht nicht in `KubeRow`. Annotationen an den Renderer zu schicken, nur um daraus einen Namen zu lesen, wäre mehr Datenfluss als nötig: `last-applied-configuration` enthält Env-Werte.
2. **Reihenfolge:**
   - (a) Annotation `argocd.argoproj.io/tracking-id` im Format `<app>:<group>/<kind>:<namespace>/<name>`. Sie zählt nur, wenn `<name>` dem Objektnamen entspricht. So verhält sich Argo CD selbst: Eine kopierte Annotation macht ein Objekt nicht zu einem verwalteten.
   - (b) Sonst das Label `argocd.argoproj.io/instance`.
3. **Der Wert muss ein gültiger App-Name sein:** `name` oder `namespace_name` (Apps in beliebigen Namespaces), Kleinbuchstaben, Ziffern, `-` und `.`, höchstens 253 Zeichen. Alles andere (`/`, `:`, Leerzeichen, URL-Teile) ergibt **kein** `argoApp`, also keine Überschrift, kein Kopieren und keinen Link.
   - Verhaltensänderung gegenüber 0.29: Ein Label mit ungültigem Wert zeigt keine Überschrift mehr. Gewollt, das Label ist ungeprüfte Eingabe.
4. **Nicht ausgewertet wird `app.kubernetes.io/instance`**, obwohl es in Argo CD 2.x der Standardschlüssel ist. Helm setzt dasselbe Label auf jede Release, das ergäbe falsche Argo-Hinweise an Nicht-Argo-Objekten. Ein einstellbarer Schlüssel ist ein Extra (Abschnitt 8).
5. **Überschrift und Kopieren bleiben** wie in C28 (`Argo CD: App <name>`, `Argo-App-Name`), jetzt aus `row.argoApp`.

### R2 – „In Argo CD öffnen“
1. **Wo:** Jede Tabellenzeile mit `argoApp`, ans Ende der ersten Gruppe nach „Nur … anzeigen“, Id `argo-open`. Event-, Container-, Node-Kachel- und Problem-Menüs bekommen ihn nicht.
2. **Hint:** der Host der Argo-Adresse, z. B. `argocd.example.test`. Der Nutzer sieht vor dem Klick, wohin der Link geht.
3. **Gesperrt** mit „Keine Argo-CD-Adresse im Cluster-Eintrag.“, wenn keine Adresse hinterlegt ist. Der Eintrag bleibt sichtbar, weil die Überschrift schon „Argo CD“ sagt und der Grund lehrt, wo die Einstellung liegt.
   - Nicht gesperrt bei „Nur lesen“, bei Neuverbinden oder ohne Verbindung: Der Link braucht den Cluster nicht.
4. **Pfad:**
   - `<adresse>/applications/<app>` für einfache Namen;
   - `<adresse>/applications/<namespace>/<name>` für `namespace_name`.
   
   Die Kurzform `/applications/<name>` gilt in Argo CD 2.x und 3.x und löst den Namespace der Steuerebene selbst auf. Shellherd muss ihn also nicht kennen. Ein Pfad-Präfix in der Adresse (`https://ops.example.com/argo-cd`) bleibt erhalten.
5. **Kein Link aus dem Cluster:**
   - Die Annotationen `link.argocd.argoproj.io/*` werden nicht geöffnet.
   - `status.summary.externalURLs` der Application wird nicht geöffnet.
   - Ingress-Hosts werden nicht geöffnet.
   
   Deren Host bestimmt der Cluster (R6).

### R3 – Self-Heal-Hinweis im Bestätigungsdialog
1. **Welche Aktionen** (`argoNoteFor(action, kind)`):
   - `revert` für `scale`, `suspend`, `resume` und `delete`. Das ändert, was Git beschreibt (Replicas, `spec.suspend`, ein Job aus Git). Bei Self-Heal setzt Argo CD es zurück bzw. legt den Job neu an.
   - `restart` (neutral): `rollout restart` setzt nur die Annotation `kubectl.kubernetes.io/restartedAt` am Pod-Template. Sie steht nicht in Git und nicht in `last-applied-configuration`, Argo CDs Vergleich ignoriert sie. Der Dialog sagt „in der Regel nicht zurück“. Eine Warnung wäre falsch und würde lehren, Warnungen zu übergehen.
   - Kein Hinweis bei `trigger` (der neue Job trägt keine Tracking-Daten), bei Pods (Argo CD verwaltet Pods nicht, auch wenn ein Chart das Label weitergibt) und bei Nodes.
2. **Woher der Dialog `argoApp` kennt:**
   - `ClusterView.confirm` sucht die Zeile mit `refKey` in `state.rows` und legt `argoApp` in `PendingAction`.
   - Das erfasst Hotkey, Menü und `:`-Befehl an einer Stelle.
   - Problem-Einträge betreffen nur Pods, für sie gibt es ohnehin keinen Hinweis.
3. **Shellherd darf die `Application` lesen**, und zwar genau einmal je geöffnetem Dialog: `get` auf `applications.argoproj.io` (R5). Ziel:
   - Namespace = der Teil vor `_` bei `namespace_name`, sonst `argocd`;
   - Name = der Teil danach bzw. der ganze Name.
   - Begründung: Self-Heal an/aus ändert die Aussage grundlegend („sofort zurück“ statt „beim nächsten Sync“). Der Aufruf ist rein lesend und kostet eine Anfrage nur dann, wenn der Nutzer ohnehin gerade ändern will.
4. **Fail-open:** Jeder Fehler ergibt `null`, und der Dialog zeigt „… setzt Abweichungen von Git möglicherweise zurück (Self-Heal)“. Gemeint sind:
   - 403, wenn das Konto Applications nicht lesen darf (häufig, denn sie liegen in `argocd`);
   - 404, wenn das CRD fehlt (Argo CD läuft in einem anderen Cluster, sehr häufig) oder die App woanders liegt (OpenShift GitOps: `openshift-gitops`);
   - Zeitüberschreitung nach 5 s, oder der Cluster ist nicht verbunden.
   
   Während des Lesens steht derselbe Text, dann wird er ersetzt. Es gibt keinen Spinner.
5. **Texte je Zustand** (wörtlich in 3.8):
   - `selfHeal`;
   - `autoSync` (automatisch, ohne Self-Heal);
   - `manual` (kein automatischer Sync);
   - `maybe` (unbekannt);
   - `restart`.
   
   Dazu kommt bei bekanntem Zustand „Stand in Argo CD: Synced, Healthy.“ Revert-Zustände nutzen die Warnfarbe, `restart` ist gedämpft. Die Formulierung hängt nie an Replicas, denn ob der Wert in Git steht (HPA, `ignoreDifferences`), weiß Shellherd nicht. Sie sagt deshalb „weicht es danach von Git ab, …“.
6. **Der Hinweis blockiert nichts:**
   - Der Bestätigen-Knopf wartet nicht auf das Lesen.
   - Namenseingabe bei Produktion und Skalieren auf 0 bleiben wie sie sind.
   - Es gibt keinen zusätzlichen Dialog.

### R4 – Sync/Health als Badge?
**Nein, nicht in der Tabelle.** Eine Spalte oder ein Badge bräuchte ein `list`/`watch` auf `applications.argoproj.io` in `argocd` oder clusterweit.
- Das verbieten Namespace-Rollen fast immer.
- In Mehr-Cluster-Setups gibt es die Applications im Ziel-Cluster gar nicht.
- Der Nutzen beim Lesen der Tabelle ist gering: Der Argo-Link zeigt den Stand vollständig.

Sync und Health erscheinen **nur** in der Dialogzeile, die ohnehin gelesen wird (R3). Die Werte sind auf Argo-Begriffe beschränkt:
- Sync: `Synced`, `OutOfSync`, `Unknown`;
- Health: `Healthy`, `Progressing`, `Degraded`, `Suspended`, `Missing`, `Unknown`.

Andere Werte fallen weg. Sie bleiben englisch wie Pod-Status.

### R5 – API-Aufrufe (vollständig)

| Wann | Methode | HTTP | Verb / Ziel |
|---|---|---|---|
| Bestätigungsdialog öffnet für ein Objekt mit `argoApp`, Aktion `restart`/`scale`/`suspend`/`resume`/`delete`, Kind nicht Pod/Node | `api.readArgoApp(namespace, name)` | `GET /apis/argoproj.io/v1alpha1/namespaces/{namespace}/applications/{name}` | `get` auf `applications.argoproj.io` |

Sonst nichts:
- Kein Discovery-Aufruf (`CustomObjectsApi` ruft den Pfad direkt).
- Kein `list`, kein `watch`, kein `patch`, kein `create`, kein `delete` auf Applications.
- Keine Anfrage an den Argo-CD-API-Server.
- Keine Anfrage an Harbor.

Argo-Labels, Annotationen und `imageID` kommen aus den bestehenden list/watch-Antworten. Dafür gibt es keine zusätzliche Anfrage.

**Browser** (keine Shellherd-Anfrage, erst nach Klick des Nutzers, über `shell.openExternal`):
- `https://<argo-adresse>/applications/[<namespace>/]<app>`;
- `https://<harbor-adresse>/harbor/projects/<projekt>/repositories/<repo>/artifacts-tab[/artifacts/<sha256:…>]`.

Damit bleibt die README-Zusage „Shellherd makes no requests of its own besides these two“ wahr (`README.md:110`).

**RBAC:** keine neue Vorabprüfung, kein Eintrag in `ACCESS_CHECKS`. Ein verbotenes `get` führt zu „möglicherweise“ (R3.4).

### R6 – Sicherheit
1. **Der Host kommt nur aus dem Vault.**
   - Die Adressen werden in `httpsBase` normalisiert: nur `https:`, kein Benutzer, kein Passwort, keine Query, kein Fragment, höchstens 512 Zeichen, ohne `/` am Ende.
   - Sie werden normalisiert gespeichert, das Vault-Schema verlangt genau diese Form.
   - Labels, Annotationen und Image-Namen füllen **nur den Pfad**, und nur nach Prüfung gegen strenge Muster: App-Name, OCI-Pfadkomponente, Tag und `sha256:`-Digest.
   - `onBase` lehnt jedes Ergebnis ab, dessen Origin nicht der Origin der Adresse ist.
2. **Harbor nur bei passendem Host:** Der Registry-Host des Images (mit Port, `:443` entfernt, klein geschrieben) muss gleich `new URL(harborAdresse).host` sein. Docker-Hub-Kurzformen (`nginx`, `library/nginx`) haben keinen Host und verlinken nie.
3. **Main baut den Link selbst.** Der Renderer schickt nur `{ type: 'argo', app }` bzw. `{ type: 'harbor', image, digest? }` über den neuen IPC `k8s:open-link`. Main:
   - prüft das Schema;
   - liest den Cluster-Eintrag frisch aus dem Vault (gesperrter Vault oder deaktivierter Cluster → Fehler);
   - baut den Link mit denselben reinen Funktionen;
   - prüft ihn erneut mit `webLinkHref` und `https://`;
   - erst dann ruft er `shell.openExternal`.
   
   Der allgemeine Kanal `app:open-external` (erlaubt `http:` und jeden Host) wird für diese Links **nicht** benutzt.
4. **Keine Zugangsdaten** für Argo CD oder Harbor. Der Browser meldet sich wie gewohnt an (SSO).
5. **Keine `file:`, `javascript:` oder `data:`-Adressen:** `httpsBase` lässt nur `https:` zu, Test in 10.1.

### R7 – Harbor
1. **Konfiguriert:** eine optionale `Harbor-Adresse` je Cluster.
   - Keine Erkennung über den Image-Host allein, denn ohne Adresse weiß Shellherd nicht, ob ein Host Harbor ist.
   - Kein zweites Feld „Registry-Host“: Harbor bedient UI und Registry (`/v2/`) unter demselben Host.
2. **Pfad:**
   - `<adresse>/harbor/projects/<projekt>/repositories/<repo kodiert>/artifacts-tab`;
   - mit Digest zusätzlich `/artifacts/<sha256:…>`.
   - `<projekt>` = erste Pfadkomponente nach dem Host, `<repo>` = der Rest, mit `encodeURIComponent` (`team/api` → `team%2Fapi`).
3. **Tag oder Digest:**
   - Digest im Image (`…@sha256:…`) → Artefakt-Seite.
   - Pod mit `imageID` desselben Repositorys → Artefakt-Seite des **laufenden** Images. Das ist die Seite mit den Scan-Ergebnissen, also der eigentliche Nutzen.
   - Nur ein Tag → Repository-Seite, dort steht der Tag in der Liste.
   - Begründung: Harbors UI-Route ist `artifacts/:digest`. Ein Tag an dieser Stelle ist nicht als Route gesichert.
4. **Projektname statt Projekt-ID:**
   - Harbors UI nutzt in eigenen Links die numerische ID. Der Projekt-Resolver ruft aber `GET /api/v2.0/projects/{name_or_id}`, das Namen annimmt.
   - Die ID ohne API-Aufruf zu kennen ist unmöglich. Shellherd nutzt den Namen.
   - **Das ist das größte Restrisiko des Pakets** (Abschnitt 9.1, manueller Test 6). Die Pfadbildung steckt in genau einer Funktion (`harborImageUrl`), eine Korrektur ändert nur sie.
5. **Wo der Eintrag erscheint** (Id `harbor-open`, Hint = Harbor-Host):
   - Pod-Zeile: erster Container, dessen Image in Harbor liegt, mit Digest.
   - Container-Zeile (Menü B): dieser Container.
   - Deployment/StatefulSet/DaemonSet: erstes passendes Image aus `cells.image`, ohne Digest.
   - Jobs, CronJobs, Services, Ingress, Events und Nodes: nicht. Ihre Zeilen haben keine Image-Zelle.
   
   Der Eintrag erscheint **nur mit Harbor-Adresse**. Wer kein Harbor nutzt, sieht keinen zusätzlichen Eintrag; das Formular lehrt die Einstellung. Liegt kein Image dort: gesperrt mit „Image liegt nicht in harbor.example.test.“
6. **Kein Harbor-API-Zugriff in Stufe 1, auch nicht lesend für Scans.** Begründung:
   - Private Projekte brauchen Zugangsdaten. Das wäre ein neuer Geheimnistyp im Vault mit eigenem Formular, eigener Maskierung und eigener Rotation.
   - Interne Harbors haben oft eine eigene CA, also käme eine CA-Konfiguration im Main-Prozess dazu.
   - Die README-Zusage „keine eigenen Anfragen“ würde gebrochen.
   - Der Browser zeigt dieselben Scan-Ergebnisse einen Klick weiter, mit der Anmeldung des Nutzers.
   
   Ein Lese-Robot-Account ist ein Extra (Abschnitt 8).

### R8 – Cluster-Eintrag und UI
1. **Formular:** Neues Fieldset „Weboberflächen (optional)“ in `ClusterForm` nach `Namespace`, vor `Produktion`.
   - Felder: `Argo-CD-Adresse`, `Harbor-Adresse`, mit Hinweiszeile.
   - Leer bedeutet nicht gesetzt.
   - Ungültige Eingaben ergeben einen Feldfehler am jeweiligen Feld.
   - Gespeichert wird die normalisierte Form, also `https://argocd.example.test/` → `https://argocd.example.test`.
2. **Status:** `ClusterStatus.argoUrl?`/`harborUrl?` kommen aus Main (`session.status()`). Daraus entscheiden die Menüs über Verfügbarkeit und Hint. Main baut den Link trotzdem selbst.
   - Eine Änderung im Formular erreicht offene Cluster-Tabs mit dem nächsten Status: Reiterwechsel, Neuverbinden oder Neuöffnen.
   - Akzeptiert (Abschnitt 9.5). Main nutzt beim Öffnen immer den aktuellen Vault.
3. **Dialogzeile:** `<p className="kube-confirm-argo">` unter dem Text, mit `aria-live="polite"`, damit der Wechsel von „möglicherweise“ zum gelesenen Stand vorgelesen wird. Die Zeile ist Teil von `aria-describedby`.
4. **Design:**
   - Keine neuen Tokens, keine Bewegung, kein Eintrag im Motion-Gate.
   - Linker Rand nach dem Muster `.assistant-command.is-mutating` (`assistant-ui.css:20`, `:24`): `--color-border` bzw. bei Warnung `--color-warn-border`, dazu Text `--color-text-muted` bzw. `--color-warn`.
   - Warnung ist ein Zustand, kein Akzent (Design-System Punkt 3).
5. **Rückmeldung nach dem Klick:** keine Statusmeldung bei Erfolg (der Browser kommt). Fehler gehen über `say(errorText(…))`, wie bei `openForward`.

### R9 – Texte
- `kubeActions.json`: `menu.openArgo`, `menu.openHarbor`, `reasons.noArgoUrl`, `reasons.notInHarbor`, `reasons.linkInvalid`, Block `confirm.argo.*`.
- `connection.json`: Block `cluster.links.*`, `cluster.validation.linkUrl`.
- `errors/kubernetes.json`: `noArgoUrl`, `noHarborUrl`, `linkRefused`.
- Immer in de-DE und en-US. Maps aus vollen Literalen (`ARGO_REVERT_KEYS`, `LINK_FIELDS`).
- Platzhalter-URLs (`https://argocd.example.com`) sind keine deutschen Literale.

---

## 3. Vertrag (wörtlich)

### 3.1 Neues Modul `src/shared/kube-links.ts` (Task A)

```ts
/** Links from the cluster tab to Argo CD and Harbor. Pure; used by main, renderer and the vault schema. The host always comes from the vault entry. */
import { MAX_LINK_LENGTH } from './links';

/** Longest Argo CD or Harbor address in the vault. */
export const MAX_BASE_URL = 512;
export const ARGO_INSTANCE_LABEL = 'argocd.argoproj.io/instance';
export const ARGO_TRACKING_ANNOTATION = 'argocd.argoproj.io/tracking-id';
/** Argo CD application name, optionally qualified with its namespace: `name` or `namespace_name`. */
const ARGO_APP = /^(?:([a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?)_)?([a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?)$/;
/** `<app>:<group>/<kind>:<namespace>/<name>`; group and namespace may be empty. */
const TRACKING_ID = /^([^:/]+):[^:/]*\/[^:/]+:[^:/]*\/([^:/]+)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TAG = /^\w[\w.-]{0,127}$/;
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const REGISTRY_HOST = /^(?:localhost|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d{1,5})?$/;

/** Normalized `https://host[:port][/path]` without a trailing slash, or null: https only, no user, password, query or fragment. */
export function httpsBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_BASE_URL) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Host (with a non-default port) of an address, for menu hints; '' when the address is not valid. */
export function linkHost(base: string): string {
  const root = httpsBase(base);
  return root ? new URL(root).host : '';
}

/** The link only when it stays on the origin of the address and within the link length. */
function onBase(root: string, href: string): string | null {
  try {
    return new URL(href).origin === new URL(root).origin && href.length <= MAX_LINK_LENGTH ? href : null;
  } catch { return null; }
}

/** Namespace (apps in any namespace) and name of a valid Argo CD application name, else null. */
export function argoAppParts(app: string): { namespace?: string; name: string } | null {
  if (app.length > 253) return null;
  const match = ARGO_APP.exec(app);
  if (!match) return null;
  return match[1] ? { namespace: match[1], name: match[2] } : { name: match[2] };
}

const stringAt = (map: unknown, key: string): string | undefined => {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  const value = (map as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Argo CD application that tracks an object: the tracking-id annotation (Argo CD 3 default) when it names this object,
 * else the instance label. Only valid application names count; cluster input never becomes anything else.
 */
export function argoAppOf(meta: { name?: unknown; labels?: unknown; annotations?: unknown }): string | undefined {
  const tracking = stringAt(meta.annotations, ARGO_TRACKING_ANNOTATION);
  const match = tracking ? TRACKING_ID.exec(tracking) : null;
  // Argo CD ignores a copied annotation whose object name does not match; so does Shellherd.
  if (match && match[2] === meta.name && argoAppParts(match[1])) return match[1];
  const label = stringAt(meta.labels, ARGO_INSTANCE_LABEL);
  return label && argoAppParts(label) ? label : undefined;
}

/** `<base>/applications/<name>` or `<base>/applications/<namespace>/<name>`; null for an invalid address or name. */
export function argoAppUrl(base: string, app: string): string | null {
  const root = httpsBase(base);
  const parts = argoAppParts(app);
  if (!root || !parts) return null;
  return onBase(root, `${root}/applications/${parts.namespace ? `${parts.namespace}/` : ''}${parts.name}`);
}

export interface ParsedImage { host: string; project: string; repository: string; tag?: string; digest?: string }

/** `host[:port]/project/repo[/…][:tag][@sha256:…]`; null without a registry host or with anything outside the OCI patterns. */
export function parseImage(image: string): ParsedImage | null {
  const trimmed = image.trim();
  if (trimmed.length > MAX_BASE_URL) return null;
  const at = trimmed.indexOf('@');
  const digest = at >= 0 ? trimmed.slice(at + 1) : undefined;
  if (digest !== undefined && !DIGEST.test(digest)) return null;
  const name = at >= 0 ? trimmed.slice(0, at) : trimmed;
  const slash = name.indexOf('/');
  if (slash < 0) return null;
  const host = name.slice(0, slash).toLowerCase().replace(/:443$/, '');
  if (!REGISTRY_HOST.test(host)) return null;
  const rest = name.slice(slash + 1);
  const colon = rest.lastIndexOf(':');
  const tag = colon >= 0 ? rest.slice(colon + 1) : undefined;
  if (tag !== undefined && !TAG.test(tag)) return null;
  const segments = (colon >= 0 ? rest.slice(0, colon) : rest).split('/');
  if (segments.length < 2 || !segments.every(segment => PATH_COMPONENT.test(segment))) return null;
  return { host, project: segments[0], repository: segments.slice(1).join('/'), ...(tag ? { tag } : {}), ...(digest ? { digest } : {}) };
}

/** Digest of the running image when status.imageID names the same repository as the spec image (`docker-pullable://` allowed). */
export function digestOf(image: string, imageID: string | undefined): string | undefined {
  if (!imageID) return undefined;
  const id = imageID.replace(/^docker-pullable:\/\//, '');
  const at = id.lastIndexOf('@');
  if (at <= 0) return undefined;
  const digest = id.slice(at + 1);
  const repository = image.split('@')[0].replace(/:[^:/]*$/, '');
  return DIGEST.test(digest) && id.slice(0, at) === repository ? digest : undefined;
}

/**
 * Harbor page of an image: the artifact for a digest (in the image or the running one), else the repository.
 * null when the image does not live on the Harbor host of `base`; never a link to another host.
 */
export function harborImageUrl(base: string, image: string, digest?: string): string | null {
  const root = httpsBase(base);
  const parsed = parseImage(image);
  if (!root || !parsed || parsed.host !== new URL(root).host) return null;
  const reference = parsed.digest ?? (digest && DIGEST.test(digest) ? digest : undefined);
  const repository = `${root}/harbor/projects/${parsed.project}/repositories/${encodeURIComponent(parsed.repository)}/artifacts-tab`;
  return onBase(root, reference ? `${repository}/artifacts/${reference}` : repository);
}
```

### 3.2 Shared Kubernetes, Schema, IPC, Preload (Task A)

`src/shared/kubernetes.ts`:
1. In `KubeRow` nach `ports?: KubePort[];` einfügen:

```ts
  /** Argo CD application tracking the object (tracking-id annotation or instance label), validated in main; see kube-links.ts. */
  argoApp?: string;
  /** Pods: container name → sha256 digest of the running image, when status.imageID names the same repository. */
  digests?: Record<string, string>;
```

2. In `ClusterStatus` nach `trying?: string;` einfügen:

```ts
  /** Argo CD and Harbor addresses of the vault entry (normalized https); menus only, main builds every link itself. */
  argoUrl?: string;
  harborUrl?: string;
```

3. Ans Ende der Datei anfügen:

```ts
/** "In Argo CD öffnen" / "In Harbor öffnen": what the renderer may ask for; main takes the host from the vault. */
export type KubeLink = { type: 'argo'; app: string } | { type: 'harbor'; image: string; digest?: string };
export interface KubeOpenLinkRequest { viewId: string; link: KubeLink }
export interface KubeArgoRequest { viewId: string; app: string }
export const ARGO_SYNC = ['Synced', 'OutOfSync', 'Unknown'] as const;
export const ARGO_HEALTH = ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'] as const;
/** What the confirmation says about an Argo CD application; read by `get` on applications.argoproj.io. */
export interface KubeArgoState { automated: boolean; selfHeal: boolean; sync?: (typeof ARGO_SYNC)[number]; health?: (typeof ARGO_HEALTH)[number] }
```

`src/shared/kubernetes-schema.ts`, ans Ende anfügen:

```ts
const KubeLinkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('argo'), app: z.string().min(1).max(253) }).strict(),
  z.object({ type: z.literal('harbor'), image: z.string().min(1).max(512), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional() }).strict(),
]);
export const KubeOpenLinkRequestSchema = z.object({ viewId, link: KubeLinkSchema }).strict();
export const KubeArgoRequestSchema = z.object({ viewId, app: z.string().min(1).max(253) }).strict();
```

`src/shared/ipc.ts`:
- `IPC_CHANNELS` nach `kubeDiagnose: 'k8s:diagnose',` um diese Zeilen ergänzen:

```ts
  kubeOpenLink: 'k8s:open-link',
  kubeArgoApp: 'k8s:argo-app',
```
- Den Typ-Import aus `./kubernetes` um `KubeArgoRequest, KubeArgoState, KubeOpenLinkRequest` erweitern.
- In `DesktopApi` nach `kubeDiagnose` einfügen:

```ts
  /** "In Argo CD öffnen" / "In Harbor öffnen": main builds the https address from the vault entry and opens the browser. */
  kubeOpenLink: (request: KubeOpenLinkRequest) => Promise<void>;
  /** Self-Heal state of an Argo CD application for the confirmation (get on applications.argoproj.io); null when unreadable. */
  kubeArgoApp: (request: KubeArgoRequest) => Promise<KubeArgoState | null>;
```

`src/preload/index.ts`, nach der Zeile `kubeDiagnose: …`:

```ts
  kubeOpenLink: request => ipcRenderer.invoke('k8s:open-link', request),
  kubeArgoApp: request => ipcRenderer.invoke('k8s:argo-app', request),
```

### 3.3 Vault (Task V)

`src/shared/vault/types.ts`, in `KubernetesConnectionNode` nach `readOnly: boolean;`:

```ts
  /** Argo CD web address, normalized https (kube-links.ts httpsBase); only for links, Shellherd never calls it. */
  argoUrl?: string;
  /** Harbor web address, normalized https; images on its host get "In Harbor öffnen". */
  harborUrl?: string;
```

`src/shared/vault/schema.ts`:
- Import ergänzen: `import { MAX_BASE_URL, httpsBase } from '../kube-links';`.
- Vor `KubernetesConnectionNodeSchema` einfügen:

```ts
/** Stored only in the normalized form, so main and renderer read the same host. */
const WebAddressSchema = z.string().max(MAX_BASE_URL).refine(value => httpsBase(value) === value, { message: 'httpsAddress' });
```
- Im Schema nach `readOnly: z.boolean(),`:

```ts
    argoUrl: WebAddressSchema.optional(),
    harborUrl: WebAddressSchema.optional(),
```

### 3.4 Client (Task B)

`src/main/kubernetes/api.ts`, in `KubeApi` nach `rulesReview`:

```ts
  /** One Argo CD Application (get on applications.argoproj.io, v1alpha1). Rejects with KubeApiError: 403, 404 (also when the CRD is missing). */
  readArgoApp(namespace: string, name: string): Promise<KubeObject>;
```

`src/main/kubernetes/client-api.ts`:
- Den Import ergänzen: `AuthorizationV1Api, CustomObjectsApi, Exec, …`.
- In `createKubeApi` nach `rulesReview` einfügen:

```ts
    async readArgoApp(namespace, name) {
      return call(async () => (await config.makeApiClient(CustomObjectsApi).getNamespacedCustomObject({
        group: 'argoproj.io', version: 'v1alpha1', namespace, plural: 'applications', name,
      })) as KubeObject);
    },
```

Die Fakes, die `KubeApi` implementieren, bekommen dieselbe Methode:
- `overview.test.ts`, `watch.test.ts`, `workload-logs.test.ts`: `readArgoApp(): never { throw new Error('unused'); }`.
- `diagnose.test.ts` (`RecordingApi`): `readArgoApp = forbidden;`. Die Analyse ruft sie nie.

### 3.5 Zeilen (Task R)

`src/main/kubernetes/rows.ts`:
- Import: `import { argoAppOf, digestOf } from '../../shared/kube-links';`.
- In `toRow` direkt nach `const row: KubeRow = { … labels: labelMap(meta.labels) };`:

```ts
  const argoApp = argoAppOf(meta);
  if (argoApp) row.argoApp = argoApp;
```
- Im Fall `'pods'` nach der Schleife über `spec.containers` (die `image:`-Zellen setzt):

```ts
      const digests: Record<string, string> = {};
      for (const entry of list(status.containerStatuses).map(rec)) {
        const containerName = text(entry.name);
        const image = containerName ? text(row.cells[`image:${containerName}`]) : undefined;
        const digest = image ? digestOf(image, text(entry.imageID)) : undefined;
        if (containerName && digest) digests[containerName] = digest;
      }
      if (Object.keys(digests).length > 0) row.digests = digests;
```

### 3.6 Main: Argo, Session, IPC (Task H)

**Neu `src/main/kubernetes/argo.ts`:**

```ts
/** Argo CD application of a tracked object: where it lives and what the confirmation says about it. Reading only. */
import { ARGO_HEALTH, ARGO_SYNC, type KubeArgoState } from '../../shared/kubernetes';
import { argoAppParts } from '../../shared/kube-links';
import type { KubeObject } from './api';

/** Namespace of Argo CD's own applications when the name is not qualified (`namespace_name`). */
export const ARGO_NAMESPACE = 'argocd';
/** The confirmation never waits longer for the Self-Heal state. */
export const ARGO_TIMEOUT_MS = 5_000;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});

export function argoAppLocation(app: string): { namespace: string; name: string } | null {
  const parts = argoAppParts(app);
  return parts ? { namespace: parts.namespace ?? ARGO_NAMESPACE, name: parts.name } : null;
}

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  (values as readonly unknown[]).includes(value) ? value as T : undefined;

/** Automated sync is on when `syncPolicy.automated` is an object and not `enabled: false` (Argo CD 3); Self-Heal needs it. */
export function argoStateOf(object: KubeObject): KubeArgoState {
  const automated = rec(rec(object.spec).syncPolicy).automated;
  const on = Boolean(automated) && typeof automated === 'object' && !Array.isArray(automated) && rec(automated).enabled !== false;
  const status = rec(object.status);
  const sync = oneOf(ARGO_SYNC, rec(status.sync).status);
  const health = oneOf(ARGO_HEALTH, rec(status.health).status);
  return { automated: on, selfHeal: on && rec(automated).selfHeal === true, ...(sync ? { sync } : {}), ...(health ? { health } : {}) };
}
```

**`src/main/kubernetes/session.ts`:**
- Imports ergänzen:
  - `import { argoAppUrl, harborImageUrl } from '../../shared/kube-links';`
  - `import { ARGO_TIMEOUT_MS, argoAppLocation, argoStateOf } from './argo';`
  - in der Typ-Importzeile aus `../../shared/kubernetes`: `KubeArgoState, KubeLink`.
- In `status()` nach der `namespace`-Zeile, vor `};`, einfügen:

```ts
      ...(cluster?.argoUrl ? { argoUrl: cluster.argoUrl } : {}),
      ...(cluster?.harborUrl ? { harborUrl: cluster.harborUrl } : {}),
```
- In `KubeSessions` nach `diagnose` einfügen:

```ts
  /** Self-Heal state for the confirmation: get on applications.argoproj.io. null whenever it cannot be read (forbidden, no CRD, other cluster, slow): the dialog then says "möglicherweise". */
  async argoApp(ownerId: number, viewId: string, app: string): Promise<KubeArgoState | null> {
    const view = this.viewOf(ownerId, viewId);
    // Read at each call, like the other entries: a disabled cluster or a locked vault refuses.
    if (this.deps.getCluster(view.session.clusterId).disabled) throw new AppError(DISABLED);
    const location = argoAppLocation(app);
    if (!location) return null;
    let api: KubeApi;
    try { api = view.session.requireApi(); } catch { return null; }
    let timer: unknown;
    const late = new Promise<null>(resolve => { timer = this.options.schedule(() => resolve(null), ARGO_TIMEOUT_MS); });
    try {
      return await Promise.race([api.readArgoApp(location.namespace, location.name).then(argoStateOf, () => null), late]);
    } finally {
      this.options.cancel(timer);
    }
  }

  /** "In Argo CD öffnen" / "In Harbor öffnen": the https address, built only from the vault entry; the cluster's names fill the path. */
  linkFor(ownerId: number, viewId: string, link: KubeLink): string {
    const view = this.viewOf(ownerId, viewId);
    const cluster = this.deps.getCluster(view.session.clusterId);
    if (cluster.disabled) throw new AppError(DISABLED);
    if (link.type === 'argo') {
      if (!cluster.argoUrl) throw new AppError('kubernetes.noArgoUrl');
      const url = argoAppUrl(cluster.argoUrl, link.app);
      if (!url) throw new AppError('kubernetes.linkRefused');
      return url;
    }
    if (!cluster.harborUrl) throw new AppError('kubernetes.noHarborUrl');
    const url = harborImageUrl(cluster.harborUrl, link.image, link.digest);
    if (!url) throw new AppError('kubernetes.linkRefused');
    return url;
  }
```

**`src/main/kubernetes/ipc.ts`:**
- `import { ipcMain, shell, webContents } from 'electron';`
- `import { webLinkHref } from '../../shared/links';`
- Den Schema-Import um `KubeArgoRequestSchema, KubeOpenLinkRequestSchema` erweitern.
- Nach dem Handler `kubeDiagnose` einfügen:

```ts
  // The address comes from the vault entry only; the renderer names the app or image, never the host.
  handle(IPC_CHANNELS.kubeOpenLink, async (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeOpenLinkRequestSchema, request);
    const href = webLinkHref(sessions.linkFor(ownerId, parsed.viewId, parsed.link));
    if (!href || !href.startsWith('https://')) throw new AppError('kubernetes.linkRefused');
    await shell.openExternal(href);
  });
  handle(IPC_CHANNELS.kubeArgoApp, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeArgoRequestSchema, request);
    return sessions.argoApp(ownerId, parsed.viewId, parsed.app);
  });
```

**`src/shared/locales/de-DE/errors/kubernetes.json`**, im Block `kubernetes` ergänzen:

```json
    "noArgoUrl": "Im Cluster-Eintrag ist keine Argo-CD-Adresse hinterlegt.",
    "noHarborUrl": "Im Cluster-Eintrag ist keine Harbor-Adresse hinterlegt.",
    "linkRefused": "Dieser Link wird nicht geöffnet: Er passt nicht zur Adresse im Cluster-Eintrag."
```

**en-US:**

```json
    "noArgoUrl": "The cluster entry has no Argo CD address.",
    "noHarborUrl": "The cluster entry has no Harbor address.",
    "linkRefused": "This link is not opened: it does not match the address in the cluster entry."
```

### 3.7 Formular (Task C)

`src/renderer/src/connection-form.ts`:
- Import: `import { httpsBase } from '../../shared/kube-links';`.
- In `ConnectionFields` nach `readOnly: 'on' | 'off';`:

```ts
  /** Kubernetes only: Argo CD and Harbor web addresses; empty = none. */
  argoUrl: string;
  harborUrl: string;
```
- In `fieldsFromConnection` in der Default-Zeile `… production: 'on', readOnly: 'off',` ergänzen: `argoUrl: '', harborUrl: '',`.
- Im `kubernetes`-Zweig von `fieldsFromConnection` ergänzen: `argoUrl: connection.argoUrl ?? '', harborUrl: connection.harborUrl ?? '',`.
- Im `kubernetes`-Zweig von `connectionFromFields` vor `node = …` einfügen:

```ts
    const links: { argoUrl?: string; harborUrl?: string } = {};
    for (const field of ['argoUrl', 'harborUrl'] as const) {
      if (!fields[field].trim()) continue;
      const base = httpsBase(fields[field]);
      if (!base) throw new ConnectionFieldError(field, t('connection:cluster.validation.linkUrl'));
      links[field] = base;
    }
```
  und im Objekt `node = { … production: …, readOnly: … }` als letztes `...links` anhängen.

`src/renderer/src/components/ClusterForm.tsx`:
- Vor der Komponente einfügen:

```tsx
const LINK_FIELDS = {
  argoUrl: { label: 'connection:cluster.links.argo', placeholder: 'https://argocd.example.com' },
  harborUrl: { label: 'connection:cluster.links.harbor', placeholder: 'https://harbor.example.com' },
} as const;
```
- Nach dem Namespace-Block (`</div>` nach `fieldError('namespace')`) einfügen:

```tsx
      <fieldset>
        <legend>{t('connection:cluster.links.legend')}</legend>
        <p className="editor-hint">{t('connection:cluster.links.hint')}</p>
        {(Object.keys(LINK_FIELDS) as (keyof typeof LINK_FIELDS)[]).map(field => <div className="editor-field" key={field}>
          <label htmlFor={`${idPrefix}-${field}`}>{t(LINK_FIELDS[field].label)}</label>
          <input id={`${idPrefix}-${field}`} type="url" inputMode="url" value={fields[field]} disabled={busy} autoComplete="off" spellCheck={false}
            placeholder={LINK_FIELDS[field].placeholder} aria-invalid={error?.field === field || undefined}
            aria-describedby={error?.field === field ? `${idPrefix}-${field}-error` : undefined}
            onChange={event => onChange(field === 'argoUrl' ? { argoUrl: event.target.value } : { harborUrl: event.target.value })} />
          {fieldError(field)}
        </div>)}
      </fieldset>
```

**`connection.json` de-DE**, im Block `cluster` nach `readOnlyHint`:

```json
    "links": {
      "legend": "Weboberflächen (optional)",
      "hint": "Für „In Argo CD öffnen“ und „In Harbor öffnen“. Shellherd öffnet damit nur Links im Browser und ruft dort selbst nichts ab. Nur https-Adressen.",
      "argo": "Argo-CD-Adresse",
      "harbor": "Harbor-Adresse"
    },
```
In `cluster.validation`: `"linkUrl": "Gib eine https-Adresse ohne Benutzername, Abfrage oder Anker an."`

**en-US:**

```json
    "links": {
      "legend": "Web interfaces (optional)",
      "hint": "For “Open in Argo CD” and “Open in Harbor”. Shellherd only opens links in your browser and requests nothing from these addresses itself. https addresses only.",
      "argo": "Argo CD address",
      "harbor": "Harbor address"
    },
```
`"linkUrl": "Enter an https address without user name, query or fragment."`

### 3.8 Menüs und Dialogtexte (Task M)

`src/renderer/src/kube-menus.ts`:
1. Imports:
   - `import { argoAppUrl, harborImageUrl, linkHost } from '../../shared/kube-links';`
   - den Typ `KubeLink` aus `../../shared/kubernetes` ergänzen.
2. `MenuAction` um `| { type: 'link'; link: KubeLink }` erweitern.
3. `const ARGO_LABEL = …` (`:57`) löschen.
4. `argoCopy` ersetzen:

```ts
const argoCopy = (row: KubeRow): [string, string, string][] => (row.argoApp ? [['argo', t('kubeActions:copy.argoApp'), row.argoApp]] : []);
```
5. Nach `analyzeItem` einfügen:

```ts
interface ImageRef { image: string; digest?: string }

/** Images of a row in container order; pods carry the digest of the running image. */
function rowImages(row: KubeRow): ImageRef[] {
  if (row.ref.kind === 'pods') {
    return (row.containers ?? []).flatMap(name => {
      const image = cell(row, `image:${name}`);
      const digest = row.digests?.[name];
      return image ? [{ image, ...(digest ? { digest } : {}) }] : [];
    });
  }
  return cell(row, 'image').split(',').map(part => part.trim()).filter(Boolean).map(image => ({ image }));
}

/** "In Argo CD öffnen": rows Argo CD tracks. Needs no connection; main builds the address from the vault entry again. */
function argoItem(env: Env, app: string): MenuEntry {
  const base = env.ctx.status?.argoUrl;
  const run: MenuAction = { type: 'link', link: { type: 'argo', app } };
  if (!base) return item(env, 'argo-open', t('kubeActions:menu.openArgo'), run, { reason: t('kubeActions:reasons.noArgoUrl') });
  return item(env, 'argo-open', t('kubeActions:menu.openArgo'), run,
    argoAppUrl(base, app) ? { extra: linkHost(base) } : { reason: t('kubeActions:reasons.linkInvalid') });
}

/** "In Harbor öffnen": only with a Harbor address, for the first image on its host; never a link to another host. */
function harborItems(env: Env, images: ImageRef[]): MenuEntry[] {
  const base = env.ctx.status?.harborUrl;
  if (!base || images.length === 0) return [];
  const found = images.find(entry => harborImageUrl(base, entry.image, entry.digest) !== null);
  const target = found ?? images[0];
  const run: MenuAction = { type: 'link', link: { type: 'harbor', image: target.image, ...(target.digest ? { digest: target.digest } : {}) } };
  return [item(env, 'harbor-open', t('kubeActions:menu.openHarbor'), run,
    found ? { extra: linkHost(base) } : { reason: t('kubeActions:reasons.notInHarbor', { host: linkHost(base) }) })];
}

const HARBOR_KINDS: readonly KubeKind[] = ['pods', 'deployments', 'statefulsets', 'daemonsets'];

function linkItems(env: Env, row: KubeRow): MenuEntry[] {
  return [
    ...(row.argoApp ? [argoItem(env, row.argoApp)] : []),
    ...(HARBOR_KINDS.includes(row.ref.kind) ? harborItems(env, rowImages(row)) : []),
  ];
}
```
6. In `rowMenu`:
   - die zwei ersten Zeilen ersetzen durch:

     ```ts
       const lead: MenuEntry[] = row.argoApp ? [{ kind: 'heading', label: t('kubeActions:menu.argoApp', { name: row.argoApp }) }] : [];
     ```
   - nach dem `if (chip && groups.length > 0) { … }`-Block, vor `return assemble(lead, groups);`, einfügen:

     ```ts
       const links = linkItems(env, row);
       if (links.length > 0 && groups.length > 0) groups[0] = [...groups[0], ...links];
     ```
7. In `containerMenu` die erste Gruppe `[...terminalItems(…), ...popoutItems(…), ...viewItems(…)]` um diesen Eintrag ergänzen:

```ts
      ...harborItems(env, cell(pod, `image:${name}`) ? [{ image: cell(pod, `image:${name}`), ...(pod.digests?.[name] ? { digest: pod.digests[name] } : {}) }] : []),
```

`src/renderer/src/kube-menu-run.ts`:
- Import `KubeLink`.
- In `MenuRunner` nach `analyze`:

```ts
  /** "In Argo CD öffnen" / "In Harbor öffnen": main builds the https address from the vault entry and opens the browser. */
  openLink(link: KubeLink): void;
```
- In `runMenuAction` nach `case 'analyze'`: `case 'link': runner.openLink(action.link); return;`

`src/renderer/src/confirm-action.ts`, ans Ende anfügen:
- den Import ergänzen: `import { KIND_INFO, type KubeAction, type KubeArgoState, type KubeKind, type KubeRef } from '../../shared/kubernetes';`
- dann diesen Code:

```ts
export type ArgoNote = 'revert' | 'restart';

/**
 * Argo CD hint of an action on a tracked object. Scale, suspend, resume and delete change what Git describes;
 * a restart only stamps the pod template, which Argo CD's diff ignores. Pods and nodes are never Argo CD's.
 */
export function argoNoteFor(action: KubeAction, kind: KubeKind): ArgoNote | null {
  if (kind === 'pods' || kind === 'nodes') return null;
  if (action === 'restart') return 'restart';
  return action === 'scale' || action === 'suspend' || action === 'resume' || action === 'delete' ? 'revert' : null;
}

const ARGO_REVERT_KEYS = {
  selfHeal: 'kubeActions:confirm.argo.selfHeal', autoSync: 'kubeActions:confirm.argo.autoSync', manual: 'kubeActions:confirm.argo.manual',
} as const;

/** The dialog line. state: undefined while reading, null when unreadable; both say "möglicherweise" (fail-open). */
export function argoNoteText(note: ArgoNote, app: string, state: KubeArgoState | null | undefined): { text: string; warn: boolean } {
  const status = state && (state.sync || state.health)
    ? ` ${t('kubeActions:confirm.argo.status', { sync: state.sync ?? '–', health: state.health ?? '–' })}` : '';
  if (note === 'restart') return { text: `${t('kubeActions:confirm.argo.restart', { app })}${status}`, warn: false };
  if (!state) return { text: t('kubeActions:confirm.argo.maybe', { app }), warn: true };
  const key = state.selfHeal ? ARGO_REVERT_KEYS.selfHeal : state.automated ? ARGO_REVERT_KEYS.autoSync : ARGO_REVERT_KEYS.manual;
  return { text: `${t(key, { app })}${status}`, warn: true };
}
```

**`kubeActions.json` de-DE:**
- in `reasons`:

  ```json
      "noArgoUrl": "Keine Argo-CD-Adresse im Cluster-Eintrag.",
      "notInHarbor": "Image liegt nicht in {{host}}.",
      "linkInvalid": "Daraus lässt sich kein Link bilden.",
  ```
- in `menu`:

  ```json
      "openArgo": "In Argo CD öffnen",
      "openHarbor": "In Harbor öffnen",
  ```
- in `confirm`:

  ```json
      "argo": {
        "maybe": "Argo CD verwaltet dieses Objekt (App {{app}}) und setzt Abweichungen von Git möglicherweise zurück (Self-Heal).",
        "selfHeal": "Argo CD verwaltet dieses Objekt (App {{app}}) mit Self-Heal: Weicht es danach von Git ab, setzt Argo CD es sofort zurück. Dauerhaft ändert es nur ein Commit.",
        "autoSync": "Argo CD verwaltet dieses Objekt (App {{app}}). Self-Heal ist aus; weicht es danach von Git ab, setzt es der nächste automatische Sync zurück.",
        "manual": "Argo CD verwaltet dieses Objekt (App {{app}}) ohne automatischen Sync. Weicht es danach von Git ab, steht die App auf OutOfSync, und ein Sync setzt es zurück.",
        "restart": "Argo CD verwaltet dieses Objekt (App {{app}}). Einen Neustart setzt Argo CD in der Regel nicht zurück.",
        "status": "Stand in Argo CD: {{sync}}, {{health}}."
      },
  ```

**en-US:**
- `reasons`: `"noArgoUrl": "No Argo CD address in the cluster entry."`, `"notInHarbor": "Image is not in {{host}}."`, `"linkInvalid": "No link can be made from this."`.
- `menu`: `"openArgo": "Open in Argo CD"`, `"openHarbor": "Open in Harbor"`.
- `confirm.argo`:
  - `maybe`: “Argo CD manages this object (app {{app}}) and may revert differences from Git (self-heal).”
  - `selfHeal`: “Argo CD manages this object (app {{app}}) with self-heal: if it then differs from Git, Argo CD reverts it right away. Only a commit changes it for good.”
  - `autoSync`: “Argo CD manages this object (app {{app}}). Self-heal is off; if it then differs from Git, the next automatic sync reverts it.”
  - `manual`: “Argo CD manages this object (app {{app}}) without automatic sync. If it then differs from Git, the app shows OutOfSync, and a sync reverts it.”
  - `restart`: “Argo CD manages this object (app {{app}}). Argo CD usually does not revert a restart.”
  - `status`: “Argo CD status: {{sync}}, {{health}}.”

### 3.9 Dialog und Cluster-Ansicht (Task D)

`components/kubernetes/ConfirmAction.tsx`:
- Imports:
  - `import { MAX_REPLICAS, type KubeActionRequest, type KubeAction, type KubeArgoState, type KubeRef } from '../../../../shared/kubernetes';`
  - `import { argoNoteFor, argoNoteText, confirmationFor } from '../../confirm-action';`
- `PendingAction` ergänzen:

  ```ts
    /** Argo CD application of the target row, when tracked; the dialog then reads its Self-Heal state. */
    argoApp?: string;
  ```
- `ConfirmActionProps` ergänzen:

  ```ts
    /** get on the Argo CD application; null when unreadable. */
    readArgo: (app: string) => Promise<KubeArgoState | null>;
  ```
  und die Signatur auf `({ pending, cluster, run, readArgo, onClose }: ConfirmActionProps)` ändern.
- Nach `const canConfirm = …;` einfügen:

```tsx
  const note = pending.argoApp ? argoNoteFor(pending.action, pending.ref.kind) : null;
  const [argo, setArgo] = useState<KubeArgoState | null | undefined>(undefined);
  useEffect(() => {
    if (!note || !pending.argoApp) return;
    let live = true;
    readArgo(pending.argoApp).then(state => { if (live) setArgo(state); }, () => { if (live) setArgo(null); });
    return () => { live = false; };
    // One read per dialog: it lives for exactly one pending action, and readArgo is a new closure on every render of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const argoLine = note && pending.argoApp ? argoNoteText(note, pending.argoApp, argo) : null;
```
- `aria-describedby={`${id}-body`}` wird zu ``aria-describedby={argoLine ? `${id}-body ${id}-argo` : `${id}-body`}``.
- Nach `<p id={`${id}-body`}>{confirmation.body}</p>` einfügen:

```tsx
      {argoLine && <p id={`${id}-argo`} className={`kube-confirm-argo${argoLine.warn ? ' is-warn' : ''}`} aria-live="polite">{argoLine.text}</p>}
```

`components/kubernetes/ClusterView.tsx`:
- In `confirm` vor `setPending({` einfügen:

```ts
    const argoApp = state.rows.find(row => refKey(row.ref) === refKey(ref))?.argoApp;
```
  und im Objekt nach der `replicas`-Zeile ergänzen: `...(argoApp ? { argoApp } : {}),`.
- Nach `analyze` einfügen:

```ts
  /** "In Argo CD öffnen" / "In Harbor öffnen": main takes the host from the vault entry; errors go to the status line. */
  const openLink = (link: KubeLink) => {
    if (!viewId) { say(t('kubernetes:viewNotOpen')); return; }
    window.desktopApi.kubeOpenLink({ viewId, link }).catch((caught: unknown) => say(errorText(caught)));
  };
  const readArgo = (app: string): Promise<KubeArgoState | null> =>
    (viewId ? window.desktopApi.kubeArgoApp({ viewId, app }) : Promise.resolve(null));
```
- Den Typ-Import aus `../../../../shared/kubernetes` um `KubeArgoState, KubeLink` erweitern.
- In `runnerFor` nach `analyze,` die Zeile `openLink,` ergänzen.
- Im JSX `<ConfirmAction pending={pending} cluster={…}` um `readArgo={readArgo}` ergänzen.

`src/renderer/src/kubernetes-ui.css`, nach `.kube-confirm { … }`:

```css
.kube-confirm-argo { margin: var(--space-8) 0 0; padding-left: var(--space-8); border-left: 3px solid var(--color-border); font-size: var(--fs-sm); color: var(--color-text-muted); }
.kube-confirm-argo.is-warn { border-left-color: var(--color-warn-border); color: var(--color-warn); }
```

### 3.10 run-app (Task G)

**`driver.mjs`**, direkt nach dem `if (process.env.SHELLHERD_RUN_REAL_DIALOGS !== '1') { … }`-Block:

```js
// Links never open a real browser: shell.openExternal only records the address in main. Scenes read it with
// `/main` → `return globalThis.__shellherdOpened`. SHELLHERD_RUN_REAL_BROWSER=1 keeps the real browser.
if (process.env.SHELLHERD_RUN_REAL_BROWSER !== '1') {
  await app.evaluate(({ shell }) => {
    globalThis.__shellherdOpened = [];
    shell.openExternal = async url => { globalThis.__shellherdOpened.push(String(url)); };
  });
}
```

Muster-Begründung: Das ist dasselbe wie bei `dialog.*` (`driver.mjs:57-63`). Main ruft `shell.openExternal(…)` zur Laufzeit als Eigenschaft auf, also greift der Ersatz. Die Liste bleibt im Main-Speicher, statt in eine Datei geschrieben zu werden. So braucht es weder `require` im ESM-Main noch eine neue Treiber-Route. Der Ersatz gilt für **alle** Links, auch Terminal-Links und Weiterleitungen: Das ist gewollt, denn bisher konnte jede Szene versehentlich einen Browser öffnen.

**`kube-fixtures.mjs`:**
1. Nach `KUBE_SECRETS` einfügen:

```js
// Synthetic Argo CD and Harbor of the shop. Hosts under .test never resolve; the driver records links instead of opening them.
export const ARGO_HOST = 'argocd.example.test';
export const HARBOR_HOST = 'harbor.example.test';
export const HARBOR_DIGEST = `sha256:${'5e'.repeat(32)}`;
```
2. `addPod`:
   - in der Parameterliste `imageID` ergänzen;
   - im `containerStatuses`-Eintrag nach `restartCount: restarts,` ergänzen: `...(imageID ? { imageID } : {}),`.
3. `deployPods`:
   - die Signatur wird zu `(deploy, hash, image, count, nodesToUse, ports, imageID)`;
   - im `addPod`-Aufruf `imageID` durchreichen.
4. `api` liegt in Harbor:

```js
  deployPods('api', '6d8f9b7c5', `${HARBOR_HOST}/shop/api:2.4.1`, 3, ['k8s-w1', 'k8s-w1', 'k8s-w2'], HTTP_PORTS, `${HARBOR_HOST}/shop/api@${HARBOR_DIGEST}`);
```
5. `deployment` bekommt den Parameter `extra = {}` und `meta('deployment', name, namespace, 30 * DAY, { labels: { app: name }, ...extra })`. Die Liste wird:

```js
  const deployments = [
    // Label tracking (Argo CD 2.x style).
    deployment('api', `${HARBOR_HOST}/shop/api:2.4.1`, 3, 3, 'shop', { labels: { app: 'api', 'argocd.argoproj.io/instance': 'shop' } }),
    deployment('worker', 'registry.local/shop/worker:2.4.1', 2, 2),
    // Forged tracking id: an app name with a host and a path; Shellherd must ignore it (no heading, no link).
    deployment('checkout', 'registry.local/shop/checkout:1.9.0', 1, 0, 'shop', { annotations: { 'argocd.argoproj.io/tracking-id': 'evil.example.test/x:apps/Deployment:shop/checkout' } }),
  ];
```
6. `cronjobs[0].metadata`: `meta('cronjob', 'nightly-report', 'shop', 30 * DAY, { annotations: { 'argocd.argoproj.io/tracking-id': 'shop:batch/CronJob:shop/nightly-report' } })`. Das ist Annotation-Tracking (Argo CD 3).
7. Event 3: `'Container image "harbor.example.test/shop/api:2.4.1" already present on machine'`. Den Host per Template aus `HARBOR_HOST` einsetzen.
8. Vor `return` einfügen:

```js
  // The Argo CD application of the shop, Self-Heal on: the confirmation of the CronJob says Argo CD reverts the change.
  const applications = [{
    metadata: meta('application', 'shop', 'argocd', 30 * DAY),
    spec: {
      project: 'default', destination: { server: 'https://kubernetes.default.svc', namespace: 'shop' },
      source: { repoURL: 'https://git.example.test/shop/deploy.git', path: 'shop', targetRevision: 'main' },
      syncPolicy: { automated: { prune: true, selfHeal: true } },
    },
    status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } },
  }];
```
   und `applications` in das zurückgegebene Objekt aufnehmen.

**`kube-fake.mjs`:**
- `RESOURCES` um `'argoproj.io/v1alpha1': { applications: 'Application' },` ergänzen.
- Kopfkommentar Zeile 1: „…; a SelfSubjectRulesReview; one Argo CD Application.“

**`fakes.test.mjs`:** Test nach 10.9.

### 3.11 Version (Task F)
- `package.json` und `package-lock.json` (beide Stellen) bekommen `0.30.0`.
- CHANGELOG-Abschnitte wie in Abschnitt 5.

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird am Wellenende. Umsetzer schreiben nur ihre eigenen Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/kube-links.ts` (neu), `src/shared/kube-links.test.ts` (neu), `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | 3.1, 3.2, Tests 10.1, 10.2 | 1 | – |
| **V** Vault | `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts` | 3.3, Tests 10.3 | 1 | A (`httpsBase`) |
| **B** Client | `src/main/kubernetes/api.ts`, `client-api.ts`, `client-api.test.ts`, `overview.test.ts`, `watch.test.ts`, `workload-logs.test.ts`, `diagnose.test.ts` | 3.4, Tests 10.4 | 1 | – |
| **R** Zeilen | `src/main/kubernetes/rows.ts`, `rows.test.ts` | 3.5, Tests 10.5 | 1 | A |
| **H** Main | `src/main/kubernetes/argo.ts` (neu), `argo.test.ts` (neu), `session.ts`, `session.test.ts`, `src/main/kubernetes/ipc.ts`, `src/shared/locales/{de-DE,en-US}/errors/kubernetes.json` | 3.6, Tests 10.6 | 1 | A, B, V (`argoUrl` am Typ) |
| **F** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` | 3.11, Abschnitt 5 | 1 | – |
| **C** Formular | `src/renderer/src/connection-form.ts`, `connection-form.test.ts`, `components/ClusterForm.tsx`, `src/shared/locales/{de-DE,en-US}/connection.json` | 3.7, Tests 10.7 | 2 | A, V |
| **M** Menüs und Dialogtexte | `src/renderer/src/kube-menus.ts`, `kube-menus.test.ts`, `kube-menu-run.ts`, `kube-menu-run.test.ts`, `confirm-action.ts`, `confirm-action.test.ts`, `src/shared/locales/{de-DE,en-US}/kubeActions.json` | 3.8, Tests 10.8 | 2 | A |
| **D** Dialog und Ansicht | `components/kubernetes/ConfirmAction.tsx`, `components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css` | 3.9 | 2 | A, M (`argoNoteFor`, `argoNoteText`, `MenuRunner.openLink`) |
| **G** Fakes und Treiber | `.claude/skills/run-app/kube-fake.mjs`, `kube-fixtures.mjs`, `fakes.test.mjs`, `driver.mjs` | 3.10, Tests 10.9 | 2 | B, R, H (`argoStateOf`) |
| **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | alle |

Hinweise zur Zerlegung:
- **B** erweitert `KubeApi`. Alle Fakes außer dem in `session.test.ts` liegen deshalb bei B. `session.test.ts` liegt bei **H** in derselben Welle.
- **H** braucht `KubernetesConnectionNode.argoUrl` (V), `readArgoApp` (B) und `argoAppUrl`/`harborImageUrl`/`argoAppParts` (A). Alles liegt in Welle 1.
- **Locale-Dateien:**
  - `errors/kubernetes.json` gehört nur H. Die Codes nutzt `session.ts`/`ipc.ts` in derselben Welle, der Katalogtest meldet also keine verwaisten Keys.
  - `kubeActions.json` gehört nur M (Menü-Keys **und** `confirm.argo.*`, die `confirm-action.ts` in M nutzt).
  - `connection.json` gehört nur C.
- **D** ändert keine Locale-Datei. Es nutzt `kubernetes:viewNotOpen`, das schon existiert.
- **G** liegt in Welle 2:
  - `fakes.test.mjs` läuft mit vitest (`vitest.config.ts`) und importiert `toRow` (R), `argoStateOf` (H) und `harborImageUrl` (A).
  - Die geänderte `api`-Fixture betrifft keinen bestehenden Test (Image-Strings von `api` prüft nur die Fixture selbst).
- **F** liegt in Welle 1, weil `src/shared/version.test.ts` Version und CHANGELOG gemeinsam prüft.
- Nach Welle 3 folgen run-app nach Abschnitt 6 und die manuellen Tests aus Abschnitt 11.

---

## 5. Doku (Task F)

**Handbuch `docs/handbuch.md`:**
1. Im Abschnitt „Kubernetes“ nach dem Absatz, der mit „Im Einrichtungsformular ist „Produktion“ vorausgewählt“ beginnt, einen Satz anfügen: „Unter „Weboberflächen (optional)“ lassen sich die Adressen von Argo CD und Harbor hinterlegen (siehe „Argo CD und Harbor“).“
2. Neuer Unterabschnitt nach `### Mit KI analysieren`, direkt vor `## Dateiansicht: Tastatur und Übertragungen`:

   > ### Argo CD und Harbor
   >
   > Im Cluster-Eintrag (`Bearbeiten` → „Weboberflächen (optional)“) kannst du die Adresse von Argo CD und von Harbor hinterlegen, etwa `https://argocd.example.com` und `https://harbor.example.com`. Erlaubt sind nur `https`-Adressen ohne Benutzername.
   >
   > - **Argo CD erkennen:** Trägt ein Objekt die Annotation `argocd.argoproj.io/tracking-id` (Standard ab Argo CD 3) oder das Label `argocd.argoproj.io/instance`, zeigt sein Kontextmenü oben „Argo CD: App …“. Das Label `app.kubernetes.io/instance` wertet Shellherd nicht aus, weil Helm es ebenfalls setzt.
   > - **`In Argo CD öffnen`** öffnet die App im Browser. Ohne hinterlegte Adresse ist der Eintrag gesperrt und sagt, warum.
   > - **Self-Heal-Hinweis:** Skalieren, Anhalten, Fortsetzen und Job löschen an einem Objekt, das Argo CD verwaltet, sagen im Bestätigungsdialog, ob Argo CD die Änderung zurücksetzt, mit Sync- und Health-Stand der App. Dafür liest Shellherd die Application im Cluster (`get` auf `applications.argoproj.io`, im Namespace `argocd` oder dem Namespace vor `_` im App-Namen). Darf das Konto das nicht, läuft Argo CD in einem anderen Cluster oder antwortet der Cluster nicht binnen 5 Sekunden, steht dort „möglicherweise“. Bei einem Neustart sagt der Dialog, dass Argo CD ihn in der Regel nicht zurücksetzt.
   > - **`In Harbor öffnen`** gibt es an Pods, Containern, Deployments, StatefulSets und DaemonSets, wenn der Registry-Host des Images der Harbor-Adresse entspricht. Bei Pods führt der Link zum laufenden Artefakt (mit Schwachstellen-Scan, falls Harbor scannt), bei Workloads zur Repository-Seite mit allen Tags. Liegt das Image woanders, ist der Eintrag gesperrt: „Image liegt nicht in harbor.example.com.“
   > - **Nur lesen, nur Links:** Shellherd löst kein Sync, kein Refresh, kein Rollback und keinen Scan aus und fragt weder Argo CD noch Harbor selbst ab. Es öffnet nur den Browser; Anmeldung und Rechte regeln Argo CD und Harbor dort wie gewohnt. Der Host eines Links kommt immer aus dem Cluster-Eintrag. Labels, Annotationen und Image-Namen aus dem Cluster bestimmen nur den Pfad.
   > - **Grenzen:** Liegen die Applications in einem anderen Namespace als `argocd` (etwa `openshift-gitops`), sagt der Dialog „möglicherweise“. Die Harbor-Links nutzen den Projektnamen und brauchen Harbor 2.1 oder neuer.

**Manual `docs/manual.md`:** dieselben Stellen auf Englisch.
- Neuer Unterabschnitt `### Argo CD and Harbor` vor `## File view: keyboard and transfers` (`docs/manual.md:633`).
- Englische UI-Texte aus 3.7 und 3.8: `Web interfaces (optional)`, `Argo CD address`, `Harbor address`, `Open in Argo CD`, `Open in Harbor`, “Image is not in harbor.example.com.”, “may revert differences from Git (self-heal)”.

**CHANGELOG.md**, ganz oben, Abschnitt `## [0.30.0] – 2026-10-25`:
- Neu: Argo CD und Harbor im Cluster-Tab. Mit der Argo-CD- und der Harbor-Adresse im Cluster-Eintrag öffnen `In Argo CD öffnen` und `In Harbor öffnen` die App bzw. das Image im Browser, bei Pods das laufende Artefakt. Argo-verwaltete Objekte erkennt Shellherd an der Tracking-Annotation oder am Label `argocd.argoproj.io/instance`.
- Neu: Skalieren, Anhalten, Fortsetzen und Job löschen an Argo-verwalteten Objekten sagen im Bestätigungsdialog, ob Argo CD die Änderung per Self-Heal zurücksetzt, mit Sync- und Health-Stand der App.
- Sicherheit: Shellherd liest dafür nur (`get` auf die Application) und löst in Argo CD und Harbor nichts aus. Links gehen nur an die hinterlegten https-Adressen; Labels, Annotationen und Image-Namen aus dem Cluster bestimmen nie den Host.

**CHANGELOG.en.md**, Abschnitt `## [0.30.0] – 2026-10-25`:
- New: Argo CD and Harbor in the cluster tab. With the Argo CD and Harbor addresses in the cluster entry, `Open in Argo CD` and `Open in Harbor` open the app or the image in your browser, for pods the running artifact. Shellherd recognizes objects managed by Argo CD by the tracking annotation or the `argocd.argoproj.io/instance` label.
- New: scaling, suspending, resuming and deleting a job on objects managed by Argo CD say in the confirmation whether Argo CD reverts the change through self-heal, with the app's sync and health status.
- Security: Shellherd only reads for this (`get` on the Application) and triggers nothing in Argo CD or Harbor. Links only go to the https addresses you entered; labels, annotations and image names from the cluster never decide the host.

**README.md:**
- `:50` (Punkt „Kubernetes“): Nach „that only reads and never sends Secrets“ einfügen: „, links to Argo CD and Harbor, and a self-heal hint before changing what Argo CD manages“.
- `:137`: Nach „Native dialogs are stubbed“ einfügen: „, links never open a browser“.

---

## 6. run-app-Szenen (Task J, Abnahme)

Die Szenen laufen nur gegen die Fakes, nie gegen einen echten Cluster, ein echtes Argo CD oder ein echtes Harbor. `.test`-Hosts lösen nie auf. Der Treiber zeichnet Links auf, statt sie zu öffnen (3.10).

### 6.1 Neuer Block `kube-links` in `screens.mjs` (vier Shots, nach `kube-ai`)

- Den Block in die Usage-Zeile (`:2`) aufnehmen.
- Import ergänzen: `import { ARGO_HOST, HARBOR_DIGEST, HARBOR_HOST, KUBE_SECRETS } from './kube-fixtures.mjs';` (ersetzt den bisherigen Import aus dieser Datei).

```js
  // Argo CD and Harbor links: addresses from the cluster entry, the browser replaced by the driver; the Self-Heal hint in the confirmation, read by GET only.
  async 'kube-links'() {
    if (!await evaluate(`document.body.innerText.includes('prod-k8s')`)) { console.log('Argo/Harbor übersprungen: prod-k8s fehlt im Baum.'); return; }
    const kubeLog = path.join(RUN_DIR, 'kube', KUBE_REQUEST_LOG);
    const opened = () => call('main', 'return globalThis.__shellherdOpened ?? []');
    const openedUntil = async (step, test) => {
      for (const end = Date.now() + 5000; ; await pause(200)) {
        const list = await opened();
        if (test(list)) return list;
        if (Date.now() > end) throw new Error(`${step}: ${JSON.stringify(list)}`);
      }
    };
    const menuHas = (label, extra = '') => `[...document.querySelectorAll('[role=menuitem]')].some(i => i.textContent.includes(${JSON.stringify(label)})${extra})`;
    const before = (await opened()).length;
    try {
      // 1. Both addresses in the cluster entry; http is refused at the field, a trailing slash is normalized away.
      await rclick('text=prod-k8s >> nth=0');
      await menuItem('Bearbeiten');
      await waitFor('Formular', `!!document.querySelector('input[id$="-argoUrl"]')`);
      await fill('input[id$="-argoUrl"]', `http://${ARGO_HOST}`);
      await fill('input[id$="-harborUrl"]', `https://${HARBOR_HOST}`);
      await click('button[type=submit]:has-text("Verbindung speichern")');
      await waitFor('Feldfehler http', `(document.querySelector('[id$="-argoUrl-error"]')?.textContent ?? '').includes('https')`);
      await fill('input[id$="-argoUrl"]', `https://${ARGO_HOST}/`);
      await pause(300);
      await shot('cluster-links-form');
      await click('button[type=submit]:has-text("Verbindung speichern")');
      await waitFor('Gespeichert', `!document.querySelector('[id$="-argoUrl-error"]')`);
      await closeTabs();
      fs.rmSync(kubeLog, { force: true });
      await click('text=prod-k8s >> nth=0');
      await key('Enter');
      await waitFor('Kubernetes-Ansicht', `document.body.innerText.includes('bereit über web-01') && ${count('.kube-table tbody tr')} >= 5`);
      // 2. Pod api: Harbor link to the running digest. checkout's image lies elsewhere: entry greyed out with the host.
      await rclick('.kube-table tbody tr:has-text("api-6d8f9b7c5-x7k2p")');
      await waitFor('Harbor im Pod-Menü', menuHas('In Harbor öffnen', ` && i.textContent.includes(${JSON.stringify(HARBOR_HOST)}) && !i.disabled`));
      await pause(300);
      await shot('kube-harbor-menu');
      await menuItem('In Harbor öffnen');
      await openedUntil('Harbor-Link', list => list.length === before + 1);
      const harbor = (await opened()).at(-1);
      if (harbor !== `https://${HARBOR_HOST}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${HARBOR_DIGEST}`) throw new Error(`Harbor-Link falsch: ${harbor}`);
      await rclick('.kube-table tbody tr:has-text("checkout-7f9c6b8d4-m2n5z")');
      await waitFor('Harbor gesperrt', menuHas('In Harbor öffnen', ` && i.disabled && i.textContent.includes('Image liegt nicht in ${HARBOR_HOST}')`));
      await key('Escape');
      // 3. Deployments: api is tracked by label and opens in Argo CD; checkout's forged tracking id is ignored.
      await click('.kube-kind-tabs button:has-text("Deployments")');
      await waitFor('Deployments', `${count('.kube-table tbody tr')} >= 3`);
      await rclick('.kube-table tbody tr:has-text("checkout")');
      await waitFor('Menü checkout', `document.querySelectorAll('[role=menuitem]').length > 0`);
      if (await evaluate(`document.querySelector('[role=menu]')?.innerText.includes('Argo CD') ?? false`)) throw new Error('Gefälschte Tracking-Annotation erzeugt einen Argo-Eintrag');
      await key('Escape');
      await rclick('.kube-table tbody tr:has-text("api")');
      await waitFor('Argo im Menü', `document.querySelector('[role=menu]')?.innerText.includes('Argo CD: App shop') && ${menuHas('In Argo CD öffnen', ` && i.textContent.includes(${JSON.stringify(ARGO_HOST)})`)}`);
      await pause(300);
      await shot('kube-argo-menu');
      await menuItem('In Argo CD öffnen');
      const links = await openedUntil('Argo-Link', list => list.length === before + 2);
      if (links.at(-1) !== `https://${ARGO_HOST}/applications/shop`) throw new Error(`Argo-Link falsch: ${links.at(-1)}`);
      // 4. CronJob (annotation tracking): the confirmation reads the application and says Self-Heal reverts; cancelled, nothing changes.
      await click('.kube-kind-tabs button:has-text("CronJobs")');
      await waitFor('CronJobs', `${count('.kube-table tbody tr')} >= 1`);
      await rclick('.kube-table tbody tr:has-text("nightly-report")');
      await menuItem('Anhalten');
      await waitFor('Self-Heal im Dialog', `(document.querySelector('dialog.kube-confirm[open] .kube-confirm-argo.is-warn')?.textContent ?? '').includes('mit Self-Heal')
        && document.querySelector('dialog.kube-confirm[open] .kube-confirm-argo').textContent.includes('Synced, Healthy')`);
      await pause(300);
      await shot('kube-argo-selfheal');
      await click('dialog.kube-confirm[open] .kube-confirm-cancel');
      await waitFor('Dialog zu', `!document.querySelector('dialog.kube-confirm[open]')`);
      // 5. Only GETs (the rules review aside), the application read exactly once; every opened link on the two .test hosts.
      const asked = fs.readFileSync(kubeLog, 'utf8').split('\n').filter(Boolean);
      if (asked.some(line => !line.startsWith('GET ') && !line.startsWith('POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews'))) throw new Error('Schreibende Anfrage an den Cluster');
      if (asked.filter(line => line === 'GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/shop').length !== 1) throw new Error('Application nicht genau einmal gelesen');
      const all = (await opened()).slice(before);
      if (all.length !== 2 || all.some(url => !url.startsWith(`https://${ARGO_HOST}/`) && !url.startsWith(`https://${HARBOR_HOST}/`))) throw new Error(`Unerwartete Links: ${JSON.stringify(all)}`);
    } finally {
      await closeTabs();
    }
  },
```

Die Helfer `rclick`, `menuItem`, `count`, `waitFor`, `shot`, `pause`, `click`, `fill`, `key` und `closeTabs` gibt es in `screens.mjs` schon. `fs`, `path`, `RUN_DIR` und `KUBE_REQUEST_LOG` sind schon importiert (`:5-10`).
- Falls der Speichern-Knopf beim Bearbeiten anders heißt, gilt der Text aus `connection:form.save`.
- `closeTabs` schließt Formular-Tab bzw. Dialog.
- Die Adressen bleiben danach im Demo-Vault. Das ist harmlos, und spätere Läufe füllen sie gleich.

### 6.2 `SKILL.md`
- Den Block `kube-links` mit seinen Shots `cluster-links-form.png`, `kube-harbor-menu.png`, `kube-argo-menu.png` und `kube-argo-selfheal.png` in die Usage-Zeile und die Liste der Szenen aufnehmen.
- Im Abschnitt zum Treiber ergänzen: Der Treiber ersetzt `shell.openExternal` im Main-Prozess. Links landen in `globalThis.__shellherdOpened` (lesbar mit `/main`: `return globalThis.__shellherdOpened`), kein Browser öffnet sich. `SHELLHERD_RUN_REAL_BROWSER=1` schaltet das ab.
- Im Abschnitt „Gegenstellen“ ergänzen:
  - Der Kubernetes-Fake liefert die Argo-CD-Application `argocd/shop` mit Self-Heal (Synced, Healthy).
  - Deployment `api` trägt das Label `argocd.argoproj.io/instance: shop`, CronJob `nightly-report` die Tracking-Annotation.
  - Deployment `checkout` trägt eine gefälschte Tracking-Annotation, die Shellherd ignorieren muss.
  - Die `api`-Pods laufen mit `harbor.example.test/shop/api:2.4.1` und einem synthetischen Digest in `imageID`.

---

## 7. Was ausdrücklich nicht getan wird

1. **Nichts Schreibendes in Argo CD (R-0):**
   - kein Sync, kein Refresh, kein Hard-Refresh;
   - keine Annotation `argocd.argoproj.io/refresh`;
   - kein Rollback, kein Terminate;
   - kein Patch an der Application;
   - kein Abschalten von Self-Heal.
2. **Nichts Schreibendes in Harbor:** kein Scan-Start, kein Retag, kein Löschen.
3. **Kein Zugriff auf die APIs von Argo CD und Harbor,** auch nicht lesend, und keine Zugangsdaten für beide (R7.6).
4. **Kein `list` oder `watch` auf Applications,** keine Sync/Health-Spalte, kein Badge in Tabelle oder Dock (R4).
5. **Kein Link mit einem Host aus dem Cluster:** keine `link.argocd.argoproj.io/*`-Annotationen, keine `externalURLs`, keine Ingress-Hosts. Der allgemeine Kanal `app:open-external` (http, jeder Host) wird für Argo- und Harbor-Links nicht benutzt (R6.3).
6. **Kein `app.kubernetes.io/instance`,** kein einstellbarer Label-Schlüssel (R1.4).
7. **Kein Argo-Namespace-Feld:** Applications außerhalb von `argocd` ergeben „möglicherweise“ (R3.4).
8. **Keine Änderung an Bestätigungsregeln:** Die Namenseingabe bei Produktion bleibt, der Dialog wartet nicht auf Argo, und es gibt keinen zweiten Dialog (R3.6).
9. **Kein Self-Heal-Hinweis an Pods, Nodes und `Jetzt ausführen…`** (R3.1).
10. **Keine Harbor-Erkennung ohne konfigurierte Adresse,** kein zweiter Registry-Host (R7.1).
11. **Keine neuen Tokens,** keine Bewegung, keine neue npm-Abhängigkeit.
12. **Keine Argo-Daten im KI-Kontext:** Annotationen bleiben aus `diagnose.ts` draußen.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a, 1b, 2a, 2b, 3a, 3b, 4a, 4b, 5a.
- Shared: ein reines Modul `kube-links.ts` (rund 110 Zeilen) und Vertragszeilen.
- Main:
  - `argo.ts` (rund 35 Zeilen);
  - zwei Session-Methoden (rund 40 Zeilen);
  - zwei IPC-Handler;
  - `readArgoApp` (6 Zeilen);
  - 10 Zeilen in `rows.ts`.
- Renderer:
  - rund 60 Zeilen Menü;
  - rund 30 Zeilen Dialogtexte;
  - rund 20 Zeilen Dialog;
  - 15 Zeilen Formular.
- run-app: Fixture, ein Treiber-Ersatz, ein Ende-zu-Ende-Test, eine Szene.

Müsste das Paket kleiner werden, fiele zuerst 2b weg (das Lesen der Application). Der Dialog sagt dann immer „möglicherweise“ und Argo-Status gibt es keinen; R5 wäre leer. Danach fiele 3b weg (Digest), und alle Harbor-Links gingen zur Repository-Seite. Empfohlen ist das ganze Paket: 2b kostet rund 60 Zeilen und macht aus einer pauschalen Warnung eine zutreffende Aussage. 3b kostet 10 Zeilen und führt direkt zu den Scan-Ergebnissen des laufenden Images.

**Extras für später:**
- Feld „Argo-CD-Namespace“ im Cluster-Eintrag (OpenShift GitOps: `openshift-gitops`).
- Einstellbarer Label-Schlüssel für Argo-Tracking (`application.instanceLabelKey`).
- Kleine Markierung „Argo“ in der Namensspalte (nur aus `row.argoApp`, ohne Lesen).
- Harbor-Scan-Übersicht im Menü über einen **lesenden** Robot-Account im Vault (`GET /api/v2.0/projects/{p}/repositories/{r}/artifacts/{digest}?with_scan_overview=true`), opt-in, mit eigener CA-Option. Das bricht die README-Zusage und braucht ein eigenes Ruling.
- Zweiter Registry-Host je Harbor (Registry-Alias).
- Argo-Status im KI-Kontext der Analyse.
- Statusaktualisierung offener Cluster-Tabs sofort nach dem Speichern des Formulars (`KubeSessions.vaultChanged()` aus `onVaultChange`).

## 9. Risiken

1. **Harbor-Route mit Projektnamen (größtes Risiko).** Harbors eigene Links nutzen die Projekt-ID. Shellherd kennt sie ohne API nicht und nutzt den Namen. Der Projekt-Resolver nimmt Namen an (`GET /api/v2.0/projects/{name_or_id}`), einzelne Teilansichten könnten aber eine Zahl erwarten.
   - Gegenmaßnahme: Die Pfadbildung steckt nur in `harborImageUrl`. Der manuelle Test 6 prüft genau das auf dem Harbor des Nutzers.
   - Scheitert er, wird die Funktion in einer Folgeversion auf die Repository-Liste des Projekts oder die Startseite zurückgenommen, ohne dass sich der Vertrag ändert.
   - Auch die Kodierung verschachtelter Repositorys (`team%2Fapi`) prüft Test 6.
2. **Applications liegen anderswo.** In Mehr-Cluster-Setups (Argo CD im Management-Cluster) und bei eigenem Namespace sagt der Dialog immer „möglicherweise“. Das ist korrekt fail-open, aber weniger hilfreich. Der Link bleibt richtig, weil er nicht vom Namespace abhängt.
3. **Self-Heal-Aussage bei Feldern, die nicht in Git stehen** (Replicas mit HPA, `ignoreDifferences`). Die Texte sagen deshalb „weicht es danach von Git ab, …“ und versprechen kein Zurücksetzen der Replicas. Bei `restart` sagt der Dialog „in der Regel nicht“. Ein Repo, das `restartedAt` in Git führt, wäre die Ausnahme.
4. **Argo CD 2.x mit Standard-Label `app.kubernetes.io/instance`** wird nicht erkannt (R1.4). Solche Installationen sehen weder Überschrift noch Link. Das Handbuch nennt die erkannten Schlüssel, ein Extra macht ihn einstellbar.
5. **Veralteter Status:** Neue Adressen erreichen einen offenen Cluster-Tab erst mit dem nächsten Status (Reiterwechsel, Neuverbinden). Main baut den Link trotzdem aus dem aktuellen Vault, falsche Hosts sind also ausgeschlossen. Nur die Verfügbarkeit im Menü hinkt.
6. **Ältere Shellherd-Versionen** (≤ 0.29) entfernen beim Speichern eines Cluster-Eintrags die unbekannten Felder (`z.object` ohne `.strict()` streift sie ab). Wer denselben Vault mit zwei Versionen bearbeitet, verliert die Adressen. Das ist nicht schlimm, sie sind schnell neu eingetragen.
7. **Treiber-Ersatz von `shell.openExternal`:** Er greift nur, weil Main `shell.openExternal` zur Laufzeit als Eigenschaft liest (wie bei `dialog.*`). Schlüge er fehl, würde ein echter Browser `https://*.example.test` öffnen. Das ist ungefährlich, die Szene scheitert dann an `openedUntil`.
8. **Vertrauensgrenze:**
   - Ein Angreifer mit Schreibrecht im Cluster kann Labels und Annotationen setzen. Er bestimmt damit höchstens den Pfad auf dem eigenen Argo- bzw. Harbor-Host des Nutzers, nach strengen Mustern.
   - Er kann den Self-Heal-Hinweis nicht unterdrücken, ohne die Application selbst zu ändern. Wer das kann, beherrscht Argo CD ohnehin.
   - Er kann einen falschen Argo-Hinweis an ein Objekt hängen. Folge: eine Warnung zu viel, nie eine ausgelöste Aktion.
9. **Bestehende Menü-Tests:** `kube-menus.test.ts:233-247` (C28) muss `argoApp` statt des rohen Labels setzen. Ein Label allein erzeugt keine Überschrift mehr (R1.3). Label-Listen ohne Argo und ohne Adressen bleiben gleich.
10. **Fixture-Änderung `api` → `harbor.example.test`** ändert das README-Bild `kubernetes` (Image-Spalte). `--readme` erneuert es. Kein bestehender Test prüft den alten Image-String.

## 10. Testideen (Pflicht = **fett**)

### 10.1 `kube-links.test.ts` (Task A)
- **`httpsBase`:**
  - `'https://Argo.Example.com/'` → `'https://argo.example.com'`;
  - `'https://h:443/x/'` → `'https://h/x'`;
  - `' https://h '` → `'https://h'`;
  - `null` für `http://h`, `javascript:alert(1)`, `file:///C:/x`, `data:text/html,x`, `https://u:p@h`, `https://u@h`, `https://h/?a=1`, `https://h/#x`, 513 Zeichen, Nicht-Strings.
- **`argoAppOf`:**
  - Die Annotation `shop:apps/Deployment:shop/api` an `api` ergibt `shop`.
  - Die Annotation gewinnt vor dem Label.
  - Eine Annotation mit fremdem Objektnamen fällt auf das Label zurück.
  - `team-a_shop` ist gültig.
  - `evil.example.test/x`, `a b`, `A`, `x:y` und 254 Zeichen ergeben `undefined`.
  - `app.kubernetes.io/instance` allein ergibt `undefined`.
- **`argoAppUrl`:**
  - `shop` → `…/applications/shop`;
  - `team-a_shop` → `…/applications/team-a/shop`;
  - Präfix `https://ops.example.com/argo-cd` bleibt;
  - ungültiger Name oder ungültige Adresse → `null`.
  - Bei `evil.com` bleibt der Host der Adresse.
- **`parseImage`/`harborImageUrl`:**
  - Tag → Repository-Seite.
  - Digest im Image → Artefakt-Seite.
  - Digest-Parameter → Artefakt-Seite; ungültiger Digest-Parameter → Repository-Seite.
  - `shop/team/api` → `repositories/team%2Fapi`.
  - Fremder Host → `null`; `nginx:1` und `library/nginx` → `null`.
  - Port `harbor.example.test:8443` passt nur zu `https://harbor.example.test:8443`; `:443` im Image passt zur Adresse ohne Port.
  - `null` für `harbor.example.test/shop/api:1#@evil.com`, `harbor.example.test/shop/../x`, `harbor.example.test/shop/%2F%2Fevil.com/x`, `harbor.example.test/shop/api:1@sha256:bad`, `harbor.example.test/shop`.
- **Für jede erzeugte Adresse aus einer Liste bösartiger Eingaben gilt `new URL(link).origin === new URL(base).origin`.**
- **`digestOf`:**
  - gleiches Repository mit und ohne `docker-pullable://` → Digest;
  - anderes Repository (Mirror) → `undefined`;
  - `sha256:…` ohne `@` → `undefined`;
  - Image mit Port ohne Tag funktioniert.

### 10.2 Schema `kubernetes-schema.test.ts` (Task A)
- **`KubeOpenLinkRequestSchema`:**
  - nimmt Argo und Harbor (mit und ohne Digest) an;
  - lehnt ab: einen unbekannten `type`, Zusatzfelder (auch `url` oder `host`), einen ungültigen Digest, `app` über 253 Zeichen, `image` über 512 Zeichen, eine fehlende `viewId`.
- `KubeArgoRequestSchema` nimmt `{ viewId, app }` an und lehnt Zusatzfelder ab.

### 10.3 Vault `schema.test.ts` (Task V)
- **Ein Cluster mit `argoUrl: 'https://argocd.example.test'` ist gültig.**
- **Abgelehnt werden** `http://…`, `https://argocd.example.test/` (nicht normalisiert) und `https://u@h`.
- Ein Cluster ohne die Felder bleibt gültig (Formatverträglichkeit).

### 10.4 Client `client-api.test.ts` (Task B)
- **`readArgoApp('argocd', 'shop')` ruft `getNamespacedCustomObject` über `CustomObjectsApi` mit `{ group: 'argoproj.io', version: 'v1alpha1', namespace: 'argocd', plural: 'applications', name: 'shop' }`.** Muster wie `rulesReview`, `:612`.
- **403 und 404 werden zu `KubeApiError` mit diesem `code`.**

### 10.5 Zeilen `rows.test.ts` (Task R)
- **`argoApp`:** aus der Annotation (Deployment), aus dem Label (Service), fehlt bei gefälschter Annotation und ungültigem Label.
- **`digests`:** Ein Pod mit `imageID` desselben Repositorys ergibt `{ main: 'sha256:…' }`. Ein anderes Repository oder ein fehlendes `imageID` ergibt kein `digests`.

### 10.6 Main `argo.test.ts`, `session.test.ts` (Task H)
- **`argoAppLocation`:** `shop` → `{ namespace: 'argocd', name: 'shop' }`; `team-a_shop` → `{ namespace: 'team-a', name: 'shop' }`; ungültig → `null`.
- **`argoStateOf`:**
  - `automated: { selfHeal: true }` → `{ automated: true, selfHeal: true }`;
  - `automated: {}` → `{ automated: true, selfHeal: false }`;
  - `automated: { enabled: false, selfHeal: true }` → beides `false`;
  - ohne `syncPolicy` → beides `false`;
  - Sync und Health nur aus den erlaubten Werten (`'Evil'` fällt weg).
- **Session `argoApp`:**
  - liefert den Zustand aus der Fake-API und ruft `readArgoApp('argocd', 'shop')`;
  - `null` bei Ablehnung (403);
  - `null` bei Zeitüberschreitung (fake `schedule`);
  - `null` ohne Verbindung;
  - `null` ohne Aufruf bei ungültigem Namen;
  - wirft `kubernetes.disabled` bei deaktiviertem Cluster und `kubernetes.viewUnavailable` bei fremder View.
- **Session `linkFor`:**
  - Argo und Harbor aus `argoUrl`/`harborUrl` des Vault-Eintrags;
  - `kubernetes.noArgoUrl` bzw. `kubernetes.noHarborUrl` ohne Adresse;
  - `kubernetes.linkRefused` für ein Image auf fremdem Host;
  - **der Host ist bei jeder Eingabe der des Vault-Eintrags**;
  - fremde View abgelehnt.
- **Status:** `status()` enthält `argoUrl`/`harborUrl` genau dann, wenn sie im Eintrag stehen.

### 10.7 Formular `connection-form.test.ts` (Task C)
- **`https://argocd.example.test/` wird als `https://argocd.example.test` gespeichert.**
- **`http://…` wirft `ConnectionFieldError` am Feld `argoUrl` bzw. `harborUrl`.**
- Leere Felder ergeben keine Eigenschaft. Das Zurücklesen füllt beide Felder.

### 10.8 Menüs und Dialogtexte (Task M)
- **Argo** (`kube-menus.test.ts`):
  - Eine Zeile mit `argoApp` hat die Überschrift und `argo-open`.
  - Ohne `status.argoUrl` ist der Eintrag gesperrt mit „Keine Argo-CD-Adresse im Cluster-Eintrag.“
  - Mit Adresse ist er frei, Hint `argocd.example.test`, `run` = `{ type: 'link', link: { type: 'argo', app } }`.
  - Er ist frei auch bei `READ_ONLY` und `RECONNECTING`.
  - Eine Zeile mit Label, aber ohne `argoApp`, hat weder Überschrift noch Eintrag. C28 wird entsprechend angepasst.
- **Harbor:**
  - ohne `status.harborUrl` kein Eintrag;
  - Pod mit passendem zweitem Container → Link auf dessen Image mit Digest;
  - kein passendes Image → gesperrt mit „Image liegt nicht in harbor.example.test.“;
  - Deployment → erstes passendes Image aus `cells.image` ohne Digest;
  - Service, Job, CronJob, Event und Node → kein Eintrag;
  - Container-Menü → Eintrag für genau diesen Container.
- Bestehende exakte Label-Listen (ohne Argo, ohne Adressen) bleiben unverändert.
- **`runMenuAction({ type: 'link', link }, runner)` ruft `runner.openLink(link)`** (`kube-menu-run.test.ts`).
- **`argoNoteFor`** (`confirm-action.test.ts`):
  - `revert` für scale, suspend, resume und delete an deployments, statefulsets, cronjobs und jobs;
  - `restart` für restart;
  - `null` für trigger, für jede Aktion an pods und nodes, für cordon und uncordon.
- **`argoNoteText`:**
  - `undefined` und `null` ergeben den `maybe`-Text mit Warnung.
  - Bei Self-Heal enthält er „mit Self-Heal“ und „Stand in Argo CD: Synced, Healthy.“
  - `automated` ohne Self-Heal → `autoSync`; manuell → `manual`.
  - `restart` ohne Warnung.
  - Ohne Sync und Health gibt es keinen Status-Satz.
  - Beides in de-DE und en-US.

### 10.9 Ende zu Ende `fakes.test.mjs` (Task G)
- **Argo und Harbor über den SSH-Tunnel gegen den Fake** (Muster des Tests „analyses the crash-looping checkout pod“):
  - `argoStateOf(await api.readArgoApp('argocd', 'shop'))` ergibt `{ automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' }`.
  - `readArgoApp('argocd', 'missing')` lehnt mit Code 404 ab.
  - `toRow` ergibt `argoApp` `shop` für Deployment `api` und CronJob `nightly-report`, kein `argoApp` für Deployment `checkout` (gefälscht).
  - `toRow('pods', …api-6d8f9b7c5-x7k2p)` ergibt `digests: { main: HARBOR_DIGEST }`. `harborImageUrl('https://harbor.example.test', …)` liefert die Artefakt-Seite.
  - `kube-requests.log` enthält `GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/shop` und nur `GET`-Zeilen.

### 10.10 Ohne Komponententest
`ClusterForm`, `ConfirmAction` und `ClusterView` haben im Projekt keine Komponententests. Ihr Verhalten belegen:
- der Typecheck;
- die reinen Helfer (10.1, 10.7, 10.8);
- die Szene `kube-links`: Feldfehler, Menüeinträge mit Host, gesperrter Harbor-Eintrag, ignorierte Fälschung, Self-Heal-Zeile, nur GET, Links nur auf den zwei Hosts.

## 11. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Nur lesen. Bestätigungsdialoge nur öffnen und mit `Abbrechen` schließen, nie bestätigen. In Argo CD und Harbor im Browser nichts auslösen (kein Sync, kein Scan).

1. **Adressen:**
   - Cluster bearbeiten, `http://argocd…` eintragen. Erwartet: ein Feldfehler.
   - Mit `https://…/` speichern, erneut öffnen. Erwartet: ohne `/` am Ende gespeichert.
2. **Argo-Link:** Rechtsklick auf ein Deployment, das Argo CD verwaltet.
   - Oben steht „Argo CD: App …“.
   - `In Argo CD öffnen` trägt den Host als Hinweis.
   - Der Browser zeigt genau diese App.
   - Bei Apps in anderen Namespaces (`ns_app`) ebenfalls.
3. **Annotation-Tracking (Argo CD 3)**, falls vorhanden: Objekte ohne das Label, aber mit `argocd.argoproj.io/tracking-id`, zeigen dieselbe Überschrift.
4. **Self-Heal:**
   - Ein Argo-verwaltetes Deployment `Skalieren…` → Dialog nennt Self-Heal an/aus und „Stand in Argo CD: …“ → `Abbrechen`.
   - Mit einem Konto ohne Leserecht auf Applications, oder wenn Argo CD in einem anderen Cluster läuft, steht „möglicherweise“.
5. **Neustart:** `Rollout neu starten…` an demselben Deployment → gedämpfter Hinweis „in der Regel nicht zurück“ → `Abbrechen`.
6. **Harbor (wichtigster Test):**
   - Rechtsklick auf einen Pod mit Harbor-Image → `In Harbor öffnen`.
   - Harbor zeigt **dieses Artefakt** (Digest gleich `kubectl get pod … -o jsonpath='{.status.containerStatuses[0].imageID}'`) mit Reiter für Schwachstellen.
   - Ebenso ein Image mit verschachteltem Repository (`projekt/team/app`).
   - An einem Deployment öffnet sich die Repository-Seite.
   - **Öffnet Harbor stattdessen die Projektliste oder eine Fehlerseite, bitte melden.** Das ist Risiko 9.1.
7. **Fremdes Image:** Ein Pod mit `docker.io`- oder anderem Registry-Image zeigt `In Harbor öffnen` gesperrt mit „Image liegt nicht in …“.
8. **„Nur lesen“-Cluster:** Beide Links funktionieren, Aktionen bleiben gesperrt.
9. **Zweites Fenster:** Cluster-Tab abreißen, beide Links dort öffnen.
10. **Kein Datenverkehr nach außen:** Mit einem Proxy- oder Firewall-Log prüfen. Shellherd selbst verbindet sich weder mit Argo CD noch mit Harbor, nur der Browser nach dem Klick.
