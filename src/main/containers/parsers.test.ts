import { describe, expect, it } from 'vitest';
import { describeFailure, parsePctList, parseProbe, parseQmList } from './parsers';

const pct = `VMID       Status     Lock         Name
101        running                 ct-web
102        stopped    backup       ct-db
`;

const qm = `      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
       100 win11                running    8192              64.00 12345
       103 debian-test          stopped    2048              32.00 0
       104 VM 104               running    2048              32.00 1234
`;

describe('container parsers', () => {
  it('reads the probe markers', () => {
    expect([...parseProbe('has:docker\nhas:pct\nnoise\n')]).toEqual(['docker', 'pct']);
  });
  it('parses pct list including the lock column', () => {
    expect(parsePctList(pct)).toEqual([
      { kind: 'lxc', vmid: 101, name: 'ct-web', state: 'running' },
      { kind: 'lxc', vmid: 102, name: 'ct-db', state: 'stopped' },
    ]);
  });
  it('parses qm list', () => {
    expect(parseQmList(qm)).toEqual([
      { kind: 'vm', vmid: 100, name: 'win11', state: 'running' },
      { kind: 'vm', vmid: 103, name: 'debian-test', state: 'stopped' },
      { kind: 'vm', vmid: 104, name: 'VM 104', state: 'running' },
    ]);
  });
});

describe('describeFailure', () => {
  const failed = (stderr: string, code = 1) => ({ code, stdout: '', stderr });
  it('explains common problems in German', () => {
    expect(describeFailure('docker', failed('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'))).toContain('Gruppe docker');
    expect(describeFailure('docker', failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'))).toBe('Der Docker-Dienst läuft nicht.');
    expect(describeFailure('proxmox', failed('sudo: a password is required'))).toContain('NOPASSWD');
    expect(describeFailure('proxmox', failed('', 127))).toContain('root');
    expect(describeFailure('docker', { code: null, stdout: '', stderr: '', timedOut: true })).toBe('Der Host hat nicht rechtzeitig geantwortet.');
  });
  it('falls back to the last stderr line or the exit code', () => {
    expect(describeFailure('podman', failed('line one\nError: something odd\n'))).toBe('Error: something odd');
    expect(describeFailure('podman', failed('', 2))).toBe('Befehl fehlgeschlagen (Exit-Code 2).');
  });
  it('does not mistake rootfs or /root paths for a missing root login', () => {
    expect(describeFailure('proxmox', failed('mount failed\nunable to mount rootfs of CT 101'))).toBe('unable to mount rootfs of CT 101');
    expect(describeFailure('proxmox', failed('cannot open /root/x'))).toBe('cannot open /root/x');
    expect(describeFailure('proxmox', failed('only root can run this command'))).toContain('brauchen root');
    expect(describeFailure('proxmox', failed('permission denied'))).toContain('brauchen root');
  });
  it('explains sudo password problems without naming a runtime', () => {
    const missing = 'sudo verlangt ein Passwort, für diese Verbindung ist keins hinterlegt. Richte NOPASSWD ein oder melde dich per Passwort an.';
    expect(describeFailure('docker', failed('sudo: a password is required'))).toBe(missing);
    expect(describeFailure('podman', failed('sudo: a terminal is required to read the password'))).toBe(missing);
    expect(describeFailure('proxmox', { code: null, stdout: '', stderr: '', sudoRejected: true })).toBe('Das sudo-Passwort wurde abgelehnt.');
    expect(describeFailure('docker', { code: null, stdout: '', stderr: 'Sorry, try again.', sudoRejected: true })).toBe('Das sudo-Passwort wurde abgelehnt.');
    expect(describeFailure('docker', { code: null, stdout: '', stderr: '', timedOut: true, sudoNoPrompt: true })).toBe('sudo hat nicht wie erwartet nach dem Passwort gefragt.');
    expect(describeFailure('docker', { code: null, stdout: '', stderr: '', sudoBusy: true }))
      .toBe('Ein anderer Tab meldet sich gerade per sudo an. Bitte später erneut versuchen.');
    expect(describeFailure('proxmox', { code: 1, stdout: '', stderr: 'sudo: a password is required\n', sudoReady: true }))
      .toBe('sudo speichert die Anmeldung nicht zwischen (timestamp_timeout=0). Richte NOPASSWD ein.');
  });
  it('does not send Podman users to the docker group', () => {
    expect(describeFailure('podman', failed('Error: permission denied on /run/podman/podman.sock'))).toBe('Keine Berechtigung für Podman. sudo aktivieren oder Podman rootless einrichten.');
  });
});
