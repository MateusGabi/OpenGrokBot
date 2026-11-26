# Design: build Electron (Windows) + logo estilo Grok Bot

Data: 2026-11-26

## Intenção / por quê

O app já tem um shell Electron funcional (`desktop/main.cjs` sobe o servidor e abre a janela) e
`npm run desktop` para desenvolvimento, mas não há como gerar um instalador. Além disso, a
identidade visual atual é um blob laranja com sorriso; o usuário quer um logo no estilo do Grok Bot:
uma esfera clara com dois olhos ovais pretos.

## Goals

- Gerar instalador Windows (NSIS) com electron-builder via um único comando.
- Novo logo (esfera clara, dois olhos ovais pretos, fundo escuro) como ícone do app empacotado.
- Favicon web alinhado ao mesmo desenho.
- Config de packaging junto do `package.json`, sem arquivo de config extra.

## Non-goals / anti-goals

- Não configurar macOS nem Linux nesta rodada (macOS não é cross-buildável nesta máquina).
- Não assinar/codificar o instalador nem configurar auto-update.
- Não alterar screenshots, landing page nem outros projetos em `projects/`.
- Não substituir o shell Electron existente.

## Restrições

- Windows, electron-builder 26.x como `devDependency`.
- O shell Electron permanece em `desktop/main.cjs`; `main` do `package.json` já aponta para ele.
- electron-builder aceita PNG ≥256×256 como ícone e converte para `.ico` internamente.
- A saída do build não pode sujar o git.

## Approaches consideradas

1. **electron-builder com config no `package.json` + script `build:desktop` (escolhida).** Uma
   única fonte de config, coerente com o resto do projeto.
2. **electron-builder com `electron-builder.yml`.** Mesmo resultado, mais um arquivo sem ganho para
   poucas linhas de config.
3. **Electron Forge.** Mais estrutura e plugins; exigiria substituir o shell atual. Descartada.

## Como será feito (decidido)

- `package.json`: adicionar `electron-builder@^26.18.0` em `devDependencies`; adicionar campo `build`
  com `appId`, `productName`, `directories.output: "release"`, `files` (`dist/**/*`, `desktop/**/*`,
  `package.json`) e `win.target: "nsis"` com ícone em `build/icon.png`.
- `package.json`: adicionar script `build:desktop` = `npm run build && electron-builder --win`.
- `build/icon.png` (novo, 1024×1024): fundo escuro, esfera off-white com leve degradê, dois olhos
  ovais pretos inclinados, sem boca. Gerada a partir da imagem de referência fornecida, adaptada
  para funcionar em tamanho pequeno de ícone.
- `client/public/icon.svg` (modificar): mesmo desenho em vetor.
- `client/index.html` (modificar): favicon inline trocado por `/icon.svg`, mantendo o
  `apple-touch-icon`.
- `.gitignore`: adicionar `release/`.

## Deixado para o builder (decisões menores, já resolvidas aqui)

- `appId`: `com.opengrokbot.desktop`.
- Produto: `OpenGrokBot`.
- O build de verificação rápida usa `electron-builder --win --dir` antes do NSIS completo, para
  confirmar os assets sem depender do instalador.
- A logo é apenas do app; não há substituição de logotipo em docs/screenshots nesta rodada.
