# About Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma seção "About" nas Configurações mostrando a versão instalada, o status de atualização, um botão de download e o link do GitHub do fork.

**Architecture:** Um módulo puro no servidor (`server/version.ts`) compara a versão local do `package.json` com o campo `version` do `package.json` remoto do fork, com cache em memória e tratamento de falha de rede. O Express expõe `GET /api/version`; o cliente React consome esse endpoint e renderiza a nova seção no modal de Configurações. Links externos usam `<a target="_blank">`, que o shell Electron já abre no navegador do sistema.

**Tech Stack:** TypeScript (NodeNext no servidor, bundler no cliente), Express 4, React 19, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-26-about-screen-design.md`

## Global Constraints

- URL de verificação: `https://raw.githubusercontent.com/MateusGabi/OpenGrokBot/refs/heads/main/package.json`.
- Repositório: `https://github.com/MateusGabi/OpenGrokBot`; downloads: `https://github.com/MateusGabi/OpenGrokBot/releases`.
- Versão local vem do `package.json` da raiz — nunca hardcoded.
- Cache de no máximo 10 minutos; timeout de 5 segundos na requisição remota.
- Textos da interface em inglês, como as demais seções de Configurações.
- Sem auto-update e sem download automático: botão é link externo.
- Sem novas dependências.

## Review Focus

- **Versão remota maior que a local** → deve dizer "Update available" e não "Up to date". Teste: Task 1, teste de comparação e de `info()` com `0.6.0`.
- **Sem rede / JSON remoto sem campo `version` válido** → não pode lançar nem travar a tela; `latest: null`, `upToDate: null`. Teste: Task 1, teste com fetcher que rejeita e com objeto malformado.
- **Abrir a seção várias vezes não pode consultar o GitHub a cada vez** → cache em memória. Teste: Task 1, teste com relógio falso contando chamadas ao fetcher.
- **A versão exibida tem que ser a do `package.json` instalado** → endpoint lê o arquivo na raiz. Verificação: Task 2, `curl` confere `current` igual a `0.5.0` (valor atual).
- **Links externos dentro do Electron** → precisam de `target="_blank"` e `rel="noopener noreferrer"` para abrir no navegador do sistema sem trocar a página do app. Teste: Task 3, teste de fonte do componente + `npm run typecheck` e `npx vite build`.

---

### Task 1: Módulo de verificação de versão

**Files:**
- Create: `shared/version.ts`
- Modify: `shared/types.ts` (adicionar `VersionInfo`)
- Create: `server/version.ts`
- Create: `server/version.test.ts`

**Interfaces:**
- Consumes: valor de `version` do `package.json` da raiz (passado por quem chamar).
- Produces: `VERSION_CHECK_URL`, `REPO_URL`, `DOWNLOAD_URL` (constantes em `shared/version.ts`); `VersionInfo` (em `shared/types.ts`); `compareVersions(a: string, b: string): -1 | 0 | 1` e `class VersionChecker` com `constructor(current: string, fetchJson?: (url: string) => Promise<unknown>, now?: () => number, cacheMs?: number)` e `info(): Promise<VersionInfo>` (em `server/version.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Em `server/version.test.ts`, com `import test from 'node:test'`, `import assert from 'node:assert/strict'` e imports de `../server/version.js` (padrão dos testes existentes):

- `test('compareVersions orders semver-like strings')`: `compareVersions('0.5.0', '0.5.1') === -1`, `compareVersions('0.6.0', '0.5.9') === 1`, `compareVersions('0.5.0', '0.5.0') === 0`, `compareVersions('0.6.0-beta.1', '0.5.9') === 1`.
- `test('info reports an available update with the configured URLs')`: `new VersionChecker('0.5.0', async () => ({ version: '0.6.0' }))`, esperar `current === '0.5.0'`, `latest === '0.6.0'`, `upToDate === false`, `repoUrl === 'https://github.com/MateusGabi/OpenGrokBot'`, `downloadUrl === 'https://github.com/MateusGabi/OpenGrokBot/releases'`, `typeof checkedAt === 'number'`.
- `test('info reports up to date for equal and newer local versions')`: fetcher retornando `{ version: '0.5.0' }` com current `0.5.0`, e fetcher retornando `{ version: '0.4.9' }` com current `0.5.0` → `upToDate === true` nos dois casos.
- `test('info survives network failure and malformed remote json')`: fetcher que rejeita, e fetcher retornando `{}` → `latest === null`, `upToDate === null`, sem exceção.
- `test('info caches the remote version for ten minutes')`: relógio falso (`let t = 1000`; `now = () => t`) e fetcher contador retornando `{ version: '0.6.0' }`; duas chamadas → 1 chamada ao fetcher; `t += 10 * 60 * 1000`; nova chamada → 2 chamadas.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha na compilação — `server/version.ts` e `shared/version.ts` não existem.

- [ ] **Step 3: Implementar o módulo**

`shared/version.ts`: exportar as três constantes com os valores exatos do campo "Global Constraints" (`DOWNLOAD_URL` pode ser template literal derivado de `REPO_URL`).

`shared/types.ts`: acrescentar ao final:
```ts
export interface VersionInfo {
  current: string
  latest: string | null
  upToDate: boolean | null
  checkedAt: number
  repoUrl: string
  downloadUrl: string
}
```

`server/version.ts`:
- `compareVersions`: extrair os três primeiros grupos numéricos com regex `/^(\\d+)\\.(\\d+)\\.(\\d+)/` (ausentes valem 0), comparar em ordem e devolver `-1 | 0 | 1`.
- `VersionChecker`: guardar `current`, `fetchJson` (padrão: `fetch(url, { signal: AbortSignal.timeout(5000) })`, `if (!res.ok) throw`, `return res.json()`), `now` (padrão `Date.now`) e `cacheMs` (padrão `10 * 60 * 1000`). Em `info()`, reaproveitar cache válido; senão buscar, aceitar somente `string` em `version`; em qualquer falha, manter o último cache ou `null`. Calcular `upToDate = latest === null ? null : compareVersions(current, latest) >= 0` e devolver `checkedAt: now()` com as URLs das constantes.
- Respeitar `verbatimModuleSyntax`: imports de tipo com `import type`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test && npm run typecheck`
Expected: todos os testes passam; typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add shared/version.ts shared/types.ts server/version.ts server/version.test.ts
git commit -m "feat: add version check module for About screen"
```

---

### Task 2: Endpoint `GET /api/version`

**Files:**
- Modify: `server/index.ts` (importar `readFileSync` existente, `VersionChecker` e criar a instância junto às outras inicializações)
- Test: verificação manual via `curl`

**Interfaces:**
- Consumes: `VersionChecker` e `VersionInfo` (Task 1); `root` já calculado em `server/index.ts:23`.
- Produces: `GET /api/version` respondendo JSON com o formato de `VersionInfo`.

- [ ] **Step 1: Registrar a rota**

Em `server/index.ts`, junto às outras rotas:
- ler `version` de `path.join(root, 'package.json')` com `readFileSync` (já importado) e `JSON.parse`;
- criar `const versionChecker = new VersionChecker(packageVersion)`;
- `app.get('/api/version', async (_req, res) => { res.json(await versionChecker.info()) })`.
- A rota deve ficar depois do middleware de autenticação, para herdar a proteção por token quando `HOST` não for local.

- [ ] **Step 2: Rodar o servidor e conferir a resposta**

Run: `npx tsx server/index.ts` em background, depois `curl -s http://127.0.0.1:4310/api/version`
Expected: JSON com `"current":"0.5.0"`, `"latest":"0.5.0"`, `"upToDate":true`, `"repoUrl":"https://github.com/MateusGabi/OpenGrokBot"`, `"downloadUrl":"https://github.com/MateusGabi/OpenGrokBot/releases"`. Se a rede estiver indisponível, `latest` e `upToDate` devem ser `null` e a requisição deve responder normalmente.

- [ ] **Step 3: Rodar typecheck e commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add server/index.ts
git commit -m "feat: expose /api/version endpoint"
```

---

### Task 3: Seção "About" nas Configurações

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/settings.css`
- Create: `server/about-ui.test.ts`

**Interfaces:**
- Consumes: `fetchVersion(): Promise<VersionInfo>` (a criar em `client/src/api.ts`, via `call<VersionInfo>('/api/version')`); `VersionInfo` (Task 1); `VERSION_CHECK_URL`, `REPO_URL`, `DOWNLOAD_URL` (Task 1).
- Produces: `'about'` em `SettingsSection`; componente `About` renderizado quando `section === 'about'`.

- [ ] **Step 1: Escrever o teste de fonte que falha**

Em `server/about-ui.test.ts`, ler `client/src/components/Settings.tsx` e `client/src/api.ts` com `readFileSync` (mesmo estilo de `server/desktop-build-config.test.ts`) e afirmar:
- `Settings.tsx` contém `'about'` em `SettingsSection`, um item `id: 'about'` no `NAV`, `section === 'about'`, `target="_blank"` e `rel="noopener noreferrer"`;
- `api.ts` contém `fetchVersion` e `'/api/version'`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha — `'about'` ainda não existe em `Settings.tsx`.

- [ ] **Step 3: Implementar a UI**

`client/src/api.ts`: `export function fetchVersion(): Promise<VersionInfo> { return call<VersionInfo>('/api/version') }`, com `VersionInfo` adicionado ao import type existente.

`client/src/components/Settings.tsx`:
- importar `useEffect` junto com `useState`, `fetchVersion` de `../api`, `type VersionInfo`, e `DOWNLOAD_URL`, `REPO_URL` de `../../../shared/version`;
- acrescentar `'about'` ao union `SettingsSection` e `{ id: 'about', label: 'About', icon: 'ℹ️' }` ao fim de `NAV`;
- renderizar `{section === 'about' && <About />}`;
- componente `About`: estado `info: VersionInfo | null`, `error: string | null`; carregar via `useEffect(() => { void load() }, [])`, onde `load` limpa o erro, chama `fetchVersion`, guarda a resposta e transforma exceção em mensagem;
- conteúdo: `<h1>About</h1>`, lead curto, `Card` com `Row` de "Current version" (`v{info?.current}`), `Row` de "Update status" e `Row` de "Check for updates" com botão "Check now" que chama `load`;
- status: `Checking…` enquanto carrega; `Couldn't check for updates` com texto de erro quando falhar; badge `badge badge-success` com "Up to date" quando `upToDate === true`; badge `badge badge-warn` com `Update available · v{latest}` quando `false`;
- ações: `<a className="btn btn-primary" href={info?.downloadUrl ?? DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Download update</a>` e `<a className="btn" href={info?.repoUrl ?? REPO_URL} target="_blank" rel="noopener noreferrer">View on GitHub</a>`, sempre visíveis.

`client/src/settings.css`: estilos para `.badge-success` (verde), `.badge-warn` (amarelo/laranja) e `.about-version` (monospace, destaque), reutilizando as variáveis CSS existentes do arquivo.

- [ ] **Step 4: Rodar testes, typecheck e build**

Run: `npm test && npm run typecheck && npx vite build`
Expected: testes passam; typecheck sem erros; build do Vite conclui.

- [ ] **Step 5: Commit**

```bash
git add client/src/api.ts client/src/components/Settings.tsx client/src/settings.css server/about-ui.test.ts
git commit -m "feat: add About section in settings"
```
