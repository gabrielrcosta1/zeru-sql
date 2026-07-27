# Distribuição — build e publicação

Estado: **o pipeline está pronto, mas faltam 4 passos que só você pode fazer**
(envolvem contas e chaves privadas). Estão marcados com ⚠️.

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

## ⚠️ Passo 1 — Gerar as chaves do updater

O auto-update precisa que cada pacote seja assinado, para o app recusar uma
atualização que não veio de você. **Isso não tem relação com assinatura de
código do sistema operacional** — é um esquema próprio do Tauri, e é de graça.

```bash
npx tauri signer generate -w ~/.tauri/zeru-updater.key
```

Guarde a senha que ele pedir. O comando imprime a **chave pública** e grava a
privada em `~/.tauri/zeru-updater.key`.

**A chave privada nunca vai para o repositório.** Se ela vazar, qualquer pessoa
pode publicar uma "atualização" que seus usuários instalarão sem questionar.

---

## ⚠️ Passo 2 — Preencher `src-tauri/tauri.conf.json`

Dois placeholders precisam ser trocados:

```jsonc
"plugins": {
  "updater": {
    "endpoints": [
      // troque SEU-USUARIO pelo seu usuário/organização do GitHub
      "https://github.com/SEU-USUARIO/zeru-sql/releases/latest/download/latest.json"
    ],
    // cole aqui a chave PÚBLICA impressa no passo 1
    "pubkey": "SUBSTITUA_PELA_CHAVE_PUBLICA_GERADA_COM_TAURI_SIGNER"
  }
}
```

Deixei placeholders inválidos de propósito: se você esquecer, o build falha com
erro claro em vez de gerar um app com updater quebrado.

---

## ⚠️ Passo 3 — Criar o repositório e os secrets

```bash
git init
git add .
git commit -m "Zeru SQL"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/zeru-sql.git
git push -u origin main
```

Em **Settings → Secrets and variables → Actions**, crie:

| Secret | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | conteúdo de `~/.tauri/zeru-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | a senha do passo 1 |

O `GITHUB_TOKEN` é automático, não precisa criar.

---

## ⚠️ Passo 4 — Publicar a primeira versão

A tag e a versão em `tauri.conf.json` precisam bater.

```bash
# ajuste "version" em src-tauri/tauri.conf.json e "version" em package.json
git commit -am "v0.1.0"
git tag v0.1.0
git push origin main --tags
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
