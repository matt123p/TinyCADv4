param()

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$envFilePath = Join-Path $workspaceRoot '.env.local'
$releasePath = Join-Path $workspaceRoot 'release'

function Read-EnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
      continue
    }

    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) {
      continue
    }

    $key = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    $values[$key] = $value.Trim('"').Trim("'")
  }

  return $values
}

function Get-LatestSignTool {
  $candidates = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' }

  if (-not $candidates) {
    throw 'Unable to find an x64 Windows SDK signtool.exe. Install the Windows 10/11 SDK first.'
  }

  return $candidates |
    Sort-Object { [version]($_.Directory.Parent.Name) } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

$envValues = Read-EnvFile -Path $envFilePath
foreach ($requiredKey in 'TEST_CSC_LINK', 'TEST_CSC_KEY_PASSWORD') {
  if (-not $envValues.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($envValues[$requiredKey])) {
    throw "Missing $requiredKey in .env.local. Run npm run setup:test-appx first."
  }
}

$signtoolPath = Get-LatestSignTool
$certificatePath = $envValues['TEST_CSC_LINK']
$certificatePassword = $envValues['TEST_CSC_KEY_PASSWORD']

if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw "Certificate file not found: $certificatePath"
}

$packages = @(Get-ChildItem -LiteralPath $releasePath -File |
  Where-Object { $_.Extension -in '.appx', '.msix' })
if ($packages.Count -eq 0) {
  throw 'No AppX or MSIX package found in release/. Run npm run dist -- --win appx --test-appx first.'
}

foreach ($package in $packages) {
  Write-Host "Signing $($package.FullName) with $signtoolPath"
  & $signtoolPath sign /f $certificatePath /p $certificatePassword /fd sha256 $package.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed while signing $($package.FullName)"
  }
}

Write-Host 'Signed test AppX/MSIX package(s) successfully.'