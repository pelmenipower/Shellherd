import { describe, expect, it } from 'vitest';
import { BATCH_TOO_LARGE, describeFailure, parsePctList, parseProbe, parseQmList, SUDO_NOT_CACHED, SUDO_REJECTED } from './parsers';

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
  const code = (kind: Parameters<typeof describeFailure>[0], result: Parameters<typeof describeFailure>[1]) => describeFailure(kind, result).code;
  it('maps common problems to codes', () => {
    expect(code('docker', failed('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'))).toBe('containers.noPermissionDocker');
    expect(code('docker', failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'))).toBe('containers.dockerNotRunning');
    expect(code('proxmox', failed('sudo: a password is required'))).toBe('containers.sudoPasswordMissing');
    expect(code('proxmox', failed('', 127))).toBe('containers.proxmoxNeedsRoot');
    expect(code('docker', { code: null, stdout: '', stderr: '', timedOut: true })).toBe('containers.hostTimeout');
  });
  it('falls back to the last stderr line or the exit code', () => {
    expect(describeFailure('podman', failed('line one\nError: something odd\n'))).toEqual({ code: 'containers.remoteOutput', params: { line: 'Error: something odd' } });
    expect(describeFailure('podman', failed('', 2))).toEqual({ code: 'containers.commandFailed', params: { code: 2 } });
    expect(describeFailure('podman', failed('x'.repeat(300))).params).toEqual({ line: 'x'.repeat(200) });
  });
  it('turns the output limit sentinel into its code', () => {
    expect(describeFailure('docker', { code: null, stdout: '', stderr: BATCH_TOO_LARGE })).toEqual({ code: 'containers.outputTooLarge' });
  });
  it('does not mistake rootfs or /root paths for a missing root login', () => {
    expect(describeFailure('proxmox', failed('mount failed\nunable to mount rootfs of CT 101'))).toEqual({ code: 'containers.remoteOutput', params: { line: 'unable to mount rootfs of CT 101' } });
    expect(describeFailure('proxmox', failed('cannot open /root/x'))).toEqual({ code: 'containers.remoteOutput', params: { line: 'cannot open /root/x' } });
    expect(code('proxmox', failed('only root can run this command'))).toBe('containers.proxmoxNeedsRoot');
    expect(code('proxmox', failed('permission denied'))).toBe('containers.proxmoxNeedsRoot');
  });
  it('explains sudo password problems without naming a runtime', () => {
    expect(code('docker', failed('sudo: a password is required'))).toBe('containers.sudoPasswordMissing');
    expect(code('podman', failed('sudo: a terminal is required to read the password'))).toBe('containers.sudoPasswordMissing');
    expect(describeFailure('proxmox', { code: null, stdout: '', stderr: '', sudoRejected: true })).toEqual({ code: SUDO_REJECTED });
    expect(describeFailure('docker', { code: null, stdout: '', stderr: 'Sorry, try again.', sudoRejected: true })).toEqual({ code: SUDO_REJECTED });
    expect(code('docker', { code: null, stdout: '', stderr: '', timedOut: true, sudoNoPrompt: true })).toBe('containers.sudoNoPrompt');
    expect(code('docker', { code: null, stdout: '', stderr: '', sudoBusy: true })).toBe('containers.sudoBusy');
    expect(describeFailure('proxmox', { code: 1, stdout: '', stderr: 'sudo: a password is required\n', sudoReady: true })).toEqual({ code: SUDO_NOT_CACHED });
  });
  it('does not send Podman users to the docker group', () => {
    expect(code('podman', failed('Error: permission denied on /run/podman/podman.sock'))).toBe('containers.noPermissionPodman');
  });
});
