# Dependency-free tests for the pure rules of check-win-signatures.ps1.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'check-win-signatures.ps1'
$parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. $script -Expect Signed

function Assert-Equal {
    param($Actual, $Expected, [string] $Message)
    if ($Actual -ne $Expected) { throw "$Message (expected '$Expected', got '$Actual')" }
}
function Entry {
    param([string] $Path, [string] $Status, [bool] $Stamp = $true, [bool] $Pinned = $true)
    return @{ Path = $Path; Status = $Status; HasTimestamp = $Stamp; Pinned = $Pinned }
}

# Pinned list
Assert-Equal (Test-ShellherdPinned 'Shellherd.exe') $true 'Shellherd.exe is pinned'
Assert-Equal (Test-ShellherdPinned 'resources\rdp-host\Shellherd.RdpHost.exe') $true 'rdp-host is pinned'
Assert-Equal (Test-ShellherdPinned 'resources/hello/Shellherd.Hello.exe') $true 'hello is pinned'
Assert-Equal (Test-ShellherdPinned 'resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node') $true '.node is pinned'
Assert-Equal (Test-ShellherdPinned 'resources/app.asar.unpacked/node_modules/node-pty/third_party/winpty-agent.exe') $true 'winpty is pinned'
Assert-Equal (Test-ShellherdPinned 'ffmpeg.dll') $false 'electron dll is not pinned'

# Signed: all good
$good = @(
    (Entry 'Shellherd.exe' 'Valid'),
    (Entry 'ffmpeg.dll' 'Valid' $true $false),
    (Entry 'd3dcompiler_47.dll' 'Valid' $false $false)
)
Assert-Equal @(Test-ShellherdSignatures -Entries $good -Expect Signed).Count 0 'good signed package'

# Signed: pinned file unsigned, missing timestamp, other unsigned dll, unverifiable
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'NotSigned') -Expect Signed).Count 1 'pinned NotSigned'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'Valid' $false) -Expect Signed).Count 1 'missing timestamp'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'libEGL.dll' 'NotSigned' $false $false) -Expect Signed).Count 1 'unsigned dll'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'a.node' 'Unverifiable' $false $true) -Expect Signed).Count 1 'unverifiable is an error'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'HashMismatch') -Expect Signed).Count 1 'hash mismatch'

# Unsigned
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'NotSigned' $false) -Expect Unsigned).Count 0 'good unsigned package'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'Valid') -Expect Unsigned).Count 1 'unexpected signature'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'x.node' 'Unverifiable' $false $true) -Expect Unsigned).Count 1 'unverifiable unsigned'
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'ffmpeg.dll' 'Valid' $true $false) -Expect Unsigned).Count 0 'foreign signature allowed when unsigned'

# Return shape: an empty result must count as zero, one problem as one
Assert-Equal @(Test-ShellherdSignatures -Entries @(Entry 'Shellherd.exe' 'Valid') -Expect Signed).Count 0 'empty result counts as zero'
Assert-Equal @(Test-ShellherdSignatures -Entries @((Entry 'Shellherd.exe' 'NotSigned'), (Entry 'winpty.dll' 'NotSigned')) -Expect Signed).Count 2 'two problems count as two'
Assert-Equal @(Test-ShellherdInstall -Present @('Shellherd.exe')).Count 0 'empty install result counts as zero'

# Only PE files are rated (node-pty ships macOS prebuilds as Mach-O)
$peDir = Join-Path ([IO.Path]::GetTempPath()) ("shellherd-pe-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $peDir | Out-Null
try {
    $pe = Join-Path $peDir 'a.node'
    $macho = Join-Path $peDir 'b.node'
    $tiny = Join-Path $peDir 'c.node'
    [IO.File]::WriteAllBytes($pe, [byte[]](0x4D, 0x5A, 0x90, 0x00))
    [IO.File]::WriteAllBytes($macho, [byte[]](0xCF, 0xFA, 0xED, 0xFE))
    [IO.File]::WriteAllBytes($tiny, [byte[]](0x4D))
    Assert-Equal (Test-ShellherdIsPe $pe) $true 'MZ header is PE'
    Assert-Equal (Test-ShellherdIsPe $macho) $false 'Mach-O is not PE'
    Assert-Equal (Test-ShellherdIsPe $tiny) $false 'one byte is not PE'
} finally {
    Remove-Item -LiteralPath $peDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Install check
Assert-Equal @(Test-ShellherdInstall -Present @('Shellherd.exe', 'resources\app.asar', 'Uninstall Shellherd.exe')).Count 0 'good install'
Assert-Equal @(Test-ShellherdInstall -Present @('Shellherd.exe', 'resources\elevate.exe')).Count 1 'elevate.exe present'
Assert-Equal @(Test-ShellherdInstall -Present @('resources\app.asar')).Count 1 'Shellherd.exe missing'

Write-Host 'check-win-signatures tests passed.'
# Mocked native calls leave LASTEXITCODE set; the CI wrapper would exit with it.
$global:LASTEXITCODE = 0
