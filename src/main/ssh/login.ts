import { remoteCommand, shellJoin, SUDO_MARKER } from '../containers/commands';

/** password: the stored password answers the marker prompt once. manual: sudo -n, else sudo asks on the terminal and the user types. */
export type RootShellPlan =
  | { kind: 'password'; marker: string; ready: string }
  | { kind: 'manual'; ready: string; hint: string };

/** exec command that authenticates sudo, prints `ready` and then runs `sudo -n -i`; never contains the start commands. */
export function rootShellCommand(plan: RootShellPlan): string {
  if (plan.kind === 'password') return remoteCommand(['-i'], { kind: 'prompt', marker: plan.marker, ready: plan.ready, stdin: false });
  if (!SUDO_MARKER.test(plan.ready)) throw new Error('Invalid sudo marker');
  // `sudo -n true` follows the command rules; `sudo -n -v` would also demand NOPASSWD on every matching entry.
  // echo instead of printf '%s\n': no backslash in the string, so fish and tcsh login shells parse it like sh.
  const script = `{ sudo -n true 2>/dev/null || { echo ${shellJoin([plan.hint])}; sudo -v; }; } && printf %s ${shellJoin([plan.ready])} && sudo -n -i; exit $?`;
  return shellJoin(['sh', '-c', script]);
}

/** Start commands as typed lines; each ends with Enter (\r). */
export function loginInput(lines: readonly string[]): string {
  return lines.map(line => `${line}\r`).join('');
}
