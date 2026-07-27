# Roteiro de testes — Zeru SQL

Ordem sugerida: automatizado primeiro (rápido, pega regressão), depois manual.
Cada item tem o **resultado esperado** — se divergir, é bug.

```bash
# 1. Automatizado (~40s)
cd src-tauri && cargo check && cargo test && cd ..
npm run typecheck && npm run lint && npm run build

# 2. Abrir o app
npm run tauri dev
```

Esperado: 18 testes Rust passando, 0 erros de tipo, lint em silêncio, build OK.

---

## A. Bugs pré-existentes corrigidos

Estes são os mais importantes: são cenários que **falhavam antes** e agora
devem funcionar.

### A1. Colisão de id de conexão (podia sobrescrever senha salva)

1. Crie duas conexões e conecte em ambas.
2. **Feche o app por completo** e abra de novo.
3. Crie uma terceira conexão, diferente das outras.
4. Feche e abra de novo.

**Esperado:** as três conexões aparecem, cada uma conecta com a própria senha.
*Antes:* a terceira nascia com o id `conn-101` e sequestrava a senha da primeira
no keychain.

### A2. Copiar célula na grade

1. Rode algo que devolva mais de uma página (`SELECT * FROM <tabela grande>`).
2. Vá para a **página 2**.
3. Clique com o botão direito numa célula → *Copiar linha*.
4. Cole em qualquer lugar.
5. Repita com um filtro ativo na busca da grade.

**Esperado:** o conteúdo colado é o da linha que você clicou.
*Antes:* vinha a linha errada em qualquer página > 1 ou com filtro.

### A3. Confirmação de comando destrutivo da IA

1. Peça à IA algo como *"apague os usuários inativos"*.
2. O card vem com tarja vermelha. Clique em **Revisar & executar**.
3. Clique em **Confirmar execução**.

**Esperado:** o SQL vai para o editor e roda de fato.
*Antes:* o botão só fechava a confirmação — o app fingia que tinha executado.
⚠️ Use uma tabela descartável.

### A4. Acentuação nas respostas da IA

Peça uma explicação longa em português (*"explique o que essa query faz, em
detalhe"*).

**Esperado:** acentos corretos ao longo de todo o texto.
*Antes:* qualquer caractere multi-byte partido entre dois chunks do stream
virava `<?>` — "ação" saía "a<?><?>ão".

---

## B. Motor de query

### B1. Múltiplos statements

```sql
SELECT 1 AS um;
SELECT 2 AS dois;
SELECT 'três' AS tres;
```

**Esperado:** faixa numerada acima da grade, uma aba por statement, clicáveis.

### B2. Erro no meio do script não descarta o que passou

```sql
SELECT 1;
SELECT * FROM tabela_que_nao_existe;
SELECT 3;
```

**Esperado:** duas entradas — a primeira com resultado, a segunda com erro. O
foco abre direto na que falhou. O terceiro statement **não** roda.

### B3. Colunas em SELECT vazio

```sql
SELECT * FROM <qualquer tabela> WHERE 1 = 0;
```

**Esperado:** cabeçalho de colunas aparece, com 0 linhas.
*Antes:* grade completamente vazia, sem nomes de coluna.

### B4. Paginação real

1. `SELECT * FROM <tabela com milhares de linhas>`
2. Navegue com as setas; troque o tamanho da página (50/100/200/500/1000).

**Esperado:** a numeração das linhas continua de onde parou (não reinicia em 1),
"próxima" desabilita na última página. O total só aparece quando o conjunto foi
lido até o fim.

### B5. O splitter não quebra onde não deve

```sql
SELECT ';' AS ponto_e_virgula_em_texto;
SELECT 'aspas '' escapadas; aqui' AS b;
-- comentário com ; dentro
SELECT 3;
```

No Postgres, teste também um corpo dollar-quoted:

```sql
DO $$ BEGIN RAISE NOTICE 'oi; tudo bem'; END $$;
SELECT 'depois' AS c;
```

**Esperado:** 4 resultados no primeiro caso, 2 no segundo. Nenhum erro de
sintaxe por corte no lugar errado.

### B6. Coluna JSON

```sql
SELECT '{"a": 1, "b": [2, 3]}'::json AS dados;   -- Postgres
SELECT JSON_OBJECT('a', 1) AS dados;             -- MySQL
```

**Esperado:** o JSON aparece legível.
*Antes:* `[object Object]`.

---

## C. Introspecção

Precisa de um banco que tenha função, procedure e trigger.

1. Abra a árvore na sidebar.
2. Expanda **Functions**, **Procedures** e **Triggers**.
3. Clique numa função.

**Esperado:** os grupos mostram contagem real (não 0). Clicar abre uma aba com
stub executável (`SELECT f()` / `CALL p()`); no Postgres, o trigger abre com o
`CREATE TRIGGER` completo.

**C2 — schema só com rotinas:** se tiver um schema sem nenhuma tabela, só
funções, ele deve aparecer no seletor de schema. *Antes: sumia da árvore.*

---

## D. Histórico

1. Rode 3 ou 4 queries diferentes.
2. Abra o painel de histórico (à direita) e marque uma como favorita ⭐.
3. **Feche o app e abra de novo.**

**Esperado:** todas as entradas continuam lá, com o favorito preservado.
*Antes: sumia tudo.*

**D2 — limpar:** clique no ícone de lixeira. Deve pedir um segundo clique antes
de apagar. Confirme, feche e reabra: continua vazio.

---

## E. IA

### E1. Configuração

1. Painel de IA → ícone de engrenagem.
2. Escolha um preset (ou digite o endpoint), informe modelo e chave.
3. Salve. **Feche o app e reabra.**

**Esperado:** o aviso amarelo de "nenhuma chave configurada" some, o campo mostra
"uma chave já está guardada" e o modelo aparece no topo do painel. A chave nunca
é reexibida — está no keychain.

Para testar sem gastar crédito: `ollama serve` + endpoint
`http://localhost:11434/v1`, chave qualquer coisa não-vazia.

### E2. Consciência de esquema

Com uma conexão aberta, pergunte: *"quais tabelas existem e como se
relacionam?"*

**Esperado:** ela cita **suas** tabelas reais, não tabelas inventadas. Os chips
sob a resposta listam o que foi enviado (esquema, SQL da aba, amostra,
histórico).

### E3. Streaming e cancelamento

Peça algo longo. O texto deve aparecer palavra a palavra, e o botão de enviar
vira um quadrado de **parar**. Clique nele no meio.

**Esperado:** para na hora, o texto parcial fica visível, o painel volta a
aceitar nova pergunta.

### E4. Caminhos de erro

- Salve uma chave inválida (`sk-errado`) e pergunte algo.
  **Esperado:** mensagem do provedor legível (ex.: "Invalid API key"), não um
  dump de JSON.
- Aponte o endpoint para `http://localhost:9/v1` e pergunte.
  **Esperado:** "Falha ao contatar o provedor: …", sem travar o painel.

### E5. SQL executável

Peça *"me mostre os 10 registros mais recentes de <tabela>"*.

**Esperado:** vem um card de SQL com botões Executar / Inserir no editor / Nova
aba. **Executar** roda e mostra o resultado na grade.

---

## Se algo falhar

Anote qual item (ex.: "B4") e o que aconteceu. Para erros do backend, a mensagem
costuma sair no terminal onde o `npm run tauri dev` está rodando — as falhas de
introspecção de rotinas, em particular, são propositalmente não-fatais e só
aparecem lá como `[zeru] introspecção de … falhou`.
