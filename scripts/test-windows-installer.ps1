# Dependency-free installer tests; downloads, cosign, Authenticode, processes and setup execution are mocked.
$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path (Join-Path $PSScriptRoot '../install.ps1')).Path
$parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
if (@([IO.File]::ReadAllBytes($installer) | Where-Object { $_ -gt 127 }).Count) { throw 'install.ps1 must be ASCII only.' }
. $installer

$envNames = @(
    'SHELLHERD_UPDATE_VERSION', 'SHELLHERD_UPDATE_PID', 'SHELLHERD_UPDATE_TARGET', 'SHELLHERD_RELAUNCH',
    'SHELLHERD_PORTABLE_DIR', 'SHELLHERD_UPDATE_SCRIPT', 'SHELLHERD_INSTALL_HANDOFF'
)
$contents = @{
    'Shellherd-Setup-1.2.3.exe'    = 'synthetic installer, never executed'
    'Shellherd-Portable-1.2.3.exe' = 'synthetic portable, never executed'
    'install.ps1'                  = 'synthetic new installer script'
}
function Get-TextHash {
    param([string] $Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '')
}

$script:started = @()
$script:launched = @()
$script:messages = @()
$script:urls = @()
$script:waited = @()
$script:children = @()
$script:cosignCalls = @()
$script:badHash = $false
$script:duplicateHash = $false
$script:setupExit = 0
$script:authStatus = 'Valid'
$script:cosignPresent = $false
$script:cosignExit = 0
$script:noBundle = $false
$script:installEntry = 'self'
$script:childExit = 0
$script:pidAlive = $false
$script:busy = $false
$script:selfHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()

function Write-Host { param($Object, $ForegroundColor, [switch]$NoNewline) $script:messages += [string]$Object }
function Invoke-RestMethod { param($Uri) return @{ tag_name = 'v1.2.3' } }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $OutFile)
    $script:urls += $Uri
    if ($Uri.EndsWith('/SHA256SUMS')) {
        $setupHash = Get-TextHash $contents['Shellherd-Setup-1.2.3.exe']
        if ($script:badHash) { $setupHash = '0' * 64 }
        $lines = @("$setupHash  Shellherd-Setup-1.2.3.exe")
        if ($script:duplicateHash) { $lines += $lines[0] }
        $lines += (Get-TextHash $contents['Shellherd-Portable-1.2.3.exe']) + '  Shellherd-Portable-1.2.3.exe'
        if ($script:installEntry -eq 'self') { $lines += "$($script:selfHash)  install.ps1" }
        if ($script:installEntry -eq 'new') { $lines += (Get-TextHash $contents['install.ps1']) + '  install.ps1' }
        if ($script:installEntry -eq 'bad') { $lines += ('0' * 64) + '  install.ps1' }
        Set-Content -LiteralPath $OutFile -Value $lines -Encoding ASCII
    } elseif ($Uri.EndsWith('.sigstore.json')) {
        if ($script:noBundle) { throw 'HTTP 404' }
        [IO.File]::WriteAllText($OutFile, '{}')
    } else {
        $name = $Uri.Substring($Uri.LastIndexOf('/') + 1)
        [IO.File]::WriteAllBytes($OutFile, [Text.Encoding]::UTF8.GetBytes($contents[$name]))
    }
}
function Start-Process {
    param($FilePath, [switch]$Wait, [switch]$PassThru, $ArgumentList, $WorkingDirectory)
    if ($Wait) {
        if (-not $PassThru) { throw 'Setup must be awaited with its exit code.' }
        $script:started += @{ Path = $FilePath; Arguments = $ArgumentList }
        return @{ ExitCode = $script:setupExit }
    }
    $script:launched += @{ Path = $FilePath; WorkingDirectory = $WorkingDirectory }
}
function Get-AuthenticodeSignature {
    param($LiteralPath)
    return [pscustomobject]@{ Status = $script:authStatus; SignerCertificate = [pscustomobject]@{ Subject = 'CN=Test Publisher' } }
}
function Get-Command {
    [CmdletBinding()]
    param($Name)
    if ($Name -eq 'cosign' -and $script:cosignPresent) { return [pscustomobject]@{ Name = 'cosign' } }
    return $null
}
function cosign { $script:cosignCalls += , @($args); $global:LASTEXITCODE = $script:cosignExit }
function Wait-Process { [CmdletBinding()] param($Id, $Timeout) $script:waited += $Id }
function Get-Process { [CmdletBinding()] param($Id) if ($script:pidAlive) { return [pscustomobject]@{ Id = $Id } } return $null }
function Start-Sleep { param($Seconds) }
function Get-ShellherdRunningFrom { param($Directory) if ($script:busy) { return @([pscustomobject]@{ Path = "$Directory\Shellherd.exe" }) } return @() }
function Get-ShellherdHostPath { return 'C:\mock\powershell.exe' }
function Invoke-ShellherdChild {
    param($HostPath, $ScriptPath, $Arguments)
    $seen = @{}
    foreach ($name in $envNames) { $seen[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $text = ((Get-Content -LiteralPath $ScriptPath) -join '')
    $script:children += @{ Host = $HostPath; Script = $ScriptPath; Text = $text; Arguments = @($Arguments); Env = $seen }
    return $script:childExit
}

function Assert-Rejected {
    param([scriptblock] $Action)
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected installation to be rejected.' }
}
function Assert-True {
    param($Condition, [string] $Message)
    if (-not $Condition) { throw $Message }
}
function Reset-State {
    $script:started = @(); $script:launched = @(); $script:messages = @(); $script:urls = @()
    $script:waited = @(); $script:children = @(); $script:cosignCalls = @()
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
}
function Set-AppEnv {
    param([string] $Target = 'setup', [string] $VersionText = '1.2.3', [string] $PidText = '4242', [string] $Relaunch = $script:userExe, [string] $Portable = $script:portableDir)
    $env:SHELLHERD_UPDATE_VERSION = $VersionText
    $env:SHELLHERD_UPDATE_PID = $PidText
    $env:SHELLHERD_UPDATE_TARGET = $Target
    if ($Relaunch) { $env:SHELLHERD_RELAUNCH = $Relaunch }
    if ($Portable) { $env:SHELLHERD_PORTABLE_DIR = $Portable }
    $env:SHELLHERD_UPDATE_SCRIPT = 'C:\x\install.ps1'
}
function Assert-EnvCleared {
    foreach ($name in $envNames) {
        if ($null -ne [Environment]::GetEnvironmentVariable($name, 'Process')) { throw "$name was not removed from the environment." }
    }
}

# Fixture: a per-user and an all-users install folder, and a portable folder.
$root = Join-Path ([IO.Path]::GetTempPath()) ('shellherd-test-' + [guid]::NewGuid().ToString('N'))
$localApp = Join-Path $root 'local'
$userDir = Join-Path $localApp 'Programs\Shellherd'
$allDir = Join-Path $root 'pf\Shellherd'
$script:portableDir = Join-Path $root 'portable'
foreach ($dir in @($userDir, $allDir, $script:portableDir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
$script:userExe = Join-Path $userDir 'Shellherd.exe'
$allExe = Join-Path $allDir 'Shellherd.exe'
foreach ($exe in @($script:userExe, $allExe)) { [IO.File]::WriteAllText($exe, 'x') }
$wrongName = Join-Path $userDir 'Other.exe'
[IO.File]::WriteAllText($wrongName, 'x')
$oldLocalApp = $env:LOCALAPPDATA
$env:LOCALAPPDATA = $localApp

try {
    # Plain install (no app values, no handoff without SelfPath).
    Reset-State
    Invoke-ShellherdInstall
    Assert-True ($script:started.Count -eq 1) 'Expected exactly one setup.'
    Assert-True (-not (Test-Path -LiteralPath $script:started[0].Path)) 'Temporary setup was not removed.'
    Assert-True ($script:children.Count -eq 0) 'No handoff expected without SelfPath.'
    foreach ($url in $script:urls) {
        Assert-True ($url.StartsWith('https://github.com/pelmenipower/Shellherd/')) "Unexpected URL: $url"
    }
    Reset-State
    Invoke-ShellherdInstall -Version 'v1.2.3' -Silent
    Assert-True (@($script:started[0].Arguments)[0] -eq '/S') 'Silent flag missing.'
    Reset-State
    $script:badHash = $true
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' }
    $script:badHash = $false
    $script:duplicateHash = $true
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' }
    $script:duplicateHash = $false
    Assert-Rejected { Invoke-ShellherdInstall -Version '../bad' }
    Assert-Rejected { Invoke-ShellherdInstall -InstallerPath 'missing.exe' }
    $script:setupExit = 2
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' }
    $script:setupExit = 0
    Assert-True ($script:started.Count -eq 1) 'Rejected downloads must never start a setup.'

    # Authenticode.
    Reset-State
    $script:authStatus = 'Valid'
    Invoke-ShellherdInstall -Version '1.2.3'
    Assert-True ($script:started.Count -eq 1) 'Valid signature must start the setup.'
    Assert-True (@($script:messages | Where-Object { $_ -like 'Authenticode gueltig: CN=Test Publisher' }).Count -eq 1) 'Valid signature must be reported.'
    Reset-State
    $script:authStatus = 'NotSigned'
    Invoke-ShellherdInstall -Version '1.2.3'
    Assert-True ($script:started.Count -eq 1) 'Unsigned setup must still start.'
    Assert-True (@($script:messages | Where-Object { $_ -like 'Hinweis: dieses Setup ist nicht signiert*' }).Count -eq 1) 'Unsigned hint missing.'
    foreach ($status in @('HashMismatch', 'NotTrusted', 'UnknownError')) {
        Reset-State
        $script:authStatus = $status
        Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' }
        Assert-True ($script:started.Count -eq 0) "Status $status must never start a setup."
    }
    $script:authStatus = 'Valid'

    # cosign.
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3'
    Assert-True ($script:cosignCalls.Count -eq 0) 'cosign must not run when absent.'
    Assert-True (@($script:messages | Where-Object { $_ -like 'cosign nicht gefunden*' }).Count -eq 1) 'Missing cosign hint missing.'
    $script:cosignPresent = $true
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3'
    Assert-True ($script:cosignCalls.Count -eq 1) 'cosign must run once.'
    $call = $script:cosignCalls[0]
    Assert-True ($call[0] -eq 'verify-blob') 'cosign must verify a blob.'
    Assert-True ($call -contains '--bundle') 'cosign needs the bundle.'
    Assert-True ($call -contains 'https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main') 'cosign identity mismatch.'
    Assert-True ($call -contains 'https://token.actions.githubusercontent.com') 'cosign issuer mismatch.'
    Assert-True ($call[$call.Count - 1].EndsWith('SHA256SUMS')) 'cosign must verify SHA256SUMS.'
    $script:cosignExit = 1
    Reset-State
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' }
    Assert-True ($script:started.Count -eq 0) 'A failed signature must never start a setup.'
    $script:cosignExit = 0
    $script:noBundle = $true
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3'
    Assert-True ($script:cosignCalls.Count -eq 0) 'No bundle: cosign must not run.'
    Assert-True ($script:started.Count -eq 1) 'No bundle must fall back to checksums.'
    Assert-True (@($script:messages | Where-Object { $_ -like 'Dieses Release hat keine Sigstore-Signatur*' }).Count -eq 1) 'No-bundle hint missing.'
    $script:noBundle = $false
    $script:cosignPresent = $false

    # -FromApp, per-user install: silent with /D, then relaunch.
    Reset-State
    Set-AppEnv
    Invoke-ShellherdInstall -FromApp
    Assert-True ($script:started.Count -eq 1) 'FromApp must start one setup.'
    Assert-True (($script:started[0].Arguments -is [string]) -and ($script:started[0].Arguments -ceq "/S /D=$userDir")) 'ArgumentList must be exactly one string "/S /D=<dir>".'
    Assert-True ($script:launched.Count -eq 1 -and $script:launched[0].Path -eq $script:userExe) 'Shellherd must be relaunched.'
    Assert-True ($script:waited -contains 4242) 'The app PID must be awaited.'
    Assert-EnvCleared
    # The busy check also fails when the PID is still alive or helpers still run.
    Reset-State
    Set-AppEnv
    $script:pidAlive = $true
    Assert-Rejected { Invoke-ShellherdInstall -FromApp }
    Assert-True ($script:started.Count -eq 0) 'A running app must block the setup.'
    $script:pidAlive = $false
    Reset-State
    Set-AppEnv
    $script:busy = $true
    Assert-Rejected { Invoke-ShellherdInstall -FromApp }
    Assert-True ($script:started.Count -eq 0) 'A running helper must block the setup.'
    $script:busy = $false

    # -FromApp, all-users install: no /S, admin hint.
    Reset-State
    Set-AppEnv -Relaunch $allExe
    Invoke-ShellherdInstall -FromApp
    Assert-True ($script:started.Count -eq 1) 'All-users install must start the setup.'
    Assert-True ($null -eq $script:started[0].Arguments) 'All-users install must start without /S.'
    Assert-True (@($script:messages | Where-Object { $_ -eq 'Shellherd ist fuer alle Benutzer installiert. Das Setup oeffnet sich und fragt nach Administratorrechten.' }).Count -eq 1) 'All-users hint missing.'

    # -FromApp validation: every bad value is rejected, never starts a setup, and clears the environment.
    $bad = @(
        @{ VersionText = '1.2' }, @{ VersionText = '1.2.3.4' }, @{ VersionText = '..\1.2.3' }, @{ VersionText = '12345.1.1' },
        @{ PidText = '0' }, @{ PidText = 'abc' }, @{ PidText = '1 2' }, @{ PidText = '' }, @{ PidText = '99999999999' }, @{ PidText = '9999999999' }, @{ PidText = '-5' },
        @{ Target = 'deb' }, @{ Target = 'Setup' }, @{ Target = '' },
        @{ Relaunch = '' }, @{ Relaunch = 'Shellherd.exe' }, @{ Relaunch = (Join-Path $root 'missing\Shellherd.exe') }, @{ Relaunch = $wrongName },
        @{ Target = 'portable'; Portable = '' }, @{ Target = 'portable'; Portable = 'portable' }, @{ Target = 'portable'; Portable = (Join-Path $root 'nope') }
    )
    foreach ($case in $bad) {
        Reset-State
        Set-AppEnv @case
        Assert-Rejected { Invoke-ShellherdInstall -FromApp }
        Assert-True ($script:started.Count -eq 0 -and $script:launched.Count -eq 0) ('Invalid app values must not start anything: ' + ($case | Out-String))
        Assert-EnvCleared
        Assert-True ($script:urls.Count -eq 0) 'Invalid app values must not reach the network.'
    }
    Reset-State
    Set-AppEnv
    Assert-Rejected { Invoke-ShellherdInstall -FromApp -Version '1.2.3' }
    Set-AppEnv
    Assert-Rejected { Invoke-ShellherdInstall -FromApp -Silent }
    Set-AppEnv
    Assert-Rejected { Invoke-ShellherdInstall -FromApp -InstallerPath $installer }
    Set-AppEnv
    Assert-Rejected { Invoke-ShellherdInstall -FromApp -PortableDir $script:portableDir }
    Assert-True ($script:started.Count -eq 0) 'FromApp combined with other parameters must not start anything.'

    # Portable: saved into the folder, nothing started, app not awaited.
    $portableFile = Join-Path $script:portableDir 'Shellherd-Portable-1.2.3.exe'
    Reset-State
    Set-AppEnv -Target 'portable' -Relaunch ''
    Invoke-ShellherdInstall -FromApp
    Assert-True (Test-Path -LiteralPath $portableFile -PathType Leaf) 'Portable file must land in the folder.'
    Assert-True ($script:started.Count -eq 0 -and $script:launched.Count -eq 0) 'Portable must not start anything.'
    Assert-True ($script:waited.Count -eq 0) 'Portable must not wait for the running app.'
    Assert-EnvCleared
    Remove-Item -LiteralPath $portableFile
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3' -PortableDir $script:portableDir
    Assert-True (Test-Path -LiteralPath $portableFile -PathType Leaf) '-PortableDir must save the file.'
    Assert-True ($script:started.Count -eq 0) '-PortableDir must not start a setup.'
    Remove-Item -LiteralPath $portableFile
    $script:authStatus = 'HashMismatch'
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' -PortableDir $script:portableDir }
    Assert-True (-not (Test-Path -LiteralPath $portableFile)) 'A rejected portable file must not be saved.'
    $script:authStatus = 'Valid'
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' -PortableDir 'relative' }
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' -PortableDir (Join-Path $root 'nope') }
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' -PortableDir $script:portableDir -Silent }

    # Handoff: the release installer differs from this one.
    $script:installEntry = 'new'
    Reset-State
    Set-AppEnv
    Invoke-ShellherdInstall -FromApp -SelfPath $installer
    Assert-True ($script:children.Count -eq 1) 'Handoff must start exactly one child.'
    $child = $script:children[0]
    Assert-True ($child.Host -eq 'C:\mock\powershell.exe') 'Child must run in the same host.'
    Assert-True ($child.Text -eq $contents['install.ps1']) 'Child must run the verified release script.'
    Assert-True (($child.Arguments -join ' ') -eq '-FromApp') 'Child must get the same parameters.'
    Assert-True ($child.Env['SHELLHERD_INSTALL_HANDOFF'] -eq '1') 'Child must be marked as handoff.'
    Assert-True ($child.Env['SHELLHERD_UPDATE_VERSION'] -eq '1.2.3' -and $child.Env['SHELLHERD_UPDATE_PID'] -eq '4242' -and $child.Env['SHELLHERD_UPDATE_TARGET'] -eq 'setup' -and $child.Env['SHELLHERD_RELAUNCH'] -eq $script:userExe) 'Child must get the validated values.'
    Assert-True ($null -eq $child.Env['SHELLHERD_PORTABLE_DIR'] -and $null -eq $child.Env['SHELLHERD_UPDATE_SCRIPT']) 'Child must not get unrelated values.'
    Assert-True ($script:started.Count -eq 0 -and $script:waited.Count -eq 0) 'The parent must neither install nor wait after a handoff.'
    Assert-EnvCleared
    # Handoff for a portable app update carries the folder.
    Reset-State
    Set-AppEnv -Target 'portable' -Relaunch ''
    Invoke-ShellherdInstall -FromApp -SelfPath $installer
    Assert-True ($script:children[0].Env['SHELLHERD_PORTABLE_DIR'] -eq $script:portableDir -and $null -eq $script:children[0].Env['SHELLHERD_RELAUNCH']) 'Portable handoff must carry the folder.'
    # Handoff for a manual run repeats the parameters with the resolved version.
    Reset-State
    Invoke-ShellherdInstall -Silent -SelfPath $installer
    Assert-True (($script:children[0].Arguments -join ' ') -eq '-Version 1.2.3 -Silent') 'Manual handoff must repeat the parameters.'
    Assert-True ($script:children[0].Env['SHELLHERD_INSTALL_HANDOFF'] -eq '1' -and $null -eq $script:children[0].Env['SHELLHERD_UPDATE_VERSION']) 'Manual handoff sets only the handoff marker.'
    Assert-EnvCleared
    # A failing child fails the run.
    $script:childExit = 7
    Reset-State
    Set-AppEnv
    Assert-Rejected { Invoke-ShellherdInstall -FromApp -SelfPath $installer }
    Assert-EnvCleared
    $script:childExit = 0
    # A handoff child never hands off again, and installs normally.
    Reset-State
    Set-AppEnv
    $env:SHELLHERD_INSTALL_HANDOFF = '1'
    Invoke-ShellherdInstall -FromApp -SelfPath $installer
    Assert-True ($script:children.Count -eq 0 -and $script:started.Count -eq 1) 'The handoff child must install itself.'
    Assert-EnvCleared
    # Without a script file (scriptblock run), a local installer, or a matching hash there is no handoff.
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3'
    Invoke-ShellherdInstall -Version '1.2.3' -SelfPath ''
    Assert-True ($script:children.Count -eq 0 -and $script:started.Count -eq 2) 'Without a script file there is no handoff.'
    # A matching hash, or no install.ps1 entry in an older release, means no handoff; a wrong hash never runs.
    $script:installEntry = 'self'
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3' -SelfPath $installer
    Assert-True ($script:children.Count -eq 0 -and $script:started.Count -eq 1) 'A matching script hash must not hand off.'
    $script:installEntry = 'none'
    Reset-State
    Invoke-ShellherdInstall -Version '1.2.3' -SelfPath $installer
    Assert-True ($script:children.Count -eq 0 -and $script:started.Count -eq 1) 'A release without an install.ps1 entry must not hand off.'
    $script:installEntry = 'bad'
    Reset-State
    Assert-Rejected { Invoke-ShellherdInstall -Version '1.2.3' -SelfPath $installer }
    Assert-True ($script:children.Count -eq 0 -and $script:started.Count -eq 0) 'A release script with a wrong hash must never run.'
} finally {
    $env:LOCALAPPDATA = $oldLocalApp
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'Windows installer tests passed: parsing, download, checksums, cosign, Authenticode, FromApp, portable, handoff and setup errors.'
# Mocked native calls leave LASTEXITCODE set; the CI wrapper would exit with it.
$global:LASTEXITCODE = 0
