# Checks Authenticode signatures of the Windows package (dist/win-unpacked) or of installer files.
# Run by release.yml on the Windows runner. Windows PowerShell 5.1 and PowerShell 7.
#   -Root <folder>              every .exe/.dll/.node below the folder
#   -Files <file[]>             the given files (setup and portable EXE)
#   -Expect Signed|Unsigned     what the signing step produced
#   -InstallCheck               with -Files: run the Setup silently and check the installed folder
param(
    [string] $Root,
    [string[]] $Files,
    [Parameter(Mandatory = $true)][ValidateSet('Signed', 'Unsigned')][string] $Expect,
    [switch] $InstallCheck
)
$ErrorActionPreference = 'Stop'

# Files that must carry our own signature (relative paths with forward slashes).
function Test-ShellherdPinned {
    param([string] $RelativePath)
    $p = $RelativePath.Replace('\', '/')
    if ($p -ieq 'Shellherd.exe') { return $true }
    if ($p -imatch '^resources/rdp-host/[^/]+\.exe$') { return $true }
    if ($p -imatch '^resources/hello/[^/]+\.exe$') { return $true }
    if ($p -imatch '^resources/app\.asar\.unpacked/.+\.node$') { return $true }
    if ($p -imatch '(^|/)winpty-agent\.exe$') { return $true }
    if ($p -imatch '(^|/)winpty\.dll$') { return $true }
    return $false
}

# Pure rule check. Entries: @{ Path; Status; HasTimestamp; Pinned }. Status is Valid, NotSigned,
# Unverifiable (no tool could tell) or any other Authenticode status. Returns problem texts.
function Test-ShellherdSignatures {
    param([object[]] $Entries, [string] $Expect)
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($e in $Entries) {
        $path = [string]$e.Path
        $status = [string]$e.Status
        if ($status -eq 'Unverifiable') {
            $problems.Add("${path}: signature cannot be checked")
            continue
        }
        if ($Expect -eq 'Signed') {
            if ($e.Pinned) {
                if ($status -ne 'Valid') { $problems.Add("${path}: expected a valid signature but status is $status") }
                elseif (-not $e.HasTimestamp) { $problems.Add("${path}: signature has no timestamp") }
            } elseif ($status -ne 'Valid') {
                # Foreign valid signatures (Microsoft DLLs) pass; anything else does not.
                $problems.Add("${path}: unsigned or invalid ($status)")
            }
        } else {
            if ($e.Pinned -and $status -ne 'NotSigned') { $problems.Add("${path}: expected unsigned but status is $status") }
        }
    }
    return , @($problems.ToArray())
}

# Pure rule check of the installed folder: paths relative to the install dir.
function Test-ShellherdInstall {
    param([string[]] $Present)
    $problems = New-Object System.Collections.Generic.List[string]
    $norm = @($Present | ForEach-Object { $_.Replace('\', '/') })
    if (-not ($norm -icontains 'Shellherd.exe')) { $problems.Add('Shellherd.exe is missing in the installation') }
    if ($norm -icontains 'resources/elevate.exe') { $problems.Add('resources/elevate.exe must not be installed (unsigned helper)') }
    return , @($problems.ToArray())
}

function Find-Signtool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path -LiteralPath $kits) {
        $found = Get-ChildItem -LiteralPath $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Get-ShellherdEntry {
    param([string] $FullPath, [string] $RelativePath, [bool] $Pinned)
    $status = 'Unverifiable'
    $stamp = $false
    $sig = $null
    try { $sig = Get-AuthenticodeSignature -LiteralPath $FullPath } catch { $sig = $null }
    # Statuses other than Valid/NotSigned can mean "not a recognised format" (for example .node); ask signtool then.
    if ($sig -and ($sig.Status -eq 'Valid' -or $sig.Status -eq 'NotSigned')) {
        $status = [string]$sig.Status
        $stamp = ($status -eq 'Valid') -and ($null -ne $sig.TimeStamperCertificate)
    } else {
        $signtool = Find-Signtool
        if ($signtool) {
            $out = & $signtool verify /pa /v $FullPath 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                $status = 'Valid'
                $stamp = $out -match 'timestamp'
            } elseif ($out -match 'No signature found') {
                $status = 'NotSigned'
            }
        } elseif ($sig) {
            $status = [string]$sig.Status
        }
    }
    return @{ Path = $RelativePath; Status = $status; HasTimestamp = $stamp; Pinned = $Pinned }
}

function Get-RootEntries {
    param([string] $Folder, [switch] $SkipUninstaller)
    $base = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\')
    $entries = @()
    $items = Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.node' }
    foreach ($item in $items) {
        $relative = $item.FullName.Substring($base.Length + 1).Replace('\', '/')
        if ($relative -ieq 'Uninstall Shellherd.exe') {
            # Information only: the uninstaller stays unsigned for now.
            $info = Get-AuthenticodeSignature -LiteralPath $item.FullName
            Write-Host "Info: $relative status $($info.Status) (not rated)"
            continue
        }
        $entries += Get-ShellherdEntry -FullPath $item.FullName -RelativePath $relative -Pinned (Test-ShellherdPinned $relative)
    }
    return , $entries
}

function Invoke-ShellherdSignatureCheck {
    $problems = New-Object System.Collections.Generic.List[string]
    if ($InstallCheck -and -not $Files) { throw '-InstallCheck needs -Files.' }
    if (-not $Root -and -not $Files) { throw 'Give -Root or -Files.' }
    if ($Root) {
        $entries = Get-RootEntries -Folder $Root
        if (@($entries).Count -eq 0) { $problems.Add("${Root}: no files found") }
        foreach ($p in @(Test-ShellherdSignatures -Entries $entries -Expect $Expect)) { $problems.Add($p) }
    }
    if ($Files) {
        $fileEntries = @()
        $resolved = @()
        foreach ($pattern in $Files) {
            $found = @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue)
            if ($found.Count -eq 0) { $problems.Add("${pattern}: no file found") }
            $resolved += $found
        }
        foreach ($file in $resolved) {
            $fileEntries += Get-ShellherdEntry -FullPath $file.FullName -RelativePath $file.Name -Pinned $true
        }
        foreach ($p in @(Test-ShellherdSignatures -Entries $fileEntries -Expect $Expect)) { $problems.Add($p) }
        if ($InstallCheck) {
            $setup = $resolved | Where-Object { $_.Name -like 'Shellherd-Setup-*.exe' } | Select-Object -First 1
            if (-not $setup) { $problems.Add('-InstallCheck: no Shellherd-Setup-*.exe in -Files') }
            else {
                $tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
                $dir = Join-Path $tempBase 'shellherd-install'
                if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
                # /D must be the last argument and unquoted.
                $proc = Start-Process -FilePath $setup.FullName -ArgumentList "/S /D=$dir" -Wait -PassThru
                if ($proc.ExitCode -ne 0) { $problems.Add("Setup failed with exit code $($proc.ExitCode)") }
                elseif (-not (Test-Path -LiteralPath $dir)) { $problems.Add("Setup did not create $dir") }
                else {
                    $present = @(Get-ChildItem -LiteralPath $dir -Recurse -File | ForEach-Object { $_.FullName.Substring($dir.Length + 1) })
                    foreach ($p in @(Test-ShellherdInstall -Present $present)) { $problems.Add($p) }
                    $installed = Get-RootEntries -Folder $dir
                    foreach ($p in @(Test-ShellherdSignatures -Entries $installed -Expect $Expect)) { $problems.Add($p) }
                }
            }
        }
    }
    return , @($problems.ToArray())
}

# Dot-sourcing (the tests) only loads the functions.
if ($MyInvocation.InvocationName -ne '.') {
    $result = @(Invoke-ShellherdSignatureCheck)
    if ($result.Count -gt 0) {
        $result | ForEach-Object { Write-Host "ERROR: $_" -ForegroundColor Red }
        exit 1
    }
    Write-Host "Signature check passed (expected: $Expect)."
}
