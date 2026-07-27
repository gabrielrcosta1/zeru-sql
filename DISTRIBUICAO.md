# Distribuição — build e publicação

Repositório: `github.com/gabrielrcosta1/zeru-sql`

**Não há chaves, secrets nem contas pagas envolvidas.** O ciclo inteiro é:

```bash
git tag v0.1.0
git push origin v0.1.0
```

O GitHub monta os instaladores das três plataformas e cria uma Release (como
rascunho) com todos eles anexados. Você revisa e publica.

---

## Por que GitHub Actions e não build local

Tauri não faz cross-compile. Cada instalador precisa ser gerado no seu próprio
sistema, porque o app linka o WebView nativo daquela plataforma — WebKit no
macOS, WebView2 no Windows, WebKitGTK no Linux. Não existe flag que gere um
`.msi` a partir do Mac.

O workflow roda os quatro alvos em paralelo:

| Alvo | Runner | Instaladores |
|---|---|---|
| macOS Apple Silicon | `macos-latest` | `.dmg` |
| macOS Intel | `macos-latest` | `.dmg` |
| Windows | `windows-latest` | `.msi`, `.exe` (NSIS) |
| Linux | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |

Os dois builds de macOS são separados de propósito: um binário universal
dobraria o tamanho do download para todo mundo.

---

## Publicar uma versão

1. Ajuste a versão nos **dois** arquivos — eles precisam bater:
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`

2. Commite e marque a tag:

```bash
git commit -am "v0.1.0"
git tag v0.1.0
git push origin main --tags
```

3. Acompanhe em **Actions**. Leva ~15-25 min na primeira vez; depois o cache do
   Rust derruba isso bastante.

4. Vá em **Releases**, revise os arquivos e clique em **Publish release**.

> A release sai como rascunho de propósito: uma release publicada é
> imediatamente baixável, e instalador quebrado no ar é pior que release
> atrasada.

---

## O que seus usuários vão ver

Os instaladores **não são assinados** — sem Apple Developer Program e sem
certificado Windows. Consequências concretas:

**macOS.** Na primeira abertura o Gatekeeper bloqueia. O caminho é clicar com o
botão direito no app → **Abrir** → **Abrir**. Se aparecer *"o app está
danificado e não pode ser aberto"*, é o atributo de quarentena:

```bash
xattr -cr /Applications/Zeru.app
```

**Windows.** O SmartScreen mostra a tela azul *"O Windows protegeu o seu PC"*.
O usuário clica em **Mais informações** → **Executar assim mesmo**.

**Linux.** Nenhum aviso. AppImage precisa de `chmod +x`.

Esse texto já vai automaticamente no corpo da release, gerado pelo workflow.

### Quando valer a pena assinar

- **macOS**: Apple Developer Program, US$ 99/ano. Elimina o aviso por completo.
  No CI entra como quatro secrets (certificado .p12, senha, Apple ID, senha de
  app específica).
- **Windows**: certificado OV (~US$ 200/ano) reduz o SmartScreen; EV (~US$
  400-600/ano) elimina. O OV ainda mostra aviso até acumular reputação.

Sem assinatura, espere perder uma parte dos usuários no primeiro susto. Com
público técnico, o custo é bem menor.

---

## Atualizações

Não há auto-update. Quando você publicar uma versão nova, os usuários precisam
voltar na página de Releases e baixar de novo — o app não avisa nem se atualiza
sozinho.

Se um dia quiser ligar isso, é o plugin `tauri-plugin-updater`. Ele exige um par
de chaves minisign (gratuito, gerado com `npx tauri signer generate`) para o app
recusar um pacote que não veio de você. **Isso não tem relação com assinatura de
código do sistema operacional** — são coisas separadas que por acaso se chamam
"chave". Você já gerou um par em `~/.tauri/zeru-updater.key`; ele continua
válido se quiser religar depois.

---

## Checklist antes de cada release

```bash
npm run typecheck && npm run lint && npm run build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

O CI roda isso a cada push, e o workflow de release roda de novo antes de
empacotar — uma tag não vira instalador se a verificação falhar.

Para testar o empacotamento local antes de marcar a tag:

```bash
npm run tauri build
```

Os arquivos saem em `src-tauri/target/release/bundle/`.
