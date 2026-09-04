# Zeru SQL - compila e instala a partir do codigo-fonte (Windows).
#
# Um app compilado na propria maquina nao dispara o SmartScreen: aquele aviso
# vem da marca que o navegador poe em arquivos BAIXADOS. Aqui nada e baixado
# alem do codigo, entao nao ha aviso - e nenhum certificado pago e necessario.
#
# Uso (PowerShell):
#   .\scripts\install.ps1
#   .\scripts\install.ps1 -BuildOnly
#
# Se o PowerShell reclamar de politica de execucao:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1

[CmdletBinding()]
param(
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoUrl      = 'https://github.com/gabrielrcosta1/zeru-sql.git'
$NodeMajorMin = 24   # LTS atual
$BuildHome    = Join-Path $env:LOCALAPPDATA 'zeru-build'

function Write-Info  { param($m) Write-Host "> $m" -ForegroundColor Cyan }
function Write-Warn  { param($m) Write-Host "! $m" -ForegroundColor Yellow }
function Write-Step  { param($m) Write-Host $m -ForegroundColor White -BackgroundColor DarkBlue }
function Fail        { param($m) Write-Host "x $m" -ForegroundColor Red; exit 1 }

function Test-Command { param($Name) $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

function Assert-NativeSuccess {
    param($What)
    if ($LASTEXITCODE -ne 0) { Fail "$What falhou (codigo $LASTEXITCODE)." }
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------- codigo-fonte do app

$Repo = $null
if ($PSScriptRoot) {
    $candidate = Split-Path -Parent $PSScriptRoot
    if (Test-Path (Join-Path $candidate 'src-tauri\tauri.conf.json')) { $Repo = $candidate }
}

if (-not $Repo) {
    if (-not (Test-Command git)) { Fail 'git nao encontrado - instale o Git for Windows e rode de novo.' }
    $Repo = Join-Path $BuildHome 'zeru-sql'
    if (Test-Path (Join-Path $Repo '.git')) {
        Write-Info "Atualizando o codigo em $Repo"
        git -C $Repo pull --ff-only; Assert-NativeSuccess 'git pull'
    } else {
        Write-Info "Baixando o codigo para $Repo"
        New-Item -ItemType Directory -Force -Path $BuildHome | Out-Null
        git clone --depth 1 $RepoUrl $Repo; Assert-NativeSuccess 'git clone'
    }
}

Write-Step " Zeru SQL - compilando de $Repo "

# ------------------------------------------------ compilador C++ (MSVC) e SDK

function Test-MsvcTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $false }
    $found = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    return [bool]$found
}

if (-not (Test-MsvcTools)) {
    Write-Warn 'As ferramentas de compilacao C++ da Microsoft (MSVC) nao foram encontradas.'
    Write-Warn 'O Rust precisa delas para linkar o app no Windows.'
    if (-not (Test-Admin)) {
        Write-Host ''
        Write-Host 'Abra o PowerShell COMO ADMINISTRADOR e rode:' -ForegroundColor Yellow
        Write-Host '  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"' -ForegroundColor Gray
        Write-Host ''
        Write-Host 'Depois rode este script de novo (nao precisa ser admin).' -ForegroundColor Yellow
        exit 1
    }
    if (-not (Test-Command winget)) { Fail 'winget nao disponivel - instale o "Visual Studio Build Tools 2022" com a carga de trabalho "Desenvolvimento para desktop com C++".' }
    Write-Info 'Instalando o Visual Studio Build Tools (demora alguns minutos)'
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements `
        --override '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if (-not (Test-MsvcTools)) { Fail 'MSVC ainda nao detectado. Reinicie o terminal e rode de novo.' }
}
Write-Info 'Ferramentas C++ (MSVC) encontradas'

# --------------------------------------------------------------- WebView2

$wv2Keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$hasWebView2 = $wv2Keys | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hasWebView2) {
    Write-Info 'Instalando o runtime do WebView2 (o app usa o motor do Edge para a interface)'
    $bootstrapper = Join-Path $env:TEMP 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
    Start-Process -FilePath $bootstrapper -ArgumentList '/silent','/install' -Wait
} else {
    Write-Info 'WebView2 encontrado'
}

# ---------------------------------------------------------------- Node.js

# Nao use `node -p '...'` aqui: o PowerShell come as aspas duplas ao passar o
# argumento para um .exe nativo, o script quebra em silencio e a deteccao vira 0.
$script:NodeExe = 'node'
function Get-NodeMajor {
    $exe = $script:NodeExe
    if ($exe -eq 'node') {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $cmd) { return 0 }
        $exe = $cmd.Source
    }
    if (-not (Test-Path $exe)) { return 0 }
    $out = & $exe -v 2>$null
    if ("$out" -match 'v(\d+)\.') { return [int]$Matches[1] }
    return 0
}

if ((Get-NodeMajor) -lt $NodeMajorMin) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    # Sem versao fixa: pega o patch mais novo da linha LTS atual.
    $base = "https://nodejs.org/dist/latest-v$NodeMajorMin.x"
    $index = (Invoke-WebRequest -Uri "$base/" -UseBasicParsing).Content
    $file = [regex]::Match($index, "node-v[\d.]+-win-$arch\.zip").Value
    if (-not $file) { Fail "Nao consegui descobrir a versao mais recente do Node $NodeMajorMin.x." }
    $nodeDir = Join-Path $BuildHome ($file -replace '\.zip$','')
    if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
        Write-Info "Instalando $file em $BuildHome (local, nao mexe no sistema)"
        New-Item -ItemType Directory -Force -Path $BuildHome | Out-Null
        $zip = Join-Path $env:TEMP $file
        Invoke-WebRequest -Uri "$base/$file" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $BuildHome -Force
        Remove-Item $zip -Force
    }
    if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
        Fail "Node extraido mas node.exe nao esta em $nodeDir"
    }
    $script:NodeExe = Join-Path $nodeDir 'node.exe'
    $env:Path = "$nodeDir;$env:Path"
}
if ((Get-NodeMajor) -lt $NodeMajorMin) { Fail 'Nao foi possivel preparar o Node.' }
Write-Info "Node $(& $script:NodeExe -v) pronto"

# ------------------------------------------------------------------- Rust

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if ((-not (Test-Command cargo)) -and (Test-Path (Join-Path $cargoBin 'cargo.exe'))) {
    $env:Path = "$cargoBin;$env:Path"
}
if (-not (Test-Command cargo)) {
    Write-Info 'Instalando o Rust (rustup) - baixa cerca de 1 GB de toolchain'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
    $rustup = Join-Path $env:TEMP 'rustup-init.exe'
    Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/$arch/rustup-init.exe" -OutFile $rustup
    & $rustup -y --no-modify-path --default-toolchain stable | Out-Host
    Assert-NativeSuccess 'rustup-init'
    $env:Path = "$cargoBin;$env:Path"
}
if (-not (Test-Command cargo)) { Fail 'cargo nao ficou disponivel no PATH.' }
Write-Info "Rust $((rustc --version).Split(' ')[1]) encontrado"

# ------------------------------------------------------------------ build

Set-Location $Repo

Write-Info 'Instalando dependencias do frontend'
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
Assert-NativeSuccess 'npm'

Write-Step ' Compilando (a primeira vez leva de 10 a 25 minutos) '
npm run tauri build -- --bundles nsis
Assert-NativeSuccess 'tauri build'

$bundleDir = Join-Path $Repo 'src-tauri\target\release\bundle'

if ($BuildOnly) {
    Write-Step " Pronto - instalador em $bundleDir\nsis "
    exit 0
}

# ---------------------------------------------------------------- instalar

$setup = Get-ChildItem -Path (Join-Path $bundleDir 'nsis') -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
         Select-Object -First 1
if (-not $setup) { Fail "Instalador nao encontrado em $bundleDir\nsis" }

Write-Info "Instalando $($setup.Name)"
$proc = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    Write-Warn "O instalador retornou $($proc.ExitCode). Rode manualmente: $($setup.FullName)"
    exit 1
}

Write-Step ' Instalado - procure por "Zeru" no menu Iniciar. '
