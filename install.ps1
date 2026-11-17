#requires -Version 5.1
# Windows PowerShell 5.1 and PowerShell 7. ASCII only. No administrator session required.
# -FromApp is used by the in-app update: the values come from SHELLHERD_* environment variables.
[CmdletBinding()]
param(
    [string] $Version,
    [string] $InstallerPath,
    [switch] $Silent,
    [string] $PortableDir,
    [switch] $FromApp
)

function Get-ShellherdEnvValue {
    # Reads a process environment variable and removes it, so nothing leaks into child processes.
    param([string] $Name)
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    # Remove-Item works on PowerShell 5.1 and 7; SetEnvironmentVariable($null) leaves an empty value on 7.
    Remove-Item -LiteralPath ('Env:' + $Name) -ErrorAction SilentlyContinue
    return $value
}

function Test-ShellherdVersion {
    param([string] $Value)
    return [bool]($Value -match '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\z')
}

function Test-ShellherdAbsolutePath {
    param([string] $Value)
    return [bool]($Value -match '^[A-Za-z]:\\[^\r\n"<>|*?]*\z')
}

function Get-ShellherdChecksum {
    # Returns the hash of exactly one matching SHA256SUMS line, otherwise $null.
    param([string] $File, [string] $Name)
    $pattern = '^([a-fA-F0-9]{64})[ \t]+\*?' + [regex]::Escape($Name) + '$'
    $entries = @(Get-Content -LiteralPath $File | Where-Object { $_ -cmatch $pattern })
    if ($entries.Count -ne 1) { return $null }
    return [regex]::Match($entries[0], $pattern).Groups[1].Value
}

function Get-ShellherdAsset {
    # Downloads one release asset and compares it with its SHA256SUMS entry.
    param([string] $Base, [string] $Asset, [string] $Checksums, [string] $Destination)
    $expected = Get-ShellherdChecksum -File $Checksums -Name $Asset
    if (-not $expected) { throw "Keine eindeutige Pruefsumme fuer $Asset im Release. Installation abgebrochen." }
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile $Destination
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($actual -ine $expected) { throw "Pruefsumme von $Asset stimmt nicht ueberein. Installation abgebrochen." }
}

function Confirm-ShellherdSignature {
    # Optional Sigstore check of SHA256SUMS. Older releases have no bundle.
    param([string] $Base, [string] $Checksums, [string] $WorkDirectory, [switch] $Strict)
    if (-not (Get-Command cosign -ErrorAction SilentlyContinue)) {
        Write-Host 'cosign nicht gefunden: nur Pruefsummen und Authenticode.'
        return
    }
    $bundle = Join-Path $WorkDirectory 'SHA256SUMS.sigstore.json'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS.sigstore.json" -OutFile $bundle
    } catch {
        # The in-app update only targets signed releases; a missing bundle there is an attack or a broken release.
        if ($Strict) { throw 'Dem Release fehlt die Sigstore-Signatur. Nichts wurde installiert.' }
        Write-Host 'Dieses Release hat keine Sigstore-Signatur; nur Pruefsummen.'
        return
    }
    $global:LASTEXITCODE = 0
    & cosign verify-blob --bundle $bundle `
        --certificate-identity 'https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main' `
        --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' $Checksums
    if ($global:LASTEXITCODE -ne 0) { throw 'Die Signatur von SHA256SUMS ist ungueltig. Nichts wurde installiert.' }
    Write-Host 'Signatur geprueft (Sigstore).'
}

function Test-ShellherdAuthenticode {
    param([string] $Path)
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $status = [string]$signature.Status
    if ($status -eq 'Valid') {
        Write-Host ('Authenticode gueltig: ' + $signature.SignerCertificate.Subject)
    } elseif ($status -eq 'NotSigned') {
        Write-Host 'Hinweis: diese Datei ist nicht signiert (Release vor der Signierung).'
    } else {
        throw 'Die Signatur dieser Datei ist ungueltig. Installation abgebrochen.'
    }
}

function Get-ShellherdHostPath {
    return [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
}

function Invoke-ShellherdChild {
    param([string] $HostPath, [string] $ScriptPath, [string[]] $Arguments)
    & $HostPath -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments | Out-Host
    return $LASTEXITCODE
}

function Get-ShellherdRunningFrom {
    # Processes whose executable lives below the given directory.
    param([string] $Directory)
    $prefix = $Directory.TrimEnd('\') + '\'
    $found = @()
    foreach ($candidate in (Get-Process)) {
        $path = $null
        try { $path = $candidate.Path } catch { $path = $null }
        if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $found += $candidate }
    }
    return $found
}

function Wait-ShellherdExit {
    param([int] $AppPid, [string] $InstallDir)
    Write-Host 'Warte, bis Shellherd beendet ist ...'
    try { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue } catch { $null = $_ }
    $busy = 'Shellherd laeuft noch. Beende alle Shellherd-Fenster und starte das Update erneut.'
    if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) { throw $busy }
    for ($i = 0; $i -lt 15; $i++) {
        if (@(Get-ShellherdRunningFrom -Directory $InstallDir).Count -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw $busy
}

function Invoke-ShellherdInstall {
    [CmdletBinding()]
    param(
        [string] $Version,
        [string] $InstallerPath,
        [switch] $Silent,
        [string] $PortableDir,
        [switch] $FromApp,
        [string] $SelfPath
    )

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Dieser Installer ist fuer Windows. Unter Linux bitte install.sh verwenden.'
    }
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -ne 'AMD64') { throw 'Shellherd benoetigt Windows x64.' }

    # Read and clear the app values first, so they never survive a rejected run.
    $handoffChild = ((Get-ShellherdEnvValue 'SHELLHERD_INSTALL_HANDOFF') -eq '1')
    $appVersion = $null; $appPidText = $null; $appTarget = $null; $appRelaunch = $null; $appPortable = $null
    if ($FromApp) {
        $appVersion = Get-ShellherdEnvValue 'SHELLHERD_UPDATE_VERSION'
        $appPidText = Get-ShellherdEnvValue 'SHELLHERD_UPDATE_PID'
        $appTarget = Get-ShellherdEnvValue 'SHELLHERD_UPDATE_TARGET'
        $appRelaunch = Get-ShellherdEnvValue 'SHELLHERD_RELAUNCH'
        $appPortable = Get-ShellherdEnvValue 'SHELLHERD_PORTABLE_DIR'
        $null = Get-ShellherdEnvValue 'SHELLHERD_UPDATE_SCRIPT'
    }

    $appPid = 0
    $installDir = $null
    $portable = [bool]$PortableDir
    if ($FromApp) {
        if ($Version -or $InstallerPath -or $PortableDir -or $Silent) {
            throw '-FromApp kann nicht mit anderen Parametern kombiniert werden.'
        }
        $invalid = 'Ungueltige Angaben der App. Installation abgebrochen.'
        if (-not (Test-ShellherdVersion $appVersion)) { throw $invalid }
        if ($appPidText -notmatch '^[1-9][0-9]{0,9}\z' -or [int64]$appPidText -gt [int]::MaxValue) { throw $invalid }
        $appPid = [int]$appPidText
        if ($appTarget -ceq 'setup') {
            if (-not (Test-ShellherdAbsolutePath $appRelaunch)) { throw $invalid }
            if (-not (Test-Path -LiteralPath $appRelaunch -PathType Leaf)) { throw $invalid }
            if ((Split-Path -Leaf $appRelaunch) -ine 'Shellherd.exe') { throw $invalid }
            $installDir = [IO.Path]::GetFullPath((Split-Path -Parent $appRelaunch))
        } elseif ($appTarget -ceq 'portable') {
            if (-not (Test-ShellherdAbsolutePath $appPortable)) { throw $invalid }
            if (-not (Test-Path -LiteralPath $appPortable -PathType Container)) { throw $invalid }
            $PortableDir = $appPortable
            $portable = $true
        } else {
            throw $invalid
        }
        $Version = $appVersion
    }
    if ($Version -and $InstallerPath) { throw '-Version und -InstallerPath koennen nicht kombiniert werden.' }
    if ($Version) {
        $Version = $Version -replace '^v', ''
        if (-not (Test-ShellherdVersion $Version)) { throw 'Ungueltige Release-Version.' }
    }
    if ($PortableDir -and -not $FromApp) {
        if ($InstallerPath -or $Silent) { throw '-PortableDir kann nicht mit -InstallerPath oder -Silent kombiniert werden.' }
        if (-not (Test-ShellherdAbsolutePath $PortableDir)) { throw 'Bitte einen absoluten Ordner fuer -PortableDir angeben.' }
        if (-not (Test-Path -LiteralPath $PortableDir -PathType Container)) { throw "Ordner nicht gefunden: $PortableDir" }
    }

    $workDirectory = Join-Path ([IO.Path]::GetTempPath()) ('shellherd-install-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $workDirectory
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    $handoffNames = @(
        'SHELLHERD_UPDATE_VERSION', 'SHELLHERD_UPDATE_PID', 'SHELLHERD_UPDATE_TARGET',
        'SHELLHERD_RELAUNCH', 'SHELLHERD_PORTABLE_DIR', 'SHELLHERD_INSTALL_HANDOFF'
    )
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
        $setup = Join-Path $workDirectory 'Shellherd-Setup.exe'
        if ($InstallerPath) {
            # A local file is the user's own choice; nothing is verified or handed off.
            if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Setup nicht gefunden: $InstallerPath" }
            if ([IO.Path]::GetExtension($InstallerPath) -ne '.exe') { throw 'Bitte eine Setup-EXE angeben.' }
            Copy-Item -LiteralPath $InstallerPath -Destination $setup
        } else {
            if (-not $Version) {
                $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/pelmenipower/Shellherd/releases/latest'
                $Version = [string]$release.tag_name -replace '^v', ''
            }
            if (-not (Test-ShellherdVersion $Version)) { throw 'Ungueltige Release-Version.' }
            $base = "https://github.com/pelmenipower/Shellherd/releases/download/v$Version"

            # 1. SHA256SUMS, 2. its signature.
            Write-Host "Lade Shellherd $Version herunter ..."
            $checksums = Join-Path $workDirectory 'SHA256SUMS'
            Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $checksums
            Confirm-ShellherdSignature -Base $base -Checksums $checksums -WorkDirectory $workDirectory -Strict:$FromApp

            # 3. Handoff to the installer of the release, before waiting for the app.
            if (-not $handoffChild -and $SelfPath -and (Test-Path -LiteralPath $SelfPath -PathType Leaf)) {
                $selfEntry = Get-ShellherdChecksum -File $checksums -Name 'install.ps1'
                $selfHash = (Get-FileHash -LiteralPath $SelfPath -Algorithm SHA256).Hash
                if ($selfEntry -and $selfHash -ine $selfEntry) {
                    $newScript = Join-Path $workDirectory 'install.ps1'
                    Get-ShellherdAsset -Base $base -Asset 'install.ps1' -Checksums $checksums -Destination $newScript
                    Write-Host "Uebergabe an den Installer von Shellherd $Version ..."
                    $childArguments = @()
                    if ($FromApp) {
                        $childArguments += '-FromApp'
                    } else {
                        $childArguments += @('-Version', $Version)
                        if ($Silent) { $childArguments += '-Silent' }
                        if ($PortableDir) { $childArguments += @('-PortableDir', $PortableDir) }
                    }
                    try {
                        if ($FromApp) {
                            [Environment]::SetEnvironmentVariable('SHELLHERD_UPDATE_VERSION', $Version, 'Process')
                            [Environment]::SetEnvironmentVariable('SHELLHERD_UPDATE_PID', [string]$appPid, 'Process')
                            [Environment]::SetEnvironmentVariable('SHELLHERD_UPDATE_TARGET', $appTarget, 'Process')
                            if ($appTarget -ceq 'setup') {
                                [Environment]::SetEnvironmentVariable('SHELLHERD_RELAUNCH', $appRelaunch, 'Process')
                            } else {
                                [Environment]::SetEnvironmentVariable('SHELLHERD_PORTABLE_DIR', $PortableDir, 'Process')
                            }
                        }
                        [Environment]::SetEnvironmentVariable('SHELLHERD_INSTALL_HANDOFF', '1', 'Process')
                        $childExit = Invoke-ShellherdChild -HostPath (Get-ShellherdHostPath) -ScriptPath $newScript -Arguments $childArguments
                    } finally {
                        foreach ($name in $handoffNames) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue }
                    }
                    if ($childExit -ne 0) { throw "Der Installer von Shellherd $Version ist fehlgeschlagen (Exitcode $childExit)." }
                    return
                }
            }

            # 4. Wait for the app, 5. download and verify the asset.
            if ($FromApp -and -not $portable) { Wait-ShellherdExit -AppPid $appPid -InstallDir $installDir }
            if ($portable) {
                $asset = "Shellherd-Portable-$Version.exe"
            } else {
                $asset = "Shellherd-Setup-$Version.exe"
            }
            Get-ShellherdAsset -Base $base -Asset $asset -Checksums $checksums -Destination $setup
            Test-ShellherdAuthenticode -Path $setup

            if ($portable) {
                $target = Join-Path $PortableDir $asset
                Move-Item -LiteralPath $setup -Destination $target -Force
                Write-Host "Gespeichert: $target. Starte diese Datei; die alte kannst du loeschen."
                return
            }
        }

        # 6. Run the setup.
        $options = @{ FilePath = $setup; Wait = $true; PassThru = $true }
        if ($FromApp) {
            $localRoot = [string]$env:LOCALAPPDATA
            $perUser = $localRoot -and $installDir.StartsWith($localRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
            if ($perUser) {
                Write-Host 'Installiere Shellherd ...'
                $options.ArgumentList = "/S /D=$installDir"
            } else {
                Write-Host 'Das Setup oeffnet sich; folge den Schritten. Es kann nach Administratorrechten fragen.'
            }
        } else {
            Write-Host 'Starte das Shellherd-Setup (Installation fuer den aktuellen Benutzer) ...'
            if ($Silent) { $options.ArgumentList = @('/S') }
        }
        $process = Start-Process @options
        if ($process.ExitCode -notin @(0, 3010)) { throw "Setup fehlgeschlagen oder abgebrochen (Exitcode $($process.ExitCode))." }
        if ($FromApp) {
            Start-Process -FilePath $appRelaunch -WorkingDirectory $env:USERPROFILE
            Write-Host "Shellherd $Version ist installiert und wird gestartet."
        } else {
            Write-Host 'Shellherd ist installiert. Starte die Anwendung ueber das Startmenue.'
        }
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol
        Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    # Only the outermost -FromApp run owns the window; a handoff child must not wait for Enter.
    $ownsWindow = $FromApp -and ([Environment]::GetEnvironmentVariable('SHELLHERD_INSTALL_HANDOFF', 'Process') -ne '1')
    $failed = $false
    try {
        Invoke-ShellherdInstall -Version $Version -InstallerPath $InstallerPath -Silent:$Silent `
            -PortableDir $PortableDir -FromApp:$FromApp -SelfPath $PSCommandPath
    } catch {
        if (-not $ownsWindow) { throw }
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host 'Falls Shellherd nicht mehr laeuft, starte es neu.'
        $failed = $true
    } finally {
        if ($ownsWindow) {
            try { $null = Read-Host 'Enter zum Schliessen' } catch { $null = $_ }
        }
    }
    if ($failed) { exit 1 }
}
