import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { parseMRemoteNg } from './import-mremoteng';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" Export="false" EncryptionEngine="AES" FullFileEncryption="false" ConfVersion="2.8">
  <Node Name="Kunden" Type="Container" Id="c1">
    <Node Name="kunde-ssh" Type="Connection" Id="n1" Hostname="ssh.kunde.test" Protocol="SSH2" Port="2222" Username="root" Password="GEHEIM-PW-123" />
    <Node Name="Intern" Type="Container" Id="c2">
      <Node Name="rdp &amp; co" Type="Connection" Id="n2" Hostname="rdp.intern.test" Protocol="RDP" Port="3389" Domain="CORP" Password="GEHEIM-PW-456"></Node>
    </Node>
  </Node>
  <Node Name="vnc" Type="Connection" Id="n3" Hostname="vnc.test" Protocol="VNC" Port="5900" />
  <Node Name="telnet" Type="Connection" Hostname="telnet.test" Protocol="Telnet" Port="23" />
  <Node Name="kaputt" Type="Connection" Hostname="bad host" Protocol="SSH2" Port="22" />
  <Node Name="port" Type="Connection" Hostname="p.test" Protocol="SSH2" Port="70000" />
  <Node Name="SSH1 &#65;" Type="Connection" Hostname="ssh1.test" Protocol="SSH1" />
  <Node Name="Ordner &lt;x&gt;" Type="Container" Id="c3"><Node Name="hex &#x42; &quot;&apos;" Type="Connection" Hostname="hex.test" Protocol="SSH2" /></Node>
</Connections>`;

describe('parseMRemoteNg', () => {
  it('reads SSH, RDP, unsupported and invalid connections in document order', () => {
    const result = parseMRemoteNg(XML);
    expect(result.candidates).toEqual([
      { key: 'n1', name: 'kunde-ssh', protocol: 'ssh', folder: ['Kunden'], host: 'ssh.kunde.test', port: 2222, username: 'root', forwards: [], notes: [] },
      { key: 'n2', name: 'rdp & co', protocol: 'rdp', folder: ['Kunden', 'Intern'], host: 'rdp.intern.test', port: 3389, domain: 'CORP', forwards: [], notes: [] },
      { key: 'SSH1 A', name: 'SSH1 A', protocol: 'ssh', folder: [], host: 'ssh1.test', port: 22, forwards: [], notes: [] },
      { key: 'Ordner <x>/hex B "\'', name: 'hex B "\'', protocol: 'ssh', folder: ['Ordner <x>'], host: 'hex.test', port: 22, forwards: [], notes: [] },
    ]);
    expect(result.skipped).toEqual([
      { code: 'unsupported', count: 2 },
      { code: 'invalid', count: 2 },
    ]);
  });

  it('never leaks passwords into the result', () => {
    expect(JSON.stringify(parseMRemoteNg(XML))).not.toContain('GEHEIM');
  });

  it('keeps folders from nested containers and ignores empty container names', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Name="A" Type="Container"><Node Name="" Type="Container"><Node Name="B" Type="Container"/>
    <Node Name="x" Type="Connection" Hostname="h" Protocol="SSH2"/></Node></Node>
  <Node Name="y" Type="Connection" Hostname="h2" Protocol="SSH2"/>
</Connections>`);
    expect(result.candidates.map((c) => [c.name, c.folder])).toEqual([['x', ['A']], ['y', []]]);
  });

  it('uses the default port and the RDP default 3389 when none is given', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Name="s" Type="Connection" Hostname="a.test" Protocol="SSH2"/>
  <Node Name="r" Type="Connection" Hostname="b.test" Protocol="RDP"/>
</Connections>`);
    expect(result.candidates.map((c) => [c.protocol, c.port])).toEqual([['ssh', 22], ['rdp', 3389]]);
    expect(result.candidates[1]).not.toHaveProperty('domain');
  });

  it('marks a connection with a bad port as invalid and an empty name falls back to the host', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Type="Connection" Hostname="a.test" Protocol="SSH2" Port="0"/>
  <Node Type="Connection" Hostname="b.test" Protocol="SSH2" Port="abc"/>
  <Node Type="Connection" Hostname="c.test" Protocol="SSH2"/>
</Connections>`);
    expect(result.candidates.map((c) => [c.name, c.host])).toEqual([['c.test', 'c.test']]);
    expect(result.skipped).toEqual([{ code: 'invalid', count: 2 }]);
  });

  it('handles open and self-closing node tags alike and closes the stack correctly', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Name="F" Type="Container">
    <Node Name="a" Type="Connection" Hostname="a.test" Protocol="SSH2"></Node>
  </Node>
  <Node Name="b" Type="Connection" Hostname="b.test" Protocol="SSH2"/>
</Connections>`);
    expect(result.candidates.map((c) => c.folder)).toEqual([['F'], []]);
  });

  it('decodes entities in names and hosts, leaves unknown entities as they are', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Name="a &amp;&#x41;&#66;&bogus;" Type="Connection" Hostname="h&#46;test" Protocol="SSH2"/>
</Connections>`);
    expect(result.candidates[0]).toMatchObject({ name: 'a &AB&bogus;', host: 'h.test' });
  });

  it('makes keys unique when names repeat in one folder without Id', () => {
    const result = parseMRemoteNg(`<Connections>
  <Node Name="dup" Type="Connection" Hostname="a.test" Protocol="SSH2"/>
  <Node Name="dup" Type="Connection" Hostname="b.test" Protocol="SSH2"/>
</Connections>`);
    expect(result.candidates.map((c) => c.key)).toEqual(['dup', 'dup#2']);
  });

  it('limits candidates to 500 and counts the rest as tooMany', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => `<Node Name="n${i}" Type="Connection" Hostname="h${i}.test" Protocol="SSH2"/>`).join('\n');
    const result = parseMRemoteNg(`<Connections>\n${nodes}\n</Connections>`);
    expect(result.candidates).toHaveLength(500);
    expect(result.skipped).toEqual([{ code: 'tooMany', count: 1 }]);
  });

  it('throws the encrypted error for FullFileEncryption="true" on the root', () => {
    const encrypted = '<?xml version="1.0"?>\n<Connections Name="Connections" FullFileEncryption="true" Protected="abc">\nQkFTRTY0Li4u\n</Connections>';
    let caught: unknown;
    try {
      parseMRemoteNg(encrypted);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('core.importEncrypted');
  });

  it('returns an empty preview for an empty file', () => {
    expect(parseMRemoteNg('')).toEqual({ candidates: [], skipped: [] });
  });
});
