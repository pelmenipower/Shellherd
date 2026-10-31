/** Pure merge adapter used by the explicitly enabled development sync; never starts sessions. */
import { createHash } from 'node:crypto';
import { VaultSchema } from '../../shared/vault/schema';
import { validateVaultConsistency } from '../../shared/vault/consistency';
import type { Vault, WorkspaceLayout } from '../../shared/vault/types';

type Json = null | boolean | number | string | Json[] | ObjectValue;
interface ObjectValue { [key: string]: Json }
export interface PortableVault {
  format: 'shellherd-sync-vault';
  version: 1;
  document: ObjectValue;
}
interface Binding { guard: string; fields: ObjectValue }
export interface DeviceBindings {
  version: 1;
  vaultId: string;
  nodes: Record<string, Binding>;
  workspaceWindows: Record<string, Binding>;
  toolbar?: Binding;
  retiredData?: Binding;
  ai?: Binding;
  sessionPolicy: ObjectValue;
}
export interface VaultMergeConflict {
  scope: 'node' | 'metadata' | 'order' | 'workspace' | 'vault' | 'structure' | 'references';
  id: string;
  field?: string;
}
export interface VaultMergeResult {
  portable: PortableVault | null;
  conflicts: VaultMergeConflict[];
  /** Full alternatives: keep encrypted with their authenticated snapshot ancestry. */
  variants: { base: PortableVault; left: PortableVault; right: PortableVault };
}

const MAX_BYTES = 512 * 1024;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
function object(value: Json | undefined): ObjectValue {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Sync object required'); return value;
}
function list(value: Json | undefined): Json[] { requireValue(Array.isArray(value), 'Sync array required'); return value; }
function text(value: Json | undefined): string { requireValue(typeof value === 'string', 'Sync string required'); return value; }
function dictionary<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }

/** Bound depth/size before Zod or recursive equality; refuse getters and non-JSON data. */
function json(input: unknown): Json {
  let count = 0; let budget = 0; const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    requireValue(++count <= 20_000 && depth <= 48, 'Sync complexity limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { requireValue(Number.isFinite(value), 'Sync finite number required'); return value; }
    if (typeof value === 'string') { budget += Buffer.byteLength(value); requireValue(budget <= MAX_BYTES, 'Sync size limit'); return value; }
    requireValue(typeof value === 'object' && value !== null && !ancestors.has(value), 'Sync JSON data required');
    requireValue(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Sync plain object required');
    ancestors.add(value);
    let result: Json;
    if (Array.isArray(value)) {
      requireValue(value.length <= 20_000, 'Sync array limit');
      result = Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        requireValue(descriptor && 'value' in descriptor, 'Sync sparse/accessor array refused');
        return visit(descriptor.value, depth + 1);
      });
    } else {
      const output = dictionary<Json>();
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        requireValue(!forbidden.has(key) && 'value' in descriptor, 'Sync unsafe property');
        budget += Buffer.byteLength(key); requireValue(budget <= MAX_BYTES, 'Sync size limit');
        if (descriptor.value !== undefined) output[key] = visit(descriptor.value, depth + 1);
      }
      result = output;
    }
    ancestors.delete(value); return result;
  }
  const result = visit(input, 0);
  requireValue(Buffer.byteLength(JSON.stringify(result)) <= MAX_BYTES, 'Sync size limit'); return result;
}
function canonical(value: Json | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const equal = (a: Json | undefined, b: Json | undefined) => canonical(a) === canonical(b);
const copy = <T>(value: T): T => structuredClone(value);
const guard = (value: Json) => createHash('sha256').update(canonical(value)).digest('hex');
const metadata = new Set(['name', 'comment', 'tags', 'color', 'icon']);
interface FlatNode { parent: string | null; data: ObjectValue }
function flatten(document: ObjectValue): { nodes: Map<string, FlatNode>; orders: Map<string | null, string[]> } {
  const nodes = new Map<string, FlatNode>(); const orders = new Map<string | null, string[]>();
  function walk(items: Json[], parent: string | null, depth: number) {
    requireValue(depth <= 24 && nodes.size + items.length <= 1000, 'Sync node limit');
    orders.set(parent, items.map(n => text(object(n).id)));
    for (const value of items) {
      const node = object(value); const id = text(node.id);
      requireValue(id.length > 0 && id.length <= 256 && !forbidden.has(id) && !nodes.has(id), 'Sync duplicate/invalid node ID');
      const data = copy(node); delete data.children; nodes.set(id, { parent, data });
      if (node.type === 'folder') walk(list(node.children), id, depth + 1);
    }
  }
  walk(list(document.nodes), null, 0); return { nodes, orders };
}

function validateReferences(vault: Vault): void {
  requireValue(validateVaultConsistency(vault).length === 0, 'Sync vault references');
  const flat = flatten(object(json(vault))); const connections = new Map([...flat.nodes].filter(([, n]) => n.data.type === 'connection'));
  for (const [id, node] of connections) {
    if (node.data.jumpHost !== undefined) {
      const target = connections.get(text(node.data.jumpHost));
      requireValue(target && target.data.protocol === 'ssh' && target.data.jumpHost === undefined && target.data.id !== id, 'Sync jump-host reference');
    }
    if (node.data.protocol === 'kubernetes') for (const target of list(node.data.accessHosts)) requireValue(connections.get(text(target))?.data.protocol === 'ssh', 'Sync cluster access reference');
  }
  const workspaces = new Set<string>();
  const layoutReferences = (layout: WorkspaceLayout): void => {
    if (layout.type === 'split') { layoutReferences(layout.first); layoutReferences(layout.second); return; }
    const indices = [...layout.fileBrowsers ?? [], ...(layout.containerViews ?? []).map(v => typeof v === 'number' ? v : v.index), ...(layout.containerTabs ?? []).map(v => v.index), ...(layout.kubeTabs ?? []).map(v => v.index)];
    requireValue(indices.every(i => i < layout.connectionIds.length), 'Sync workspace index reference');
    for (const tab of layout.kubeTabs ?? []) requireValue(connections.get(layout.connectionIds[tab.index])?.data.protocol === 'kubernetes', 'Sync workspace cluster reference');
  };
  for (const workspace of vault.workspaces) {
    requireValue(!workspaces.has(workspace.id) && !forbidden.has(workspace.id), 'Sync workspace ID'); workspaces.add(workspace.id);
    layoutReferences(workspace.layout);
    for (const view of workspace.views ?? []) layoutReferences(view.layout);
    for (const window of workspace.windows ?? []) {
      layoutReferences(window.layout); for (const view of window.views ?? []) layoutReferences(view.layout);
    }
  }
  if (vault.ai?.defaultProviderId !== undefined) requireValue(vault.ai.providers.some(p => p.id === vault.ai!.defaultProviderId), 'Sync AI provider reference');
  requireValue(new Set(vault.ai?.providers.map(p => p.id)).size === (vault.ai?.providers.length ?? 0), 'Sync provider IDs');
  for (const item of vault.toolbar?.items ?? []) if (item.connectionId !== undefined) requireValue(connections.has(item.connectionId), 'Sync toolbar reference');
}
function checkedVault(input: unknown): ObjectValue {
  const raw = object(json(input)); const parsed = VaultSchema.safeParse(raw);
  requireValue(parsed.success, 'Unsupported sync vault schema');
  const normalized = object(json(parsed.data));
  // Existing local readers tolerate unknown properties. Sync must not silently discard them.
  requireValue(equal(raw, normalized), 'Unsupported or normalized sync fields');
  validateReferences(parsed.data); return normalized;
}
function core(data: ObjectValue): ObjectValue {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !metadata.has(key))) as ObjectValue;
}
function nodeGuard(node: FlatNode): string { return guard([node.parent, core(node.data)]); }

function splitDocument(source: ObjectValue): { portable: PortableVault; local: DeviceBindings } {
  const document = copy(source);
  const local: DeviceBindings = { version: 1, vaultId: text(source.id), nodes: dictionary<Binding>(), workspaceWindows: dictionary<Binding>(), sessionPolicy: {} };
  const settings = object(document.settings);
  for (const key of ['autoLockMinutes', 'confirmBeforeClosingSession', 'timeouts']) {
    if (settings[key] !== undefined) local.sessionPolicy[key] = settings[key];
  }
  settings.autoLockMinutes = 15; settings.confirmBeforeClosingSession = true; delete settings.timeouts;
  function strip(items: Json[]) {
    for (const value of items) {
      const node = object(value);
      if (node.type === 'folder') { strip(list(node.children)); continue; }
      const fields: ObjectValue = {};
      for (const field of ['workingDirectory', 'autoUpload', 'login', 'forwards', 'containers', 'disabled']) {
        if (node[field] !== undefined) { fields[field] = node[field]; delete node[field]; }
      }
      if ((node.protocol === 'ssh' || node.protocol === 'sftp') && object(node.authentication).method === 'privateKey') {
        const auth = object(node.authentication); fields.keyPath = auth.keyPath;
        if (auth.passphrase !== undefined) fields.passphrase = auth.passphrase;
        delete auth.keyPath; delete auth.passphrase;
      }
      if (node.protocol === 'kubernetes' && object(node.kubeconfig).source === 'path') {
        const config = object(node.kubeconfig); fields.kubeconfigPath = config.path; delete config.path;
      }
      if (node.protocol === 'rdp') {
        fields.clipboard = object(node.rdp).clipboard; object(node.rdp).clipboard = false;
      }
      local.nodes[text(node.id)] = { guard: '', fields };
    }
  }
  strip(list(document.nodes));
  for (const value of list(document.workspaces)) {
    const workspace = object(value);
    if (workspace.windows !== undefined) { local.workspaceWindows[text(workspace.id)] = { guard: '', fields: { windows: workspace.windows } }; delete workspace.windows; }
  }
  if (document.toolbar !== undefined) { local.toolbar = { guard: '', fields: { toolbar: document.toolbar } }; delete document.toolbar; }
  if (document.workflows !== undefined) { local.retiredData = { guard: '', fields: { workflows: document.workflows } }; delete document.workflows; }
  if (document.ai !== undefined) local.ai = { guard: guard(document.ai), fields: {} };
  const flat = flatten(document);
  for (const [id, node] of flat.nodes) if (node.data.type === 'connection') local.nodes[id].guard = nodeGuard(node);
  const documentGuard = guard(document);
  for (const binding of Object.values(local.workspaceWindows)) binding.guard = documentGuard;
  if (local.toolbar) local.toolbar.guard = documentGuard;
  if (local.retiredData) local.retiredData.guard = documentGuard;
  return { portable: { format: 'shellherd-sync-vault', version: 1, document }, local };
}

export function splitVaultForSync(input: unknown): { portable: PortableVault; local: DeviceBindings } {
  const result = splitDocument(checkedVault(input)); json(result.portable); return result;
}
/** Probe placeholders are used only for schema validation and never returned. */
export function validatePortableVault(input: unknown): PortableVault {
  const raw = object(json(input));
  requireValue(raw.format === 'shellherd-sync-vault' && raw.version === 1 && Object.keys(raw).length === 3, 'Unsupported portable vault');
  const document = object(raw.document); flatten(document);
  const probe = copy(document);
  function hydrate(items: Json[]) {
    for (const value of items) {
      const node = object(value);
      if (node.type === 'folder') { hydrate(list(node.children)); continue; }
      if ((node.protocol === 'ssh' || node.protocol === 'sftp') && object(node.authentication).method === 'privateKey') object(node.authentication).keyPath = '/sync-schema-probe-only';
      if (node.protocol === 'kubernetes' && object(node.kubeconfig).source === 'path') object(node.kubeconfig).path = '/sync-schema-probe-only';
    }
  }
  hydrate(list(probe.nodes));
  const expected = splitDocument(checkedVault(probe)).portable;
  requireValue(equal(expected.document, document), 'Device fields refused in portable vault');
  return { format: 'shellherd-sync-vault', version: 1, document: copy(document) };
}

export function materializeVault(input: unknown, local?: DeviceBindings): { vault: Vault | null; needsBindings: string[]; needsApproval: string[]; localActionsHeld: boolean } {
  const { document } = validatePortableVault(input); const flat = flatten(document);
  requireValue(local === undefined || (local.version === 1 && local.vaultId === document.id), 'Local binding vault mismatch');
  const needsBindings: string[] = []; const needsApproval: string[] = [];
  const restored = copy(document); const documentGuard = guard(document);
  if (local) {
    const policy = object(json(local.sessionPolicy));
    for (const key of ['autoLockMinutes', 'confirmBeforeClosingSession', 'timeouts']) if (policy[key] !== undefined) object(restored.settings)[key] = policy[key];
  }
  if (document.ai !== undefined && local?.ai?.guard !== guard(document.ai)) { delete restored.ai; needsApproval.push('ai'); }
  let localActionsHeld = false;
  function hydrate(items: Json[]) {
    for (const value of items) {
      const node = object(value); const id = text(node.id);
      if (node.type === 'folder') { hydrate(list(node.children)); continue; }
      const binding = local?.nodes[id]; const trusted = binding?.guard === nodeGuard(flat.nodes.get(id)!);
      const fields = trusted ? object(json(binding.fields)) : {};
      node.disabled = trusted ? fields.disabled ?? false : true;
      if (!trusted) needsApproval.push(id);
      for (const key of ['workingDirectory', 'autoUpload', 'login', 'forwards', 'containers']) if (fields[key] !== undefined) node[key] = fields[key];
      if ((node.protocol === 'ssh' || node.protocol === 'sftp') && object(node.authentication).method === 'privateKey') {
        if (typeof fields.keyPath !== 'string' || !fields.keyPath) needsBindings.push(id);
        else { object(node.authentication).keyPath = fields.keyPath; if (fields.passphrase !== undefined) object(node.authentication).passphrase = fields.passphrase; }
      }
      if (node.protocol === 'kubernetes' && object(node.kubeconfig).source === 'path') {
        if (typeof fields.kubeconfigPath !== 'string' || !fields.kubeconfigPath) needsBindings.push(id);
        else object(node.kubeconfig).path = fields.kubeconfigPath;
      }
      if (node.protocol === 'rdp') object(node.rdp).clipboard = fields.clipboard ?? false;
    }
  }
  hydrate(list(restored.nodes));
  for (const value of list(restored.workspaces)) {
    const workspace = object(value); const binding = local?.workspaceWindows[text(workspace.id)];
    if (binding?.guard === documentGuard) workspace.windows = copy(binding.fields.windows);
    else if (binding) localActionsHeld = true;
  }
  if (local?.toolbar?.guard === documentGuard) restored.toolbar = copy(local.toolbar.fields.toolbar);
  else if (local?.toolbar) localActionsHeld = true;
  if (local?.retiredData) restored.workflows = copy(local.retiredData.fields.workflows);
  if (needsBindings.length) return { vault: null, needsBindings, needsApproval, localActionsHeld };
  const checked = checkedVault(restored);
  return { vault: VaultSchema.parse(checked), needsBindings, needsApproval, localActionsHeld };
}

export function mergePortableVaults(baseInput: unknown, leftInput: unknown, rightInput: unknown): VaultMergeResult {
  const base = validatePortableVault(baseInput); const left = validatePortableVault(leftInput); const right = validatePortableVault(rightInput);
  requireValue([left, right].every(v => v.document.id === base.document.id && v.document.createdAt === base.document.createdAt), 'Sync vault identity mismatch');
  const variants = { base, left, right }; const conflicts: VaultMergeConflict[] = [];
  const pick = (b: Json | undefined, l: Json | undefined, r: Json | undefined, conflict: VaultMergeConflict): Json | undefined => {
    if (equal(l, r)) return copy(l);
    if (equal(b, l)) return copy(r);
    if (equal(b, r)) return copy(l);
    conflicts.push(conflict); return undefined;
  };
  const [bf, lf, rf] = [base, left, right].map(v => flatten(v.document));
  const merged = new Map<string, FlatNode>();
  for (const id of new Set([...bf.nodes.keys(), ...lf.nodes.keys(), ...rf.nodes.keys()])) {
    const b = bf.nodes.get(id); const l = lf.nodes.get(id); const r = rf.nodes.get(id);
    if (!b && l && r) { conflicts.push({ scope: 'node', id, field: 'id-collision' }); continue; }
    if (!b || !l || !r) {
      const toJson = (n: FlatNode | undefined): Json | undefined => n ? { parent: n.parent, data: n.data } : undefined;
      const selected = pick(toJson(b), toJson(l), toJson(r), { scope: 'node', id, field: 'delete-edit' });
      if (selected) merged.set(id, selected as unknown as FlatNode);
      continue;
    }
    const selected = pick({ parent: b.parent, data: core(b.data) }, { parent: l.parent, data: core(l.data) }, { parent: r.parent, data: core(r.data) }, { scope: 'node', id, field: 'configuration-or-move' });
    if (!selected) continue;
    const record = selected as unknown as FlatNode;
    for (const key of metadata) {
      const value = pick(b.data[key], l.data[key], r.data[key], { scope: 'metadata', id, field: key });
      if (value !== undefined) record.data[key] = value;
    }
    merged.set(id, record);
  }
  const document = copy(base.document);
  for (const field of new Set(Object.keys(base.document).concat(Object.keys(left.document), Object.keys(right.document)))) {
    if (['nodes', 'workspaces', 'id', 'format', 'version', 'createdAt', 'updatedAt'].includes(field)) continue;
    if (Object.hasOwn(document, field)) delete document[field];
    const value = pick(base.document[field], left.document[field], right.document[field], { scope: 'vault', id: text(base.document.id), field });
    if (value !== undefined) document[field] = value;
  }
  const workspaces = [base, left, right].map(v => new Map(list(v.document.workspaces).map(w => [text(object(w).id), w])));
  const ws = new Map<string, Json>();
  for (const id of new Set(workspaces.flatMap(w => [...w.keys()]))) {
    const [b, l, r] = workspaces.map(w => w.get(id));
    if (!b && l && r) { conflicts.push({ scope: 'workspace', id, field: 'id-collision' }); continue; }
    const value = pick(b, l, r, { scope: 'workspace', id }); if (value !== undefined) ws.set(id, value);
  }
  // Keep deliberate unilateral ordering. Concurrent additions/moves append by stable ID.
  function order(b: string[], l: string[], r: string[], final: string[], id: string): string[] {
    const relevant = new Set(final);
    const filter = (items: string[]) => items.filter(x => relevant.has(x));
    b = filter(b); l = filter(l); r = filter(r);
    if (equal(l, r)) return [...l, ...final.filter(x => !l.includes(x)).sort()];
    if (equal(b, l)) return [...r, ...final.filter(x => !r.includes(x)).sort()];
    if (equal(b, r)) return [...l, ...final.filter(x => !l.includes(x)).sort()];
    const common = new Set(b.filter(x => l.includes(x) && r.includes(x)));
    const kept = pick(b.filter(x => common.has(x)), l.filter(x => common.has(x)), r.filter(x => common.has(x)), { scope: 'order', id });
    const first = (kept ?? []) as string[]; return [...first, ...final.filter(x => !first.includes(x)).sort()];
  }
  document.workspaces = order(...[base, left, right].map(v => list(v.document.workspaces).map(w => text(object(w).id))) as [string[], string[], string[]], [...ws.keys()], 'workspaces').map(id => ws.get(id)!);
  const seen = new Set<string>(); const visiting = new Set<string>();
  function children(parent: string | null, depth: number): Json[] {
    requireValue(depth <= 24, 'Sync merged tree depth');
    const ids = [...merged].filter(([, node]) => node.parent === parent).map(([id]) => id);
    return order(bf.orders.get(parent) ?? [], lf.orders.get(parent) ?? [], rf.orders.get(parent) ?? [], ids, parent ?? 'root').map(id => {
      requireValue(!visiting.has(id), 'Sync merged tree cycle'); visiting.add(id); seen.add(id);
      const node = copy(merged.get(id)!.data);
      if (node.type === 'folder') node.children = children(id, depth + 1);
      visiting.delete(id); return node;
    });
  }
  if (conflicts.length) return { portable: null, conflicts, variants };
  try {
    document.nodes = children(null, 0);
    requireValue(seen.size === merged.size, 'Sync orphan or cycle');
  } catch { conflicts.push({ scope: 'structure', id: text(document.id) }); }
  if (conflicts.length) return { portable: null, conflicts, variants };
  try { validatePortableVault({ format: 'shellherd-sync-vault', version: 1, document }); }
  catch { conflicts.push({ scope: 'references', id: text(document.id) }); }
  return { portable: conflicts.length ? null : { format: 'shellherd-sync-vault', version: 1, document }, conflicts, variants };
}

/** Explicit whole-configuration choices only; unsupported conflict kinds stay blocked. */
export function resolveVaultConfigurationConflicts(base: unknown, left: unknown, right: unknown,
  choices: { id: string; side: 'left' | 'right' }[]): PortableVault {
  const result = mergePortableVaults(base, left, right);
  requireValue(result.conflicts.every(c => c.scope === 'node' && c.field === 'configuration-or-move'), 'Unsupported conflict resolution');
  const wanted = new Set(result.conflicts.map(c => c.id));
  requireValue(choices.length === wanted.size && new Set(choices.map(c => c.id)).size === choices.length
    && choices.every(c => wanted.has(c.id) && ['left', 'right'].includes(c.side)), 'Incomplete/unknown conflict choices');
  const l = copy(result.variants.left); const r = copy(result.variants.right);
  const bf = flatten(result.variants.base.document); const lf = flatten(l.document); const rf = flatten(r.document);
  function patch(items: Json[], id: string, selected: ObjectValue): void {
    for (const value of items) {
      const node = object(value);
      if (node.type === 'folder') patch(list(node.children), id, selected);
      else if (node.id === id) {
        for (const key of Object.keys(node)) if (!metadata.has(key)) delete node[key];
        Object.assign(node, copy(core(selected)));
      }
    }
  }
  for (const choice of choices) {
    const b = bf.nodes.get(choice.id); const a = lf.nodes.get(choice.id); const z = rf.nodes.get(choice.id);
    requireValue(b && a && z && a.data.type === 'connection' && z.data.type === 'connection'
      && a.parent === b.parent && z.parent === b.parent, 'Moved/deleted connection requires separate resolution');
    const selected = choice.side === 'left' ? a.data : z.data;
    patch(list(l.document.nodes), choice.id, selected); patch(list(r.document.nodes), choice.id, selected);
  }
  const resolved = mergePortableVaults(result.variants.base, l, r);
  requireValue(resolved.portable !== null, 'Resolution still conflicts'); return resolved.portable;
}
