# Kubernetes: Argo-CD-Bezug und Harbor-Links – Validierung (bindend)

Urteil: **ready after corrections** (go-with-fixes). 3 Blocker (alle mit Fix), 9 Korrekturen, 14 Rulings. Dieser Anhang geht Spec `2026-10-25-k8s-argo-harbor-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich**.

Geprüft gegen `b73afd1` (sauberer Arbeitsbaum). Umgebung: Node 24.20, TypeScript 5.9, zod 4, `@kubernetes/client-node` 2.0.0, Electron aus `node_modules`. Ausgangslage: `npm run typecheck` grün, `npx vitest run` 175 Dateien und 2 814 Tests grün.

**Belege aus dem Scratchpad** (`git archive` von `b73afd1` mit Junction auf `node_modules`; nie gegen einen echten Cluster, ein echtes Argo CD oder ein echtes Harbor, nur Kubernetes-Fake über den SSH-Fake):
- Der **Spec-Code wurde wörtlich eingespielt** (3.1 bis 3.11, `kube-links.ts` und `argo.ts` als ganze Dateien, Texte per JSON-Skript).
  - Welle 1 mit Spec-Code: `npm run typecheck` rot in `session.test.ts` (FakeApi ohne `readArgoApp`, B1) und in den vier Fakes, die die Spec nennt (behoben durch 3.4 wörtlich).
  - Welle 2 mit Spec-Code: `npm run typecheck` rot in `connection-form.test.ts:8` und `kube-menu-run.test.ts:6-8` (B2), danach `npx vitest run` 1 Test rot: C28 in `kube-menus.test.ts:233` (B3).
  - Alle übrigen Spec-Blöcke (`kube-links.ts`, Schema, IPC, Preload, `argo.ts`, Session, Main-IPC, `rows.ts`, Formular, Menüs, `confirm-action.ts`, `ConfirmAction.tsx`, `ClusterView.tsx`, CSS, Fixtures, Fake) kompilieren unverändert.
- **Stand nach Welle 1** (A, V, B, R, H, F mit Korrekturen und Pflicht-Tests, Welle-2-Dateien auf Ausgangsstand, eigene Scratch-Kopie): `tsc` für Node und Web grün, `vitest run` **177 Dateien und 2 845 Tests grün**, darin `i18n-catalog.test.ts`, `design-tokens.test.ts` und `version.test.ts`.
- **Stand nach Welle 2** (C, M, D, G dazu): `tsc` grün, `vitest run` **177 Dateien und 2 857 Tests grün**, darin der neue Ende-zu-Ende-Test in `fakes.test.mjs` (lief zweimal).
- **Anfrage-Protokoll des Fakes** im Ende-zu-Ende-Test: `readArgoApp` erzeugt genau `GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/shop` (bzw. `…/missing` → 404). Kein Discovery-Aufruf auf `/apis/argoproj.io/v1alpha1`, kein `list`, kein `watch`, kein Nicht-GET.
- **`shell.openExternal`-Ersatz im Main-Prozess** mit dem echten Electron-Binary geprüft (Mini-App ohne Fenster): Nach `electron.shell.openExternal = async url => …` ruft auch ein später per `require('electron')` geholtes `shell` den Ersatz; kein Browser öffnete sich.
- **Eingaben gegen `kube-links.ts`** (über 80 Fälle, siehe Pflicht-Test A): `@`, `//`, `..`, `%2F`, `\`, IDN/Punycode, Ports, Userinfo, Großschreibung, Steuerzeichen, `javascript:`/`file:`/`data:`. Jede erzeugte Adresse liegt auf dem Origin der Vault-Adresse. `httpsBase` ist auf allen gültigen Proben idempotent.
- **Mutationsproben:**
  - Ohne die Namespace-Prüfung aus K1 scheitert Pflicht-Test A „ignores a copied annotation …“.
  - Ohne den Origin-Vergleich in `onBase` scheitert **kein** Test: Die Muster davor lassen schon keinen fremden Host zu. `onBase` bleibt als zweite Sperre (Ruling V8).
  - `Clock.run(5000)` im bestehenden `session.test.ts` träfe zuerst den Health-Timer (`HEALTH_MS = 5000`). Der Pflicht-Test H nimmt deshalb den jüngsten Timer mit `ARGO_TIMEOUT_MS`.
- **Kontraste** (WCAG 2.x) der Dialogzeile auf `--color-bg-panel` (`.confirm-dialog`): `--color-warn` dunkel 11,05, hell 5,90; `--color-text-muted` dunkel 8,04, hell 7,02. `.kube-confirm-argo.is-warn` (0,2,0) schlägt `.confirm-dialog p` (0,1,1); die Warnfarbe greift.
- Die Szene `kube-links` (Spec 6) wurde in `screens.mjs` eingesetzt und mit `node --check` geprüft, aber **nicht** in der echten App ausgeführt (Abschnitt 7).

## 1. Vertrag: was bindend ist

- **Kompiliert gegen den echten Code ohne Abweichung und gilt wörtlich:**
  - Spec 3.1 (Task A) mit K1 (zwei Zeilen und ein Kommentar);
  - 3.2 (Task A), 3.3 (Task V) mit K2 (eine Zeile), 3.4 (Task B) mit K4a für `session.test.ts` (Task H);
  - 3.5 (Task R), 3.6 (Task H);
  - 3.7 (Task C) mit K4b; 3.8 (Task M) mit K3 (zwei Texte), K4c, K4d und K6 (Einfügestelle);
  - 3.9 (Task D), 3.10 (Task G) wörtlich, 3.11 und 5 (Task F) mit K7, 6 (Task J) mit K8.
- **Ersetzt durch diesen Anhang:**
  - Spec 3.1, `TRACKING_ID` und `argoAppOf` → K1
  - Spec 3.3, `WebAddressSchema` → K2; Spec 10.3 zweiter Punkt (`…test/` abgelehnt) entfällt
  - Spec 3.8, `confirm.argo.autoSync` (de-DE, en-US) → K3
  - Spec 3.4 Fake-Liste, 3.7 und 3.8 bestehende Testdateien → K4
  - Spec 10.1 bis 10.9 (Testideen) → K5 (wörtliche Pflicht-Tests)
  - Spec 3.8 Punkt 7, Einfügestelle in `containerMenu` → K6
  - Spec 5, Handbuch-Punkte „Harbor“ und „Grenzen“, Manual ohne Wortlaut, README ohne Datenschutzsatz → K7
  - Spec 6.1, zwei Selektoren und die Speicher-Wartebedingung; Spec 6.2 ein Satz → K8
- **Typ- und Code-Fakten, die die Spec betreffen:**
  - `ErrorCode` entsteht aus den Keys von `errors/*.json` (`src/shared/errors.ts:6`). `new AppError('kubernetes.noArgoUrl')` kompiliert erst, wenn H die drei Keys anlegt. Beides liegt in Task H.
  - `toRow` bekommt `meta = rec(object.metadata)`; `meta.namespace` ist für K1 schon da.
  - Der Vault wird beim Entsperren mit `VaultSchema.parse` geprüft (`migrations.ts:53`, `vault/session.ts:108`). Scheitert ein Feld, öffnet sich der **ganze** Vault nicht (K2).
  - Der Renderer prüft mit `ConnectionNodeSchema.safeParse` (Chromium-URL-Parser), Main beim Speichern mit `VaultSchema.parse` (Node-URL-Parser).
  - `ClusterStatus` und `KubeRow` haben kein Laufzeit-Schema; die neuen optionalen Felder gehen ohne weitere Änderung über IPC.
  - `ConnectionForm` hat `noValidate` (`ConnectionForm.tsx:153`); `type="url"` blockiert das Absenden also nicht.
  - `StrictMode` (`main.tsx:23`) ruft Effekte nur in `npm run dev` doppelt auf. run-app nutzt den gebauten Stand, dort liest der Dialog genau einmal.

## 2. Blocker

### B1 – Welle 1 ist nicht grün (FakeApi in `session.test.ts`)
`session.test.ts:70` implementiert `KubeApi`. Spec 3.4 nennt nur `overview`, `watch`, `workload-logs` und `diagnose`. Mit Spec-Code: `TS2420` und `TS2322` in `session.test.ts:70` und `:208`. Die Spec sagt nur, die Datei „liegt bei H“, nicht was hineinkommt.
**Fix:** K4a (Task H).

### B2 – Welle 2 ist im Typecheck rot (bestehende Test-Fixtures)
- `connection-form.test.ts:8`: Das Literal `fields: ConnectionFields` hat kein `argoUrl`/`harborUrl` → `TS2739`.
- `kube-menu-run.test.ts:6-8`: `runner()` erfüllt `MenuRunner` ohne `openLink` nicht mehr → `TS1360`, `TS2345`, `TS7053`.

**Fix:** K4b (Task C), K4c (Task M).

### B3 – Welle 2 ist im Test rot (C28)
`kube-menus.test.ts:233-247` baut Zeilen nur mit dem Label. Nach R1.3 entsteht die Überschrift nur aus `row.argoApp` → `expected undefined to deeply equal { kind: 'heading', … }`. Die Spec nennt das (Risiko 9), gibt aber keinen Wortlaut.
**Fix:** K4d (Task M).

## 3. Korrekturen (wörtlicher Ersatz)

### K1 – `src/shared/kube-links.ts` (Task A): Tracking-ID nur für dasselbe Objekt
Argo CD wertet eine Tracking-ID nur aus, wenn Name **und** Namespace passen. Die Spec prüft nur den Namen. Eine kopierte Annotation (z. B. Manifest per `sed` in einen anderen Namespace übernommen) erzeugte dann einen falschen Argo-Hinweis. Der Host ist davon nicht betroffen.

In Spec 3.1 diese zwei Zeilen
```ts
/** `<app>:<group>/<kind>:<namespace>/<name>`; group and namespace may be empty. */
const TRACKING_ID = /^([^:/]+):[^:/]*\/[^:/]+:[^:/]*\/([^:/]+)$/;
```
ersetzen durch:
```ts
/** `<app>:<group>/<kind>:<namespace>/<name>`; group and namespace (cluster-scoped objects) may be empty. */
const TRACKING_ID = /^([^:/]+):[^:/]*\/[^:/]+:([^:/]*)\/([^:/]+)$/;
```
Und in `argoAppOf` die Signatur und die drei Zeilen ab `const tracking` bis zum ersten `return`
```ts
export function argoAppOf(meta: { name?: unknown; labels?: unknown; annotations?: unknown }): string | undefined {
  const tracking = stringAt(meta.annotations, ARGO_TRACKING_ANNOTATION);
  const match = tracking ? TRACKING_ID.exec(tracking) : null;
  // Argo CD ignores a copied annotation whose object name does not match; so does Shellherd.
  if (match && match[2] === meta.name && argoAppParts(match[1])) return match[1];
```
ersetzen durch:
```ts
export function argoAppOf(meta: { name?: unknown; namespace?: unknown; labels?: unknown; annotations?: unknown }): string | undefined {
  const tracking = stringAt(meta.annotations, ARGO_TRACKING_ANNOTATION);
  const match = tracking ? TRACKING_ID.exec(tracking) : null;
  // Argo CD ignores a copied annotation whose namespace or name does not match; so does Shellherd.
  if (match && match[3] === meta.name && match[2] === (meta.namespace ?? '') && argoAppParts(match[1])) return match[1];
```
Der Rest von `argoAppOf` (Label-Zweig) bleibt. `rows.ts` übergibt schon `meta` mit `namespace` (Spec 3.5 unverändert).

### K2 – `src/shared/vault/schema.ts` (Task V): Validator prüft Gültigkeit, nicht Gleichheit
Bewertung des Spec-Validators `httpsBase(value) === value`:
- **Sicherheit:** Er bringt nichts zusätzlich. Main (`linkFor` → `argoAppUrl`/`harborImageUrl`) und Renderer (`linkHost`, `argoAppUrl`, `harborImageUrl`) normalisieren jede Adresse vor Gebrauch erneut mit `httpsBase`.
- **Risiko:** Er bindet das Öffnen des **ganzen** Vaults an die Normalisierung des URL-Parsers. Ändert ein Electron-Update die Normalisierung (IDNA, Prozent-Kodierung, IPv4-Formen), scheitert `VaultSchema.parse` beim Entsperren, und der Nutzer kommt an keinen Eintrag mehr. Dazu prüft der Renderer mit dem Chromium-Parser und Main beim Speichern mit dem Node-Parser.
- **Scratch:** `httpsBase` ist auf allen gültigen Proben idempotent, die Gleichheit hält also heute. Das Risiko ist selten, die Folge aber schwer.

Spec 3.3, die Zeilen vor `KubernetesConnectionNodeSchema`
```ts
/** Stored only in the normalized form, so main and renderer read the same host. */
const WebAddressSchema = z.string().max(MAX_BASE_URL).refine(value => httpsBase(value) === value, { message: 'httpsAddress' });
```
ersetzen durch:
```ts
/** A valid https address (the form stores it normalized); main and renderer normalize again before use. Not "=== httpsBase(value)": a URL parser update must never make a vault unopenable. */
const WebAddressSchema = z.string().max(MAX_BASE_URL).refine(value => httpsBase(value) !== null, { message: 'httpsAddress' });
```
Weiterhin abgelehnt werden `http:`, Benutzer, Passwort, Query, Fragment, `javascript:`, Leerstring und mehr als 512 Zeichen (Pflicht-Test V). Gespeichert wird weiter die normalisierte Form, weil das Formular (Spec 3.7) `httpsBase(…)` speichert.

### K3 – `kubeActions.json` (Task M): `confirm.argo.autoSync`
Ohne Self-Heal löst Argo CD bei einer Abweichung im Cluster **keinen** automatischen Sync aus. Erst ein neuer Commit (neue Revision) tut das. „Der nächste automatische Sync“ klingt nach „gleich“. Ersatz:
- de-DE: `"autoSync": "Argo CD verwaltet dieses Objekt (App {{app}}). Self-Heal ist aus; weicht es danach von Git ab, setzt es erst der nächste automatische Sync nach einem neuen Commit zurück."`
- en-US: `"autoSync": "Argo CD manages this object (app {{app}}). Self-heal is off; if it then differs from Git, only the next automatic sync after a new commit reverts it."`

Alle anderen Texte aus Spec 3.6, 3.7 und 3.8 gelten wörtlich.

### K4 – Bestehende Testdateien (B1, B2, B3)

**K4a – `src/main/kubernetes/session.test.ts` (Task H)**, in `class FakeApi` direkt nach der Methode `readLog` (nach deren schließender `}`, vor der `}` der Klasse) einfügen:
```ts
  argo: KubeObject | Error = { metadata: { name: 'shop', namespace: 'argocd' }, spec: { syncPolicy: { automated: { selfHeal: true } } }, status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } } };
  argoReads: string[] = [];
  async readArgoApp(namespace: string, name: string): Promise<KubeObject> {
    this.argoReads.push(`${namespace}/${name}`);
    if (this.argo instanceof Error) throw this.argo;
    return this.argo;
  }
```

**K4b – `src/renderer/src/connection-form.test.ts` (Task C)**, Zeile 13: `… namespace: '', production: 'on', readOnly: 'off',` wird zu `… namespace: '', production: 'on', readOnly: 'off', argoUrl: '', harborUrl: '',`.

**K4c – `src/renderer/src/kube-menu-run.test.ts` (Task M):**
- Zeile 7 (`runner`): `… logsAll: vi.fn(), analyze: vi.fn(),` wird zu `… logsAll: vi.fn(), analyze: vi.fn(), openLink: vi.fn(),`.
- In der Fallliste nach der Zeile `[{ type: 'analyze', target: { ref, problem: 'crashloop' } }, 'analyze', [{ ref, problem: 'crashloop' }]],` einfügen:
```ts
      [{ type: 'link', link: { type: 'argo', app: 'shop' } }, 'openLink', [{ type: 'argo', app: 'shop' }]],
      [{ type: 'link', link: { type: 'harbor', image: 'harbor.example.test/shop/api:1' } }, 'openLink', [{ type: 'harbor', image: 'harbor.example.test/shop/api:1' }]],
```
Der bestehende Test prüft damit auch, dass `link` genau einen Runner-Aufruf auslöst.

**K4d – `src/renderer/src/kube-menus.test.ts` (Task M), C28:**
- Zeile 235 wird zu:
```ts
    for (const r of [deployment({ argoApp: 'shop-api' }), pod({ argoApp: 'shop-api' }), row('services', 's', { argoApp: 'shop-api', selector: { a: 'b' } })]) {
```
- Der Test `it('has no Argo entries without the label', …)` (Zeilen 243-247) wird ganz ersetzt durch den ersten Block aus K5 M1.

### K5 – Pflicht-Tests (wörtlich, ersetzen Spec 10.1 bis 10.9)

#### A1 – `src/shared/kube-links.test.ts` (neu, ganze Datei)
```ts
import { describe, expect, it } from 'vitest';
import { argoAppOf, argoAppParts, argoAppUrl, digestOf, harborImageUrl, httpsBase, linkHost, parseImage } from './kube-links';

const ARGO = 'https://argocd.example.test';
const HARBOR = 'https://harbor.example.test';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BACKSLASH = String.fromCharCode(92);
const tracking = (value: string) => ({ 'argocd.argoproj.io/tracking-id': value });

describe('httpsBase', () => {
  it('normalizes https addresses: lower-case host, default port and trailing slashes removed, path prefix kept', () => {
    expect(httpsBase('https://Argo.Example.com/')).toBe('https://argo.example.com');
    expect(httpsBase('https://h.example.test:443/x/')).toBe('https://h.example.test/x');
    expect(httpsBase(' https://h.example.test ')).toBe('https://h.example.test');
    expect(httpsBase('https://ops.example.com/argo-cd')).toBe('https://ops.example.com/argo-cd');
    expect(httpsBase('https://h.example.test:8443')).toBe('https://h.example.test:8443');
    expect(httpsBase('https://bücher.example')).toBe('https://xn--bcher-kva.example');
  });

  it('is stable: a normalized address normalizes to itself', () => {
    for (const raw of ['https://Argo.Example.com/', 'https://h.example.test/a b/', `https://h.example.test${BACKSLASH}x`, 'https://bücher.example/x/../y', 'https://[::1]:8443/']) {
      const base = httpsBase(raw);
      expect(base).not.toBeNull();
      expect(httpsBase(base)).toBe(base);
    }
  });

  it('refuses everything but plain https', () => {
    for (const raw of ['http://h.example.test', 'javascript:alert(1)', 'file:///C:/x', 'data:text/html,x', 'https://u:p@h.example.test', 'https://u@h.example.test',
      'https://h.example.test/?a=1', 'https://h.example.test/#x', 'https://h%2Fevil.com', 'https://evil.com%2F@h.example.test', `https://h.example.test/${'x'.repeat(513)}`, 'h.example.test', '']) {
      expect(httpsBase(raw)).toBeNull();
    }
    for (const raw of [null, undefined, 42, {}, ['https://h.example.test']]) expect(httpsBase(raw)).toBeNull();
  });

  it('gives the host with a non-default port for menu hints', () => {
    expect(linkHost('https://h.example.test:8443/x')).toBe('h.example.test:8443');
    expect(linkHost('https://h.example.test:443')).toBe('h.example.test');
    expect(linkHost('http://h.example.test')).toBe('');
  });
});

describe('argoAppOf', () => {
  it('takes the tracking annotation when it names this object, before the label', () => {
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('shop:apps/Deployment:shop/api') })).toBe('shop');
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('team-a_shop:apps/Deployment:shop/api') })).toBe('team-a_shop');
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: { 'argocd.argoproj.io/instance': 'other' }, annotations: tracking('shop:apps/Deployment:shop/api') })).toBe('shop');
    expect(argoAppOf({ name: 'shop', annotations: tracking('shop:/Namespace:/shop') })).toBe('shop');
  });

  it('ignores a copied annotation of another object and falls back to the label', () => {
    const label = { 'argocd.argoproj.io/instance': 'fallback' };
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: label, annotations: tracking('shop:apps/Deployment:shop/other') })).toBe('fallback');
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: label, annotations: tracking('shop:apps/Deployment:prod/api') })).toBe('fallback');
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('shop:apps/Deployment:prod/api') })).toBeUndefined();
  });

  it('takes only valid application names, never host or path parts', () => {
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 'shop' } })).toBe('shop');
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 'team-a_shop' } })).toBe('team-a_shop');
    for (const value of ['evil.example.test/x', 'a b', 'A', 'x:y', 'shop_', '_shop', 'a_b_c', '-a', 'a.', '..', 'x'.repeat(254)]) {
      expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': value } })).toBeUndefined();
    }
    expect(argoAppOf({ name: 'checkout', namespace: 'shop', annotations: tracking('evil.example.test/x:apps/Deployment:shop/checkout') })).toBeUndefined();
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('Shop:apps/Deployment:shop/api') })).toBeUndefined();
    expect(argoAppOf({ name: 'api', labels: { 'app.kubernetes.io/instance': 'shop' } })).toBeUndefined();
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 7 }, annotations: ['x'] })).toBeUndefined();
  });

  it('splits namespace_name and caps the length', () => {
    expect(argoAppParts('shop')).toEqual({ name: 'shop' });
    expect(argoAppParts('team-a_shop')).toEqual({ namespace: 'team-a', name: 'shop' });
    expect(argoAppParts('x'.repeat(253))).toEqual({ name: 'x'.repeat(253) });
    expect(argoAppParts('x'.repeat(254))).toBeNull();
    expect(argoAppParts(`${'a'.repeat(64)}_b`)).toBeNull();
  });
});

describe('argoAppUrl', () => {
  it('builds the application page under the address, path prefix kept', () => {
    expect(argoAppUrl(ARGO, 'shop')).toBe(`${ARGO}/applications/shop`);
    expect(argoAppUrl(ARGO, 'team-a_shop')).toBe(`${ARGO}/applications/team-a/shop`);
    expect(argoAppUrl('https://ops.example.com/argo-cd', 'shop')).toBe('https://ops.example.com/argo-cd/applications/shop');
    expect(argoAppUrl(`${ARGO}/`, 'shop')).toBe(`${ARGO}/applications/shop`);
  });

  it('never leaves the host of the address and refuses invalid names or addresses', () => {
    expect(argoAppUrl(ARGO, 'evil.com')).toBe(`${ARGO}/applications/evil.com`);
    for (const app of ['evil.com/x', '//evil.com', '..', 'a b', '']) expect(argoAppUrl(ARGO, app)).toBeNull();
    expect(argoAppUrl('http://argocd.example.test', 'shop')).toBeNull();
    expect(argoAppUrl('', 'shop')).toBeNull();
  });
});

describe('parseImage and harborImageUrl', () => {
  it('links a tag to the repository page and a digest to the artifact page', () => {
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:2.4.1')).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab`);
    expect(harborImageUrl(HARBOR, `harbor.example.test/shop/api@${DIGEST}`)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, `harbor.example.test/shop/api:1@${DIGEST}`)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:1', DIGEST)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:1', 'sha256:x/../../evil')).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/team/api:1')).toBe(`${HARBOR}/harbor/projects/shop/repositories/team%2Fapi/artifacts-tab`);
    expect(parseImage('harbor.example.test/shop/team/api:1')).toEqual({ host: 'harbor.example.test', project: 'shop', repository: 'team/api', tag: '1' });
  });

  it('matches the host with port and case, :443 counts as no port', () => {
    expect(harborImageUrl(HARBOR, 'HARBOR.example.test/shop/api')).not.toBeNull();
    expect(harborImageUrl(HARBOR, 'harbor.example.test:443/shop/api')).not.toBeNull();
    expect(harborImageUrl(HARBOR, 'harbor.example.test:8443/shop/api')).toBeNull();
    expect(harborImageUrl('https://harbor.example.test:8443', 'harbor.example.test:8443/shop/api')).toBe('https://harbor.example.test:8443/harbor/projects/shop/repositories/api/artifacts-tab');
    expect(harborImageUrl('https://bücher.example', 'xn--bcher-kva.example/shop/api')).toBe('https://xn--bcher-kva.example/harbor/projects/shop/repositories/api/artifacts-tab');
  });

  it('refuses other hosts, Docker Hub short names and anything outside the OCI patterns', () => {
    for (const image of ['registry.local/shop/api:1', 'nginx:1', 'library/nginx', 'harbor.example.test/shop', 'harbor.example.test/shop/api:1#@evil.com',
      'harbor.example.test/shop/../x', 'harbor.example.test/shop/%2F%2Fevil.com/x', 'harbor.example.test/shop/api:1@sha256:bad', 'user@harbor.example.test/shop/api',
      'harbor.example.test/shop//api', `harbor.example.test${BACKSLASH}shop${BACKSLASH}api`, `harbor.example.test/shop/api${BACKSLASH}..`, 'harbor.example.test/Shop/api',
      'harbor.example.test/shop/api:', 'harbor.example.test/shop/api:1:2', 'harbor.example.test/shop/api:..', 'bücher.example/shop/api', 'harbor.example.test./shop/api',
      '//harbor.example.test/shop/api', 'evil.com/harbor.example.test/shop/api']) {
      expect(harborImageUrl(HARBOR, image)).toBeNull();
    }
    expect(harborImageUrl('http://harbor.example.test', 'harbor.example.test/shop/api')).toBeNull();
  });

  it('keeps every link on the origin of the address, whatever the cluster sends', () => {
    const hostile = ['evil.com', 'a@b', '//evil.com', '..', '%2e%2e', 'shop:x', 'x'.repeat(300), 'harbor.example.test@evil.com/shop/api', 'harbor.example.test/shop/api:1@sha256:' + 'f'.repeat(64)];
    for (const base of [ARGO, 'https://ops.example.com/argo-cd', 'https://h.example.test:8443']) {
      for (const value of hostile) {
        for (const link of [argoAppUrl(base, value), harborImageUrl(base, value), harborImageUrl(base, `h.example.test:8443/shop/${value}`)]) {
          if (link !== null) expect(new URL(link).origin).toBe(new URL(base).origin);
        }
      }
    }
  });
});

describe('digestOf', () => {
  it('takes the digest of the running image of the same repository', () => {
    expect(digestOf('harbor.example.test/shop/api:2.4.1', `harbor.example.test/shop/api@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf('harbor.example.test/shop/api:2.4.1', `docker-pullable://harbor.example.test/shop/api@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf('harbor.example.test:5000/shop/api', `harbor.example.test:5000/shop/api@${DIGEST}`)).toBe(DIGEST);
  });

  it('ignores another repository, a bare digest and missing ids', () => {
    expect(digestOf('harbor.example.test/shop/api', `mirror.example.test/shop/api@${DIGEST}`)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', DIGEST)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', undefined)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', 'harbor.example.test/shop/api@sha256:bad')).toBeUndefined();
  });
});
```

#### A2 – `src/shared/kubernetes-schema.test.ts` (Task A)
- Import Zeile 3: `import { KubeAccessRequestSchema, KubeActionRequestSchema,` wird zu `import { KubeAccessRequestSchema, KubeActionRequestSchema, KubeArgoRequestSchema, KubeOpenLinkRequestSchema,` (Rest der Zeile bleibt).
- Ans Dateiende anfügen:
```ts

describe('KubeOpenLinkRequestSchema and KubeArgoRequestSchema', () => {
  const viewId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const digest = `sha256:${'a'.repeat(64)}`;

  it('accepts an Argo app and a Harbor image with and without digest', () => {
    expect(KubeOpenLinkRequestSchema.safeParse({ viewId, link: { type: 'argo', app: 'shop' } }).success).toBe(true);
    expect(KubeOpenLinkRequestSchema.safeParse({ viewId, link: { type: 'harbor', image: 'harbor.example.test/shop/api:1' } }).success).toBe(true);
    expect(KubeOpenLinkRequestSchema.safeParse({ viewId, link: { type: 'harbor', image: 'harbor.example.test/shop/api:1', digest } }).success).toBe(true);
    expect(KubeArgoRequestSchema.safeParse({ viewId, app: 'team-a_shop' }).success).toBe(true);
  });

  it('never takes a url or host from the renderer and rejects bad digests, lengths and view ids', () => {
    for (const link of [
      { type: 'url', app: 'shop' }, { type: 'argo', app: 'shop', url: 'https://evil.example.test' }, { type: 'argo', app: 'shop', host: 'evil.example.test' },
      { type: 'harbor', image: 'harbor.example.test/shop/api:1', digest: 'sha256:bad' }, { type: 'argo', app: 'x'.repeat(254) }, { type: 'argo', app: '' },
      { type: 'harbor', image: 'x'.repeat(513) }, { type: 'harbor', image: '' },
    ]) expect(KubeOpenLinkRequestSchema.safeParse({ viewId, link }).success).toBe(false);
    expect(KubeOpenLinkRequestSchema.safeParse({ link: { type: 'argo', app: 'shop' } }).success).toBe(false);
    expect(KubeOpenLinkRequestSchema.safeParse({ viewId, link: { type: 'argo', app: 'shop' }, url: 'https://evil.example.test' }).success).toBe(false);
    expect(KubeArgoRequestSchema.safeParse({ viewId, app: 'shop', namespace: 'argocd' }).success).toBe(false);
    expect(KubeArgoRequestSchema.safeParse({ viewId: 'v', app: 'shop' }).success).toBe(false);
  });
});
```

#### V – `src/shared/vault/schema.test.ts` (Task V)
Im `describe('ConnectionNodeSchema', …)` direkt nach dem Test `it('accepts a kubernetes connection and keeps old vaults valid', …)` einfügen (vier Leerzeichen Einzug wie die Datei):
```ts

    it('accepts optional https addresses for Argo CD and Harbor and refuses anything else there', () => {
        const cluster = { id: 'k1', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts: ['cp1'],
            kubeconfig: { source: 'auto' }, production: true, readOnly: false };
        expect(ConnectionNodeSchema.parse({ ...cluster, argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test:8443/sub' }))
            .toMatchObject({ argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test:8443/sub' });
        expect(ConnectionNodeSchema.parse(cluster)).not.toHaveProperty('argoUrl');
        for (const value of ['http://argocd.example.test', 'https://u@argocd.example.test', 'https://u:p@argocd.example.test', 'https://argocd.example.test/?a=1',
            'https://argocd.example.test/#x', 'javascript:alert(1)', '', `https://argocd.example.test/${'x'.repeat(513)}`]) {
            expect(ConnectionNodeSchema.safeParse({ ...cluster, argoUrl: value }).success).toBe(false);
            expect(ConnectionNodeSchema.safeParse({ ...cluster, harborUrl: value }).success).toBe(false);
        }
        expect(ConnectionNodeSchema.safeParse({ ...cluster, argoUrl: 42 }).success).toBe(false);
    });
```

#### B – `src/main/kubernetes/client-api.test.ts` (Task B)
- Import Zeile 8 wird zu `import { AuthorizationV1Api, CustomObjectsApi, KubeConfig, KubernetesObjectApi, Watch } from '@kubernetes/client-node';`.
- Direkt vor `describe('readLog', () => {` einfügen:
```ts
describe('createKubeApi.readArgoApp', () => {
  const withApp = async (answer: () => Promise<unknown>) => {
    const get = vi.fn(answer);
    const spy = vi.spyOn(KubeConfig.prototype, 'makeApiClient').mockReturnValue({ getNamespacedCustomObject: get } as never);
    try {
      const result = await createKubeApi(testConfig()).readArgoApp('argocd', 'shop');
      return { result, get, clients: spy.mock.calls.map(call => call[0]) };
    } finally {
      spy.mockRestore();
    }
  };

  it('gets exactly one Application through CustomObjectsApi', async () => {
    const application = { metadata: { name: 'shop', namespace: 'argocd' }, spec: { syncPolicy: { automated: { selfHeal: true } } } };
    const { result, get, clients } = await withApp(async () => application);
    expect(clients).toEqual([CustomObjectsApi]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ group: 'argoproj.io', version: 'v1alpha1', namespace: 'argocd', plural: 'applications', name: 'shop' });
    expect(result).toEqual(application);
  });

  it('maps forbidden and missing (also a missing CRD) to a KubeApiError with the status code', async () => {
    for (const code of [403, 404]) {
      const error = await withApp(async () => { throw Object.assign(new Error('Unknown API Status Code!'), { code, body: '{}' }); }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(KubeApiError);
      expect(error).toMatchObject({ code });
    }
  });
});

```

#### R – `src/main/kubernetes/rows.test.ts` (Task R), ans Dateiende anfügen
```ts

describe('Argo CD and Harbor data', () => {
  const DIGEST = `sha256:${'b'.repeat(64)}`;
  const meta = (extra: object) => ({ name: 'api', namespace: 'shop', uid: 'u', creationTimestamp: '2026-10-16T08:00:00Z', ...extra });

  it('sets argoApp from the tracking annotation or the label, never from a forged or invalid value', () => {
    expect(toRow('deployments', { metadata: meta({ annotations: { 'argocd.argoproj.io/tracking-id': 'shop:apps/Deployment:shop/api' } }), spec: {}, status: {} })?.argoApp).toBe('shop');
    expect(toRow('services', { metadata: meta({ labels: { 'argocd.argoproj.io/instance': 'shop' } }), spec: {} })?.argoApp).toBe('shop');
    expect(toRow('deployments', { metadata: meta({ annotations: { 'argocd.argoproj.io/tracking-id': 'evil.example.test/x:apps/Deployment:shop/api' } }), spec: {}, status: {} })).not.toHaveProperty('argoApp');
    expect(toRow('services', { metadata: meta({ labels: { 'argocd.argoproj.io/instance': 'Evil Name' } }), spec: {} })).not.toHaveProperty('argoApp');
    expect(toRow('services', { metadata: meta({}), spec: {} })).not.toHaveProperty('argoApp');
  });

  it('keeps the digest of the running image per container, only for the same repository', () => {
    const object = (imageID?: string) => ({
      metadata: meta({}),
      spec: { containers: [{ name: 'main', image: 'harbor.example.test/shop/api:2.4.1' }, { name: 'proxy', image: 'registry.local/proxy:1' }] },
      status: { phase: 'Running', containerStatuses: [
        { name: 'main', ready: true, restartCount: 0, state: { running: {} }, ...(imageID ? { imageID } : {}) },
        { name: 'proxy', ready: true, restartCount: 0, state: { running: {} }, imageID: `mirror.example.test/proxy@${DIGEST}` },
      ] },
    });
    expect(toRow('pods', object(`harbor.example.test/shop/api@${DIGEST}`))?.digests).toEqual({ main: DIGEST });
    expect(toRow('pods', object(`docker-pullable://harbor.example.test/shop/api@${DIGEST}`))?.digests).toEqual({ main: DIGEST });
    expect(toRow('pods', object())).not.toHaveProperty('digests');
    expect(toRow('pods', object(`other.example.test/shop/api@${DIGEST}`))).not.toHaveProperty('digests');
  });
});
```

#### H1 – `src/main/kubernetes/argo.test.ts` (neu, ganze Datei)
```ts
import { describe, expect, it } from 'vitest';
import { ARGO_TIMEOUT_MS, argoAppLocation, argoStateOf } from './argo';

const app = (spec: object, status: object = {}) => ({ metadata: { name: 'shop', namespace: 'argocd' }, spec, status });

describe('argoAppLocation', () => {
  it('reads plain names from argocd and namespace_name from their namespace', () => {
    expect(argoAppLocation('shop')).toEqual({ namespace: 'argocd', name: 'shop' });
    expect(argoAppLocation('team-a_shop')).toEqual({ namespace: 'team-a', name: 'shop' });
    for (const name of ['evil.example.test/x', 'A', 'a_b_c', '']) expect(argoAppLocation(name)).toBeNull();
    expect(ARGO_TIMEOUT_MS).toBe(5000);
  });
});

describe('argoStateOf', () => {
  it('reads automated sync and Self-Heal, Argo CD 3 enabled: false included', () => {
    expect(argoStateOf(app({ syncPolicy: { automated: { selfHeal: true } } }))).toEqual({ automated: true, selfHeal: true });
    expect(argoStateOf(app({ syncPolicy: { automated: {} } }))).toEqual({ automated: true, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: { enabled: false, selfHeal: true } } }))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: { selfHeal: 'true' } } }))).toEqual({ automated: true, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: true } }))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf(app({}))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf({})).toEqual({ automated: false, selfHeal: false });
  });

  it('keeps only Argo CD sync and health values', () => {
    expect(argoStateOf(app({}, { sync: { status: 'OutOfSync' }, health: { status: 'Degraded' } }))).toEqual({ automated: false, selfHeal: false, sync: 'OutOfSync', health: 'Degraded' });
    expect(argoStateOf(app({}, { sync: { status: 'Evil' }, health: { status: '<b>x</b>' } }))).toEqual({ automated: false, selfHeal: false });
  });
});
```

#### H2 – `src/main/kubernetes/session.test.ts` (Task H, zusätzlich zu K4a)
- Nach der Zeile `import { KubeSessions, HEALTH_MS, userError } from './session';` einfügen: `import { ARGO_TIMEOUT_MS } from './argo';`
- Ans Dateiende (nach der letzten `});` der Suite `KubeSessions`) anfügen:
```ts

suite('KubeSessions Argo CD and Harbor', () => {
  /** HEALTH_MS has the same delay, so the newest task with ARGO_TIMEOUT_MS is the one of argoApp. */
  const fireArgoTimeout = (world: World) => {
    const entry = [...world.clock.tasks.entries()].filter(([, task]) => task.ms === ARGO_TIMEOUT_MS).at(-1);
    if (!entry) throw new Error('no Argo CD timeout pending');
    world.clock.tasks.delete(entry[0]);
    entry[1].fn();
  };

  it('reads the application once by get and returns its Self-Heal state, null when it cannot be read', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toEqual({ automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' });
    expect(await world.sessions.argoApp(1, viewId, 'team-a_shop')).not.toBeNull();
    expect(world.api.argoReads).toEqual(['argocd/shop', 'team-a/shop']);
    world.api.argo = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toBeNull();
    world.api.argo = new KubeApiError('Not Found', 404, { code: 'kubernetes.notFound' });
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toBeNull();
    expect(await world.sessions.argoApp(1, viewId, 'evil.example.test/x')).toBeNull();
    expect(world.api.argoReads).toHaveLength(4);
    // Every finished read cancels its timer; only the health check may still wait with the same delay.
    expect(world.clock.delays().filter(ms => ms === ARGO_TIMEOUT_MS).length).toBeLessThanOrEqual(1);
  });

  it('gives up after the timeout and without a connection, never blocking the dialog', async () => {
    const world = setup();
    const notReady = world.sessions.open(1, 'c1').viewId;
    expect(await world.sessions.argoApp(1, notReady, 'shop')).toBeNull();
    expect(world.api.argoReads).toEqual([]);
    await settle();
    world.api.readArgoApp = () => new Promise(() => {});
    const hanging = world.sessions.argoApp(1, notReady, 'shop');
    fireArgoTimeout(world);
    expect(await hanging).toBeNull();
  });

  it('refuses other owners, a disabled cluster and a locked vault', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    await expect(world.sessions.argoApp(2, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.argoApp(1, viewId, 'shop')).rejects.toMatchObject({ code: 'core.vaultLocked' });
    world.cluster.disabled = true;
    await expect(world.sessions.argoApp(1, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.disabled' }));
    expect(world.api.argoReads).toEqual([]);
  });

  it('builds links only from the addresses of the vault entry', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const digest = `sha256:${'c'.repeat(64)}`;
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.noArgoUrl' }));
    expect(() => world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'harbor.example.test/shop/api:1' })).toThrow(expect.objectContaining({ code: 'kubernetes.noHarborUrl' }));
    world.cluster.argoUrl = 'https://argocd.example.test';
    world.cluster.harborUrl = 'https://harbor.example.test';
    expect(world.sessions.linkFor(1, viewId, { type: 'argo', app: 'team-a_shop' })).toBe('https://argocd.example.test/applications/team-a/shop');
    expect(world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'harbor.example.test/shop/api:1', digest }))
      .toBe(`https://harbor.example.test/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${digest}`);
    expect(() => world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'registry.local/shop/api:1' })).toThrow(expect.objectContaining({ code: 'kubernetes.linkRefused' }));
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'evil.example.test/x' })).toThrow(expect.objectContaining({ code: 'kubernetes.linkRefused' }));
    for (const app of ['evil.com', 'a.b.c', 'x-y']) expect(new URL(world.sessions.linkFor(1, viewId, { type: 'argo', app })).host).toBe('argocd.example.test');
    for (const image of ['harbor.example.test/a/b', 'HARBOR.example.test:443/a/b/c:1']) expect(new URL(world.sessions.linkFor(1, viewId, { type: 'harbor', image })).host).toBe('harbor.example.test');
    expect(() => world.sessions.linkFor(2, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.viewUnavailable' }));
  });

  it('puts the addresses into the status only when the vault entry has them', async () => {
    const world = setup();
    world.cluster.argoUrl = 'https://argocd.example.test';
    const first = world.sessions.open(1, 'c1');
    await settle();
    expect(statusesOf(world, first.viewId).at(-1)).toMatchObject({ argoUrl: 'https://argocd.example.test' });
    expect(statusesOf(world, first.viewId).at(-1)).not.toHaveProperty('harborUrl');
    delete world.cluster.argoUrl;
    world.cluster.harborUrl = 'https://harbor.example.test';
    const second = world.sessions.open(2, 'c1');
    expect(second.status).toMatchObject({ harborUrl: 'https://harbor.example.test' });
    expect(second.status).not.toHaveProperty('argoUrl');
  });
});
```

#### C – `src/renderer/src/connection-form.test.ts` (Task C, zusätzlich zu K4b)
Im `describe('kubernetes clusters in the form', …)` nach dem Test `it('reports access host, kubeconfig path and namespace problems on their fields', …)` (vor der `});` des `describe`) einfügen:
```ts
  it('stores the Argo CD and Harbor addresses normalized and reads them back', () => {
    const node = connectionFromFields('k', { ...cluster, argoUrl: ' https://ArgoCD.example.test/ ', harborUrl: 'https://harbor.example.test:443/' }, 'kubernetes');
    expect(node).toMatchObject({ argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test' });
    expect(fieldsFromConnection('kubernetes', node)).toMatchObject({ argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test' });
    const plain = connectionFromFields('k', { ...cluster, argoUrl: '  ', harborUrl: '' }, 'kubernetes');
    expect(plain).not.toHaveProperty('argoUrl');
    expect(plain).not.toHaveProperty('harborUrl');
    expect(fieldsFromConnection('kubernetes', plain)).toMatchObject({ argoUrl: '', harborUrl: '' });
  });
  it('reports an address that is not plain https on its field', () => {
    for (const field of ['argoUrl', 'harborUrl'] as const) {
      for (const value of ['http://argocd.example.test', 'argocd.example.test', 'https://u@argocd.example.test', 'https://argocd.example.test/?x=1', 'javascript:alert(1)']) {
        const error = (() => { try { connectionFromFields('k', { ...cluster, [field]: value }, 'kubernetes'); } catch (caught) { return caught; } return null; })();
        expect(error).toBeInstanceOf(ConnectionFieldError);
        expect(error).toMatchObject({ field, message: 'Gib eine https-Adresse ohne Benutzername, Abfrage oder Anker an.' });
      }
    }
  });
```

#### M1 – `src/renderer/src/kube-menus.test.ts` (Task M, zusätzlich zu K4d)
Der Test `it('has no Argo entries without the label', …)` samt der schließenden `});` des `describe('Argo (C28)', …)` wird durch diesen Block ersetzt (er schließt C28 und legt zwei neue `describe` an):
```ts
  it('has no Argo entries without argoApp, also when only the raw label is there (main validates it)', () => {
    for (const r of [deployment(), deployment({ labels: { app: 'api', 'argocd.argoproj.io/instance': 'shop-api' } })]) {
      const entries = rowMenu(r, withStatus({ ...READY, argoUrl: 'https://argocd.example.test' }));
      expect(entries.some(entry => entry.kind === 'heading' && entry.label.startsWith('Argo'))).toBe(false);
      expect(has(entries, 'copy-argo')).toBe(false);
      expect(has(entries, 'argo-open')).toBe(false);
    }
  });
});

describe('In Argo CD öffnen', () => {
  const ARGO_READY: ClusterStatus = { ...READY, argoUrl: 'https://argocd.example.test' };
  const firstGroup = (entries: MenuEntry[]): MenuEntry[] => entries.slice(0, entries.findIndex(entry => entry.kind === 'separator'));

  it('ends the first group of a tracked row with the link and the host as hint', () => {
    for (const r of [deployment({ argoApp: 'shop' }), row('cronjobs', 'nightly', { argoApp: 'shop' }), row('services', 's', { argoApp: 'shop', selector: { a: 'b' } })]) {
      const entries = rowMenu(r, withStatus(ARGO_READY));
      const group = firstGroup(entries);
      expect(group.at(-1)).toEqual({ kind: 'item', id: 'argo-open', label: 'In Argo CD öffnen', hint: 'argocd.example.test', run: { type: 'link', link: { type: 'argo', app: 'shop' } } });
    }
  });

  it('is greyed out without an address and free on read-only, reconnecting and disconnected clusters', () => {
    expect(find(rowMenu(deployment({ argoApp: 'shop' })), 'argo-open')).toMatchObject({ disabled: true, hint: 'Keine Argo-CD-Adresse im Cluster-Eintrag.' });
    for (const status of [{ ...ARGO_READY, readOnly: true }, { ...ARGO_READY, state: 'reconnecting' as const }, { ...ARGO_READY, state: 'error' as const }]) {
      expect(find(rowMenu(deployment({ argoApp: 'team-a_shop' }), withStatus(status)), 'argo-open')).toMatchObject({ hint: 'argocd.example.test', run: { type: 'link', link: { type: 'argo', app: 'team-a_shop' } } });
      expect(find(rowMenu(deployment({ argoApp: 'team-a_shop' }), withStatus(status)), 'argo-open').disabled).toBeUndefined();
    }
  });
});

describe('In Harbor öffnen', () => {
  const HARBOR_READY: ClusterStatus = { ...READY, harborUrl: 'https://harbor.example.test' };
  const DIGEST = `sha256:${'d'.repeat(64)}`;
  const harborPod = pod({ cells: { status: 'Running', 'image:api': 'reg/api:1', 'image:proxy': 'harbor.example.test/shop/proxy:2' }, digests: { proxy: DIGEST } });

  it('only exists with a Harbor address', () => {
    expect(has(rowMenu(harborPod), 'harbor-open')).toBe(false);
    expect(has(menu({ type: 'container', pod: harborPod, name: 'proxy' }), 'harbor-open')).toBe(false);
  });

  it('links the first image on the Harbor host, a pod with the digest of the running image', () => {
    expect(find(rowMenu(harborPod, withStatus(HARBOR_READY)), 'harbor-open'))
      .toEqual({ kind: 'item', id: 'harbor-open', label: 'In Harbor öffnen', hint: 'harbor.example.test', run: { type: 'link', link: { type: 'harbor', image: 'harbor.example.test/shop/proxy:2', digest: DIGEST } } });
    const workload = deployment({ cells: { image: 'reg/api:1, harbor.example.test/shop/side:2, harbor.example.test/shop/other:3' } });
    expect(find(rowMenu(workload, withStatus(HARBOR_READY)), 'harbor-open').run).toEqual({ type: 'link', link: { type: 'harbor', image: 'harbor.example.test/shop/side:2' } });
    expect(find(menu({ type: 'container', pod: harborPod, name: 'proxy' }, withStatus(HARBOR_READY)), 'harbor-open').run)
      .toEqual({ type: 'link', link: { type: 'harbor', image: 'harbor.example.test/shop/proxy:2', digest: DIGEST } });
  });

  it('is greyed out with the host when no image lies there', () => {
    expect(find(rowMenu(pod(), withStatus(HARBOR_READY)), 'harbor-open')).toMatchObject({ disabled: true, hint: 'Image liegt nicht in harbor.example.test.' });
    expect(find(menu({ type: 'container', pod: harborPod, name: 'api' }, withStatus(HARBOR_READY)), 'harbor-open')).toMatchObject({ disabled: true, hint: 'Image liegt nicht in harbor.example.test.' });
  });

  it('never appears on services, jobs, cron jobs, events and nodes', () => {
    for (const r of [row('services', 's', { selector: { a: 'b' }, cells: { image: 'harbor.example.test/shop/api:1' } }), row('jobs', 'j', { cells: { image: 'harbor.example.test/shop/api:1' } }),
      row('cronjobs', 'c'), row('events', 'e.1', { cells: { object: 'Pod/api-1' } }), node()]) {
      expect(has(rowMenu(r, withStatus(HARBOR_READY)), 'harbor-open')).toBe(false);
    }
  });
});
```

#### M2 – `src/renderer/src/confirm-action.test.ts` (Task M)
- Zeile 2 wird zu `import type { KubeAction, KubeKind, KubeRef } from '../../shared/kubernetes';`
- Zeile 3 wird zu `import { argoNoteFor, argoNoteText, confirmationFor } from './confirm-action';`
- Ans Dateiende anfügen:
```ts

describe('Argo CD hint in the confirmation', () => {
  it('warns for scale, suspend, resume and delete, stays neutral for restart and silent otherwise', () => {
    for (const kind of ['deployments', 'statefulsets', 'cronjobs', 'jobs'] as KubeKind[]) {
      for (const action of ['scale', 'suspend', 'resume', 'delete'] as KubeAction[]) expect(argoNoteFor(action, kind)).toBe('revert');
      expect(argoNoteFor('restart', kind)).toBe('restart');
      expect(argoNoteFor('trigger', kind)).toBeNull();
    }
    for (const action of ['restart', 'scale', 'delete', 'cordon', 'uncordon', 'suspend', 'resume', 'trigger'] as KubeAction[]) {
      expect(argoNoteFor(action, 'pods')).toBeNull();
      expect(argoNoteFor(action, 'nodes')).toBeNull();
    }
    expect(argoNoteFor('cordon', 'deployments')).toBeNull();
    expect(argoNoteFor('uncordon', 'deployments')).toBeNull();
  });

  it('says "möglicherweise" while reading and when unreadable, then the read state', () => {
    const maybe = { text: 'Argo CD verwaltet dieses Objekt (App shop) und setzt Abweichungen von Git möglicherweise zurück (Self-Heal).', warn: true };
    expect(argoNoteText('revert', 'shop', undefined)).toEqual(maybe);
    expect(argoNoteText('revert', 'shop', null)).toEqual(maybe);
    expect(argoNoteText('revert', 'shop', { automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' })).toEqual({ warn: true,
      text: 'Argo CD verwaltet dieses Objekt (App shop) mit Self-Heal: Weicht es danach von Git ab, setzt Argo CD es sofort zurück. Dauerhaft ändert es nur ein Commit. Stand in Argo CD: Synced, Healthy.' });
    expect(argoNoteText('revert', 'shop', { automated: true, selfHeal: false })).toEqual({ warn: true,
      text: 'Argo CD verwaltet dieses Objekt (App shop). Self-Heal ist aus; weicht es danach von Git ab, setzt es erst der nächste automatische Sync nach einem neuen Commit zurück.' });
    expect(argoNoteText('revert', 'shop', { automated: false, selfHeal: false, sync: 'OutOfSync' })).toEqual({ warn: true,
      text: 'Argo CD verwaltet dieses Objekt (App shop) ohne automatischen Sync. Weicht es danach von Git ab, steht die App auf OutOfSync, und ein Sync setzt es zurück. Stand in Argo CD: OutOfSync, –.' });
    expect(argoNoteText('restart', 'shop', null)).toEqual({ warn: false, text: 'Argo CD verwaltet dieses Objekt (App shop). Einen Neustart setzt Argo CD in der Regel nicht zurück.' });
    expect(argoNoteText('restart', 'shop', { automated: true, selfHeal: true, health: 'Degraded' }).text).toBe('Argo CD verwaltet dieses Objekt (App shop). Einen Neustart setzt Argo CD in der Regel nicht zurück. Stand in Argo CD: –, Degraded.');
  });

  it('has the same states in English', async () => {
    await i18n.changeLanguage('en-US');
    try {
      expect(argoNoteText('revert', 'shop', null).text).toBe('Argo CD manages this object (app shop) and may revert differences from Git (self-heal).');
      expect(argoNoteText('revert', 'shop', { automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' }).text)
        .toBe('Argo CD manages this object (app shop) with self-heal: if it then differs from Git, Argo CD reverts it right away. Only a commit changes it for good. Argo CD status: Synced, Healthy.');
      expect(argoNoteText('restart', 'shop', undefined)).toEqual({ warn: false, text: 'Argo CD manages this object (app shop). Argo CD usually does not revert a restart.' });
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});
```

#### G – `.claude/skills/run-app/fakes.test.mjs` (Task G)
- Zeile 29 wird zu `import { HARBOR_DIGEST, HARBOR_HOST, KUBE_SECRETS } from './kube-fixtures.mjs';`
- Nach der Zeile `import { buildDiagnosis } from '../../../src/main/kubernetes/diagnose';` einfügen:
```js
import { argoStateOf } from '../../../src/main/kubernetes/argo';
import { toRow } from '../../../src/main/kubernetes/rows';
import { harborImageUrl } from '../../../src/shared/kube-links';
```
- Direkt nach dem Test `it.skipIf(!findOpenssl())('analyses the crash-looping checkout pod, …')` (nach dessen `});`) einfügen:
```js

  it.skipIf(!findOpenssl())('reads the Argo CD application by GET only, tracks api and the CronJob, ignores the forged id and links the running digest', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-argo') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-argo', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));

    expect(argoStateOf(await api.readArgoApp('argocd', 'shop'))).toEqual({ automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' });
    await expect(api.readArgoApp('argocd', 'missing')).rejects.toMatchObject({ code: 404 });

    const rowOf = async (kind, name) => toRow(kind, (await api.list(kind, 'shop')).items.find(item => item.metadata.name === name));
    expect((await rowOf('deployments', 'api')).argoApp).toBe('shop');
    expect((await rowOf('cronjobs', 'nightly-report')).argoApp).toBe('shop');
    expect((await rowOf('deployments', 'checkout')).argoApp).toBeUndefined();
    const pod = await rowOf('pods', 'api-6d8f9b7c5-x7k2p');
    expect(pod.digests).toEqual({ main: HARBOR_DIGEST });
    expect(harborImageUrl(`https://${HARBOR_HOST}`, String(pod.cells['image:main']), pod.digests.main))
      .toBe(`https://${HARBOR_HOST}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${HARBOR_DIGEST}`);

    const asked = readFileSync(join(base, 'kube-argo', KUBE_REQUEST_LOG), 'utf8').split('\n').filter(Boolean);
    expect(asked.filter(line => line.includes('argoproj'))).toEqual(['GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/shop', 'GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/missing']);
    expect(asked.every(line => line.startsWith('GET '))).toBe(true);
  });
```

### K6 – `containerMenu` in `kube-menus.ts` (Task M): Einfügestelle
Spec 3.8 Punkt 7 wörtlich so: Die Zeile
```ts
    [...terminalItems(env, pod, name, prefix), ...popoutItems(env, pod, name), ...viewItems(env, podPrefix, true)],
```
wird zu
```ts
    [...terminalItems(env, pod, name, prefix), ...popoutItems(env, pod, name), ...viewItems(env, podPrefix, true),
      ...harborItems(env, cell(pod, `image:${name}`) ? [{ image: cell(pod, `image:${name}`), ...(pod.digests?.[name] ? { digest: pod.digests[name] } : {}) }] : [])],
```
Der Eintrag steht also am **Ende** der ersten Gruppe. Die Spec-Punkte 1 bis 6 gelten wörtlich; die Funktionen aus Punkt 5 stehen direkt vor `function imageLines`.

### K7 – Doku (Task F)

**Handbuch:** Spec 5 gilt wörtlich, mit zwei Ersetzungen im neuen Abschnitt `### Argo CD und Harbor`:
- Im Punkt **`In Harbor öffnen`** wird der Satz „Bei Pods führt der Link zum laufenden Artefakt (mit Schwachstellen-Scan, falls Harbor scannt), bei Workloads zur Repository-Seite mit allen Tags.“ zu: „Bei Pods führt der Link zum laufenden Artefakt (mit Schwachstellen-Scan, falls Harbor scannt), sofern der Cluster dessen Digest meldet; sonst und bei Workloads führt er zur Repository-Seite mit allen Tags.“
- Der Punkt **Grenzen** wird ganz zu: „- **Grenzen:** Liegen die Applications in einem anderen Namespace als `argocd` (etwa `openshift-gitops`), sagt der Dialog „möglicherweise“. Die Harbor-Links nutzen den Projektnamen statt der internen Projekt-ID. Öffnet Harbor statt des Artefakts die Projektliste oder eine Fehlerseite, nimmt deine Harbor-Version den Namen nicht an.“

Grund: Die Angabe „Harbor 2.1 oder neuer“ ist nicht belegt (Spec Risiko 9.1).

Der Satz aus Spec 5 Punkt 1 wird an das Ende des Absatzes angehängt, der mit „Im Einrichtungsformular ist „Produktion“ vorausgewählt“ beginnt (`docs/handbuch.md:540-543`, nach „bevor der Knopf aktiv wird.“), mit einem Leerzeichen davor.

**Manual `docs/manual.md`, wörtlich:**
1. An das Ende des Absatzes, der mit „In the setup form, “Production” is preselected“ beginnt (`docs/manual.md:529-532`, nach „before the button becomes active.“), mit einem Leerzeichen davor: „Under “Web interfaces (optional)” you can enter the addresses of Argo CD and Harbor (see “Argo CD and Harbor”).“
2. Direkt vor `## File view: keyboard and transfers` (nach dem Abschnitt `### Analyze with AI`, mit Leerzeile davor und danach):

```markdown
### Argo CD and Harbor

In the cluster entry (`Edit` → “Web interfaces (optional)”) you can enter the address of Argo CD and of Harbor, for example `https://argocd.example.com` and `https://harbor.example.com`. Only `https` addresses without a user name are allowed.

- **Recognizing Argo CD:** If an object carries the annotation `argocd.argoproj.io/tracking-id` (default since Argo CD 3) or the label `argocd.argoproj.io/instance`, its context menu shows “Argo CD: app …” at the top. Shellherd does not evaluate the label `app.kubernetes.io/instance`, because Helm sets it too.
- **`Open in Argo CD`** opens the app in your browser. Without an address the entry is greyed out and says why.
- **Self-heal hint:** Scaling, suspending, resuming and deleting a job on an object that Argo CD manages say in the confirmation whether Argo CD reverts the change, with the app’s sync and health status. For this Shellherd reads the Application in the cluster (`get` on `applications.argoproj.io`, in the namespace `argocd` or the namespace before `_` in the app name). If the account may not do that, if Argo CD runs in another cluster or if the cluster does not answer within 5 seconds, it says “may revert differences from Git (self-heal)”. For a restart the confirmation says that Argo CD usually does not revert it.
- **`Open in Harbor`** is offered on pods, containers, Deployments, StatefulSets and DaemonSets when the registry host of the image matches the Harbor address. For pods the link leads to the running artifact (with the vulnerability scan, if Harbor scans) as long as the cluster reports its digest; otherwise, and for workloads, it leads to the repository page with all tags. If the image lies elsewhere, the entry is greyed out: “Image is not in harbor.example.com.”
- **Read-only, links only:** Shellherd triggers no sync, no refresh, no rollback and no scan, and never queries Argo CD or Harbor itself. It only opens your browser; sign-in and permissions are handled there by Argo CD and Harbor as usual. The host of a link always comes from the cluster entry. Labels, annotations and image names from the cluster only decide the path.
- **Limits:** If the Applications live in a namespace other than `argocd` (for example `openshift-gitops`), the confirmation says “may revert”. Harbor links use the project name instead of Harbor’s internal project ID. If Harbor shows the project list or an error page instead of the artifact, your Harbor version does not accept the name.
```

**README.md:** Spec 5 (`:50`, `:137`) gilt wörtlich. Zusätzlich in `README.md:110` an das Ende des Absatzes (nach „go only to the hosts you configured.“), mit einem Leerzeichen davor: „Argo CD and Harbor links open in your browser only after your click; Shellherd itself never contacts either.“

**CHANGELOG.md, CHANGELOG.en.md, package.json, package-lock.json:** Spec 3.11 und 5 wörtlich. Je drei Punkte, damit `version.test.ts` (Parität) grün bleibt. In `package-lock.json` gibt es genau zwei Stellen (`:3`, `:9`).

### K8 – Szene `kube-links` (Task J)
Spec 6.1 gilt wörtlich mit diesen Ersetzungen:
- `await rclick('text=prod-k8s >> nth=0');` wird zu `await rclick('.vault-tree-row >> text=prod-k8s >> nth=0');`
- `await click('text=prod-k8s >> nth=0');` (vor `key('Enter')`) wird zu `await click('.vault-tree-row >> text=prod-k8s >> nth=0');`. Grund: Das offene Formular zeigt den Namen ebenfalls.
- Die Zeile `await waitFor('Gespeichert', `!document.querySelector('[id$="-argoUrl-error"]')`);` wird zu:
```js
      // Saved: the submit button is disabled (no longer dirty) and not busy. The field error alone vanishes already on typing.
      await waitFor('Gespeichert', `(() => { const save = document.querySelector('button[type=submit].busy-button'); return !!save && save.disabled && !save.hasAttribute('aria-busy') && !document.querySelector('[id$="-argoUrl-error"]'); })()`);
```
  Grund: `updateCluster` löscht den Feldfehler schon beim Tippen (`ConnectionForm.tsx:99`). Die Spec-Bedingung wäre vor dem Speichern wahr.
- Die Sätze „Falls der Speichern-Knopf beim Bearbeiten anders heißt …“ entfallen: Der Knopf heißt `Verbindung speichern` (`connection:form.save`).
- Einfügestelle: Der Block steht direkt vor `  async settings() {`. Die Usage-Zeile (`screens.mjs:2`) bekommt `|kube-links` direkt nach `|kube-ai`.

**`SKILL.md`:** Spec 6.2 gilt. Dazu im Abschnitt „Gegenstellen“ ein Satz: „Nach Änderungen an `kube-fake.mjs` oder `kube-fixtures.mjs` den Testserver (`npm run drive:sshd`) neu starten, er lädt die Fakes nur beim Start.“ (Falls der Satz dort schon steht, nicht doppelt.)

### K9 – Überholte Spec-Aussagen
- Spec 10.3: „Abgelehnt werden … `https://argocd.example.test/` (nicht normalisiert)“ gilt nicht mehr (K2). Gilt: Pflicht-Test V.
- Spec 4, Hinweis zu B: „Alle Fakes außer dem in `session.test.ts`“: Den Fake in `session.test.ts` ergänzt H mit K4a.
- Spec 6.1, Kommentar „the application read exactly once“: Das gilt für den gebauten Stand (run-app). In `npm run dev` liest der Dialog wegen `StrictMode` zweimal (V4).

## 4. Rulings

- **V1 – Validator prüft Gültigkeit statt Gleichheit (K2).** Die Sicherheit liegt in `httpsBase` vor jedem Gebrauch in Main und Renderer, nicht im Schema. Das Schema verhindert nur, dass Unsinn gespeichert wird. Gespeichert wird weiter normalisiert, weil das Formular normalisiert.
- **V2 – Tracking-ID verlangt Name und Namespace (K1).** Gruppe und Kind werden nicht geprüft (`argoAppOf` kennt den Kind nicht). Ein falscher Treffer ergibt höchstens einen Hinweis zu viel, nie eine Aktion.
- **V3 – Kein Abbruch der HTTP-Anfrage beim Schließen des Dialogs.** Nach dem Schließen verwirft der Renderer das Ergebnis (`live = false`). Main beendet das Warten spätestens nach 5 s und löscht den Timer (`finally`). Die GET-Anfrage selbst läuft weiter, bis der Server antwortet oder die Sitzung endet, wie bei `access()` (`session.ts:628-643`). Angenommen.
- **V4 – Doppeltes Lesen in `npm run dev`.** `StrictMode` führt den Effekt zweimal aus: zwei GETs, beide lesend. Im gebauten Paket genau einer. Angenommen.
- **V5 – IDN-Adressen erscheinen als Punycode** in Feld, Hinweis und Link (`https://xn--…`). Das ist gewollt: Ein Homograph-Host fällt so eher auf.
- **V6 – Rein numerische Harbor-Projektnamen** könnte Harbor als Projekt-ID lesen. Der Link bleibt auf dem Harbor-Host, zeigt dann aber ein falsches Projekt. Nicht ohne API lösbar; die Doku nennt die Grenze (K7). Manueller Test 6 deckt es ab.
- **V7 – `In Argo CD öffnen` an Event-Zeilen.** `linkItems` greift für jede Zeile mit `argoApp`. Events tragen das Label bzw. die Annotation des betroffenen Objekts nicht, `argoApp` entsteht dort praktisch nie. Keine Sonderregel.
- **V8 – `onBase` bleibt als zweite Sperre**, obwohl keine Mutationsprobe sie allein auslöst. Die Muster davor sichern schon den Host; `onBase` sichert gegen künftige Änderungen an `parseImage`/`ARGO_APP`.
- **V9 – Die https-Prüfung in `k8s:open-link`** (`webLinkHref` + `startsWith('https://')`) hat keinen Unit-Test, weil `src/main/kubernetes/ipc.ts` keine Tests hat. Der Review prüft sie per Lesen. Abgedeckt sind `linkFor` (Pflicht-Test H) und die Szene (nur `.test`-Hosts geöffnet).
- **V10 – Ohne Status (Tab-Start)** zeigt `In Argo CD öffnen` kurz „Keine Argo-CD-Adresse im Cluster-Eintrag.“. Mit dem ersten Status (Teil der `k8s:open`-Antwort) stimmt es. Angenommen.
- **V11 – Der Renderer darf jeden gültigen App-Namen und jeden OCI-Pfad auf dem Harbor-Host anfragen.** Main prüft nicht, ob die Zeile wirklich existiert. Der Host ist fest, das Ziel ist die eigene Argo- bzw. Harbor-Oberfläche des Nutzers mit dessen Anmeldung. Angenommen.
- **V12 – `border-left: 3px solid`** ist Geometrie wie `.assistant-command` (`assistant-ui.css:20`); `design-tokens.test.ts` ist damit grün. Kein neues Token.
- **V13 – Die Application verlässt den Main nie.** `argoStateOf` reduziert sie auf zwei Booleans und zwei Werte aus festen Listen. Helm-Values oder Parameter der Application (können Geheimnisse enthalten) erreichen weder Renderer noch KI.
- **V14 – Reihenfolge der Welle 1.** V, R und H programmieren gegen den Vertrag von A (und H gegen B und V) in derselben Welle. Geprüft wird am Wellenende; belegt mit dem Welle-1-Stand oben.

## 5. Sicherheitsprüfung

| Prüfpunkt | Ergebnis | Beleg |
|---|---|---|
| Nutzer-Ruling R-0: nur `get` auf `applications.argoproj.io` | erfüllt | Einzige neue API-Methode `readArgoApp` → `CustomObjectsApi.getNamespacedCustomObject` (Pflicht-Test B: genau ein Aufruf, genau diese Parameter). Ende-zu-Ende: genau `GET /apis/argoproj.io/v1alpha1/namespaces/{ns}/applications/{name}`, kein Discovery, kein `list`/`watch`/`patch`/`create`/`delete`. Kein Aufruf an Argo-CD- oder Harbor-API, kein Refresh, keine Annotation. `diagnose.test.ts` setzt `readArgoApp = forbidden`. |
| `k8s:open-link`: Host immer aus dem Vault | erfüllt | Das Schema lässt nur `{type:'argo', app}` bzw. `{type:'harbor', image, digest?}` zu, `.strict()`; `url`/`host` werden abgelehnt (Pflicht-Test A2). `linkFor` liest `getCluster` frisch (gesperrt → Fehler, deaktiviert → `kubernetes.disabled`). Pflicht-Test H: Bei jeder Eingabe ist der Host der des Eintrags. |
| Beliebiges Schema, Host oder Pfad erzwingbar? | nein | `httpsBase` nur `https:`, ohne Userinfo/Query/Fragment. Image-Host muss **gleich** `new URL(base).host` sein (Groß-/Kleinschreibung normalisiert, `:443` entfernt, sonst Port exakt). Abgelehnt werden `@` außerhalb `@sha256:<64 hex>`, `//`, `..`, `%2F`, `\`, Großbuchstaben im Pfad, Nicht-ASCII-Hosts, Hosts mit Punkt am Ende, Userinfo (Pflicht-Test A1, über 80 Fälle). Punycode-Image-Host nur bei identischem Punycode-Vault-Host. `onBase`: Origin-Gleichheit plus höchstens 2048 Zeichen. |
| Main prüft vor `shell.openExternal` erneut auf https | erfüllt | `webLinkHref(…)` (nur http/https, keine Userinfo, ≤ 2048) und `href.startsWith('https://')`, sonst `kubernetes.linkRefused` (Spec 3.6). `app:open-external` wird für diese Links nicht benutzt. Ohne Unit-Test (V9). |
| Tracking-Annotation und Label nur im Pfad, korrekt kodiert | erfüllt | Nur nach `ARGO_APP` (`[a-z0-9._-]`, Unterstrich nur als Trenner). Diese Zeichen sind im URL-Pfad unreserviert, also ohne Kodierung sicher. Nur ein Segment `name` bzw. `namespace/name`; `..` und `.` sind durch das Muster ausgeschlossen. Harbor: Projekt nach OCI-Muster, Repository mit `encodeURIComponent`, Digest nach Muster. Kopierte Annotation zählt nicht (K1). |
| Vault-Normalisierung und Validator | erfüllt mit K2 | Formular speichert `httpsBase(…)`. Schema prüft Gültigkeit; der Vault bleibt auch nach einem Parser-Update lesbar. Alte Vaults ohne Felder bleiben gültig (Pflicht-Test V). Ältere Versionen streifen die Felder beim Speichern ab (Spec Risiko 6). |
| Self-Heal-Lesen: fail-open, nicht blockierend, Zeitlimit, Abbruch | erfüllt | Jeder Fehler, 403, 404, keine Verbindung, ungültiger Name und 5 s → `null` → „möglicherweise“ (Pflicht-Test H). Renderer: `readArgo`-Fehler → `null`. Der Bestätigen-Knopf hängt nicht an `argo`. Die Namenseingabe bei Produktion bleibt. Beim Schließen wird das Ergebnis verworfen, der Timer in Main gelöscht (V3). Gesperrter Vault oder deaktivierter Cluster → Fehler → im Dialog „möglicherweise“. |
| Bestätigungspfad unverändert | erfüllt | `ClusterView.confirm` bleibt der einzige Weg zu `setPending`. Neu ist nur das Feld `argoApp`. `actionReason` greift vorher (Nur lesen, RBAC, Verbindung). Ein Link löst keine Cluster-Aktion aus. |
| „Nur lesen“ im Main | unverändert | `runAction`/`readOnly` nicht berührt. `readArgoApp` ist lesend und auf Nur-lesen-Clustern ohne Dialog ohnehin unerreichbar (`confirm` bricht vorher ab). |
| Keine Exec ohne Klick | erfüllt | `shell.openExternal` nur aus dem IPC-Handler; der Renderer ruft ihn nur in `runMenuAction` (`case 'link'`), also nach Klick oder Enter im Menü. Kein automatisches Öffnen. |
| kubeconfig und Secrets verlassen den Main nie | erfüllt | Neu an den Renderer gehen nur `argoUrl`/`harborUrl` aus dem Vault, `argoApp`, `digests` und `KubeArgoState` (Enum-Werte). Die Application bleibt im Main (V13). Annotationen gehen nicht an den Renderer und nicht in `diagnose.ts`. |
| Treiber-Ersatz nur unter dem Treiber | erfüllt | Ersatz per `app.evaluate` in `driver.mjs` (Playwright), mit `SHELLHERD_RUN_REAL_BROWSER=1` abschaltbar. Kein Code in `src/`, nichts im gebauten Paket. Mit echtem Electron geprüft (siehe oben). |
| README-Datenschutzzusage | wahr mit K7 | Das Lesen der Application geht an den konfigurierten Kubernetes-API-Server (gedeckt durch „go only to the hosts you configured“). Links öffnet der Browser nach Klick. K7 sagt das ausdrücklich. |

Nicht geschlossen und benannt: Harbor-Route mit Projektnamen (Spec Risiko 9.1, V6), Applications außerhalb `argocd` (Risiko 9.2).

## 6. Wellen und Tasks (endgültig, exklusive Dateien)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein (belegt: Welle 1 mit 177 Dateien und 2 845 Tests, Welle 2 mit 177 Dateien und 2 857 Tests). Umsetzer schreiben nur ihre eigenen Dateien und committen nie. Bei einem roten Wellenende behebt der Task, dem die Datei gehört.

| Welle | Task | Dateien (exklusiv) | Inhalt |
|---|---|---|---|
| 1 | **A** Vertrag | `src/shared/kube-links.ts` (neu), `src/shared/kube-links.test.ts` (neu), `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Spec 3.1 mit K1, 3.2; Tests K5 A1, A2 |
| 1 | **V** Vault | `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts` | Spec 3.3 mit K2; Test K5 V |
| 1 | **B** Client | `src/main/kubernetes/api.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/kubernetes/overview.test.ts`, `src/main/kubernetes/watch.test.ts`, `src/main/kubernetes/workload-logs.test.ts`, `src/main/kubernetes/diagnose.test.ts` | Spec 3.4; Test K5 B |
| 1 | **R** Zeilen | `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts` | Spec 3.5; Test K5 R |
| 1 | **H** Main | `src/main/kubernetes/argo.ts` (neu), `src/main/kubernetes/argo.test.ts` (neu), `src/main/kubernetes/session.ts`, `src/main/kubernetes/session.test.ts`, `src/main/kubernetes/ipc.ts`, `src/shared/locales/de-DE/errors/kubernetes.json`, `src/shared/locales/en-US/errors/kubernetes.json` | Spec 3.6; K4a; Tests K5 H1, H2 |
| 1 | **F** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` | Spec 3.11, 5 mit K7 |
| 2 | **C** Formular | `src/renderer/src/connection-form.ts`, `src/renderer/src/connection-form.test.ts`, `src/renderer/src/components/ClusterForm.tsx`, `src/shared/locales/de-DE/connection.json`, `src/shared/locales/en-US/connection.json` | Spec 3.7; K4b; Test K5 C |
| 2 | **M** Menüs und Dialogtexte | `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts`, `src/renderer/src/kube-menu-run.ts`, `src/renderer/src/kube-menu-run.test.ts`, `src/renderer/src/confirm-action.ts`, `src/renderer/src/confirm-action.test.ts`, `src/shared/locales/de-DE/kubeActions.json`, `src/shared/locales/en-US/kubeActions.json` | Spec 3.8 mit K3, K6; K4c, K4d; Tests K5 M1, M2 |
| 2 | **D** Dialog und Ansicht | `src/renderer/src/components/kubernetes/ConfirmAction.tsx`, `src/renderer/src/components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css` | Spec 3.9 |
| 2 | **G** Fakes und Treiber | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/kube-fixtures.mjs`, `.claude/skills/run-app/fakes.test.mjs`, `.claude/skills/run-app/driver.mjs` | Spec 3.10; Test K5 G |
| 3 | **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6 mit K8 |

Hinweise:
- **Locale-Dateien:** `errors/kubernetes.json` gehört nur H (Codes in `session.ts`/`ipc.ts` derselben Welle). `kubeActions.json` gehört nur M (Menü-Keys und `confirm.argo.*`, beide von M benutzt). `connection.json` gehört nur C. D ändert keine Locale-Datei (`kubernetes:viewNotOpen` existiert). So meldet der Katalogtest in keiner Welle verwaiste Keys (belegt).
- **JSON-Stellen:** C legt `cluster.links` direkt nach `cluster.readOnlyHint` an und `linkUrl` als letzten Key in `cluster.validation`. M hängt die drei `reasons`-Keys ans Ende von `reasons`, die zwei `menu`-Keys ans Ende von `menu` und `argo` als letzten Key in `confirm`. Zwei Leerzeichen Einzug, Dateiende mit Zeilenumbruch.
- **Abhängigkeiten in der Welle:** V, R und H nutzen A; H nutzt B (`readArgoApp`) und V (`argoUrl` am Typ). D nutzt M (`argoNoteFor`, `argoNoteText`, `MenuRunner.openLink`) und A (`KubeLink`, `KubeArgoState`). G nutzt R (`toRow`), H (`argoStateOf`) und A (`harborImageUrl`); `fakes.test.mjs` läuft in `vitest run` mit (nur unter Windows mit openssl).
- **F in Welle 1:** `version.test.ts` prüft Version und beide CHANGELOGs gemeinsam.
- Nach Welle 3: Szene `kube-links` mit run-app (gebauter Stand, `drive:sshd` neu gestartet, K8), danach die manuellen Tests aus Spec 11.

## 7. Nicht geprüft

- Die Szene `kube-links` (Spec 6 mit K8) lief nicht in der echten App. Geprüft sind ihre Annahmen gegen den Code: Selektoren, Texte, Knopfzustand nach dem Speichern, `RUN_DIR/kube/kube-requests.log`, `/main`-Route und der `shell`-Ersatz in Electron. Dazu `node --check`.
- `ClusterForm`, `ConfirmAction` und `ClusterView` sind nur kompiliert, nicht gerendert (keine Komponententests im Projekt).
- Ob echte Harbor-Versionen `projects/<name>` in der UI-Route annehmen und wie sie verschachtelte Repositorys (`team%2Fapi`) erwarten (Spec Risiko 9.1, manueller Test 6).
- Ob Argo CD `/applications/<name>` ohne Namespace bei Apps in beliebigen Namespaces überall auflöst (Spec R2.4, manueller Test 2).
- Die Doku-Texte (Spec 5 mit K7) sind nicht gegen die fertige UI gelesen.
