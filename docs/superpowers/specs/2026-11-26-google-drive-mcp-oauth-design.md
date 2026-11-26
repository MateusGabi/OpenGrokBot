# Google Drive MCP (OAuth) no Marketplace — design

Data: 2026-11-26

## Intenção

Disponibilizar o **servidor MCP remoto oficial do Google Drive** (`https://drivemcp.googleapis.com/mcp/v1`, documentado em https://developers.google.com/workspace/drive/api/guides/configure-mcp-server) como uma entrada do marketplace do OpenGrokBot. O usuário informa um OAuth client seu, autoriza no navegador uma vez, e os funcionários passam a ter as ferramentas `mcp__google_drive__*` (buscar, ler, criar e baixar arquivos do Drive).

Hoje o app só suporta MCP por `stdio` (comando + env) ou `http/sse` com headers estáticos. O endpoint da Google exige OAuth 2.0 com token delegado pelo usuário; um token colado manualmente expira em ~1 hora. Esse é o verdadeiro trabalho do feature.

## Objetivos

- Entrada "Google Drive" no catálogo (`client/src/marketplace.ts`) apontando para o servidor oficial.
- Fluxo OAuth 2.0 completo: client pré-registrado, PKCE + `state`, callback local, troca de código, refresh automático do access token.
- Funcionar nos dois consumidores de MCP que o app já tem: Claude (Agent SDK) e Opencode/API (`openMcpServers`).
- Client secret e tokens **nunca** chegam ao browser; só o client id e o status aparecem na UI.
- Credenciais persistem entre restarts e ficam isoladas por instalação (`OPENGROKBOT_TEAM` / `OPENGROKBOT_DATA`).
- Usar `/mcp/v1self` por padrão, para não exigir suporte a *form elicitation*.
- Documentar na UI/README o setup no Google Cloud (APIs, OAuth client, redirect URI, escopos).

## Não-goals

- Codex e Gemini: seus CLIs gerenciam MCP por conta própria; o marketplace já só habilita Claude e "Opencode + MCP".
- *Form elicitation* e a toolset completa de `/mcp/v1` (operações sensíveis). Fica para uma evolução.
- Dynamic client registration (a Google exige client criado no console).
- Criptografia dos tokens em repouso (o projeto já guarda API keys em texto plano no `team.json`).
- Criar/publicar um servidor MCP próprio: usamos o oficial da Google.

## Anti-goals

- Pedir ao usuário que cole um `gcloud auth print-access-token` — resolve por 1 hora e depois quebra.
- Spawnar um bridge stdio por turno: processo extra, empacotamento no Electron, corrida de escrita de token entre funcionários simultâneos, e sem benefício no caminho Opencode.

## Restrições descobertas no código

- `McpServerDef` (`shared/types.ts`) é `stdio | http/sse` com `headers` opcionais.
- `McpHttpServerConfig` do `@anthropic-ai/claude-agent-sdk` aceita `headers` estáticos, **sem OAuth**.
- `@modelcontextprotocol/sdk@1.30.0` já traz `OAuthClientProvider`, `StreamableHTTPClientTransport({ authProvider })` e `finishAuth()` — o refresh e o 401 são tratados pelo SDK.
- `runClaudeTurn` é `async`, mas `buildQueryOptions` é síncrona (`server/providers/claude.ts`).
- `publicTeam()` (`server/index.ts`) devolve o team ao browser; qualquer segredo precisa ficar fora dele.
- O middleware de `OPENGROKBOT_TOKEN` (`server/index.ts`) protege `/api/*`; o callback do OAuth chega do navegador sem esse token e precisa ser tratado à parte, validado por `state` + PKCE.
- `applyTeam()` reescreve `team.json`, faz `store.seed()` e broadcast — não é lugar para salvar token que muda a cada refresh.

## Abordagens consideradas

**A. Gerenciador de tokens único + header injetado no Claude e `authProvider` no Opencode (escolhida).**
Um módulo no servidor é o dono de credenciais, state/verifier e refresh. No Claude, buscamos o token válido antes de montar as opções e passamos `Authorization: Bearer …` em `headers`. No Opencode, entregamos um `OAuthClientProvider` que delega para o mesmo módulo. Um só dono do estado, nenhum processo extra, aproveita o middleware OAuth que o SDK já tem.

**B. Bridge stdio local único.**
Um script que faz OAuth e expõe as ferramentas por stdio para os dois caminhos. Descartada: precisa entrar no `build.files` do Electron, é spawnado por turno, cria concorrência de escrita do token e duplica o que o SDK já resolve no Opencode.

**C. Servidor MCP in-process via `McpSdkServerConfigWithInstance`.**
Elegante para renovar token por chamada, mas exige espelhar os schemas remotos das ferramentas num `McpServer` local. Guardada como evolução se um turno longo do Claude expirar no meio.

## Decisões já tomadas (chamadas do designer)

1. **Credenciais e tokens em `data/mcp-oauth.json`**, resolvido a partir de `dataDir` — não em `team.json`. Razões: refresh frequente não deve reescrever o team nem disparar broadcast; `publicTeam()` continua intacto; `OPENGROKBOT_DATA` isola instalações.
2. **`McpServerDef` fica sem campo OAuth.** O catálogo ganha apenas um metadado client-side (`oauth?: { kind: 'google', scopes, docsUrl }`) em `MarketplaceItem` para disparar a UI de conexão. O servidor reconhece o servidor como OAuth pela entrada existente no `mcp-oauth.json`, não pelo formato do def.
3. **Endpoint padrão `/mcp/v1self`** na entrada do catálogo (sem elicitation).
4. **Um módulo `server/oauth.ts`** (ou equivalente) com: leitura/escrita do store, `getAccessToken(name)` com refresh quando próximo do vencimento, serialização de refresh concorrente, e construção do `OAuthClientProvider` por servidor.
5. **Rotas**: `POST /api/mcp/oauth/:name/start` recebe `{ clientId, clientSecret, redirectUri, scopes }`, cria uma sessão com `state` + PKCE e devolve `{ authorizationUrl, state }`; `GET /api/mcp/oauth/:name/callback` troca o código, persiste tokens e responde HTML que avisa a UI; `POST /api/mcp/oauth/:name/disconnect` e `GET /api/mcp/oauth/:name/status` completam o conjunto. O callback fica fora do middleware de token do app e é validado por `state` + PKCE (não pelo cookie do OpenGrokBot).
6. **Claude**: `buildQueryOptions` passa a ser `async`; `mcpServersFor` inclui o header `Authorization` com o token de `getAccessToken`. Sem token válido, o servidor é registrado sem header e a falha 401 aparece como aviso legível, sem derrubar o app. Como o fluxo normal já autoriza no momento do "Add" (decisão 10), esse caminho só ocorre se o token for perdido, revogado ou expirar no meio de um turno longo.
7. **Opencode/API**: `transportFor` (`server/providers/mcp.ts`) usa `authProvider` quando o nome está no store OAuth; caso contrário mantém `headers` como hoje. Turnos de funcionários não têm navegador: se não houver token válido, ou se o refresh falhar com `invalid_grant`, `openMcpServers` **não** dispara `redirectToAuthorization`; ele pula o servidor, emite um aviso legível via `onNotice` e marca a entrada como `needs_auth` para a UI oferecer "Reconectar".
8. **UI**: no modal do marketplace, itens com `oauth` mostram Client ID + Client Secret e um botão "Autorizar no Google" que abre em popup a URL devolvida por `/start`; status consultado em `GET .../status`; a URI exata a registrar no Google é exibida antes de autorizar. Secret nunca é devolvido ao browser. Itens sem OAuth continuam com `secrets`/`argHint` como hoje.
9. **Escopos e redirect URI**: `drive.readonly` + `drive.file`, com `access_type=offline` e `prompt=consent`. O browser envia `window.location.origin` no `/start`; o servidor monta e persiste `${origin}/api/mcp/oauth/${name}/callback` e usa **exatamente esse valor** como `redirect_uri` na troca de código. Isso cobre dev (`:5180`, com o proxy `/api` do Vite), produção (`:4310`) e acesso remoto/VPS sem configurar nada; trocar de origem exige atualizar o client no Google Cloud. O client é *Web application* com "Use this client for an AI-powered agent" habilitado.
10. **Add + autorizar em uma única ação**: para itens `oauth`, o botão do catálogo abre um formulário que já salva o def em `team.json` e inicia o OAuth. Não existe estado "instalado mas nunca autorizado" no fluxo normal — isso simplifica a UI e torna o aviso da decisão 6 puramente um caminho de erro/recuperação.
11. **`/disconnect`**: apaga localmente tokens, client secret, verifier e sessão daquele servidor. **Não** revoga o consentimento no Google — a UI avisa que a revogação global deve ser feita na conta Google. Depois disso é preciso informar client id/secret novamente.
12. **Estados do `/status`**: `absent` (não configurado), `configured` (client salvo, sem token válido / refresh falhou — a UI mostra "Reconectar"), `connected` (token válido). O secret nunca aparece na resposta.
13. **Refresh concorrente**: o módulo OAuth serializa as renovações por servidor (uma promise em voo por entrada) para que dois funcionários falando ao mesmo tempo não disputem o `refresh_token`.

## Deixado para o builder

- Usar `auth()` do SDK com um `OAuthClientProvider` customizado ou montar a URL/troca diretamente contra os endpoints da Google — desde que o mesmo provider atenda o fluxo no browser e o refresh em runtime, e que `clientInformation()` seja estático (cliente pré-registrado, sem DCR).
- Mecanismo de aviso entre popup e UI (`postMessage` vs. polling do `/status`), e expiração das sessões de autorização em memória.
- Formato exato do `mcp-oauth.json` e validação na leitura (o secret nunca entra na resposta da API — decisão 12).
- Testes unitários: refresh, validação de `state`, serialização de refresh concorrente, mascaramento; mais verificação manual com um client real do Google Cloud.
- Limite conhecido: token injetado no header é estático durante um turno do Claude. Documentar; se um turno longo expirar no meio, migrar esse caminho para a abordagem C.
