#!/usr/bin/env bash
# Zeru SQL — compila e instala a partir do código-fonte (macOS e Linux).
#
# Um app compilado na própria máquina não passa pelo Gatekeeper nem pelo
# SmartScreen: esses avisos existem por causa do atributo de quarentena que o
# navegador põe em arquivos BAIXADOS. Nada é baixado aqui além do código, então
# não há aviso nenhum — e nenhum certificado pago é necessário.
#
# Uso:
#   ./scripts/install.sh                 # compila e instala
#   ./scripts/install.sh --build-only    # só compila, não instala
#
# Ou direto, sem clonar antes:
#   curl -fsSL https://raw.githubusercontent.com/gabrielrcosta1/zeru-sql/main/scripts/install.sh | bash

set -euo pipefail

REPO_URL="https://github.com/gabrielrcosta1/zeru-sql.git"
NODE_MAJOR_MIN=24   # LTS atual
BUILD_HOME="${ZERU_BUILD_HOME:-$HOME/.zeru-build}"
BUILD_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opção desconhecida: $arg" >&2; exit 1 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m›\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- plataforma

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  *) fail "Sistema não suportado por este script: $OS (no Windows use scripts/install.ps1)" ;;
esac

# ------------------------------------------------------- código-fonte do app

SCRIPT_SRC="${BASH_SOURCE[0]:-}"
REPO=""
if [ -n "$SCRIPT_SRC" ] && [ -f "$SCRIPT_SRC" ]; then
  CANDIDATE="$(cd "$(dirname "$SCRIPT_SRC")/.." && pwd)"
  [ -f "$CANDIDATE/src-tauri/tauri.conf.json" ] && REPO="$CANDIDATE"
fi

if [ -z "$REPO" ]; then
  command -v git >/dev/null 2>&1 || fail "git não encontrado — instale o git e rode de novo."
  REPO="$BUILD_HOME/zeru-sql"
  if [ -d "$REPO/.git" ]; then
    info "Atualizando o código em $REPO"
    git -C "$REPO" pull --ff-only
  else
    info "Baixando o código para $REPO"
    mkdir -p "$BUILD_HOME"
    git clone --depth 1 "$REPO_URL" "$REPO"
  fi
fi

bold "Zeru SQL — compilando de $REPO"

# --------------------------------------------------- dependências de sistema

ensure_macos_deps() {
  if ! xcode-select -p >/dev/null 2>&1; then
    warn "As Ferramentas de Linha de Comando do Xcode não estão instaladas."
    warn "Vai abrir uma janela do sistema. Conclua a instalação e rode este script de novo."
    xcode-select --install || true
    exit 1
  fi
}

ensure_linux_deps() {
  local sudo_cmd=""
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then sudo_cmd="sudo"; else
      warn "Sem sudo: não dá para instalar as bibliotecas de sistema automaticamente."
      warn "Instale o equivalente a: webkit2gtk 4.1, gtk3, librsvg, libsoup3, appindicator, build-essential, patchelf"
      return 0
    fi
  fi

  if command -v apt-get >/dev/null 2>&1; then
    info "Instalando dependências (apt)"
    $sudo_cmd apt-get update
    $sudo_cmd apt-get install -y \
      build-essential curl wget file pkg-config libssl-dev \
      libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev \
      libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf
  elif command -v dnf >/dev/null 2>&1; then
    info "Instalando dependências (dnf)"
    $sudo_cmd dnf install -y \
      gcc gcc-c++ make curl wget file openssl-devel \
      webkit2gtk4.1-devel libsoup3-devel gtk3-devel librsvg2-devel \
      libappindicator-gtk3-devel patchelf
  elif command -v pacman >/dev/null 2>&1; then
    info "Instalando dependências (pacman)"
    $sudo_cmd pacman -Sy --needed --noconfirm \
      base-devel curl wget file openssl webkit2gtk-4.1 libsoup3 gtk3 \
      librsvg libayatana-appindicator patchelf
  elif command -v zypper >/dev/null 2>&1; then
    info "Instalando dependências (zypper)"
    $sudo_cmd zypper install -y \
      gcc gcc-c++ make curl wget file libopenssl-devel \
      webkit2gtk3-devel libsoup-devel gtk3-devel librsvg-devel \
      libappindicator3-devel patchelf
  else
    warn "Gerenciador de pacotes não reconhecido — instale manualmente:"
    warn "webkit2gtk 4.1, libsoup3, gtk3, librsvg, appindicator, compilador C, patchelf"
  fi
}

if [ "$PLATFORM" = macos ]; then ensure_macos_deps; else ensure_linux_deps; fi

# ------------------------------------------------------------------ Node.js

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MAJOR_MIN" ]
}

install_node_local() {
  local slug file url dest
  case "$PLATFORM-$ARCH" in
    macos-arm64)         slug="darwin-arm64" ;;
    macos-x86_64)        slug="darwin-x64" ;;
    linux-x86_64)        slug="linux-x64" ;;
    linux-aarch64|linux-arm64) slug="linux-arm64" ;;
    *) fail "Arquitetura sem build oficial do Node: $ARCH — instale o Node $NODE_MAJOR_MIN+ manualmente." ;;
  esac
  dest="$BUILD_HOME/node"
  if [ ! -x "$dest/bin/node" ]; then
    # Sem versão fixa: pega o patch mais novo da linha LTS atual.
    local base="https://nodejs.org/dist/latest-v$NODE_MAJOR_MIN.x"
    file="$(curl -fsSL "$base/" | grep -o "node-v[0-9][0-9.]*-$slug\.tar\.gz" | head -n1)"
    [ -n "$file" ] || fail "Não consegui descobrir a versão mais recente do Node $NODE_MAJOR_MIN.x."
    info "Instalando ${file%%-$slug*} em $dest (local, não mexe no sistema)"
    mkdir -p "$dest"
    curl -fsSL "$base/$file" | tar -xz -C "$dest" --strip-components=1
  fi
  export PATH="$dest/bin:$PATH"
}

if node_ok; then
  info "Node $(node -v) encontrado"
else
  install_node_local
  node_ok || fail "Falha ao preparar o Node."
  info "Node $(node -v) pronto"
fi

# --------------------------------------------------------------------- Rust

if ! command -v cargo >/dev/null 2>&1; then
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  info "Instalando o Rust (rustup) — isso baixa ~1 GB de toolchain"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain stable
  . "$HOME/.cargo/env"
fi
command -v cargo >/dev/null 2>&1 || fail "cargo não ficou disponível no PATH."
info "Rust $(rustc --version | awk '{print $2}') encontrado"

# ------------------------------------------------------------------- build

cd "$REPO"

info "Instalando dependências do frontend"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

if [ "$PLATFORM" = macos ]; then
  BUNDLES="app"
else
  if command -v dpkg >/dev/null 2>&1; then BUNDLES="deb"
  elif command -v rpm >/dev/null 2>&1; then BUNDLES="rpm"
  else BUNDLES="appimage"; fi
fi

bold "Compilando (a primeira vez leva de 10 a 25 minutos)"
npm run tauri build -- --bundles "$BUNDLES"

BUNDLE_DIR="$REPO/src-tauri/target/release/bundle"

if [ "$BUILD_ONLY" -eq 1 ]; then
  bold "Pronto — artefatos em $BUNDLE_DIR"
  exit 0
fi

# ----------------------------------------------------------------- instalar

install_macos() {
  local app dest
  app="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' | head -n1)"
  [ -n "$app" ] || fail "Bundle .app não encontrado em $BUNDLE_DIR/macos"

  dest="/Applications"
  [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }

  local target="$dest/$(basename "$app")"
  info "Instalando em $target"
  rm -rf "$target"
  cp -R "$app" "$dest/"
  # Assinatura ad-hoc local: sem certificado, só para o binário rodar em Apple Silicon.
  codesign --force --deep --sign - "$target" >/dev/null 2>&1 || true
  xattr -cr "$target" 2>/dev/null || true

  bold "Instalado: $target"
  echo "Abra pelo Launchpad ou com: open \"$target\""
}

install_linux() {
  local pkg
  case "$BUNDLES" in
    deb)
      pkg="$(find "$BUNDLE_DIR/deb" -maxdepth 1 -name '*.deb' | head -n1)"
      [ -n "$pkg" ] || fail ".deb não encontrado."
      info "Instalando $pkg"
      if [ "$(id -u)" -eq 0 ]; then apt-get install -y "$pkg"; else sudo apt-get install -y "$pkg"; fi
      bold "Instalado — procure por \"Zeru\" no menu de aplicativos."
      ;;
    rpm)
      pkg="$(find "$BUNDLE_DIR/rpm" -maxdepth 1 -name '*.rpm' | head -n1)"
      [ -n "$pkg" ] || fail ".rpm não encontrado."
      info "Instalando $pkg"
      if [ "$(id -u)" -eq 0 ]; then rpm -Uvh --force "$pkg"; else sudo rpm -Uvh --force "$pkg"; fi
      bold "Instalado — procure por \"Zeru\" no menu de aplicativos."
      ;;
    *)
      pkg="$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name '*.AppImage' | head -n1)"
      [ -n "$pkg" ] || fail "AppImage não encontrado."
      mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
      install -m 755 "$pkg" "$HOME/.local/bin/zeru"
      cp "$REPO/src-tauri/icons/128x128.png" "$HOME/.local/share/icons/zeru.png" 2>/dev/null || true
      cat > "$HOME/.local/share/applications/zeru.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Zeru
Comment=Cliente SQL com assistente de IA
Exec=$HOME/.local/bin/zeru
Icon=$HOME/.local/share/icons/zeru.png
Categories=Development;Database;
Terminal=false
DESKTOP
      bold "Instalado em ~/.local/bin/zeru"
      case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "Adicione ~/.local/bin ao PATH para chamar de 'zeru' no terminal." ;; esac
      ;;
  esac
}

if [ "$PLATFORM" = macos ]; then install_macos; else install_linux; fi
