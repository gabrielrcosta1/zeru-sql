# Distribuição — build e publicação

Repositório: `github.com/gabrielrcosta1/zeru-sql`

Estado: pipeline pronto e chaves geradas. **Faltam 3 passos** (⚠️), todos
rápidos.

Para subir uma nova versão depois que estiver tudo configurado, o ciclo é só:
ajustar a versão nos dois `package.json`/`tauri.conf.json`, commitar, e
`git tag vX.Y.Z && git push origin vX.Y.Z`.

---

## Por que GitHub Actions e não build local

Tauri não faz cross-compile. Cada instalador precisa ser gerado no seu próprio
sistema, porque o app linka o WebView nativo daquela plataforma — WebKit no
macOS, WebView2 no Windows, WebKitGTK no Linux. Não existe flag que gere um
`.msi` a partir do Mac.

O workflow roda os quatro alvos em paralelo:

| Alvo | Runner | Instaladores gerados |
|---|---|---|
| macOS Apple Silicon | `macos-latest` | `.dmg`, `.app.tar.gz` |
| macOS Intel | `macos-latest` | `.dmg`, `.app.tar.gz` |
| Windows | `windows-latest` | `.msi`, `.exe` (NSIS) |
| Linux | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |

Os dois builds de macOS são separados de propósito: um binário universal
dobraria o tamanho do download para todo mundo.

---

## ✅ Passo 1 — Chaves do updater — FEITO

```bash
npx tauri signer generate -w ~/.tauri/zeru-updater.key
```

Gerou `~/.tauri/zeru-updater.key` (privada) e `.key.pub` (pública).

**A chave privada nunca vai para o repositório.** Se vazar, qualquer pessoa
pode publicar uma "atualização" que seus usuários instalam sem questionar. Se
você perdê-la, não existe recuperação: usuários já instalados param de receber
updates para sempre, porque o app deles só confia nessa chave.

Faça um backup dela (gerenciador de senhas, ou um cofre offline).

---

## ⚠️ Passo 2 — Inserir a chave pública na config

O endpoint já está preenchido com o seu repositório. Falta a chave:

```bash
./scripts/set-updater-pubkey.sh
```

O script lê `~/.tauri/zeru-updater.key.pub`, valida o formato e grava em
`src-tauri/tauri.conf.json`. Existe para evitar o erro clássico de copiar e
colar — a chave é uma linha longa de base64, e um caractere perdido só aparece
como "update rejeitado" muito depois, na máquina do usuário final.

Confira e commite:

```bash
git diff src-tauri/tauri.conf.json
git add -A && git commit -m "configura updater"
git push
```

---

## ⚠️ Passo 3 — Criar os secrets no GitHub

Em **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | conteúdo de `~/.tauri/zeru-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | a senha que você definiu no passo 1 |

Para copiar a privada sem abrir o arquivo:

```bash
pbcopy < ~/.tauri/zeru-updater.key
```

O `GITHUB_TOKEN` é automático, não precisa criar.

---

## ⚠️ Passo 4 — Publicar a primeira versão

A tag e a versão em `tauri.conf.json` precisam bater — o updater compara
versões, e uma tag `v0.2.0` com config em `0.1.0` publica um pacote que se
anuncia como mais antigo do que é.

```bash
git tag v0.1.0
git push origin v0.1.0
```

O workflow dispara, monta os quatro alvos (~15-25 min na primeira vez, menos
depois pelo cache) e cria a Release **como rascunho**. Revise os arquivos e
clique em *Publish release*.

> O rascunho é intencional: uma release publicada é imediatamente baixável, e
> um instalador quebrado no ar é pior que uma release atrasada.

---

## O que seus usuários vão ver

Os instaladores **não são assinados** — foi a escolha para esta primeira
rodada. Consequências concretas:

**macOS.** Na primeira abertura o Gatekeeper bloqueia. O caminho é clicar com o
botão direito no app → **Abrir** → **Abrir**. Se aparecer *"o app está
danificado e não pode ser aberto"*, é o atributo de quarentena:

```bash
xattr -cr /Applications/Zeru.app
```

**Windows.** O SmartScreen mostra a tela azul *"O Windows protegeu o seu PC"*.
O usuário clica em **Mais informações** → **Executar assim mesmo**.

**Linux.** Nenhum aviso. AppImage precisa de `chmod +x`.

Esse texto já está no corpo da release, gerado pelo workflow.

### Quando valer a pena assinar

- **macOS**: Apple Developer Program, US$ 99/ano. Elimina o aviso por completo.
  No CI entra como mais quatro secrets (certificado .p12, senha, Apple ID,
  senha de app específica).
- **Windows**: certificado OV (~US$ 200/ano) reduz o SmartScreen; EV (~US$
  400-600/ano) elimina. O OV ainda mostra aviso até acumular reputação.

Sem assinatura, espere perder uma parte dos usuários no primeiro susto. Com um
público técnico, o custo é bem menor.

---

## Como funciona o auto-update

1. `tauri-action` gera `latest.json` e o anexa à release.
2. O app consulta esse arquivo na abertura (`UpdateBanner`).
3. Havendo versão maior, aparece uma faixa no topo com o botão **Atualizar**.
4. O download é verificado contra a chave pública antes de ser aplicado.

**O app nunca atualiza sozinho.** Um cliente SQL pode estar com uma transação
aberta ou uma query não salva — reiniciar sem perguntar não é aceitável. A
verificação é silenciosa; a instalação é decisão do usuário.

Se a verificação falhar (offline, release ainda não publicada), o app registra
no console e segue normalmente. Nada de diálogo de erro.

---

## Checklist antes de cada release

```bash
npm run typecheck && npm run lint && npm run build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

O CI roda isso a cada push, e o workflow de release roda de novo antes de
empacotar — uma tag não vira instalador se os testes falharem.

Para testar o empacotamento local antes de marcar a tag:

```bash
npm run tauri build
```

Os arquivos saem em `src-tauri/target/release/bundle/`.
