# Design: provider `opencode2` com MCP

Data: 2026-11-26

## Intenção / por quê

Todos os funcionários do `team.json` usam o provider `opencode` (`kind: 'openai'`). O runtime
desse kind só oferece `LOCAL_TOOLS` e nunca lê `agent.mcpServers` / `team.mcpServers`, então os
MCPs cadastrados (github, oggb/Linear, filesystem, vercel, ui-skills, notion) são ignorados.
O suporte a MCP hoje existe apenas no provider Claude. Queremos um provider novo, `opencode2`,
que use a mesma API OpenAI-compatible do Opencode **com** ferramentas MCP, sem alterar o
comportamento do `opencode` atual.

## Goals

- Novo `ProviderKind: 'opencode'`, com runner próprio, registrado ao lado do `openai`.
- Novo provider `opencode2` em `team.providers` (id amigável, `kind: 'opencode'`, mesma base URL e
  chave do provider `opencode` atual).
- Ferramentas MCP por funcionário, opt-in via `agent.mcpServers` (campo que já existe).
- Suporte aos três transportes já declarados em `McpServerDef`: `stdio`, `http`, `sse`.
- Ferramentas MCP aparecem no loop de tools do modelo, com o mesmo fluxo de aprovação
  (`needsApproval` já trata `mcp__*`).
- Perfil mostra a seção "MCP servers" para o kind novo.

## Non-goals / anti-goals

- Não modificar o comportamento do provider `opencode` existente.
- Não alterar o provider Claude nem o Agent SDK.
- Não inventar descoberta automática de servidores: a lista continua sendo `team.mcpServers`.
- Não persistir credenciais novas em arquivos versionados (o `team.json` já é local/ignorado).

## Restrições

- `@modelcontextprotocol/sdk@1.30.0` já está no lockfile (transitivo do Agent SDK); torná-lo
  dependência direta.
- `McpServerDef` (`shared/types.ts`) já tem `stdio { command, args, env }` e
  `http|sse { url, headers }` — não mudar o formato.
- `runOpenAiTurn` (`server/providers/openai.ts`) já tem o loop de streaming e de tool calls;
  duplicá-lo é anti-goal.
- A UI filtra recursos por `kind` (`Profile.tsx`, `catalog.ts`); o kind novo precisa entrar nesses
  pontos.

## Approaches consideradas

1. **Kind novo + runner próprio com loop compartilhado (escolhido).** Extrair de `openai.ts` uma
   função genérica de turn que recebe uma lista de ferramentas externas; `opencode.ts` monta as
   ferramentas MCP e chama essa função. Explícito, isolado, sem duplicação do loop.
2. **Flag `mcpEnabled` no kind `openai`.** Menos arquivos, mas o comportamento fica escondido numa
   flag e a UI precisa de uma regra paralela à de `kind === 'claude'`. Rejeitado: o usuário quer
   um provider novo e explicitamente separado.
3. **Duplicar `openai.ts` inteiro no runner novo.** Rejeitado: ~160 linhas repetidas de streaming,
   consumo de SSE e tratamento de tool calls.

## Como será feito (decidido)

- `shared/types.ts`: adicionar `'opencode'` a `ProviderKind`.
- `shared/catalog.ts`: entrada em `PROVIDER_KINDS` e em `MODEL_SUGGESTIONS` (vazia, como `openai`).
- `server/providers/index.ts`: `RUNNERS.opencode = runOpencodeTurn`; `probe()` trata o kind novo
  como o `openai` (exige `baseUrl`, testa `/models`).
- `server/providers/openai.ts`: extrair `runOpenAiCompatibleTurn(params, extraTools, systemNote)`
  reutilizável; `runOpenAiTurn` chama com zero ferramentas externas.
- `server/providers/mcp.ts` (novo): abrir/fechar clientes MCP por turn via
  `StdioClientTransport` / `StreamableHTTPClientTransport` / `SSEClientTransport`, listar
  ferramentas e convertê-las para function tools do OpenAI com nomes `mcp__<servidor>__<ferramenta>`.
  Executar `callTool` quando o modelo chamar, devolvendo o resultado como mensagem `role: 'tool'`.
- `server/providers/opencode.ts` (novo): `runOpencodeTurn` — usa `mcp.ts` + o loop compartilhado.
- `client/src/components/Profile.tsx`: mostrar MCP quando `kind === 'claude' || kind === 'opencode'`.
- `team.example.json`: documentar o provider `opencode2` de exemplo. O `team.json` real é local;
  o usuário terá que copiar o provider e apontar os agentes desejados para ele.

## Deixado para o builder (decisões menores, já resolvidas aqui)

- Nome das ferramentas: `mcp__<servidor>__<ferramenta>` (consistente com `approvals.ts` e
  `summarizeToolUse` em `claude.ts`).
- Ciclo de vida do cliente MCP: um por turn, fechado no `finally` — mais simples e sem estado
  compartilhado entre funcionários.
- Servidores que falham ao conectar são ignorados com aviso em `handlers.onActivity`, sem derrubar
  o turn inteiro.
- Resultado de `callTool` é serializado como texto (JSON quando não for string), truncado como o
  resto das mensagens `tool`.
- Testes: um teste de integração com um servidor MCP stdio fake confirmando que a ferramenta
  chega ao corpo da requisição e que o `callTool` é executado.
