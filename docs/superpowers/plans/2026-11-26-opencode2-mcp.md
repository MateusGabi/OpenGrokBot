# Opencode2 MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o provider `opencode2` (`kind: 'opencode'`) que usa a API OpenAI-compatible do Opencode com ferramentas MCP por funcionário, sem alterar o provider `opencode` atual.

**Architecture:** O kind novo tem runner próprio registrado ao lado do `openai`. O loop de streaming e tool-calls de `openai.ts` é extraído para `runOpenAiCompatibleTurn`, que aceita ferramentas externas injetadas. Um módulo `mcp.ts` abre clientes MCP (stdio/http/sse) com `@modelcontextprotocol/sdk`, converte `listTools` em function tools `mcp__<servidor>__<ferramenta>` e executa `callTool` pelo mesmo loop de aprovação.

**Tech Stack:** TypeScript (NodeNext, strict), Node 24, `@modelcontextprotocol/sdk@1.30.0`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-26-opencode2-mcp-design.md`

## Global Constraints

- Não alterar o comportamento do provider `opencode` (`kind: 'openai'`) existente.
- Não alterar o provider Claude nem o Agent SDK.
- Não mudar o formato de `McpServerDef`: `stdio { command, args?, env? }` | `http|sse { url, headers? }`.
- Nomes de ferramentas MCP: `mcp__<servidor>__<ferramenta>` (padrão já usado em `approvals.ts` e `claude.ts`).
- Ciclo de vida do cliente MCP: um por turn, fechado no `finally`.
- Servidor que falha ao conectar é ignorado com aviso via `handlers.onActivity`; não derruba o turno.
- `@modelcontextprotocol/sdk` deve virar dependência direta em `package.json` (versão `^1.30.0`).
- Testes ficam em `server/**/*.test.ts` e são executados por `npm test` (tsc → `node --test dist/server/*.test.js`).

## Review Focus

- **MCP server com comando inexistente** → deve ser ignorado com aviso e o turno deve continuar. Teste: Task 3, "servidor que falha".
- **Nome de servidor/ferramenta com `_` ou `__`** (`my_server`, `read_file`) → resolução não pode quebrar por parsing de prefixo. Teste: Task 3, "nomes com underscore"; implementar com `Map` de nome completo → alvo, não com `split('__')`.
- **Ferramenta MCP sob `approvals: 'ask-dangerous'`** → `mcp__*` exige aprovação; recusa não deve executar a ferramenta. Teste: Task 4, "aprovação negada".
- **Regressão do provider `opencode` atual** → mesmo com `agent.mcpServers` preenchido, o runner `openai` não deve enviar ferramentas MCP. Teste: Task 2, "regressão".
- **`env` / `headers` do MCP server** → devem chegar ao transporte. Teste: Task 3, "env do stdio".

---

### Task 1: Contrato do novo kind

**Files:**
- Modify: `shared/types.ts:16`
- Modify: `shared/catalog.ts:12-24`
- Modify: `server/team.ts:9`
- Test: `server/provider-kinds.test.ts` (novo)

**Interfaces:**
- Consumes: nada.
- Produces: `ProviderKind` inclui `'opencode'`; `MODEL_SUGGESTIONS.opencode === []`; `PROVIDER_KINDS` inclui entrada `{ id: 'opencode', label, hint }`; `parseTeam` aceita provider com `kind: 'opencode'`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_SUGGESTIONS, PROVIDER_KINDS } from '../shared/catalog.js'
import { parseTeam } from './team.js'

test('opencode is a valid provider kind', () => {
  assert.deepEqual(MODEL_SUGGESTIONS.opencode, [])
  assert.ok(PROVIDER_KINDS.some((k) => k.id === 'opencode'))
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { opencode2: { kind: 'opencode', label: 'Opencode 2', baseUrl: 'https://x/v1', apiKey: 'k' } },
    agents: [], skills: {}, settings: {},
  }, '.')
  assert.equal(team.providers.opencode2?.kind, 'opencode')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha no teste novo (`MODEL_SUGGESTIONS.opencode` undefined) e/ou erro de compilação em `PROVIDER_KINDS`.

- [ ] **Step 3: Implementar**

Em `shared/types.ts`, `ProviderKind` passa a ser `'claude' | 'codex' | 'gemini' | 'openai' | 'opencode'`.
Em `shared/catalog.ts`, adicionar `opencode: []` em `MODEL_SUGGESTIONS` e a entrada em `PROVIDER_KINDS` com hint curto citando MCP e base URL OpenAI-compatible.
Em `server/team.ts`, adicionar `'opencode'` ao `Set` `PROVIDER_KINDS`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts shared/catalog.ts server/team.ts server/provider-kinds.test.ts
git commit -m "feat: add opencode provider kind"
```

---

### Task 2: Extrair o loop compartilhado do runner OpenAI

**Files:**
- Modify: `server/providers/types.ts` (adicionar `ExternalTool`, `ExternalToolRunner`)
- Modify: `server/providers/openai.ts` (extrair `runOpenAiCompatibleTurn`)
- Test: `server/providers/openai.test.ts` (novo)

**Interfaces:**
- Consumes: `RunTurnParams`, `TurnHandlers` de `server/providers/types.ts`; `LOCAL_TOOLS`, `runLocalTool`, `summarizeLocalTool` de `localtools.ts`.
- Produces:
  - `ExternalTool = { name: string; description: string; parameters: Record<string, unknown> }`
  - `ExternalToolRunner = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<string>`
  - `runOpenAiCompatibleTurn(params: RunTurnParams, extraTools: ExternalTool[], runExtraTool: ExternalToolRunner | undefined, systemNote: string): Promise<TurnResult>`
  - `runOpenAiTurn(params)` continua com assinatura e comportamento idênticos, chamando a função acima com `[]`, `undefined`, `''`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// helper: substitui globalThis.fetch por um mock que captura o body e devolve um SSE de 1 chunk
assert.deepEqual(names(captured[0].tools), ['read_file']) // agente com tools: ['Read']
```

Testes: (a) "regressão": agente com `mcpServers: ['notion']` no provider `openai` ainda envia só `read_file`; (b) "ferramentas externas": chamar `runOpenAiCompatibleTurn` com `extraTools: [{ name: 'mcp__fake__ping', ... }]` e `runExtraTool` que devolve `'pong'`, o corpo da requisição contém `mcp__fake__ping` e o resultado aparece na segunda mensagem `role: 'tool'`; (c) streaming continua gerando texto via `handlers.onDelta`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha de compilação — `runOpenAiCompatibleTurn` não existe.

- [ ] **Step 3: Implementar a extração**

Mover o corpo atual de `runOpenAiTurn` para `runOpenAiCompatibleTurn`. Em `body.tools`, juntar `LOCAL_TOOLS.filter(...)` mapeadas mais `extraTools`. No ramo de execução: se `call.function.name` pertence a `extraTools`, chamar `runExtraTool(name, args, signal)`; senão usar `runLocalTool` como hoje. `claudeName` para `needsApproval` é o próprio nome quando for ferramenta externa. Manter `buildSystemPrompt(team, conversation, agent, systemNote, notes)`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos passam, inclusive o teste de regressão.

- [ ] **Step 5: Commit**

```bash
git add server/providers/types.ts server/providers/openai.ts server/providers/openai.test.ts
git commit -m "refactor: share OpenAI-compatible turn loop"
```

---

### Task 3: Cliente MCP

**Files:**
- Create: `server/providers/mcp.ts`
- Create: `server/providers/fixtures/fake-mcp.mjs`
- Test: `server/providers/mcp.test.ts` (novo)
- Modify: `package.json` (dependência direta `@modelcontextprotocol/sdk`)

**Interfaces:**
- Consumes: `ExternalTool`, `ExternalToolRunner` (Task 2); `Team`, `Agent` de `shared/types.ts`.
- Produces:
  - `McpBundle = { tools: ExternalTool[]; callTool: ExternalToolRunner; close: () => Promise<void> }`
  - `openMcpServers(team: Team, agent: Agent, onNotice?: (line: string) => void): Promise<McpBundle>`

- [ ] **Step 1: Escrever os testes que falham**

Fixture `fake-mcp.mjs`: servidor MCP stdio mínimo com `Server` + `StdioServerTransport`, declarando uma tool `ping` com `inputSchema: { type: 'object', properties: {} }` e respondendo `callTool` com texto `pong:<args JSON>`.

Testes: (a) "listing e chamada": `openMcpServers` com server stdio `command: process.execPath`, `args: [caminho da fixture via process.cwd()]`; esperar `tools[0].name === 'mcp__fake__ping'`; chamar e conferir `pong:`; (b) "nomes com underscore": servidor `my_server` com tool `read_file` → nome completo `mcp__my_server__read_file` resolve e chama; (c) "env do stdio": fixture lê `process.env.MCP_FIXTURE_TAG`, teste passa `env: { MCP_FIXTURE_TAG: 'abc' }` e confere o texto retornado; (d) "servidor que falha": comando inexistente → `onNotice` chamado e `tools` vazio.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha de compilação — `mcp.ts` não existe.

- [ ] **Step 3: Implementar**

Imports exatos: `Client` de `@modelcontextprotocol/sdk/client/index.js`, `StdioClientTransport` de `.../client/stdio.js`, `StreamableHTTPClientTransport` de `.../client/streamableHttp.js`, `SSEClientTransport` de `.../client/sse.js`.

Para cada `name` em `agent.mcpServers`: buscar `team.mcpServers[name]`; para `stdio` usar `StdioClientTransport({ command, args, env: { ...process.env, ...def.env } })`; para `http` usar `StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers: def.headers } })`; para `sse` usar `SSEClientTransport(new URL(def.url), { requestInit: { headers: def.headers } })`. Criar `Client`, `await client.connect(transport)`, `await client.listTools()`. Guardar num `Map<string, { client: Client; toolName: string }>` a chave `mcp__${name}__${tool.name}` — esse Map é a fonte de verdade para `callTool`, sem parsing de prefixo. `callTool` chama `client.callTool({ name: toolName, arguments: args })` e converte `content` em texto (JSON se não for string). `close` fecha todos os clients. Erros de conexão/listagem chamam `onNotice(\`MCP ${name}: ${msg}\`)` e seguem para o próximo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
npm install @modelcontextprotocol/sdk@^1.30.0 --save-exact=false
git add package.json package-lock.json server/providers/mcp.ts server/providers/fixtures/fake-mcp.mjs server/providers/mcp.test.ts
git commit -m "feat: MCP client for stdio, http and sse servers"
```

---

### Task 4: Runner `opencode` e registro

**Files:**
- Create: `server/providers/opencode.ts`
- Modify: `server/providers/index.ts:1-23`
- Test: `server/providers/opencode.test.ts` (novo)

**Interfaces:**
- Consumes: `runOpenAiCompatibleTurn` (Task 2), `openMcpServers` (Task 3), `RUNNERS`/`providerKeepsSession` de `index.ts`.
- Produces: `runOpencodeTurn(params: RunTurnParams): Promise<TurnResult>`; `RUNNERS.opencode`; `providerKeepsSession` continua `false` para o kind novo.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('opencode runner sends MCP tools and executes them', async () => { /* mock fetch + fixture MCP */ })
test('denied MCP tool is not executed', async () => { /* approvals: ask-dangerous, onToolPermission -> false */ })
```

Assertões: corpo da requisição contém `mcp__fake__ping`; com aprovação negada, a mensagem `role: 'tool'` contém `Denied by the boss` e a fixture não foi chamada (contador em arquivo temporário ou tag no texto).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha de compilação — `opencode.ts` não existe.

- [ ] **Step 3: Implementar**

`runOpencodeTurn`: abrir bundle com `openMcpServers(team, agent, handlers.onActivity ? (l) => handlers.onActivity!(l) : undefined)`; montar `mcpNote` igual ao de `claude.ts:69`; chamar `runOpenAiCompatibleTurn(params, bundle.tools, bundle.callTool, mcpNote)` dentro de `try`, `await bundle.close()` no `finally`. Em `index.ts`: importar e registrar em `RUNNERS`; no `probe()`, tratar `case 'opencode'` com a mesma lógica de `openai` (exigir `baseUrl`, consultar `/models`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add server/providers/opencode.ts server/providers/index.ts server/providers/opencode.test.ts
git commit -m "feat: opencode2 provider with MCP tools"
```

---

### Task 5: UI, exemplo e documentação

**Files:**
- Modify: `client/src/components/Profile.tsx:293`
- Modify: `team.example.json`
- Modify: `README.md`
- Test: `server/provider-kinds.test.ts` (ampliar, se houver seam)

**Interfaces:**
- Consumes: `ProviderKind` com `'opencode'` (Task 1).
- Produces: nenhuma interface nova.

**Nota de seam:** não existe teste automatizado para a UI neste repo; a verificação é `npm run typecheck` + `npm test`. Isso é uma limitação conhecida, não um teste omitido.

- [ ] **Step 1: Escrever/ajustar a verificação**

Ampliar `server/provider-kinds.test.ts` com uma asserção de que a entrada `opencode` em `PROVIDER_KINDS` existe para a UI (já feita na Task 1 — apenas confirmar que continua passando).

- [ ] **Step 2: Rodar e confirmar que falha (se aplicável)**

Run: `npm run typecheck`
Expected: passa antes da mudança; a falha aqui é apenas a ausência da mudança de UI, verificada por inspeção.

- [ ] **Step 3: Implementar**

Em `Profile.tsx`, a condição da seção de MCP passa a `kind === 'claude' || kind === 'opencode'`; atualizar o texto da dica para não dizer que é exclusivo do Claude. Em `team.example.json`, adicionar em `providers` um exemplo `opencode2` com `kind: 'opencode'`, `baseUrl: 'https://opencode.ai/inference/openai/v1'` e sem `apiKey` (comentário implícito: preencher localmente). Em `README.md`, atualizar a linha que diz que MCP é Claude-only para incluir o provider `opencode2`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run typecheck && npm test`
Expected: passa sem erros.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Profile.tsx team.example.json README.md
git commit -m "docs: expose opencode2 MCP in UI and examples"
```
