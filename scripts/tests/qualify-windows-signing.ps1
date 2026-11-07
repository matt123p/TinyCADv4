param([string]$SignToolPath)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $workspace
if (-not $SignToolPath) {
  $SignToolPath = Get-ChildItem "$env:LOCALAPPDATA/electron-builder/Cache" -Filter signtool.exe -Recurse |
    Where-Object FullName -Match 'windows-10[\\/]x64[\\/]signtool.exe$' |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $SignToolPath) { throw 'Build AppX first to obtain signtool, or pass -SignToolPath.' }
$qualificationRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'build/qualification'))
$packageRoot = Join-Path $qualificationRoot ('authenticode-' + [guid]::NewGuid().ToString('N'))
$engine = Join-Path $packageRoot 'resources/ngspice'
New-Item -ItemType Directory -Path (Split-Path -Parent $engine) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'build/engines/native') -Destination $engine -Recurse
$manifest = Get-Content -LiteralPath (Join-Path $engine 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.platform -ne 'win32') { throw 'A Windows native engine is required.' }
$arch = if ($manifest.arch -eq 'x64') { 1 } elseif ($manifest.arch -eq 'arm64') { 3 } else { throw 'Unsupported Windows architecture.' }
$pfxPath = Join-Path $packageRoot 'ephemeral.pfx'
$password = [guid]::NewGuid().ToString('N')
$rsa = $null
$certificate = $null
$originalEnvironment = @{}
foreach ($name in @('TEMP', 'TMP', 'TINYCAD_NATIVE_ENGINE_DIR', 'TINYCAD_SIGNING_TEST_ROOT', 'TINYCAD_SIGNING_TEST_ARCH')) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  # CertificateRequest creates an in-memory self-signed leaf. No certificate
  # store, trust root, existing signing identity or .env configuration is used.
  $parameters = [Security.Cryptography.CspParameters]::new()
  $parameters.ProviderType = 24
  $parameters.Flags = [Security.Cryptography.CspProviderFlags]::CreateEphemeralKey
  $rsa = [Security.Cryptography.RSACryptoServiceProvider]::new(2048, $parameters)
  $rsa.PersistKeyInCsp = $false
  $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=TinyCAD Automated Qualification', $rsa,
    [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $usage = [Security.Cryptography.OidCollection]::new()
  $usage.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage, $true))
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
  $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))
  [IO.File]::WriteAllBytes($pfxPath, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
  foreach ($name in @($manifest.helper, $manifest.library)) {
    $binary = Join-Path $engine $name
    & $SignToolPath sign /fd SHA256 /f $pfxPath /p $password $binary
    if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $binary
    if ($signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or
        $signature.Status -in @('NotSigned', 'HashMismatch')) { throw "Invalid test signature: $name" }
    Write-Output "$name signature: $($signature.Status) (self-signed test identity)"
    Write-Output $signature.StatusMessage
  }
  $env:TINYCAD_SIGNING_TEST_ROOT = $packageRoot
  $env:TINYCAD_SIGNING_TEST_ARCH = $arch
  node -e "require('./scripts/finalize-signed-engine.cjs')({electronPlatformName:'win32',arch:Number(process.env.TINYCAD_SIGNING_TEST_ARCH),appOutDir:process.env.TINYCAD_SIGNING_TEST_ROOT}).catch(e=>{console.error(e);process.exitCode=1;});"
  if ($LASTEXITCODE -ne 0) { throw 'Signed engine manifest finalization failed.' }
  $env:TINYCAD_NATIVE_ENGINE_DIR = $engine
  $env:TEMP = $qualificationRoot
  $env:TMP = $qualificationRoot
  node scripts/tests/qualify-engines.mjs native
  if ($LASTEXITCODE -ne 0) { throw 'Signed native engine failed its numerical fixtures.' }
  Write-Output 'Signed helper/library hashes and native numerical fixtures passed.'
} finally {
  if ($certificate) { $certificate.Dispose() }
  if ($rsa) { $rsa.Dispose() }
  if (Test-Path -LiteralPath $pfxPath) { Remove-Item -LiteralPath $pfxPath -Force }
  $password = $null
  foreach ($name in $originalEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
  }
  Write-Output 'Ephemeral PFX removed; certificate stores were not modified.'
}
