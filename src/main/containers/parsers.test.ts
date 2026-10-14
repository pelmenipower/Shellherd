import { describe, expect, it } from 'vitest';
import { describeFailure, parseContainerList, parsePctList, parseProbe, parseQmList } from './parsers';

const dockerLines = [
  '{"Command":"\\"nginx\\"","ID":"3f2a1b","Image":"nginx:1.27","Names":"web-1","State":"running","Status":"Up 2 hours"}',
  '{"ID":"9c8d7e","Image":"postgres:16","Names":"db,db-alias","State":"exited","Status":"Exited (0)"}',
  '{"ID":"aa11bb","Image":"redis","Names":"cache","State":"paused","Status":"Up (Paused)"}',
].join('\n');

const podmanJson = JSON.stringify([
  { Id: 'f00dcafe', Image: 'docker.io/library/alpine:latest', Names: ['tools'], State: 'running' },
  { Id: 'beef1234', Image: 'quay.io/x/y', Names: ['weird name'], State: 'created' },
]);

const pct = `VMID       Status     Lock         Name
101        running                 ct-web
102        stopped    backup       ct-db
`;

const qm = `      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
       100 win11                running    8192              64.00 12345
       103 debian-test          stopped    2048              32.00 0
`;

describe('container parsers', () => {
  it('reads the probe markers', () => {
    expect([...parseProbe('has:docker\nhas:pct\nnoise\n')]).toEqual(['docker', 'pct']);
  });
  it('parses docker JSON lines', () => {
    expect(parseContainerList('docker', dockerLines)).toEqual([
      { kind: 'container', runtime: 'docker', id: '3f2a1b', ref: 'web-1', name: 'web-1', image: 'nginx:1.27', state: 'running' },
      { kind: 'container', runtime: 'docker', id: '9c8d7e', ref: 'db', name: 'db', image: 'postgres:16', state: 'stopped' },
      { kind: 'container', runtime: 'docker', id: 'aa11bb', ref: 'cache', name: 'cache', image: 'redis', state: 'paused' },
    ]);
  });
  it('parses the podman JSON array and falls back to the ID for unusual names', () => {
    expect(parseContainerList('podman', podmanJson)).toEqual([
      { kind: 'container', runtime: 'podman', id: 'f00dcafe', ref: 'tools', name: 'tools', image: 'docker.io/library/alpine:latest', state: 'running' },
      { kind: 'container', runtime: 'podman', id: 'beef1234', ref: 'beef1234', name: 'weird name', image: 'quay.io/x/y', state: 'stopped' },
    ]);
  });
  it('skips malformed lines and empty output', () => {
    expect(parseContainerList('docker', 'not json\n\n')).toEqual([]);
    expect(parseContainerList('podman', '')).toEqual([]);
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
});
