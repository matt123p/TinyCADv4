param(
  [string]$OutputDir = ".certs/appx",
  [string]$Publisher,
  [switch]$MachineWide,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$envFilePath = Join-Path $workspaceRoot '.env.local'
$outputPath = Join-Path $workspaceRoot $OutputDir

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Import-PublicCertificate {
  param(
    [string]$CertificatePath,
    [switch]$MachineWide
  )

  Import-Certificate -FilePath $CertificatePath -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null
  Import-Certificate -FilePath $CertificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

  if ($MachineWide) {
    if (-not (Test-IsAdministrator)) {
      throw 'Machine-wide certificate trust requires an elevated PowerShell session.'
    }

    Import-Certificate -FilePath $CertificatePath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
    Import-Certificate -FilePath $CertificatePath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  }
}

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

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $content = ''
  if (Test-Path -LiteralPath $Path) {
    $content = Get-Content -LiteralPath $Path -Raw
  }

  $escapedKey = [regex]::Escape($Key)
  $lineValue = "$Key=$Value"
  if ($content -match "(?m)^$escapedKey=") {
    $content = [regex]::Replace($content, "(?m)^$escapedKey=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $lineValue })
  }
  else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$lineValue`r`n"
  }

  Set-Content -LiteralPath $Path -Value $content -Encoding UTF8
}

function Get-ExistingConfig {
  $fileValues = Read-EnvFile -Path $envFilePath
  return [pscustomobject]@{
    Values = $fileValues
    TestPublisher = if ($fileValues.ContainsKey('TEST_APPX_PUBLISHER')) { $fileValues['TEST_APPX_PUBLISHER'] } else { '' }
    TestCscLink = if ($fileValues.ContainsKey('TEST_CSC_LINK')) { $fileValues['TEST_CSC_LINK'] } else { '' }
    TestCscKeyPassword = if ($fileValues.ContainsKey('TEST_CSC_KEY_PASSWORD')) { $fileValues['TEST_CSC_KEY_PASSWORD'] } else { '' }
    StorePublisher = if ($fileValues.ContainsKey('APPX_PUBLISHER')) { $fileValues['APPX_PUBLISHER'] } elseif ($env:APPX_PUBLISHER) { $env:APPX_PUBLISHER } else { '' }
  }
}

function New-Password {
  return (([guid]::NewGuid().ToString('N')) + 'Aa1!')
}

$existingConfig = Get-ExistingConfig
$resolvedPublisher = if ($Publisher) {
  $Publisher
}
elseif ($existingConfig.StorePublisher) {
  $existingConfig.StorePublisher
}
elseif ($existingConfig.TestPublisher) {
  $existingConfig.TestPublisher
}
else {
  'CN=TinyCAD.Local.Test'
}

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$safeFileName = ($resolvedPublisher -replace '[^A-Za-z0-9.-]', '_')
$pfxPath = Join-Path $outputPath "$safeFileName.pfx"
$cerPath = Join-Path $outputPath "$safeFileName.cer"

$canReuseExisting = -not $Force `
  -and $existingConfig.TestPublisher -eq $resolvedPublisher `
  -and $existingConfig.TestCscLink `
  -and (Test-Path -LiteralPath $existingConfig.TestCscLink) `
  -and $existingConfig.TestCscKeyPassword

if ($canReuseExisting) {
  if (Test-Path -LiteralPath $cerPath) {
    Import-PublicCertificate -CertificatePath $cerPath -MachineWide:$MachineWide
  }

  Write-Host "Using existing test AppX certificate for $resolvedPublisher"
  if ($MachineWide) {
    Write-Host 'Certificate trust refreshed in CurrentUser and LocalMachine stores.'
  }
  exit 0
}

$password = New-Password
$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force

if (Test-Path -LiteralPath $pfxPath) {
  Remove-Item -LiteralPath $pfxPath -Force
}

if (Test-Path -LiteralPath $cerPath) {
  Remove-Item -LiteralPath $cerPath -Force
}

$certificate = New-SelfSignedCertificate `
  -Type Custom `
  -Subject $resolvedPublisher `
  -FriendlyName 'TinyCAD local AppX test certificate' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(3) `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')

Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null
Import-PublicCertificate -CertificatePath $cerPath -MachineWide:$MachineWide

Set-EnvValue -Path $envFilePath -Key 'TEST_APPX_PUBLISHER' -Value $resolvedPublisher
Set-EnvValue -Path $envFilePath -Key 'TEST_CSC_LINK' -Value $pfxPath
Set-EnvValue -Path $envFilePath -Key 'TEST_CSC_KEY_PASSWORD' -Value $password

Write-Host "Created test AppX certificate for $resolvedPublisher"
Write-Host "Updated $envFilePath with TEST_APPX_PUBLISHER, TEST_CSC_LINK, and TEST_CSC_KEY_PASSWORD"
if ($MachineWide) {
  Write-Host "Public certificate trusted in CurrentUser and LocalMachine TrustedPeople/Root: $cerPath"
}
else {
  Write-Host "Public certificate trusted for current user in TrustedPeople and Root: $cerPath"
  Write-Host 'If Add-AppxPackage still reports 0x800B0109, run this script again from an elevated shell with -MachineWide.'
}