<div align="center">

<img src="public/zeru-icon.png" width="120" alt="Zeru" />

# Zeru SQL

**Cliente de banco de dados com assistente de IA que conhece o seu esquema.**

PostgreSQL · MySQL · MariaDB — macOS, Windows e Linux

</div>

---

## Baixar

| Sistema | Arquivo |
|---|---|
| **macOS** — Apple Silicon (M1 em diante) | [Zeru-macOS-AppleSilicon.dmg](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-macOS-AppleSilicon.dmg) |
| **macOS** — Intel | [Zeru-macOS-Intel.dmg](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-macOS-Intel.dmg) |
| **Windows** — instalador | [Zeru-Windows-x64-setup.exe](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-Windows-x64-setup.exe) |
| **Windows** — MSI | [Zeru-Windows-x64.msi](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-Windows-x64.msi) |
| **Linux** — universal | [Zeru-Linux-x86_64.AppImage](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-Linux-x86_64.AppImage) |
| **Linux** — Debian/Ubuntu | [Zeru-Linux-amd64.deb](https://github.com/gabrielrcosta1/zeru-sql/releases/latest/download/Zeru-Linux-amd64.deb) |

Não sabe qual escolher no Mac? Menu  → **Sobre este Mac**. Se disser "Apple
M1/M2/M3/M4", use Apple Silicon; se disser "Intel", use Intel.

Todas as versões: [página de releases](https://github.com/gabrielrcosta1/zeru-sql/releases).

### Instalação

O app **não é assinado** — não há certificado da Apple nem da Microsoft por
trás dele. Os dois sistemas avisam. É esperado, e o contorno é rápido:

**macOS.** Abra o `.dmg`, arraste o Zeru para *Aplicativos*. Na primeira
abertura, clique com o **botão direito** no app → **Abrir** → **Abrir** (abrir
com clique duplo não oferece essa opção). Se aparecer *"o app está danificado e
não pode ser aberto"*, é o atributo de quarentena do download:

```bash
xattr -cr /Applications/Zeru.app
```

**Windows.** O SmartScreen mostra *"O Windows protegeu o seu PC"*. Clique em
**Mais informações** → **Executar assim mesmo**.

**Linux.** O AppImage precisa de permissão de execução:

```bash
chmod +x Zeru-Linux-x86_64.AppImage
./Zeru-Linux-x86_64.AppImage
```

O app não se atualiza sozinho — para uma versão nova, volte aqui e baixe.

### Alternativa: compilar você mesmo (sem aviso nenhum)

Os avisos acima existem por causa da marca de quarentena que o navegador põe em
arquivos **baixados**. Um app compilado na sua própria máquina não tem essa
marca — nem Gatekeeper, nem SmartScreen, nem certificado pago envolvido.

**macOS e Linux:**

```bash
git clone https://github.com/gabrielrcosta1/zeru-sql.git
cd zeru-sql
./scripts/install.sh
```

**Windows** (PowerShell):

```powershell
git clone https://github.com/gabrielrcosta1/zeru-sql.git
cd zeru-sql
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

O script cuida do resto: instala o que faltar (Node, Rust, bibliotecas do
sistema), compila e instala o app — em *Aplicativos* no macOS, pelo `.deb`/`.rpm`
ou AppImage no Linux, e pelo instalador no menu Iniciar no Windows.

Custo: a primeira compilação baixa o toolchain do Rust (~1 GB) e leva de 10 a 25
minutos. Depois disso, recompilar é rápido. Use `--build-only` (ou `-BuildOnly`
no Windows) se quiser só gerar o instalador sem instalar.

No Windows, se as ferramentas de compilação C++ da Microsoft não estiverem
instaladas, o script para e mostra o comando `winget` para instalá-las — esse é
o único passo que precisa de administrador.

---

## O que ele faz

**Explorador de esquema.** Tabelas, views, colunas com PK/FK/unique, índices,
funções, procedures e triggers. Diagrama de relacionamentos montado a partir das
chaves estrangeiras reais.

**Editor SQL.** Monaco com realce de sintaxe, formatação (⌘⇧F pelo botão),
executar tudo (⌘↵) ou só a seleção (⌘⇧↵). Scripts com vários comandos rodam em
sequência e cada um vira uma aba de resultado.

**Grade de resultados.** Paginação real no servidor, busca e filtro por coluna,
ordenação, cópia de célula/linha/JSON, exportação para CSV, Excel e JSON.

**Assistente de IA.** Você pergunta em português; ele responde com SQL. Antes de
gerar, ele escolhe as tabelas relevantes do seu esquema e lê algumas linhas
reais para não inventar coluna. O SQL sempre aparece **antes** de rodar, e
comandos destrutivos exigem confirmação explícita.

Funciona com qualquer provedor compatível com a API da OpenAI — OpenAI,
OpenRouter, Groq, ou um **Ollama local** se os dados não podem sair da máquina.
A chave fica no keychain do sistema operacional e nunca é exposta à interface.

> **Sobre privacidade:** ao usar a IA, o esquema do banco, o SQL da aba aberta e
> uma amostra do último resultado são enviados ao provedor escolhido. O painel
> mostra, embaixo de cada resposta, exatamente o que foi enviado. Para dados
> sensíveis, use um endpoint local.

**Conexões.** Senhas no keychain do sistema, nunca em texto puro no disco.

---

## Desenvolvimento

Requer [Rust](https://rustup.rs) e Node 24+.

```bash
npm install
npm run tauri dev     # app completo
npm run dev           # só o front, no navegador (sem banco)
```

Verificação — o CI roda exatamente isto:

```bash
npm run typecheck
npm run lint
npm run build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

### Estrutura

```
src/                        # React + TypeScript
├── store/app.ts            # estado global (zustand) e orquestração da IA
├── lib/
│   ├── api.ts              # ponte para os comandos Tauri
│   ├── ai-context.ts       # montagem do prompt e seleção de tabelas
│   └── export.ts           # CSV / Excel / JSON
└── components/             # ui, shell, sidebar, editor, results, ai, history

src-tauri/src/              # Rust
├── db/
│   ├── mod.rs              # pools de conexão por engine
│   ├── introspect.rs       # leitura de catálogo (pg_catalog / information_schema)
│   └── query.rs            # execução, split de statements, paginação
├── ai.rs                   # provedor OpenAI-compatible com streaming
├── history.rs              # histórico persistente
└── persist.rs              # conexões salvas + keychain
```

Publicação e build multiplataforma: [DISTRIBUICAO.md](DISTRIBUICAO.md).
Registro de decisões e histórico técnico: [etapas.md](etapas.md).

---

## Limitações conhecidas

- SQLite e SQL Server aparecem na interface como "em breve" — ainda não há
  driver.
- A exportação cobre a página carregada, não o resultado inteiro.
- `CREATE PROCEDURE` do MySQL sem trocar o `DELIMITER` é quebrado nos `;`
  internos, igual ao cliente oficial.
- O corpo/source de funções não é carregado na árvore.

## Stack

Tauri 2 · Rust · sqlx · React 18 · TypeScript · Vite · Tailwind · Monaco · zustand
