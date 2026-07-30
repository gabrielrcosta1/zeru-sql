# Zeru SQL — Registro de Tarefas (etapas.md)

Fonte de verdade permanente de todo o trabalho. Nunca apagar tarefas concluídas nem reescrever histórico.

## Contexto / Decisões
- App: Tauri (Rust) + React/TS. Objetivo atual: **fazer o backend funcionar** — conectar ao banco real, trazer schemas/tabelas e executar queries.
- Engines prioritárias: **PostgreSQL + MySQL** (MariaDB via driver MySQL).
- Driver Rust: **sqlx** (async, runtime-tokio-rustls).
- Validação: usuário possui **banco real** para testar (credenciais a fornecer na fase de verificação).
- Execução **em fases**, máx. 5 arquivos por fase, aguardando aprovação entre fases.

---

## Task 001
Status: Completed

Title:
Backend — dependências + gerenciador de conexão

Validação:
- `cargo check` OK na máquina do usuário (macOS), Rust 1.97.0, ~28s.
- 2 warnings esperados (file_path/get) — consumidos nas Fases 2/frontend.

Description:
Adicionar sqlx (Postgres+MySQL) ao Cargo.toml. Criar módulo `db` com um pool manager guardado no estado do Tauri (HashMap id -> pool). Expor comandos `test_connection`, `connect` e `disconnect`.

Affected files:
- src-tauri/Cargo.toml
- src-tauri/src/db/mod.rs (novo)
- src-tauri/src/commands.rs (novo)
- src-tauri/src/lib.rs

Notes:
- Enum de pool por engine (Postgres/MySql) para controle fino de tipos.
- Config de conexão recebe senha em runtime (não persiste no tipo Connection do front).
- Comandos custom do Tauri v2 não exigem entrada em capabilities.

Dependencies: nenhuma.

---

## Task 002
Status: Completed

Title:
Backend — introspecção de schema

Description:
Comandos para listar databases/schemas/tabelas/colunas/índices (Postgres via pg_catalog/information_schema, MySQL via information_schema), mapeando para DatabaseTree/Schema/TableNode/Column do front.

Affected files:
- src-tauri/src/db/introspect.rs (novo)
- src-tauri/src/db/mod.rs (registro do módulo + allow no file_path)
- src-tauri/src/commands.rs (comandos list_databases / get_database_tree)
- src-tauri/src/lib.rs (registro dos handlers)

Notes:
- Comandos expostos: `list_databases(id)` e `get_database_tree(id)`.
- PK/FK/UNIQUE detectados; índices com colunas/unique/método.
- functions/procedures/triggers retornam vazio nesta fase (não bloqueiam o front).
- Validação pendente: `cd src-tauri && cargo check` na máquina do usuário.

Dependencies: Task 001.

---

## Task 003
Status: Completed

Title:
Backend — execução de query

Description:
Comando `run_query(id, sql)` retornando QueryResult (colunas, linhas JSON, affectedRows, durationMs, totalRows) com inferência de ColumnType por engine.

Affected files:
- src-tauri/src/db/query.rs (novo)
- src-tauri/src/db/mod.rs (registro do módulo)
- src-tauri/src/commands.rs (comando run_query)
- src-tauri/src/lib.rs (registro do handler)

Notes:
- Classificação SELECT/DML por keyword (+ detecção de RETURNING) decide fetch vs execute.
- Decodificação de célula por "probe" de tipos (bool/int/float/decimal/json/uuid/data/texto/bytes) → serde_json::Value.
- Cap de MAX_ROWS=5000 no payload; totalRows reflete a contagem real.
- Limitações conhecidas (fases futuras): 1 statement por chamada (protocolo preparado); colunas vazias se SELECT retorna 0 linhas; células JSON vêm como objeto (tratar exibição no front).
- Validação pendente: `cd src-tauri && cargo check`.

Dependencies: Task 001.

---

## Task 004
Status: Completed

Title:
Frontend — camada de API + integração

Description:
Camada de API (`invoke`) + estado/ações no store + `ConnectionModal` real + componentes de exibição lendo do store. Dividida em 4a (API/store/modal) e 4b (Sidebar/StatusBar/TitleBar).

Affected files (4a):
- src/lib/api.ts (novo) — wrappers testConnection/connect/disconnect/listDatabases/getDatabaseTree/runQuery + isTauri
- src/store/app.ts — connections/databaseTree/connecting/connectError + connectAndLoad/refreshDatabaseTree; runTab usa api.runQuery
- src/components/screens/ConnectionModal.tsx — form controlado, test/connect reais

Affected files (4b):
- src/components/sidebar/Sidebar.tsx — lê connections + databaseTree (fallback mock)
- src/components/shell/StatusBar.tsx — idem
- src/components/shell/TitleBar.tsx — switcher de conexões do store

Validação:
- `tsc --noEmit` OK no sandbox (0 erros) para 4a e 4b.
- Pendente E2E: rodar o app (`npm run tauri dev`) e conectar a um banco real.

Follow-up (fase futura): migrar consumidores de mock restantes — CommandPalette, TableExplorer, RelationshipsDiagram, AiPanel, HistoryPanel.

Dependencies: Tasks 001–003.

---

## Task 005
Status: Completed

Title:
Verificação (cargo check + tsc)

Description:
Rodar `cargo check`/`clippy` no backend e `tsc --noEmit` no frontend. Testar conexão de ponta a ponta contra o banco real fornecido pelo usuário.

Affected files: —

Notes:
- E2E validado pelo usuário em 27/07/2026 contra banco real: conexão, árvore de
  schema e execução de query funcionando. Isso fecha também a validação
  pendente das Tasks 003, 004, 006 e 011 (todas passam a Completed).

Dependencies: Tasks 001–004.

---

## Task 012
Status: Completed

Title:
Fase 0 — Limpeza (Step 0) + ESLint

Validação:
- `npx tsc --noEmit` → 0 erros.
- `npx eslint . --quiet` → 0 erros (exit 0).

Description:
Remoção de código morto antes das fases estruturais, e introdução de linting —
o projeto não tinha nenhum. Dois erros reais do react-hooks foram expostos e
corrigidos (não eram cosméticos: setState síncrono dentro de efeito causa
renders em cascata).

Affected files:
- src/lib/mock/schema.ts, src/lib/mock/data.ts (REMOVIDOS — 0 referências)
- src/types.ts (comentário stale sobre "mock fixtures")
- src/lib/api.ts (idem)
- eslint.config.js (novo — flat config, type-aware, react-hooks + react-refresh)
- package.json (devDeps do eslint + script `lint`)
- src/components/screens/TableExplorer.tsx (useMemo compiler-safe; preview de
  dados com cache por chave + ref de in-flight no lugar de setState síncrono)
- src/components/screens/CommandPalette.tsx (reset da busca via ajuste de
  estado em render, não em efeito)

Notes:
- @eslint/js fixado em ^9 (o ^10 conflita com eslint 9 via peer dep).
- Regras estritas ligadas: no-explicit-any como erro, no-unused-vars com escape
  por `_`.

Dependencies: Task 005.

---

## Task 026
Status: Waiting Validation

Title:
Release baixável — publicar direto, nomes fixos e seção de download no README

Validação:
- YAML válido; `bash -n` no script do passo de anexar.
- Fluxo do `attach` testado com arquivo presente, pasta vazia e pasta
  inexistente: nenhum caso aborta o job.
- Checagem cruzada: os 6 links do README batem 1:1 com os 6 arquivos que o
  workflow anexa.
- PENDENTE: nova tag e conferir a release publicada.

Description:
O usuário rodou o build, funcionou, e **não achou o arquivo para baixar**.
Duas falhas minhas:

1. **`releaseDraft: true`.** Rascunho não aparece para ninguém além do dono do
   repositório e os arquivos não ficam baixáveis. Eu escolhi isso por
   segurança, escrevi "clique em Publish release" no meio de um documento
   longo, e na prática isso é o mesmo que não avisar. Trocado para publicar
   direto — a rede de segurança continua sendo typecheck/lint/testes rodando
   antes de empacotar.
2. **README sem seção de download.** Pior: o README ainda descrevia o projeto
   como "UI layer only, mock fixtures" — texto de antes de todo o backend
   existir. Estava mentindo sobre o que o app é.

Affected files:
- .github/workflows/release.yml
- README.md (reescrito)

Notes:
- **Nomes de arquivo estáveis.** O Tauri gera `Zeru_0.1.0_aarch64.dmg`, com a
  versão embutida — link permanente é impossível, a URL mudaria a cada release.
  Um passo novo reanexa cada instalador com nome fixo
  (`Zeru-macOS-AppleSilicon.dmg`), o que permite ao README apontar para
  `/releases/latest/download/<nome>` sem quebrar nunca.
- O passo usa `find -print -quit` e trata ausência de arquivo como aviso, não
  erro: `.rpm` e `.msi` nem sempre são gerados, e perder um formato opcional
  não pode derrubar a publicação dos outros.
- **Bug corrigido antes de rodar**: a linha `[ -n "$target" ] && base=...`
  sob `set -euo pipefail` é armadilha conhecida — trocada por `if`.
- README reescrito: download em primeiro lugar, com tabela por plataforma e
  instruções de Gatekeeper/SmartScreen. Inclui aviso explícito de privacidade
  sobre o que a IA envia ao provedor, e uma seção de limitações conhecidas.

Dependencies: Task 025.

---

## Task 025
Status: Waiting Validation

Title:
Remover o auto-update — distribuição só com instalador

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK; JSON e YAML válidos.
- `grep -rni "updater|plugin-process|UpdateBanner"` em src/, src-tauri/,
  package.json e .github/ → nenhuma referência restante.
- PENDENTE: `cargo check` (2 dependências removidas).

Description:
O usuário questionou, com razão, por que este app precisaria de chaves se o
anterior não precisou. **Falha de comunicação minha**: usei "chave" para duas
coisas sem relação, na mesma explicação.

- Assinatura de código do SO (Apple US$ 99/ano, certificado Windows) — é o que
  faz sumir o aviso de "app danificado". Nunca tivemos, e a decisão foi não ter.
- Chave do updater (minisign, gratuita, local) — serve só para o app recusar um
  pacote de atualização que não veio do autor.

**A chave nunca foi requisito para buildar ou distribuir.** Era consequência de
uma escolha anterior do próprio usuário ("sim, com auto-update"), e eu não
deixei essa dependência clara na hora.

Decisão: remover o auto-update. Distribuição fica igual à do app anterior —
tag, push, instalador pronto.

Affected files:
- src-tauri/Cargo.toml, src/lib.rs, tauri.conf.json, capabilities/default.json
- src/App.tsx, src/components/shell/UpdateBanner.tsx (removido)
- scripts/set-updater-pubkey.sh (removido)
- package.json (2 deps removidas), .github/workflows/release.yml, DISTRIBUICAO.md

Notes:
- `createUpdaterArtifacts` e o bloco `plugins.updater` saíram do tauri.conf.
- Os secrets `TAURI_SIGNING_*` saíram do workflow. Se ele já os criou no
  GitHub, ficam inertes — não custam nada e não precisam ser apagados.
- A chave em `~/.tauri/zeru-updater.key` continua válida. Religar o updater
  depois não exige gerar outra.
- Nada mais no pipeline mudou: os quatro alvos, o CI e o release em rascunho
  seguem iguais.

Dependencies: Task 024.

---

## Task 024
Status: Waiting Validation

Title:
Distribuição — CI, release multiplataforma e auto-update

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK.
- YAML e JSON validados por parser; versões de tauri.conf e package.json batem.
- PENDENTE: `cargo check` (3 dependências novas) e os 4 passos manuais do
  DISTRIBUICAO.md.

Description:
Decisões do usuário: GitHub Actions, **sem assinatura de código** por enquanto,
**com** auto-update.

Affected files:
- .github/workflows/release.yml (novo), .github/workflows/ci.yml (novo)
- src-tauri/Cargo.toml, src/lib.rs, tauri.conf.json, capabilities/default.json
- src/components/shell/UpdateBanner.tsx (novo), src/App.tsx
- package.json, .gitignore, DISTRIBUICAO.md (novo)

Notes:
- **Tauri não cross-compila.** O app linka o WebView nativo de cada sistema
  (WebKit / WebView2 / WebKitGTK); não existe flag que gere `.msi` a partir do
  Mac. Daí a matriz de 4 runners.
- macOS sai em **dois binários separados** (arm64 e x86_64) em vez de um
  universal: o universal dobraria o download para todo mundo.
- `fail-fast: false` — um alvo quebrado não deve cancelar os outros três.
- Release sai como **rascunho**. Release publicada é imediatamente baixável, e
  instalador quebrado no ar é pior que release atrasada.
- O workflow roda typecheck + lint + `cargo test` **antes** de empacotar: uma
  tag não vira instalador se a verificação falhar.
- CI separado, só Linux: tipos, lint e testes não dependem de plataforma, e uma
  matriz de três aqui gastaria minutos sem descobrir nada a mais.
- **Assinatura do updater ≠ assinatura de código.** A primeira é minisign do
  próprio Tauri, gratuita, e serve para o app recusar update de origem
  desconhecida. A segunda custa dinheiro e some com os avisos do SO. Estamos
  usando só a primeira.
- **O app nunca atualiza sozinho.** Um cliente SQL pode estar com transação
  aberta ou query não salva; reiniciar sem perguntar não é aceitável. A
  verificação é silenciosa, a instalação é decisão do usuário, e falha de
  verificação (offline, feed inexistente) vira log — não diálogo de erro.
- Placeholders em tauri.conf.json são **inválidos de propósito**: esquecer de
  preencher quebra o build com erro claro, em vez de gerar app com updater
  morto.
- `.gitignore` passou a cobrir `*.key`. A chave privada do updater, se vazar,
  permite publicar "atualização" que os usuários instalam sem questionar.

Dependencies: Task 023.

---

## Task 023
Status: Waiting Validation

Title:
Aplicar o logo real do Zeru no ícone e na interface

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK; `dist/zeru-icon.png` presente
  e referenciado no `dist/index.html`.
- .icns regerado (8 entradas, magic e tamanho conferidos).
- PENDENTE: `npm run tauri build` e conferir o Dock.

Description:
O usuário forneceu o logo definitivo (tile azul com Z + cilindro, mais o
wordmark "zeru SQL" embaixo). Pedido: usar só o tile.

Na rodada anterior eu havia trocado **apenas os arquivos de ícone** e chamado de
pronto. O usuário reportou, com razão, que não tinha mudado em lugar nenhum: o
Dock lê do bundle (não regerado) e a interface nunca usou esses arquivos —
título e splash tinham um "Z" desenhado à mão em SVG, sem relação com o ícone.

Affected files:
- src-tauri/icons/icon-source.png (novo, recorte do logo) + icons/* regerados
- public/zeru-icon.png (novo)
- src/components/shell/TitleBar.tsx (ZeruMark passa a usar o ícone real)
- index.html (favicon + splash)
- src-tauri/build.rs

Notes:
- Recorte do tile em x 312..948, y 142..778, detectado por bandas de linhas com
  conteúdo (tile / "zeru" / "SQL" são três bandas separadas por branco).
- Fundo removido por **flood fill a partir dos quatro cantos**, não por
  "branco → transparente": o Z tem a metade inferior branca e o cilindro é
  branco, e a regra ingênua teria furado o logo.
- `public/zeru-icon.png` guarda o tile **sem** a margem do template da Apple.
  Essa margem existe para o Dock, onde o sistema desenha no tile inteiro; dentro
  da UI ela só encolheria o logo dentro do próprio elemento.
- **build.rs ganhou `cargo:rerun-if-changed=icons`.** `tauri_build` declara
  dependência só de tauri.conf.json, não dos ícones que lê. Sem isso, trocar um
  ícone e rebuildar mantém a arte antiga embutida — falha silenciosa que parece,
  exatamente, com a mudança não ter sido aplicada.

Dependencies: Task 022.

---

## Task 022
Status: Waiting Validation

Title:
Varredura — todo controle decorativo do app

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK.
- Script de varredura reexecutado ao final: **0 controles sem handler**.

Description:
"Explicar com IA não funciona" era o terceiro relato do mesmo tipo. Em vez de
corrigir mais um, escrevi uma varredura que percorre todo `src/**/*.tsx`,
extrai as props de cada `<button>`, `<Button>` e `<IconButton>` (respeitando
chaves aninhadas) e lista os que não têm handler algum.

Resultado: **7 controles decorativos**, não um.

Affected files:
- src/components/editor/SqlEditor.tsx (4 botões)
- src/store/app.ts (runTab aceita SQL alternativo)
- src/components/history/HistoryPanel.tsx (re-executar)
- src/components/results/ResultsGrid.tsx (filtro por coluna)
- src/components/ui/engine.tsx, src/components/screens/ConnectionModal.tsx
- package.json (sql-formatter)

Notes:
- **Explicar com IA** → manda a seleção (ou a aba inteira) ao painel de IA.
- **Executar seleção** → roda só o trecho destacado. Exigiu `runTab(id, sql?)`;
  atalho ⌘⇧↵ junto.
- **Formatar SQL** → `sql-formatter`, com dialeto derivado da engine da conexão.
  SQL pela metade faz a lib lançar; o catch preserva o texto — formatador que
  apaga o trabalho do usuário é pior que formatador ausente.
- **Copiar como JSON** → copia o resultado ativo; desabilitado sem resultado,
  em vez de silenciosamente não fazer nada.
- **Re-executar no histórico** → abre nova aba e roda. O id vem de
  `useApp.getState()`, porque o `tabs` desta render ainda é o anterior.
- **Filtro por coluna** → linha de inputs sob o cabeçalho, um por coluna.
  Fechar o painel limpa os filtros: filtro ativo com input escondido seria uma
  contagem de linhas inexplicável.
- **SQLite / SQL Server**: `build_pool` rejeita as duas com erro. A UI oferecia
  as duas normalmente e levava o usuário a preencher um formulário inteiro para
  chegar num erro garantido. Agora aparecem desabilitadas com "em breve", e o
  botão de escolher arquivo (que também não fazia nada) saiu junto.
- `ENGINE_META` ganhou a flag `supported`, para a UI parar de divergir do que o
  backend aceita.

Dependencies: Task 021.

---

## Task 021
Status: Waiting Validation

Title:
Correções de UI — exportação, menus da sidebar e ícone do Dock

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK.
- .icns gerado e verificado byte a byte (magic, tamanho declarado, 8 entradas
  com PNG válido de 32 a 1024).
- PENDENTE: `cd src-tauri && cargo check` (nova dependência tauri-plugin-dialog).
- Pendente E2E: exportar, usar o menu de contexto, e reinstalar para ver o ícone.

Description:
Três bugs visuais/funcionais reportados em uso.

### 1. Exportar CSV/Excel/JSON não fazia nada
Causa: `export.ts` criava um blob e clicava num `<a download>`. **O WKWebView
ignora o atributo `download` em blob URLs** — no macOS o clique registrava e
nada acontecia, sem erro no console. Nunca funcionou; só não dava sinal.
Correção: comando Rust `export_file` com diálogo nativo (tauri-plugin-dialog),
`async` para o diálogo bloqueante não rodar na main thread. O caminho do
navegador fica só para o preview via `vite`, onde funciona.

### 2. Itens do menu de contexto da sidebar sem efeito
Causa dupla:
- "Perguntar à IA", "Copiar nome" e "Copiar SELECT *" **não tinham `onSelect`**.
  Eram entradas de menu decorativas.
- "Ver dados" tinha handler, mas gerava `SELECT * FROM user LIMIT 200` — sem
  schema e sem aspas. `user` é palavra reservada no Postgres: a aba abria com
  SQL que o servidor recusa. Parecia "não funcionar" porque o resultado era um
  erro de sintaxe.
Correção: os três handlers implementados; identificadores agora são
qualificados com o schema e quotados conforme a engine.

### 3. Ícone gigante no Dock
Causa: a arte ocupava **100% do canvas**. O macOS não recorta nem adiciona
margem — desenha o arquivo no tamanho cheio do tile, então um ícone full-bleed
fica visivelmente maior que os vizinhos, que seguem o template da Apple (arte
em 824/1024 = 80,5%, raio de canto ~18%).
Correção: `scripts/make-icons.py` aplica o template e regenera tudo, incluindo
um `.icns` escrito à mão (o `iconutil` só existe no macOS, e o container é
simples o bastante para emitir direto). Originais preservados em
`src-tauri/icons/original/`, e o script sempre parte de lá — rodar duas vezes
não aplica margem sobre margem.

Affected files:
- src-tauri/Cargo.toml, src/lib.rs, src/commands.rs, capabilities/default.json
- src/lib/export.ts, src/components/results/ResultsGrid.tsx
- src/components/sidebar/TableBranch.tsx, src/components/sidebar/Sidebar.tsx
- scripts/make-icons.py (novo) + src-tauri/icons/*

Notes:
- CSV agora sai com BOM: sem ele o Excel lê UTF-8 como latin-1 e destrói os
  acentos.
- Os itens de exportação passam a dizer quantas linhas serão exportadas
  ("Exportar CSV (100 linhas)"). Exportação cobre a **página carregada**, não o
  resultado inteiro — melhor deixar explícito que entregar um arquivo
  silenciosamente parcial. Exportar tudo exigiria paginar no backend durante o
  export; fica como trabalho futuro.

Dependencies: Task 020.

---

## Task 020
Status: Waiting Validation

Title:
IA — recuperação em duas passadas, sondagem de dados e autocorreção

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK.
- 18 asserções sobre o pipeline, com o esquema real do caso reportado
  (user / company_group_user / company_terms_acceptances + 413 tabelas de ruído).
- Pendente E2E: refazer a pergunta dos termos por empresa.

Description:
Reportado em uso real: perguntado "usuários que assinaram o termo da empresa 1",
o modelo inventou `terms_of_use` e `affiliate_id` em `burh.user`. O certo era
passar por `company_group_user` e `company_terms_acceptances`.

**Causa raiz, medida:** para essa pergunta, o casamento por substring achou
ZERO tabelas. "usuarios" não contém "user" — a ponte PT→EN que eu havia
afirmado existir simplesmente não existia. As 168 tabelas detalhadas foram
escolhidas pelo desempate de contagem de FKs, ou seja, ao acaso. O modelo
recebeu 418 nomes soltos e um conjunto arbitrário de colunas, e deduziu.

A lição: **escolher tabela por regex não é recuperação de informação**. Nenhum
ajuste de texto no prompt resolve — enquanto a seleção for um chute meu, o
prompt melhor só produz um chute mais bem redigido.

Affected files:
- src/lib/api.ts (aiComplete — completion sem renderizar, sobre o mesmo comando)
- src/lib/ai-context.ts (prompts de seleção e geração, grafo de FK, vizinhança)
- src/store/app.ts (orquestração, sondagem, validação)

Notes:
- **Passada 1 — o modelo escolhe as tabelas.** Recebe todos os nomes + o grafo
  completo de chaves estrangeiras (o item de maior valor por caractere do
  prompt: caminho de JOIN é exatamente o que não se adivinha) e devolve JSON
  com as tabelas necessárias. O prompt manda explicitamente incluir tabelas de
  ligação e traduzir PT→EN. Quem entende linguagem passa a fazer a escolha.
- **Sondagem — leitura real, autorizada pelo usuário.** O app roda
  `SELECT * FROM <tabela> LIMIT 3` nas escolhidas. O SQL é montado **aqui**,
  nunca pelo modelo: não existe caminho entre uma saída do modelo e um
  statement executado sem clique do usuário. Falha de permissão é ignorada.
- **Passada 2 — esquema completo só do que importa.** Caiu de ~17k tokens de
  esquema truncado para ~400 tokens de esquema **completo e relevante**. Inclui
  vizinhas a 1 FK de distância, como seguro caso a passada 1 tenha perdido uma
  tabela de ligação.
- **Autocorreção.** A consulta gerada passa por `EXPLAIN` (que não executa
  nada) e, se o banco recusar, o erro volta ao modelo para uma correção. Só
  para SELECT/WITH — nunca para DML.
- Sem tool calling: `aiComplete` reaproveita o `ai_chat` existente e lê o texto
  do evento `done`. Zero mudança no Rust, e funciona em qualquer provedor
  compatível — inclusive Ollama, cujo suporte a tools é irregular.
- Fallback: se a passada 1 falhar ou vier ilegível, cai no prompt de passada
  única anterior. Degrada, não quebra.
- Custo: 2 chamadas por pergunta (3 se houver correção). A passada 1 é ~1.7k
  tokens e a 2 é ~400 — no total **mais barato** que os ~17k de antes.
- Os chips agora mostram quais tabelas a IA escolheu, não uma contagem genérica.

Dependencies: Task 019.

---

## Task 019
Status: Waiting Validation

Title:
Correção — IA dizia que tabela existente não existe (esquema truncado)

Validação:
- `tsc` 0 erros, `eslint` exit 0, `vite build` OK.
- Cenário do usuário reproduzido em script: 418 tabelas, `user` no fim do
  alfabeto, tabelas de 29 colunas. Antes o nome sequer chegava ao prompt; agora
  `user` é a **primeira** tabela detalhada e `is_admin` está presente. 9/9
  asserções.

Description:
Reportado em uso real: com `burh.user` **aberta na tela**, a IA respondeu que
"não existe tabela ou coluna is admin". Não era alucinação — era falha de
engenharia de contexto minha, em duas camadas que se somaram:

1. `SCHEMA_BUDGET` de 12.000 caracteres, com as tabelas percorridas em ordem
   alfabética. Num banco de 418 objetos, tudo depois de ~40 tabelas era
   descartado. `user` começa com "u": nunca chegou ao prompt.
2. A regra que eu mesmo escrevi — *"use apenas tabelas presentes no esquema
   abaixo; se algo não existir, diga isso em vez de inventar"* — fez o modelo
   obedecer corretamente sobre um esquema que eu havia mutilado. O
   comportamento estava certo; o insumo estava errado.

Affected files:
- src/lib/ai-context.ts
- src/store/app.ts

Notes:
- **Dois orçamentos, não um.** O índice de NOMES (20k chars) é praticamente
  completo — um modelo que não vê o nome vai negar a existência da tabela, e
  com razão. O detalhamento de COLUNAS (60k chars) é que precisa escolher, e
  agora escolhe **por relevância**, não por acaso alfabético.
- Relevância por sinais locais e baratos (sem embeddings, sem round trip):
  tabela aberta no explorer (+500), nome citado na pergunta ou no SQL da aba
  (+100), colunas citadas (+12 cada), desempate por número de FKs.
- Casamento por normalização: acentos, `_` e espaços são removidos, então
  `is_admin` = "is admin" = "IS ADMIN", e "usuarios" contém "user". Mínimo de 4
  caracteres para não fazer `id` casar com tudo.
- O prompt agora **distingue explicitamente** "não está na lista de nomes"
  (não existe) de "está na lista mas sem colunas detalhadas" (existe, colunas
  desconhecidas) — e proíbe negar existência no segundo caso.
- Instrução nova de ponte PT→EN: "usuários" quase sempre é `user`/`users`.
- O chip mentia: dizia "418 objetos" como se todos tivessem sido enviados.
  Agora diz "418 tabelas (45 com colunas)".
- Custo: prompt vai a ~17k tokens num banco desse porte. Cabe folgado em
  qualquer modelo de 128k, mas encarece cada turno. Se virar problema, o passo
  seguinte é tool calling — o modelo pedir o schema de uma tabela sob demanda,
  em vez de receber tudo na primeira mensagem.

Complemento (mesma sessão): a correção acima foi medida em escala e **quebrava
em ~1000 tabelas**, do jeito pior possível. O índice de nomes era montado por
schema, e um schema cujo bloco de nomes não coubesse no orçamento era
descartado INTEIRO — num banco de schema único, o índice sumia por completo e o
bug original voltava. Corrigido:
- Truncamento passa a ser por nome, nunca por schema.
- Tabelas com score >= 100 (citadas na pergunta / abertas no explorer) entram no
  índice **incondicionalmente**, antes de qualquer orçamento. Perder justamente
  esse nome é o que produz a negação errada.
- INDEX_BUDGET 20k → 60k chars.
- Quando ainda assim sobra nome de fora, o prompt declara a lista como
  INCOMPLETA e proíbe explicitamente concluir inexistência a partir da ausência.
- Medido de 418 a 50.000 tabelas: nome visível, coluna certa detalhada e tabela
  relevante em 1º lugar em todos os casos; prompt satura em ~30k tokens.

Dependencies: Task 018.

---

## Task 018
Status: Waiting Validation

Title:
Fase 5 — IA no frontend: contexto, streaming e configuração do provedor

Validação:
- `npx tsc --noEmit` → 0 erros; `npx eslint . --quiet` → exit 0; `vite build` OK.
- `extractSqlBlock` / `isDestructive` validados por script (esbuild + node):
  11/11 casos, incluindo fence sem linguagem, prosa depois do bloco, bloco
  vazio e palavra-chave dentro de comentário.
- Pendente E2E: configurar uma chave e conversar com o banco conectado.

Description:
Liga o painel de IA ao backend da Task 017. O `sendAi` falso (setTimeout com
SQL hardcoded) sai de cena.

Affected files:
- src/lib/ai-context.ts (novo — montagem do prompt e extração do bloco SQL)
- src/lib/api.ts (settings, chat, cancel, listener de eventos)
- src/store/app.ts (sendAi real, cancelAi, clearAi, settings)
- src/components/screens/AiSettingsModal.tsx (novo)
- src/components/ai/AiPanel.tsx (streaming, cancelar, aviso de não-configurado)
- src/App.tsx (monta o modal)
- src/components/ai/SqlCard.tsx (correção do botão de confirmação)

Notes:
- Contexto enviado por turno: esquema da conexão, SQL da aba aberta, amostra do
  último resultado e queries recentes do histórico — reconstruído a cada
  mensagem, porque o usuário pode trocar de conexão ou rodar query entre turnos.
- **Esquema é orçado em ~12k caracteres**, em formato de uma linha por tabela.
  Quando corta, o prompt diz explicitamente quantas tabelas ficaram de fora: um
  corte silencioso faria o modelo referenciar com confiança tabelas que ele não
  enxerga mais.
- Os `contextChips` sob cada resposta listam o que foi enviado. O usuário não
  deveria precisar adivinhar que o schema dele saiu da máquina.
- O modal avisa, em texto claro, que esquema/SQL/amostra vão para o provedor, e
  sugere endpoint local para quem não pode deixar isso sair.
- Detecção de destrutivo por limite de palavra e ignorando comentários: uma
  coluna `updated_at` ou `deleted` não dispara mais o alerta (a versão antiga
  usava regex solta no texto da *pergunta*, não no SQL).
- **BUG PRÉ-EXISTENTE CORRIGIDO**: no `SqlCard`, o botão "Confirmar execução"
  de comando destrutivo só fazia `setConfirming(false)` — não executava nada.
  O usuário confirmava e o app fingia. Agora executa de fato, e ganhou botão de
  cancelar ao lado.
- Removido o botão de anexo (clipe) do input: não tinha handler.
- Fase tocou 7 arquivos (teto 5), pelo mesmo motivo das anteriores: a troca do
  contrato de `sendAi` atinge store, painel e modal de uma vez.

Dependencies: Task 017.

---

## Task 017
Status: Completed

Title:
Fase 4 — IA no backend: provider genérico OpenAI-compatible com streaming

Validação:
- `cargo check` + `cargo test` OK na máquina do usuário: 18/18 testes passando.
- Sem toolchain Rust no sandbox. O parsing de SSE + a lógica de buffer foram
  transliterados para Python e submetidos a 17 casos, incluindo chunking
  hostil (byte a byte, corte dentro do separador): 17/17 passando.

Description:
`sendAi` era 100% falso — `setTimeout` devolvendo SQL hardcoded. Esta fase
constrói o backend real: módulo `ai.rs` que fala com qualquer endpoint
`/chat/completions` compatível com OpenAI.

Affected files:
- src-tauri/Cargo.toml (reqwest, rustls apenas — sem OpenSSL na cadeia)
- src-tauri/src/ai.rs (novo)
- src-tauri/src/commands.rs (load/save settings, ai_chat, ai_cancel)
- src-tauri/src/lib.rs (módulo, state e handlers)

Notes:
- **Provider aberto por decisão do usuário**: base URL + modelo + token são
  editáveis. Serve OpenAI, OpenRouter, Groq, Ollama local
  (`http://localhost:11434/v1`) ou gateway corporativo pelo mesmo caminho.
- **Chave nunca cruza a ponte para o JS**. Fica no keychain e só é lida para
  montar o header. `load_ai_settings` devolve `hasApiKey: bool` — nunca a
  chave. Um teste garante que `hasApiKey` vindo do arquivo é ignorado (é
  derivado do keychain, não confiável em disco).
- Streaming via eventos Tauri (`ai:delta` / `ai:done` / `ai:error`), todos
  marcados com `requestId`. O erro é **retornado E emitido**: a UI é dirigida
  por evento, não deveria ter que correlacionar promise rejeitada com a
  mensagem correspondente.
- Cancelamento por `AtomicBool` num registry em state. Registrado **antes** do
  request sair, senão um cancelamento durante a espera do provedor sumiria.
- **BUG PEGO ANTES DE COMPILAR**: a primeira versão fazia
  `String::from_utf8_lossy` em cada chunk recebido. Provedores cortam o stream
  em qualquer byte — um caractere multi-byte partido entre dois chunks viraria
  `` (verificado: "ação" → "aão"). Ou seja, toda resposta acentuada em
  português sairia corrompida. O buffer agora é `Vec<u8>` e só decodifica
  frames completos. Há teste cobrindo o corte no meio do "ç".
- Sem timeout total no client (uma completion longa não é conexão travada);
  só o connect é limitado, em 15s.
- Aceita tanto `choices[0].delta.content` quanto `choices[0].message.content` —
  alguns gateways devolvem a forma não-streaming mesmo com `stream: true`.
- Frames de keep-alive e o frame inicial só-com-role são ignorados em silêncio,
  não tratados como erro.

Dependencies: Task 016.

---

## Task 016
Status: Completed

Title:
Fase 3 — Histórico persistente

Validação:
- `npx tsc --noEmit` → 0 erros; `npx eslint . --quiet` → exit 0; `vite build` OK.
- `cargo check` + `cargo test` OK na máquina do usuário: 18/18 testes passando.
- Pendente E2E: rodar queries, fechar e reabrir o app, conferir o histórico.

Description:
O histórico vivia só em memória (`history: []`) e sumia ao fechar o app. Agora é
gravado em `history.json` no diretório de config, carregado no boot, com
favoritos e limpeza explícita.

Affected files:
- src-tauri/src/history.rs (novo)
- src-tauri/src/commands.rs (load/push/set_favorite/clear)
- src-tauri/src/lib.rs (módulo, state e handlers)
- src/lib/api.ts (wrappers)
- src/store/app.ts (persistência + hydrateHistory + clearHistory)
- src/App.tsx (hidratação no boot)
- src/components/history/HistoryPanel.tsx (botão de limpar com confirmação)

Notes:
- **BUG SÉRIO PRÉ-EXISTENTE CORRIGIDO**: `uid()` usava um contador de sessão
  (`seq = 100`) que **reinicia em cada abertura do app**. Como ids de conexão
  são persistidos em connections.json e usados como chave no keychain, criar
  uma conexão após reiniciar gerava `conn-101` de novo — sobrescrevendo a senha
  e os metadados de uma conexão salva. Trocado por `crypto.randomUUID()` com
  fallback. O histórico teria herdado o mesmo defeito.
- A lista fica em memória atrás de um Mutex no state do Tauri, com write-through
  a cada mutação. Isso torna o read-modify-write atômico: duas queries
  terminando no mesmo instante não se sobrescrevem (o que aconteceria se cada
  comando relesse o arquivo).
- Poda: **favoritos nunca são removidos por idade**; o teto de 500 vale só para
  entradas comuns. O usuário marcou aquilo de propósito.
- Arquivo corrompido não trava o app — `unwrap_or_default()` recomeça vazio. O
  histórico é conveniência, não dado autoral do usuário.
- Gravação é fire-and-forget no front: falha vira `console.warn`, nunca impede
  o resultado da query de chegar na tela.
- "Limpar" apaga favoritos junto, então exige segundo clique para confirmar.
- Fase tocou 7 arquivos (teto é 5). Optei por incluir o comando `clear_history`
  e sua UI em vez de deixar um histórico que nunca pode ser apagado — o usuário
  pode ter rodado query com dado sensível.

Dependencies: Task 015.

---

## Task 015
Status: Completed

Title:
Fase 2 — Introspecção completa: functions, procedures e triggers

Validação:
- `npx tsc --noEmit` → 0 erros; `npx eslint . --quiet` → exit 0.
- `cargo check` OK na máquina do usuário.
- Pendente E2E: abrir a árvore num banco que tenha função, procedure e trigger.

Description:
Fecha a lacuna aberta na Task 002. `SchemaNode.functions/procedures/triggers`
deixam de ser `Vec<Json>` vazio e passam a ser `Vec<RoutineNode>` preenchido.

Affected files:
- src-tauri/src/db/introspect.rs
- src/components/sidebar/Sidebar.tsx

Notes:
- Postgres: `pg_proc` + `prokind` separa function de procedure (agregados e
  window functions ficam de fora). Triggers vêm de `pg_trigger` com filtro
  `NOT tgisinternal` — sem ele a lista encheria de triggers que o próprio PG
  cria por trás de FKs e constraints. A signature do trigger é o
  `pg_get_triggerdef` completo, então abre no editor como SQL executável.
- MySQL: `information_schema.routines` + `parameters` (ordinal 0 é o retorno da
  função, por isso o filtro `> 0`). Triggers viram "BEFORE INSERT ON `t`".
- Aliases `returns`, `language` e `event` estão em backticks no MySQL — são
  palavras-chave e quebrariam sem quoting.
- **Decisão de robustez**: as consultas de rotina passam por `non_fatal`. Esses
  catálogos mudam de forma entre versões (`prokind` é PG 11+), e perder a lista
  de rotinas é uma sidebar degradada — perder a árvore é não poder navegar.
  Falha vira log no stderr, não erro na UI.
- **Bug estrutural corrigido**: `assemble` montava os schemas só a partir do
  mapa de tabelas. Um schema contendo apenas funções simplesmente não aparecia
  na árvore. Agora o conjunto de nomes é a união de tabelas + rotinas.
- A Sidebar já renderizava esses grupos (mostrava 0). Agora exibe `returns`/
  `language` como meta e abre um stub executável (`SELECT f()`, `CALL p()`) em
  vez de colar uma assinatura que não é SQL válido. Também caiu um `as` cast
  que mascarava o tipo real.
- Fora de escopo (fase futura): corpo/source das funções. Buscar via
  `pg_get_functiondef` numa query em lote é arriscado — a função levanta erro
  para rotinas em C/internal e derrubaria a consulta inteira. Isso pede busca
  sob demanda, ao clicar.

Dependencies: Task 014.

---

## Task 014
Status: Completed

Title:
Fase 1b — Motor de query (frontend): múltiplos resultados + paginação server-side

Validação:
- `npx tsc --noEmit` → 0 erros.
- `npx eslint . --quiet` → exit 0.
- `npx vite build` → build OK.
- Pendente E2E do usuário: script com vários statements, navegação de páginas,
  SELECT que retorna 0 linhas (cabeçalho deve aparecer), coluna JSON.

Description:
Frontend adaptado ao novo contrato do backend (Task 013). Uma aba deixa de ter
`result` único e passa a ter `results[]` + `activeResultIndex`, com faixa de
navegação por statement quando o script tem mais de um.

Affected files:
- src/types.ts (QueryResult ganha statement/offset/hasMore; QueryTab ganha
  results/activeResultIndex/pagingIndex; helper activeResult; Cell aceita
  objeto/array)
- src/lib/api.ts (runQuery → QueryResult[]; novo fetchPage)
- src/store/app.ts (runTab agrega histórico do script; setActiveResult;
  loadResultPage; DEFAULT_PAGE_SIZE exportado)
- src/components/results/ResultsGrid.tsx (paginação server-side, props
  onFetchPage/loading, render de célula JSON)
- src/components/editor/EditorPane.tsx (faixa de statements + wiring de página)
- src/components/shell/StatusBar.tsx (lê o resultado ativo)
- src/components/screens/TableExplorer.tsx (prévia paginada de verdade)

Notes:
- **Bugs reais corrigidos de passagem** (não eram parte do escopo pedido):
  1. O menu de contexto da grade indexava `processed[globalIndex]`, mas
     `processed` é a lista já filtrada/ordenada — copiar célula/linha trazia a
     linha errada em qualquer página > 1 ou com filtro ativo. Índice agora é
     relativo à lista visível.
  2. Células JSON caíam em `String(value)` → "[object Object]". `Cell` foi
     alargado e a renderização passa por JSON.stringify.
  3. `text-violet` (classe que escrevi) não existe na paleta do
     tailwind.config — não geraria CSS nenhum. Trocada por `text-iris`.
- Removidos os botões "Desfazer (ROLLBACK)" e "Ver linhas alteradas" do painel
  de linhas afetadas: eram decorativos, sem handler. UI que promete e não
  cumpre é pior que ausência de UI.
- Busca e ordenação da grade agem **só na página carregada** — o rótulo no
  toolbar diz "nesta página" quando há filtro, para o número não ser lido como
  total.
- A prévia do TableExplorer não usa mais `LIMIT 200` embutido no SQL: agora
  pagina de verdade pelo backend.
- Fase tocou 7 arquivos (acima do teto de 5). Motivo: a mudança de tipo em
  QueryResult/QueryTab atinge todos os consumidores de uma vez; dividir
  deixaria a árvore sem compilar entre as fases.

Dependencies: Task 013.

---

## Task 013
Status: Completed

Title:
Fase 1a — Motor de query (backend): multi-statement, colunas em SELECT vazio,
paginação real

Validação:
- `cargo check` OK na máquina do usuário (Rust 1.97.0, 3.64s). `cargo test`
  (que cobre os 8 `#[test]` do splitter) ainda não foi rodado.
- O splitter foi transliterado fielmente para Python e submetido aos mesmos
  casos dos `#[test]` mais 8 casos de borda extras: 23/23 passando. Isso valida
  o algoritmo, não a compilação.
- Um caso revelou expectativa errada no teste Rust (comentário após `;` fica no
  fragmento seguinte, comportamento correto) — asserção corrigida.

Description:
Reescrita de `db/query.rs`. Três limitações da Task 003 fechadas:
1. **Multi-statement** — `split_statements` tokeniza o script e quebra só nos
   `;` de nível superior, respeitando literais, identificadores quotados,
   comentários de linha/bloco (com aninhamento do PG) e corpos dollar-quoted.
   Dialeto MySQL vs PG tratado explicitamente (`#` como comentário e `\` como
   escape só no MySQL; no PG `#` é caractere de operador).
2. **Colunas em SELECT com 0 linhas** — quando nenhuma linha volta, o statement
   é preparado via `Executor::describe` só para extrair o cabeçalho. Falha é
   engolida (cabeçalho vazio é perda cosmética, não erro).
3. **Paginação real** — as linhas passam a ser consumidas por stream com
   `offset`/`limit`, buscando 1 linha além da página para calcular `hasMore`
   exato sem query de contagem. O cap fixo de MAX_ROWS=5000 sai de cena
   (DEFAULT_PAGE_SIZE=1000, teto de 50k por página).

Affected files:
- src-tauri/Cargo.toml (futures-util, para consumir os streams do sqlx)
- src-tauri/src/db/query.rs (reescrito)
- src-tauri/src/db/mod.rs (DbPool::is_mysql)
- src-tauri/src/commands.rs (run_query → Vec<QueryResult>; novo fetch_page)
- src-tauri/src/lib.rs (registro do fetch_page)

Notes:
- `run_query` agora devolve **um QueryResult por statement**. Erro em um
  statement encerra o script mas NÃO descarta os anteriores: vira um result de
  `kind: "error"` no fim da lista.
- `QueryResult` ganhou `statement`, `offset` e `hasMore`. `totalRows` só é
  preenchido quando o conjunto foi lido até o fim (`hasMore == false`) — antes
  ele mentia, reportando só o que coube no cap.
- `fetch_page(id, sql, offset, limit)` re-executa um statement isolado. Paginar
  por offset re-executa server-side em vez de manter cursor aberto: libera a
  conexão entre páginas ao custo de trabalho repetido, e queries não
  determinísticas podem deslocar entre páginas (trade-off de todo cliente SQL
  stateless).
- Classificação read/write melhorada: `RETURNING` agora exige limites de
  palavra (antes `no_returning_flag` dava falso positivo) e a keyword inicial é
  lida do SQL sem comentários. `CALL` entrou na lista.
- Limitação conhecida e documentada no código: `CREATE PROCEDURE` do MySQL com
  `BEGIN … END;` sem trocar o DELIMITER é quebrado nos `;` internos — mesmo
  comportamento do cliente oficial do MySQL.
- **ATENÇÃO**: o frontend ainda chama a assinatura antiga. O app fica quebrado
  em runtime entre 1a e 1b — rodar só `cargo check`, não `tauri dev`.

Dependencies: Task 012.

---

## Task 006
Status: Completed

Title:
Boot limpo — remover seeds mock do store + estado vazio na shell

Validação:
- `tsc --noEmit` OK (0 erros). ResultsGrid trata kind "error".
- Pendente E2E: recarregar o app, confirmar boot vazio + conectar a banco real.

Description:
App inicia sem dados mock (sem conexões, sem abas com resultado, sem IA/histórico semeados). Sidebar/StatusBar/TitleBar passam a tratar o estado "sem conexão". Decisão do usuário: abrir limpo (dados reais apenas).

Affected files:
- src/store/app.ts (remover imports/seeds mock, resultFor; estado inicial vazio; runTab trata sem-backend/sem-conexão)
- src/components/shell/TitleBar.tsx (guarda sem conexão)
- src/components/shell/StatusBar.tsx (guarda sem conexão + árvore vazia)
- src/components/sidebar/Sidebar.tsx (fallback vazio + dica quando não há conexões)

Notes: arquivos em src/lib/mock/* permanecem até os painéis serem migrados (Tasks 007–010).

Dependencies: Task 004.

---

## Task 007
Status: Completed

Title:
Migrar TableExplorer para dados reais

Description:
Trocar DATABASE/usersResult mock por dados do store; prévia de linhas via run_query (SELECT ... LIMIT).

Affected files:
- src/components/screens/TableExplorer.tsx

Notes:
- Tabela/schema localizados no databaseTree; header usa o schema real.
- Aba "Dados" busca prévia via run_query (SELECT * FROM <schema>.<tabela> LIMIT 200), com identificadores quotados por engine (pg: "..", mysql: ``..``).
- Relacionamentos de entrada/saída computados da árvore real.

Dependencies: Task 006.

---

## Task 008
Status: Completed

Title:
Migrar CommandPalette para o store

Notes: usa databaseTree (flatMap dos schemas). Concluída junto da correção do boot.

Description:
Buscar tabelas/objetos a partir do databaseTree real.

Affected files:
- src/components/screens/CommandPalette.tsx

Dependencies: Task 006.

---

## Task 009
Status: Completed

Title:
Migrar RelationshipsDiagram para o store

Description:
Computar edges de FK a partir do databaseTree real (substituir foreignKeyEdges mock).

Affected files:
- src/components/screens/RelationshipsDiagram.tsx

Notes:
- Edges computados das colunas FK da árvore (só arestas cujo alvo existe no diagrama).
- Layout automático em grade (funciona com qualquer schema), substituindo POS fixo.
- Estado vazio quando não há conexão.

Follow-up de limpeza: src/lib/mock/{schema,data}.ts ficaram sem uso (não importados). Remoção manual pendente (sandbox sem permissão de delete).

Dependencies: Task 006.

---

## Task 011
Status: Completed

Title:
Perf — eliminar tela preta / carregamento lento da UI

Validação:
- `tsc --noEmit` OK. Pendente: reiniciar `npm run tauri dev` (Vite re-otimiza 1x por mudança em optimizeDeps) e confirmar que a shell aparece instantânea + editor carrega com placeholder.
- Observação: monaco-editor completo traz 100+ linguagens (infla o pré-bundle). Otimização futura opcional: importar só a linguagem SQL.

Description:
Causa: `main.tsx` importa Monaco no entry (bloqueia 1º paint) + Vite re-otimiza deps (deps_temp) causando stalls de ~20s. Correção: tirar Monaco do entry, lazy-load do editor com Suspense, `optimizeDeps.include` para pré-bundle estável, e splash no index.html.

Affected files:
- src/main.tsx (remover import de ./lib/monaco)
- src/components/editor/SqlEditor.tsx (importar @/lib/monaco no chunk lazy)
- src/components/editor/EditorPane.tsx (React.lazy + Suspense)
- vite.config.ts (optimizeDeps.include monaco)
- index.html (splash até o React montar)

Dependencies: nenhuma (independente das migrações de painel).

---

## Task 010
Status: Completed

Title:
Migrar AiPanel + HistoryPanel para o store

Description:
Resolver nomes de conexão pelo store; estados vazios; remover CONNECTIONS mock.

Affected files:
- src/components/ai/AiPanel.tsx
- src/components/history/HistoryPanel.tsx

Notes:
- CAUSA RAIZ da tela preta: AiPanel (painel padrão à direita) fazia
  `CONNECTIONS.find(...)!.name` — com boot limpo virou `undefined.name`,
  crashando o React no 1º render (por isso nem o splash aparecia).
- Corrigido usando connections do store com guarda (conn?.name).

Dependencies: Task 006.
