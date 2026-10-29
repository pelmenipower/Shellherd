#requires -Version 5.1
# Windows PowerShell 5.1 and PowerShell 7. No administrator session required.
[CmdletBinding()]
param(
    [string] $Version,
    [string] $InstallerPath,
    [switch] $Silent
)

function Invoke-ShellherdInstall {
    [CmdletBinding()]
    param([string] $Version, [string] $InstallerPath, [switch] $Silent)

    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Dieser Installer ist fuer Windows. Unter Linux bitte install.sh verwenden.'
    }
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -ne 'AMD64') { throw 'Shellherd benoetigt Windows x64.' }
    if ($Version -and $InstallerPath) { throw '-Version und -InstallerPath koennen nicht kombiniert werden.' }
    if ($Version) {
        $Version = $Version -replace '^v', ''
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Ungueltige Release-Version.' }
    }

    $workDirectory = Join-Path ([IO.Path]::GetTempPath()) ('shellherd-install-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $workDirectory
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
        $setup = Join-Path $workDirectory 'Shellherd-Setup.exe'
        if ($InstallerPath) {
            if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Setup nicht gefunden: $InstallerPath" }
            if ([IO.Path]::GetExtension($InstallerPath) -ne '.exe') { throw 'Bitte eine Setup-EXE angeben.' }
            Copy-Item -LiteralPath $InstallerPath -Destination $setup
        } else {
            if (-not $Version) {
                $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/pelmenipower/Shellherd/releases/latest'
                $Version = [string]$release.tag_name -replace '^v', ''
            }
            if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Ungueltige Release-Version.' }
            $asset = "Shellherd-Setup-$Version.exe"
            $base = "https://github.com/pelmenipower/Shellherd/releases/download/v$Version"
            Write-Host "Lade Shellherd $Version herunter ..."
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $setup
            $checksums = Join-Path $workDirectory 'SHA256SUMS'
            Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $checksums
            $pattern = '^([a-fA-F0-9]{64})[ \t]+\*?' + [regex]::Escape($asset) + '$'
            $entries = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -cmatch $pattern })
            if ($entries.Count -ne 1) { throw 'Keine eindeutige Setup-Pruefsumme im Release. Installation abgebrochen.' }
            $expected = [regex]::Match($entries[0], $pattern).Groups[1].Value
            $actual = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
            if ($actual -ine $expected) { throw 'Setup-Pruefsumme stimmt nicht ueberein. Installation abgebrochen.' }
        }

        Write-Host 'Starte das Shellherd-Setup (Installation fuer den aktuellen Benutzer) ...'
        $options = @{ FilePath = $setup; Wait = $true; PassThru = $true }
        if ($Silent) { $options.ArgumentList = @('/S') }
        $process = Start-Process @options
        if ($process.ExitCode -notin @(0, 3010)) { throw "Setup fehlgeschlagen oder abgebrochen (Exitcode $($process.ExitCode))." }
        Write-Host 'Shellherd ist installiert. Starte die Anwendung ueber das Startmenue.'
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol
        Remove-Item -LiteralPath $workDirectory -Recurse -Force
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-ShellherdInstall -Version $Version -InstallerPath $InstallerPath -Silent:$Silent
}
