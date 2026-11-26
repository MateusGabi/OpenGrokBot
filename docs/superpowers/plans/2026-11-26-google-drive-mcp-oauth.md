# Google Drive MCP (OAuth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the official Google Drive remote MCP server to OpenGrokBot's marketplace with a working OAuth 2.0 connect flow, usable by Claude and "Opencode + MCP" employees.

**Architecture:** A server-side OAuth store in `data/mcp-oauth.json` holds client credentials and tokens; a `GoogleOAuth` manager owns the authorization-code/PKCE flow, refresh, and the MCP SDK `OAuthClientProvider`. Claude gets a refreshed Bearer header injected before each turn; Opencode gets the SDK's native `authProvider`. The browser sees only status and client id.

**Tech Stack:** TypeScript (strict, NodeNext), Express 4, React 19, `@modelcontextprotocol/sdk@1.30.0`, `@anthropic-ai/claude-agent-sdk`, `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-google-drive-mcp-oauth-design.md`

## Global Constraints

- Node 20+; server tsconfig is `strict` with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (`tsconfig.server.json`).
- Tests are `node:test` + `node:assert/strict`, compiled by `npm test` (`tsc -p tsconfig.server.json && node --test "dist/server/**/*.test.js"`). Client checks with `npm run typecheck`.
- Do **not** change `McpServerDef` (`shared/types.ts`): stdio/http/sse with env/headers only.
- Do **not** add runtime dependencies; the MCP SDK and Express already provide everything.
- Client secret, access token and refresh token never appear in any HTTP response to the browser; they live only in `data/mcp-oauth.json`.
- Default endpoint is `https://drivemcp.googleapis.com/mcp/v1self` (no form elicitation); scopes are exactly `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/drive.file`.
- Redirect URI is always the exact string the browser sent as `${window.location.origin}/api/mcp/oauth/google-drive/callback`, persisted and reused verbatim.
- Commit at the end of every task.

## Review Focus

- A Google callback arrives without the app's `OPENGROKBOT_TOKEN` cookie — the callback route must be exempt from the token middleware and reject mismatched `state`. Test: Task 3 callback route test; Task 2 mismatched-state test.
- Dev (`:5180`), production (`:4310`) and VPS/browser origins produce different redirect URIs — using any derived or hardcoded origin breaks the token exchange. Test: Task 3 `/start` test asserts the provided `redirectUri` is persisted/returned verbatim; Task 8 manual checklist covers dev and remote origins.
- Refresh token revoked (`invalid_grant`) or token expired mid-work — must not trigger an interactive redirect in a background employee turn, and must show "Reconectar". Test: Task 2 invalid-grant test; Task 5 configured-status skip test; the known mid-turn limit is documented in Task 8.
- Two employees turn simultaneously and both need a refresh — concurrent `refresh_token` use can invalidate the grant. Test: Task 2 serialized-refresh test.
- Server deleted from `team.json` while OAuth entry lingers, or `/status` leaking the secret — status must be `absent` with no def, and never contain credentials. Test: Task 3 `/status` tests.

---

### Task 1: OAuth credential store

**Files:**
- Create: `server/oauth-store.ts`
- Test: `server/oauth-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type OAuthStatus = 'absent' | 'configured' | 'connected'`; `export interface OAuthEntry { clientId: string; clientSecret: string; redirectUri: string; scopes: string[]; accessToken?: string; refreshToken?: string; expiresAt?: number; state?: string; codeVerifier?: string }`; `export class OAuthStore { constructor(file: string); get(name: string): OAuthEntry | undefined; set(name: string, entry: OAuthEntry): void; delete(name: string): void; status(name: string): OAuthStatus }`. `status` is `absent` with no entry, `connected` with an unexpired `accessToken`, else `configured`.

- [ ] **Step 1: Write the failing test**

`server/oauth-store.test.ts`: use `node:test`, `node:assert/strict`, `mkdtempSync(path.join(tmpdir(), 'ogb-oauth-'))` for the file path. Write two tests:
  - `salva e relê entradas entre instâncias`: `new OAuthStore(file)` → `set('google-drive', entry)` → a second `new OAuthStore(file).get('google-drive')` deep-equals entry.
  - `status acompanha o ciclo de vida`: assert `absent` before `set`; `configured` after `set` without token; `connected` after `set` with `accessToken: 'tok', expiresAt: Date.now() + 60_000`; `configured` after `set` with `expiresAt: Date.now() - 1`; `absent` after `delete`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error, module `./oauth-store.js` not found.

- [ ] **Step 3: Implement `server/oauth-store.ts`**

Read/write the JSON file with `readFileSync`/`writeFileSync` via a `.tmp` + `renameSync` (mirror `saveTeam` in `server/team.ts`). Return a fresh empty store on missing/invalid file. No secret masking here — that happens at the API layer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: both new tests PASS, existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add server/oauth-store.ts server/oauth-store.test.ts
git commit -m "feat: add persistent OAuth credential store"
```

### Task 2: Google OAuth flow, refresh and SDK provider

**Files:**
- Create: `server/oauth.ts`
- Test: `server/oauth.test.ts`

**Interfaces:**
- Consumes: `OAuthStore`, `OAuthEntry`, `OAuthStatus` from Task 1.
- Produces: `export const GOOGLE_DRIVE_SCOPES: readonly string[]`; `export const GOOGLE_AUTH_URL`, `export const GOOGLE_TOKEN_URL`; `export class OAuthNeedsAuthError extends Error`; `export interface OAuthAccess { accessToken(name: string): Promise<string | undefined>; authProvider(name: string): OAuthClientProvider | undefined; status(name: string): OAuthStatus }`; `export class GoogleOAuth implements OAuthAccess { constructor(store: OAuthStore, opts?: { fetch?: typeof fetch; now?: () => number }); start(name: string, input: { clientId: string; clientSecret: string; redirectUri: string; scopes: readonly string[] }): { authorizationUrl: string; state: string }; complete(name: string, state: string, code: string): Promise<void>; accessToken(name: string): Promise<string | undefined>; authProvider(name: string): OAuthClientProvider | undefined; status(name: string): OAuthStatus; disconnect(name: string): void }`. Import the SDK type with `import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'` (the package's `./*` export maps this to `dist/esm/client/auth.js`).

- [ ] **Step 1: Write the failing tests**

`server/oauth.test.ts` with a temp-file store and a fake `fetch` captured per test:
  - `start gera URL de autorização com PKCE`: call `start` with `redirectUri: 'http://localhost:5180/api/mcp/oauth/google-drive/callback'` and the two scopes; assert the URL starts with `https://accounts.google.com/o/oauth2/v2/auth?`, has exactly `state` and `code_challenge` equal to the stored values, `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, `response_type=code`, `redirect_uri` equal to the input string, and `scope` with both scopes. Assert `store.get(name)` has `state`, `codeVerifier`, client id/secret and redirect uri.
  - `complete troca o código com code_verifier e persiste tokens`: fake `fetch` returns `Response.json({ access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' })`; assert the request body contains `grant_type=authorization_code`, `code=abc`, `code_verifier` equal to the stored verifier, client id/secret and redirect uri; assert entry now has tokens and no `state`/`codeVerifier`.
  - `complete rejeita state divergente`: after `start`, `complete(name, 'wrong', 'abc')` rejects; store still has no `accessToken`.
  - `accessToken renova quando expirado e reusa quando válido`: fixed clock `now = () => 1_000_000`; entry with `expiresAt: 999_000` → fake fetch returns a new token, assert `store.get(...).accessToken` updated and `expiresAt === 1_000_000 + 3600_000`; second call with fresh token makes zero extra fetch calls.
  - `accessToken serializa renovações concorrentes`: two parallel calls on an expired entry with a fake fetch that awaits a deferred promise; resolve it; assert fetch called once and both calls return `'tok'`.
  - `accessToken marca configured em invalid_grant`: fake fetch returns status 400 `{ error: 'invalid_grant' }`; assert `OAuthNeedsAuthError` is thrown and `status(name) === 'configured'`.
  - `authProvider não abre navegador em turno de funcionário`: `authProvider(name)?.redirectToAuthorization()` rejects with `OAuthNeedsAuthError`.
  - `authProvider.tokens devolve o token atual`: after `complete`, `await authProvider(name)?.tokens()` returns `access_token: 'tok'` and `token_type: 'Bearer'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error, module `./oauth.js` not found.

- [ ] **Step 3: Implement `server/oauth.ts`**

`start`: generate `state` with `randomUUID()`, verifier with `randomBytes(32).toString('base64url')`, challenge with `createHash('sha256').update(verifier).digest('base64url')`; persist entry via `store.set`; build the Google URL with `URLSearchParams`. `complete`: check `entry.state === state` before anything else, POST form-encoded to `GOOGLE_TOKEN_URL`, parse JSON, store tokens and clear `state`/`codeVerifier`. `accessToken`: cached by a `Map<string, Promise<string>>` (delete on settle), refresh 60 s before expiry via `grant_type=refresh_token`; on non-OK response with `invalid_grant`, clear tokens and throw `OAuthNeedsAuthError`. `authProvider`: return an object implementing `OAuthClientProvider` with `redirectUrl`, `clientMetadata` (`{ redirect_uris: [entry.redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }`), `state`, `clientInformation` (static client id/secret), `tokens` (calls `accessToken` and returns `{ access_token, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((expiresAt - now()) / 1000)), refresh_token }`), `saveTokens` (persist SDK-refreshed tokens), `saveCodeVerifier`/`codeVerifier` (store fields), and `redirectToAuthorization` that throws `OAuthNeedsAuthError`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all eight new tests PASS; existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/oauth.ts server/oauth.test.ts
git commit -m "feat: add Google OAuth flow and token manager"
```

### Task 3: HTTP routes and server wiring

**Files:**
- Create: `server/oauth-routes.ts`, `server/oauth-routes.test.ts`
- Modify: `server/index.ts:55-56`, `server/index.ts:74`, `server/index.ts:416-426`

**Interfaces:**
- Consumes: `GoogleOAuth` from Task 2, `OAuthStatus` from Task 1.
- Produces: `export interface OAuthRoutesApi { start(name: string, input: { clientId: string; clientSecret: string; redirectUri: string; scopes: readonly string[] }): { authorizationUrl: string; state: string }; complete(name: string, state: string, code: string): Promise<void>; status(name: string): OAuthStatus; disconnect(name: string): void }`; `export function createOAuthRoutes(api: OAuthRoutesApi, hasServer: (name: string) => boolean): Router`.

- [ ] **Step 1: Write the failing test**

`server/oauth-routes.test.ts`: mount `createOAuthRoutes(fake, hasServer)` on an Express app at `/api/mcp/oauth`, start with `app.listen(0)`, use global `fetch` against the assigned port; fake implements `OAuthRoutesApi` with in-memory values. Assert:
  - `GET /google-drive/status` returns `{ status: 'absent' }` when `hasServer` returns false, and `{ status: 'connected' }` when true and fake says connected; `JSON.stringify(body)` does not contain the client secret.
  - `POST /google-drive/start` with valid body returns `{ authorizationUrl, state }`, and the fake received `redirectUri` exactly as sent; a body with an unknown scope returns 400.
  - `GET /google-drive/callback?state=ok&code=abc` calls `fake.complete('google-drive', 'ok', 'abc')` and returns HTML containing "Autorização concluída"; `state=wrong` makes fake reject and returns 400.
  - `POST /google-drive/disconnect` calls `fake.disconnect` and returns `{ ok: true }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — expected compile error, `./oauth-routes.js` not found.

- [ ] **Step 3: Implement `server/oauth-routes.ts`**

`Router()` with `GET /:name/status`, `POST /:name/start`, `GET /:name/callback`, `POST /:name/disconnect`. Validate `clientId`/`clientSecret`/`redirectUri` are non-empty strings and `scopes` deep-equals `GOOGLE_DRIVE_SCOPES` (reject otherwise with 400). The callback HTML shows `Autorização concluída — você pode fechar esta janela.` and includes `<script>window.opener?.postMessage({ type: 'ogb-oauth', name: '<escaped name>' }, window.location.origin)</script>`; escape `name` with `encodeURIComponent` in HTML and JSON. No secrets in any response.

- [ ] **Step 4: Wire into `server/index.ts`**

After `const dataDir`/`uploadsDir` (line 37-39), instantiate `const oauthStore = new OAuthStore(path.join(dataDir, 'mcp-oauth.json'))` and `const oauth = new GoogleOAuth(oauthStore)`. In the token middleware (line 55-56), skip only callback requests: `if (!TOKEN || (req.path.startsWith('/api/mcp/oauth/') && req.path.endsWith('/callback'))) return next()`. After `app.use(express.json(...))` (line 74), `app.use('/api/mcp/oauth', createOAuthRoutes(oauth, (name) => name in team.mcpServers))`. In `DELETE /api/team/mcp/:name` (line 416-426) call `oauth.disconnect(name)` after a successful team update so removing the server clears its credentials.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add server/oauth-routes.ts server/oauth-routes.test.ts server/index.ts
git commit -m "feat: expose OAuth connect routes and exempt callback from app token"
```

### Task 4: Inject a fresh Bearer token into Claude MCP servers

**Files:**
- Modify: `server/providers/types.ts:21-33`, `server/providers/claude.ts:48-59,62,100-108`, `server/orchestrator.ts:46,155-169,292-311`, `server/index.ts:46`
- Test: `server/providers/claude.test.ts`

**Interfaces:**
- Consumes: `OAuthAccess` from Task 2, `GoogleOAuth` instance from Task 3.
- Produces: `RunTurnParams.oauth?: OAuthAccess`; `buildQueryOptions(team, conversation, agent, provider, sessionId, abort, handlers?, notes?, oauth?): Promise<Options>`; `Orchestrator` constructor takes an optional 7th argument `oauth?: OAuthAccess`.

- [ ] **Step 1: Write the failing test**

`server/providers/claude.test.ts`: build a minimal `Team` (copy the fixture shape from `server/orchestrator.test.ts`) with `mcpServers: { 'google-drive': { type: 'http', url: 'https://drivemcp.googleapis.com/mcp/v1self' } }`, one agent with `mcpServers: ['google-drive']`. Pass a fake `OAuthAccess` whose `accessToken` resolves `'fresh-token'` and assert:
  - `(await buildQueryOptions(team, conversation, agent, team.providers.claude!, undefined, new AbortController(), undefined, '', oauth)).mcpServers?.['google-drive'].headers.Authorization === 'Bearer fresh-token'`
  - with `oauth` omitted, the same server entry has no `Authorization` header.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — expected compile error (`oauth` is not a parameter of `buildQueryOptions`).

- [ ] **Step 3: Implement**

Make `mcpServersFor(team, agent, oauth?)` async; for http/sse entries, when `await oauth?.accessToken(name)` returns a token, spread `{ headers: { ...def.headers, Authorization: \`Bearer ${token}\` } }`. Make `buildQueryOptions` async and await `mcpServersFor`; in `runClaudeTurn` await it. Add `oauth?: OAuthAccess` to `RunTurnParams`; add the optional constructor arg to `Orchestrator` and pass `this.oauth` in both `runAgentTurn` calls (lines 155 and 292); pass `oauth` as the 7th arg when constructing the orchestrator in `server/index.ts`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/providers/types.ts server/providers/claude.ts server/providers/claude.test.ts server/orchestrator.ts server/index.ts
git commit -m "feat: attach refreshed Google token to Claude MCP headers"
```

### Task 5: Non-interactive OAuth on the Opencode/API path

**Files:**
- Modify: `server/providers/mcp.ts:14-25,28-55`, `server/providers/opencode.ts:8`, `server/providers/mcp.test.ts`

**Interfaces:**
- Consumes: `OAuthAccess` from Task 2, `RunTurnParams.oauth` from Task 4.
- Produces: `openMcpServers(team, agent, onNotice?, oauth?: OAuthAccess): Promise<McpBundle>`; `transportFor(def, authProvider?)` accepts an `OAuthClientProvider`.

- [ ] **Step 1: Write the failing test**

Add to `server/providers/mcp.test.ts`: with a fake `OAuthAccess` whose `status(name)` returns `'configured'`, `openMcpServers(team, agent, onNotice, oauth)` returns zero tools and `onNotice` receives a line containing `not authorized` and `google-drive`. Confirm no subprocess/connection is started (the existing fixture would otherwise expose `mcp__fake__ping`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — expected: compile error, `openMcpServers` currently accepts only three arguments.

- [ ] **Step 3: Implement**

In `openMcpServers`, before connecting each server: if `oauth?.status(name) === 'configured'`, emit `MCP ${name}: not authorized — reconnect in Settings → Marketplace` via `onNotice` and `continue`. Otherwise pass `oauth?.authProvider(name)` into `transportFor`; `transportFor` adds `authProvider` only for `http`/`sse`. In `server/providers/opencode.ts`, pass `params.oauth` as the fourth argument.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/providers/mcp.ts server/providers/mcp.test.ts server/providers/opencode.ts
git commit -m "feat: skip unauthorized Google MCP in background turns"
```

### Task 6: Marketplace catalog entry and client API

**Files:**
- Modify: `client/src/marketplace.ts:3-35`, `client/src/api.ts:65-71`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MarketplaceItem.oauth?: { kind: 'google'; scopes: string[]; docsUrl: string }`; `export type OAuthStatus = 'absent' | 'configured' | 'connected'` in `client/src/api.ts`; `startMcpOAuth(name: string, input: { clientId: string; clientSecret: string; redirectUri: string; scopes: string[] }): Promise<{ authorizationUrl: string; state: string }>`, `mcpOAuthStatus(name: string): Promise<{ status: OAuthStatus }>`, `disconnectMcpOAuth(name: string): Promise<unknown>`.

- [ ] **Step 1: Add the catalog entry**

Append to `MARKETPLACE` in `client/src/marketplace.ts`: id `google-drive`, name `Google Drive`, category `Featured`, icon `📂`, description `Search, read, create and download files in Google Drive (official Google MCP server).`, `def: { type: 'http', url: 'https://drivemcp.googleapis.com/mcp/v1self' }`, `oauth: { kind: 'google', scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'], docsUrl: 'https://developers.google.com/workspace/drive/api/guides/configure-mcp-server' }`.

- [ ] **Step 2: Add the API functions**

Implement the three functions in `client/src/api.ts` using the existing private `call`/`json` helpers and `/api/mcp/oauth/${encodeURIComponent(name)}/...` paths.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors (the entry is not yet wired into a special modal, so no UI change is needed here).

- [ ] **Step 4: Commit**

```bash
git add client/src/marketplace.ts client/src/api.ts
git commit -m "feat: list Google Drive in marketplace and add OAuth client API"
```

### Task 7: Marketplace connect UI

**Files:**
- Modify: `client/src/components/Settings.tsx:1-13,227-308,310-402`

**Interfaces:**
- Consumes: `MarketplaceItem.oauth` and the three API functions from Task 6.
- Produces: a `Marketplace` component that renders connection status per OAuth item and an `AddServer` modal that saves the def and starts authorization in one action.

- [ ] **Step 1: Add status fetching to `Marketplace`**

Import `useEffect`, `mcpOAuthStatus`, `disconnectMcpOAuth`, `OAuthStatus`. Add `const [statuses, setStatuses] = useState<Record<string, OAuthStatus>>({})` and `const [pending, setPending] = useState<string | null>(null)`. Add an effect that loads `mcpOAuthStatus(id)` for each `MARKETPLACE` item with `oauth`, and while `pending` is set re-loads that one every 2000 ms; clear `pending` when it becomes `connected`. Add a `window.addEventListener('message', ...)` handler for `{ type: 'ogb-oauth', name }` that immediately reloads that status; remove it on unmount. In each market item with `oauth`, show `Conectado` when connected, `Reconectar` (with a `Disconnect` button) when configured, `—` when absent. Pass `setPending` and a reload callback into `AddServer`.

- [ ] **Step 2: Branch `AddServer` for OAuth items**

When `item?.oauth`: render Client ID and Client Secret password fields, the exact redirect URI `${window.location.origin}/api/mcp/oauth/${name}/callback` as selectable text, and a link to `item.oauth.docsUrl` with a short instruction to register that URI in Google Cloud. Hide the generic secrets/env fields for these items. On submit: `await putMcpServer(name, item.def)`, then `await startMcpOAuth(name, { clientId, clientSecret, redirectUri, scopes: item.oauth.scopes })`, then `window.open(authorizationUrl, 'ogb-google-oauth', 'width=560,height=720')`, call `onDone()` and `setPending(name)`. If either call fails, keep the modal open and show the error. Non-OAuth items keep the existing save path unchanged.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. Manual: `npm run dev`, open Settings → Marketplace, confirm "Google Drive" appears under Featured with a status chip.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Settings.tsx
git commit -m "feat: add Google authorize flow to marketplace UI"
```

### Task 8: Setup docs and end-to-end verification

**Files:**
- Modify: `README.md` (Marketplace/Settings section, around line 147)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: user-facing setup instructions and a verification run.

- [ ] **Step 1: Document the Google Cloud setup**

Add a short subsection: create a Google Cloud project; enable Drive API and Drive MCP API; create an OAuth client of type *Web application* with redirect URI `<app origin>/api/mcp/oauth/google-drive/callback` and "Use this client for an AI-powered agent" enabled; add yourself as a test user if the app is external; then Marketplace → Google Drive → paste client id/secret → authorize. Note that changing origin (dev `:5180`, prod `:4310`, VPS) requires adding that URI to the same OAuth client; that removing the server locally does not revoke Google consent; and that the Claude token is refreshed per turn (a turn longer than ~1 hour could expire mid-turn).

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass. Then, with a real Google OAuth client, manually verify: authorize on dev (`:5180`); status becomes `Conectado`; ask an Opencode+MCP employee to list recent Drive files and confirm `mcp__google-drive__*` tools run; ask a Claude employee the same; `Disconnect` then confirm status becomes `—` and a reconnect prompt appears on next turn.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Google Drive OAuth setup in marketplace"
```
