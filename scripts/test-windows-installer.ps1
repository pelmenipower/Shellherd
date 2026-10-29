# Dependency-free installer tests; downloads and setup execution are mocked.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '../install.ps1'
$parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. $installer
$script:started = @()
$script:badHash = $false
$script:duplicateHash = $false
$script:setupExit = 0
$script:downloads = 0
function Invoke-RestMethod { param($Uri) return @{ tag_name = 'v1.2.3' } }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $OutFile)
    $script:downloads++
    if ($Uri.EndsWith('/SHA256SUMS')) {
        $setup = Join-Path (Split-Path $OutFile) 'Shellherd-Setup.exe'
        $hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($script:badHash) { $hash = '0' * 64 }
        $line = "$hash  Shellherd-Setup-1.2.3.exe"
        if ($script:duplicateHash) { $line += "`n$line" }
        Set-Content -LiteralPath $OutFile -Value $line -Encoding ASCII
    } else {
        [IO.File]::WriteAllText($OutFile, 'synthetic installer, never executed')
    }
}
function Start-Process {
    param($FilePath, [switch]$Wait, [switch]$PassThru, $ArgumentList)
    if (-not $Wait -or -not $PassThru) { throw 'Setup must be awaited.' }
    $script:started += @{ Path = $FilePath; Arguments = @($ArgumentList) }
    return @{ ExitCode = $script:setupExit }
}
function Assert-Rejected {
    param([scriptblock] $Action)
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected installation to be rejected.' }
}
Invoke-ShellherdInstall
if ($script:started.Count -ne 1) { throw 'Expected exactly one setup.' }
if (Test-Path -LiteralPath $script:started[0].Path) { throw 'Temporary setup was not removed.' }
Invoke-ShellherdInstall -Version 'v1.2.3' -Silent
if ($script:started[1].Arguments[0] -ne '/S') { throw 'Silent flag missing.' }
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
if ($script:started.Count -ne 3) { throw 'Rejected downloads must never start a setup.' }
Write-Host 'Windows installer tests passed: parsing, download, checksums, cleanup, silent flag and setup errors.'
