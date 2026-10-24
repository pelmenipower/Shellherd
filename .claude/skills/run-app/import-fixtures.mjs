// Synthetic import sources for the demo: OpenSSH config, PuTTY and WinSCP registry exports, mRemoteNG file.
// Only made-up hosts and names; the one Password attribute holds an obviously wrong value.
import fs from 'node:fs';
import path from 'node:path';

const PUTTY = String.raw`HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions`;
const WINSCP = String.raw`HKEY_CURRENT_USER\Software\Martin Prikryl\WinSCP 2\Sessions`;

const SSH_CONFIG = `# Synthetic demo data only
Host *
    User demo

Host web-01
    HostName 127.0.0.1
    Port 2222

Host build-01
    HostName 10.20.0.11
    IdentityFile ~/.ssh/id_ed25519

Host db-01
    ProxyJump build-01
    LocalForward 15433 db-internal:5432

Host legacy
    ProxyJump a,b

Host *.internal
    ServerAliveInterval 60
Include config.d/*

Match host x
    Port 2200
`;

const PUTTY_REG = String.raw`Windows Registry Editor Version 5.00

[${PUTTY}\Default%20Settings]
"Protocol"="ssh"

[${PUTTY}\router]
"Protocol"="telnet"
"HostName"="router.demo"
"PortNumber"=dword:00000017

[${PUTTY}\jenkins]
"Protocol"="ssh"
"HostName"="jenkins.demo"
"PortNumber"=dword:00000016
"UserName"="demo"
"PublicKeyFile"="C:\\Users\\demo\\.ssh\\jenkins.ppk"

[${PUTTY}\monitoring]
"Protocol"="ssh"
"HostName"="monitoring.demo"
"PortNumber"=dword:00000016
"PortForwardings"="L3000=localhost:3000"

[${PUTTY}\web%2001]
"Protocol"="ssh"
"HostName"="web01.demo"
"PortNumber"=dword:00000016
"UserName"="demo"
`;

const WINSCP_REG = String.raw`Windows Registry Editor Version 5.00

[${WINSCP}\Default%20Settings]
"FSProtocol"=dword:00000002

[${WINSCP}\Prod%2Ffiles-02]
"FSProtocol"=dword:00000002
"HostName"="files-02.demo"
"PortNumber"=dword:00000016
"UserName"="demo"

[${WINSCP}\legacy-scp]
"FSProtocol"=dword:00000000
"HostName"="legacy-scp.demo"
"PortNumber"=dword:00000016
"UserName"="demo"

[${WINSCP}\ftp-site]
"FSProtocol"=dword:00000005
"HostName"="ftp.demo"
"PortNumber"=dword:00000015

[${WINSCP}\behind-tunnel]
"FSProtocol"=dword:00000002
"HostName"="db-internal.demo"
"PortNumber"=dword:00000016
"Tunnel"=dword:00000001
"TunnelHostName"="internal-01.demo"
`;

const CONF_CONS = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" Export="false" EncryptionEngine="AES" BlockCipherMode="GCM" BlockSize="128" KdfIterations="1000" FullFileEncryption="false" Protected="false" ConfVersion="2.8">
  <Node Name="Kunden" Type="Container" Expanded="true" Id="5b1f6c2e-4a10-4d7e-9a11-000000000001">
    <Node Name="kunde-ssh" Type="Connection" Id="5b1f6c2e-4a10-4d7e-9a11-000000000002" Hostname="ssh.kunde.demo" Protocol="SSH2" Port="22" Username="demo" Password="not-imported" />
    <Node Name="kunde-rdp" Type="Connection" Id="5b1f6c2e-4a10-4d7e-9a11-000000000003" Hostname="rdp.kunde.demo" Protocol="RDP" Port="3389" Username="demo" Domain="KUNDE" />
    <Node Name="vnc-kunde" Type="Connection" Id="5b1f6c2e-4a10-4d7e-9a11-000000000004" Hostname="vnc.kunde.demo" Protocol="VNC" Port="5900" />
  </Node>
</Connections>
`;

// reg export writes UTF-16LE with a BOM and CRLF line endings
function regBytes(text) {
  const crlf = text.split(/\r?\n/).join('\r\n');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(crlf, 'utf16le')]);
}

// Writes the demo import sources into dir and returns their paths.
export function writeImportFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    sshConfig: path.join(dir, 'ssh_config'),
    puttyReg: path.join(dir, 'putty.reg'),
    winscpReg: path.join(dir, 'winscp.reg'),
    confCons: path.join(dir, 'confCons.xml'),
  };
  fs.writeFileSync(files.sshConfig, SSH_CONFIG, 'utf8');
  fs.writeFileSync(files.puttyReg, regBytes(PUTTY_REG));
  fs.writeFileSync(files.winscpReg, regBytes(WINSCP_REG));
  fs.writeFileSync(files.confCons, CONF_CONS, 'utf8');
  return files;
}
