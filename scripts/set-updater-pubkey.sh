#!/usr/bin/env bash
# Insere a chave PÚBLICA do updater em src-tauri/tauri.conf.json.
#
# Existe para evitar o erro clássico de copiar e colar: a chave é uma linha
# longa de base64, e um caractere perdido só aparece como "update rejeitado"
# muito depois, no computador do usuário final.
#
# Uso:  ./scripts/set-updater-pubkey.sh [caminho-da-.pub]

set -euo pipefail

KEY_FILE="${1:-$HOME/.tauri/zeru-updater.key.pub}"
CONF="$(dirname "$0")/../src-tauri/tauri.conf.json"

if [ ! -f "$KEY_FILE" ]; then
  echo "erro: não encontrei $KEY_FILE" >&2
  echo "gere com: npx tauri signer generate -w ~/.tauri/zeru-updater.key" >&2
  exit 1
fi

python3 - "$KEY_FILE" "$CONF" <<'PY'
import json, sys, base64

key_file, conf_path = sys.argv[1], sys.argv[2]
raw = open(key_file).read().strip()

# O signer do Tauri grava o .pub já em base64. Se o arquivo vier no formato
# minisign de duas linhas ("untrusted comment: ..."), converte — o plugin
# espera base64 do arquivo inteiro.
if raw.startswith("untrusted comment:"):
    value = base64.b64encode(raw.encode()).decode()
    origem = "formato minisign convertido para base64"
else:
    value = "".join(raw.split())
    origem = "base64 lido direto do arquivo"

# Sanidade: precisa decodificar e conter uma chave minisign.
try:
    decoded = base64.b64decode(value).decode(errors="replace")
    assert "minisign" in decoded or len(decoded.splitlines()) >= 2
except Exception as e:
    sys.exit(f"erro: a chave não parece válida ({e})")

conf = json.load(open(conf_path))
conf.setdefault("plugins", {}).setdefault("updater", {})["pubkey"] = value
json.dump(conf, open(conf_path, "w"), indent=2, ensure_ascii=False)
open(conf_path, "a").write("\n")

print(f"chave pública inserida ({origem})")
print(f"endpoint: {conf['plugins']['updater']['endpoints'][0]}")
PY
