# Múltiplos offices / workspaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vários offices isolados (cada um com `team.json`, `data/` e porta próprios), gerenciáveis por CLI e por uma tela Electron minimalista, sem mudar o servidor nem o chat.

**Architecture:** Um módulo CJS puro (`shared/offices.cjs`) dono do registro `offices.json`; a CLI e o Electron consomem as mesmas funções. Cada office continua em um processo servidor distinto, com `OPENGROKBOT_TEAM`/`OPENGROKBOT_DATA`/`PORT` próprios. A tela do gerenciador é uma janela Electron autocontida (`desktop/offices.*`) com preload que expõe só o necessário; o cliente React de chat não muda.

**Tech Stack:** Node 24, CommonJS para registro/CLI/Electron, TypeScript strict no servidor, `node:test`, HTML/CSS/JS puro na tela (sem Tailwind, sem assets remotos).

**Spec:** `docs/superpowers/specs/2026-11-26-multiple-offices-design.md`

## Global Constraints

- Não alterar `server/index.ts`, `client/**` nem o formato de `team.json`.
- Nenhuma dependência de runtime nova; nenhuma fonte/CDN externa na tela (app roda offline).
- `npm run typecheck && npm test && npm run build` devem passar ao final de cada task.
- Office `default` = `team.json` + `data/` na raiz do state root; porta `Number(process.env.PORT ?? 4310)`. Portas novas começam em 4311 e são únicas.
- `default` é reservado como id; remove nunca apaga arquivos sem `deleteData: true`; `deleteData` só atua se `dir === path.resolve(stateRoot, 'offices', id)`.
- Nomes de exibição são únicos (case-insensitive); slugs usam NFD para remover acentos e casam com `/^[a-z0-9][a-z0-9-]{0,39}$/`.
- Seguir `zeke/swiss-design` + `pbakaus/distill` na tela: uma ação principal, uma coluna, 8 px, opacidade para hierarquia, 3 tamanhos de fonte, 2 pesos, um accent, `:focus-visible`, `prefers-reduced-motion`.
- Commits convencionais (`feat:`, `test:`, `docs:`, `chore:`).

## Review Focus

- **`lastId` órfão ou diretório removido** → startup cai para `default` sem criar dados no caminho errado. Teste: Task 1, `startupId` com entry removido/dir ausente.
- **Slug de nome acentuado / nome duplicado** → `Clientê ACME` vira `cliente-acme`; segundo `Acme` é recusado. Teste: Task 1.
- **`remove` sem apagar arquivos seguido de `add`** → os dados sobrevivem e voltam ao registro. Teste: Task 1 (round-trip) e Task 2 (CLI).
- **`deleteData` com `dir` adulterado para fora de `offices/`** → recusa e não apaga nada. Teste: Task 1.
- **Registro corrompido / versão desconhecida** → `OfficesError`, nunca substituição silenciosa. Teste: Task 1.
- **Tela com referência externa** → nenhuma URL `http(s)` ou `@import` de fonte no HTML/CSS. Teste: Task 4.

---

### Task 1: Registro de offices

**Files:**
- Create: `shared/offices.cjs`
- Test: `scripts/offices.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces (todas exportadas de `shared/offices.cjs`):
  - `class OfficesError extends Error`
  - `officesPath(stateRoot): string`
  - `loadOffices(stateRoot): { version: 1; offices: OfficeEntry[]; lastId?: string }`
  - `saveOffices(stateRoot, data): void`
  - `async nextPort(offices): Promise<number>`
  - `async createOffice(stateRoot, name): Promise<OfficeEntry>`
  - `async addOffice(stateRoot, dir, name?): Promise<OfficeEntry>`
  - `renameOffice(stateRoot, id, name): OfficeEntry`
  - `removeOffice(stateRoot, id, opts?: { deleteData?: boolean }): void`
  - `startupId(registry): string | null`
  - `officeEnv(office): { PORT: string; OPENGROKBOT_TEAM: string; OPENGROKBOT_DATA: string }`
  - `officeUrl(office): string`
  - `OfficeEntry = { id, name, dir, port, createdAt }`

- [ ] **Step 1: Escrever os testes que falham**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const offices = require('../shared/offices.cjs')

function root() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-offices-'))
  writeFileSync(path.join(dir, 'team.example.json'), '{}\n') // o módulo copia da raiz da instalação; ver nota abaixo
  return dir
}
```

> Nota: `createOffice` copia `team.example.json` de `path.resolve(__dirname, '..')` (raiz real do repo nos testes). O arquivo temporário acima não é a fonte da cópia; ele só simula um state root com `team.json` quando necessário.

Escrever estes testes, com as asserções exatas:

- `loadOffices cria o entry default a partir do team.json existente`: criar `<root>/team.json` com `{"company":"Acme"}`; chamar `loadOffices(root)`; asserts `offices.length === 1`, `id === 'default'`, `name === 'Acme'`, `dir === root`, `port === 4310`; ler o `team.json` original e conferir que o conteúdo não mudou.
- `createOffice gera slug sem acentos, team.json, data/ e porta única`: `const a = await createOffice(root(), 'Clientê ACME')`; asserts `a.id === 'cliente-acme'`, `existsSync(path.join(a.dir, 'team.json'))`, `existsSync(path.join(a.dir, 'data'))`, `a.port >= 4311`; criar outro office `Beta` e conferir `b.port !== a.port`.
- `nomes de exibição duplicados são recusados`: `await assert.rejects(() => createOffice(r, 'Beta'), offices.OfficesError)` depois de criar `Beta`.
- `addOffice recupera um diretório removido sem apagar dados`: criar office, escrever `<dir>/data/marker`, `removeOffice(root, id)`, `const back = await addOffice(root, dir, 'Voltou')`; asserts `back.dir === dir`, `existsSync(marker)`, registro com 2 entries (`default` + voltado).
- `renameOffice preserva id e dir`: `const renamed = renameOffice(root, a.id, 'Novo nome')`; asserts `renamed.id === a.id`, `renamed.dir === a.dir`, `renamed.name === 'Novo nome'`.
- `removeOffice recusa default e mantém arquivos por padrão`: `assert.throws(() => removeOffice(root, 'default'), offices.OfficesError)`; depois de remover um office criado, `existsSync(dir)` continua true.
- `deleteData recusa diretório fora de offices/`: criar office, trocar `entry.dir = path.join(root, 'outside')`, criar arquivo lá, `assert.throws(() => removeOffice(root, id, { deleteData: true }), offices.OfficesError)` e o arquivo continua existindo.
- `officeEnv e officeUrl apontam para o office`: asserts `officeEnv(a).OPENGROKBOT_TEAM === path.join(a.dir, 'team.json')`, `.OPENGROKBOT_DATA === path.join(a.dir, 'data')`, `.PORT === String(a.port)`, `officeUrl(a) === 'http://127.0.0.1:' + a.port + '/'`.
- `startupId cai para default quando lastId é órfão`: registro com `lastId: 'sumido'` → `startupId(reg) === 'default'`; com `lastId` apontando para entry cujo `dir` não existe → `'default'`; sem `default` válido → `null`.
- `registro corrompido gera OfficesError`: escrever `offices.json` com `{` e `assert.throws(() => loadOffices(root), offices.OfficesError)`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test scripts/offices.test.mjs`
Expected: FAIL com `Cannot find module '../shared/offices.cjs'`.

- [ ] **Step 3: Implementar `shared/offices.cjs`**

Assinaturas exatas acima. Detalhes que o teste não determina, já decididos:
- `loadOffices`: se `offices.json` não existe, montar entry `default` com nome lido de `<stateRoot>/team.json` (fallback `'Main office'`) e porta de `process.env.PORT ?? 4310`, salvar e devolver. Se o arquivo existe mas JSON/versão é inválido, lançar `OfficesError` sem escrever nada.
- `saveOffices`: `writeFileSync(tmp)` + `renameSync(tmp, officesPath)` (escrita atômica).
- Slug: `name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)`; se vazio ou `default` ou igual a um id existente, anexar `-2`, `-3`… até ser único.
- `nextPort`: primeira porta ≥ 4311 não usada por outra entry e livre em `127.0.0.1` (probar com `net.createServer` e fechar).
- `createOffice`: criar `dir`, copiar `team.example.json` da raiz da instalação, criar `data/`, registrar e salvar.
- `addOffice`: exigir `dir` existente com `team.json`; nome do parâmetro ou `team.company`; registrar sem copiar nada.
- `removeOffice`: nunca remover `default`; com `deleteData`, exigir `path.resolve(dir) === path.resolve(stateRoot, 'offices', id)` antes de `rmSync(..., { recursive: true, force: true })`.
- `startupId`: devolver `lastId` somente se a entry existe e `dir` existe; senão `default` se existir e tiver `dir`; senão `null`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test scripts/offices.test.mjs`
Expected: todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/offices.cjs scripts/offices.test.mjs
git commit -m "feat: add isolated offices registry"
```

### Task 2: CLI de offices

**Files:**
- Create: `scripts/office.cjs`, `scripts/office-cli.test.mjs`
- Modify: `package.json` (adicionar script `office`)

**Interfaces:**
- Consumes: `shared/offices.cjs` da Task 1.
- Produces: comandos `list`, `create <name>`, `open <id>`, `add <dir> [name]`, `rename <id> <new name>`, `remove <id> [--delete-data]`; state root = `path.resolve(process.env.OPENGROKBOT_STATE_ROOT ?? process.cwd())`.

- [ ] **Step 1: Escrever os testes que falham**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cli = path.join(process.cwd(), 'scripts', 'office.cjs')
function run(stateDir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENGROKBOT_STATE_ROOT: stateDir },
  })
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-cli-'))
  writeFileSync(path.join(dir, 'team.json'), '{"company":"Acme"}')
  return dir
}
```

Testes: `list` num state root novo imprime `default` e `Acme` e sai 0; `create "Beta"` cria o entry e imprime o id `beta`; `rename beta "Beta Dois"` atualiza o nome; `remove beta` mantém `data/` no disco e `add <dir> "Beta Dois"` traz o office de volta; comando desconhecido sai 1 e imprime usage no stderr.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test scripts/office-cli.test.mjs`
Expected: FAIL (`scripts/office.cjs` não existe).

- [ ] **Step 3: Implementar a CLI**

`main()` assíncrona com `try/catch` que imprime a mensagem e sai 1. `open` usa `spawn(process.execPath, [dist/server/index.js], { cwd: office.dir, env: { ...process.env, ...officeEnv(office) }, stdio: 'inherit' })` e atualiza `lastId` via `saveOffices`; os demais comandos chamam diretamente as funções da Task 1. Em `package.json`, `"office": "node scripts/office.cjs"`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test scripts/office-cli.test.mjs`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office.cjs scripts/office-cli.test.mjs package.json
git commit -m "feat: add offices CLI"
```

### Task 3: Ciclo de vida multi-office no Electron

**Files:**
- Modify: `desktop/main.cjs`, `server/desktop-child.test.ts`

**Interfaces:**
- Consumes: `loadOffices`, `saveOffices`, `startupId`, `officeEnv`, `officeUrl`, `createOffice`, `addOffice`, `renameOffice`, `removeOffice`, `childOptions(port, stateDir, baseEnv)` de `desktop/child.cjs`.
- Produces: `Map<id, { office, server, win }>`; `openOffice(office)`, `closeOffice(id)`, `focusOrOpen(id)`, `openManager()`, `activeOffice()`.

- [ ] **Step 1: Escrever os testes que falham**

Em `server/desktop-child.test.ts`, adicionar a `test('electron shell ...')` (ou uma nova) asserções sobre o código-fonte lido com `readFileSync`:

```ts
const main = readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8')
assert.match(main, /loadOffices\(/)
assert.match(main, /startupId\(/)
assert.match(main, /offices-preload\.cjs/)
assert.match(main, /setApplicationMenu\(/)
assert.match(main, /page-title-updated/)
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL na nova asserção (`loadOffices` ausente em `main.cjs`).

- [ ] **Step 3: Implementar `desktop/main.cjs`**

Substituir as globais `server`/`URL` pelo `Map`. `waitForServer(port)` paramétrico. No `whenReady`, `const registry = loadOffices(stateDir)`; `const id = startupId(registry)`; se `null`, `dialog.showErrorBox` e `app.quit()`; senão `openOffice`. `openOffice` usa `childOptions(office.port, office.dir, baseEnv)` e `officeUrl(office)`, define o título como `${office.name} — OpenGrokBot` e mantém `page-title-updated` com `preventDefault`. `activeOffice()` = `win.isFocused()` do mapa, senão entry de `lastId`. `renameOffice`/`removeOffice` atualizam registros, títulos, `lastId` (fallback `default`) e o menu. `Menu.setApplicationMenu` com **Offices…** → `openManager()`. Fechar janela derruba só o child correspondente; `before-quit` derruba todos. Manter `childOptions` inalterado.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos PASS (inclusive os testes antigos de `childOptions`).

- [ ] **Step 5: Commit**

```bash
git add desktop/main.cjs server/desktop-child.test.ts
git commit -m "feat: run one server process per office in Electron"
```

### Task 4: Tela minimalista do gerenciador

**Files:**
- Create: `desktop/offices.html`, `desktop/offices.css`, `desktop/offices.cjs`, `desktop/offices-preload.cjs`
- Modify: `server/desktop-assets.test.ts`

**Interfaces:**
- Consumes: funções do registro via `main.cjs`; `contextBridge` do Electron.
- Produces: `window.offices.{list,create,add,open,rename,remove,close}` no renderer (todas retornando Promises), com `list()` devolvendo `{ offices, activeId }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `server/desktop-assets.test.ts`, adicionar:

```ts
for (const f of ['offices.html', 'offices.css', 'offices.cjs', 'offices-preload.cjs']) {
  assert.ok(existsSync(path.join(root, 'desktop', f)), `desktop/${f} must exist`)
}
const html = readFileSync(path.join(root, 'desktop', 'offices.html'), 'utf8')
const css = readFileSync(path.join(root, 'desktop', 'offices.css'), 'utf8')
const preload = readFileSync(path.join(root, 'desktop', 'offices-preload.cjs'), 'utf8')
assert.doesNotMatch(html + css, /https?:\/\//)
assert.doesNotMatch(html + css, /@import/)
for (const name of ['list', 'create', 'add', 'open', 'rename', 'remove', 'close']) {
  assert.match(preload, new RegExp(name))
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL (arquivos não existem).

- [ ] **Step 3: Implementar os quatro arquivos**

- `offices-preload.cjs`: `contextBridge.exposeInMainWorld('offices', { ... ipcRenderer.invoke('offices:<name>') })` para os sete nomes.
- `main.cjs` (já modificado na Task 3) registra os handlers `ipcMain.handle` correspondentes.
- `offices.html`: `<!doctype html>`, `lang`, `<meta charset>`, `data-theme`, um `<h1>Offices</h1>`, `<ul id="list">`, `<form id="new"><input name="name" ...><button>New office</button></form>`, `<script src="offices-preload.cjs">` via `webPreferences.preload` (não via tag) e `<script src="offices.cjs" defer>`.
- `offices.cjs`: chama `list()`, renderiza uma `<li>` por office com nome, `id · porta` em `<small>`, botão `Open`; um botão de três pontos com `Rename`/`Add`/`Remove` (divulgação progressiva) e confirmação dupla para remover com dados; submeter `#new` chama `create(name)` e recarrega.
- `offices.css`: aplicar os tokens do `client/src/styles.css` (conjunto mínimo, sem import), uma coluna, 8 px, 3 tamanhos de fonte, 2 pesos, um accent, bordas retas, `:focus-visible`, `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/offices.html desktop/offices.css desktop/offices.cjs desktop/offices-preload.cjs desktop/main.cjs server/desktop-assets.test.ts
git commit -m "feat: add minimalist offices manager screen"
```

### Task 5: Empacotamento, documentação e verificação final

**Files:**
- Modify: `package.json`, `README.md`, `server/desktop-build-config.test.ts`

**Interfaces:**
- Consumes: artefatos das Tasks 1–4.
- Produces: `build.files` contendo `shared/offices.cjs`, `scripts/office.cjs` e `desktop/offices.*`; README com a seção "Multiple offices / workspaces".

- [ ] **Step 1: Escrever os testes que falham**

Em `server/desktop-build-config.test.ts`, adicionar:

```ts
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { build: { files: string[] }; scripts: Record<string, string> }
assert.ok(pkg.build.files.includes('shared/offices.cjs'))
assert.ok(pkg.build.files.includes('desktop/offices.*'))
assert.equal(pkg.scripts.office, 'node scripts/office.cjs')
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL nas novas asserções de `build.files`.

- [ ] **Step 3: Atualizar `package.json` e README**

Em `build.files`, acrescentar `shared/offices.cjs`, `scripts/office.cjs` e `desktop/offices.*`. No README, substituir "Run a second, separate office (demos, tests)" por "Multiple offices / workspaces": modelo de isolamento (um office = state dir + porta + processo), comandos `npm run office -- list|create|open|add|rename|remove`, menu **Offices…** do Electron, layout `offices.json` / `offices/<id>/{team.json,data}`, e aviso de que `remove --delete-data` é permanente.

- [ ] **Step 4: Verificação final**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck limpo; testes PASS (34 existentes + novos); build gera `dist/server` e `dist/client` sem erro.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md server/desktop-build-config.test.ts
git commit -m "docs: document multiple offices and package manager assets"
```
