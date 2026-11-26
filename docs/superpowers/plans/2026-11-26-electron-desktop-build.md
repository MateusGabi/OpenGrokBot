# Electron Desktop Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar um instalador Windows do OpenGrokBot com electron-builder e trocar a identidade visual para um logo no estilo Grok Bot.

**Architecture:** O shell Electron existente é mantido. A config de empacotamento fica no campo `build` do `package.json`, com um script `build:desktop` que compila servidor/cliente e chama o electron-builder. Os assets de ícone são um PNG grande (convertido pelo builder para `.ico`) e um SVG equivalente para a web.

**Tech Stack:** Node 24, electron-builder 26.x, Electron 38, PNG/SVG.

**Spec:** `docs/superpowers/specs/2026-11-26-electron-desktop-build-design.md`

## Global Constraints

- Windows apenas; target NSIS. Não configurar macOS/Linux nesta rodada.
- `electron-builder@^26.18.0` em `devDependencies`.
- `appId: com.opengrokbot.desktop`; `productName: OpenGrokBot`.
- Saída do build em `release/`, ignorada pelo git.
- `main` do `package.json` permanece `desktop/main.cjs`; shell Electron inalterado.
- Não alterar screenshots, landing page nem `projects/`.

## Review Focus

- **`files` do electron-builder não incluir `dist/server/index.js`** → o app empacotado abre uma janela morta. Teste: Task 3 verifica o arquivo no diretório desempacotado.
- **PNG do ícone menor que 256px** → electron-builder não consegue gerar o `.ico`. Teste: Task 1 lê o header PNG e exige largura/altura ≥ 256.
- **`client/public/icon.svg` ausente no build do Vite** → favicon 404 no app. Teste: Task 1 verifica `dist/client/icon.svg` após `npm run build`.
- **Mudança do `main` quebrar o launch dev** → `npm run desktop` deixa de funcionar. Teste: Task 2 afirma que `pkg.main === 'desktop/main.cjs'`.
- **Instalador não gerado de fato** → "build passou" sem `.exe`. Teste: Task 3 exige `release/*.exe` após `npm run build:desktop`.

---

### Task 1: Assets do logo

**Files:**
- Create: `build/icon.png` (1024×1024)
- Modify: `client/public/icon.svg`
- Modify: `client/index.html`
- Test: `server/desktop-assets.test.ts` (novo)

**Interfaces:**
- Consumes: imagem de referência fornecida pelo usuário (esfera clara, dois olhos ovais pretos).
- Produces: `build/icon.png`, `client/public/icon.svg`; `client/index.html` referencia `/icon.svg`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
test('desktop icon assets exist and are usable', () => {
  // lê build/icon.png; do header PNG, largura e altura >= 256
  // lê client/public/icon.svg; contém dois <ellipse> e nenhum path de sorriso
  // lê client/index.html; contém href="/icon.svg" e não contém o data URI laranja antigo
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha — `build/icon.png` não existe.

- [ ] **Step 3: Gerar os assets**

Gerar `build/icon.png` com a ferramenta de imagem a partir da referência: fundo escuro, esfera off-white com leve degradê, dois olhos ovais pretos inclinados, sem boca, 1024×1024. Reescrever `client/public/icon.svg` com o mesmo desenho em vetor (`viewBox 0 0 64 64`, fundo `#111`, esfera em degradê claro, duas `<ellipse>` pretas inclinadas). Em `client/index.html`, trocar o `<link rel="icon" href="data:image/svg+xml,...">` por `href="/icon.svg"`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test && npm run build`
Expected: testes passam; `dist/client/icon.svg` existe.

- [ ] **Step 5: Commit**

```bash
git add build/icon.png client/public/icon.svg client/index.html server/desktop-assets.test.ts
git commit -m "feat: Grok-style logo for app icon and favicon"
```

---

### Task 2: Configuração do electron-builder

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `server/desktop-build-config.test.ts` (novo)

**Interfaces:**
- Consumes: `build/icon.png` (Task 1).
- Produces: `pkg.scripts['build:desktop']`, `pkg.build`, `pkg.devDependencies['electron-builder']`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
test('package is configured to build a Windows installer', () => {
  assert.equal(pkg.main, 'desktop/main.cjs')
  assert.match(pkg.scripts['build:desktop'] ?? '', /electron-builder --win/)
  assert.equal(pkg.build?.appId, 'com.opengrokbot.desktop')
  assert.equal(pkg.build?.productName, 'OpenGrokBot')
  assert.equal(pkg.build?.win?.target, 'nsis')
  assert.equal(pkg.build?.win?.icon, 'build/icon.png')
  assert.match(pkg.devDependencies['electron-builder'] ?? '', /^\^?26/)
  assert.match(gitignore, /^release\/$/m)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: falha nos campos `build` ausentes.

- [ ] **Step 3: Implementar**

Adicionar ao `package.json`: script `build:desktop` = `npm run build && electron-builder --win`; campo `build` com `appId`, `productName`, `directories.output: "release"`, `files: ["dist/**/*", "desktop/**/*", "package.json"]`, `win: { target: "nsis", icon: "build/icon.png" }`. Instalar `electron-builder@^26.18.0` como devDependency. Adicionar `release/` ao `.gitignore`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test && npm run typecheck`
Expected: testes e typecheck passam.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore server/desktop-build-config.test.ts
git commit -m "build: configure electron-builder for Windows NSIS"
```

---

### Task 3: Validar o empacotamento

**Files:**
- Nenhum arquivo de código; apenas verificação.

**Interfaces:**
- Consumes: config da Task 2; assets da Task 1.
- Produces: instalador em `release/`.

- [ ] **Step 1: Verificar o app desempacotado**

Run: `npx electron-builder --win --dir`
Expected: `release/win-unpacked/resources/app/dist/server/index.js` e `release/win-unpacked/resources/app/desktop/main.cjs` existem.

- [ ] **Step 2: Gerar o instalador**

Run: `npm run build:desktop`
Expected: termina com exit 0 e existe pelo menos um `release/*.exe`.

- [ ] **Step 3: Rodar a suíte final**

Run: `npm test`
Expected: todos passam.

- [ ] **Step 4: Commit**

Sem arquivos novos a commitar. Registrar no log do plano o resultado da verificação.
