# Design: Tela "Sobre" em Configurações

Data: 2026-11-26

## Intenção / por quê

O usuário fez um fork do projeto (`https://github.com/MateusGabi/OpenGrokBot`, que já é o `origin`
deste repositório) e quer uma tela de Sobre nas Configurações mostrando a versão instalada, se ela
está atualizada, um botão para baixar uma versão nova e um link para o GitHub dele.

A fonte da versão mais recente é o campo `version` do `package.json` na branch `main` do fork, em
`https://raw.githubusercontent.com/MateusGabi/OpenGrokBot/refs/heads/main/package.json`. Hoje tanto
a versão local quanto a remota são `0.5.0`.

## Goals

- Nova seção "About" no modal de Configurações, ao lado das existentes.
- Mostrar a versão atual do app lida do `package.json` local.
- Mostrar o status: atualizado ou atualização disponível (com a versão mais recente).
- Botão para baixar a nova versão e link para o repositório do fork.
- Funcionar tanto em `npm run dev` (browser) quanto no app Electron.

## Non-goals / anti-goals

- Não implementar auto-update nem instalação automática: o download é um link externo.
- Não criar workflow de release nem publicar artefatos (o botão aponta para a página de releases,
  que existe mesmo sem releases publicadas).
- Não trocar o idioma da interface: a tela segue o inglês das demais seções.
- Não mexer nas outras seções de Configurações nem no shell Electron.

## Restrições

- O servidor Express já expõe endpoints REST em `server/index.ts`; o cliente os consome via
  `client/src/api.ts`.
- `desktop/main.cjs` já abre links externos no navegador do sistema via `setWindowOpenHandler`,
  então `<a target="_blank">` funciona no Electron e no browser.
- Tipos compartilhados ficam em `shared/types.ts`; o projeto usa TypeScript nos dois lados.

## Approaches consideradas

1. **Verificação no servidor via `GET /api/version` (escolhida).** O servidor lê a versão local,
   busca a remota, compara e devolve os dados prontos para a UI. Funciona igual nos dois modos,
   não depende de CORS e permite cache/tratamento de erro de rede em um só lugar.
2. **`fetch` direto ao `raw.githubusercontent.com` no componente.** Menos código, mas duplica a
   lógica de comparação na UI e depende da requisição externa do renderer; descartada.
3. **Versão fixa no código.** Não refletiria bumps de versão; descartada.

## Como será feito (decidido)

- `shared/types.ts`: novo tipo `VersionInfo` com `current: string`, `latest: string | null`,
  `upToDate: boolean | null`, `checkedAt: number`, `repoUrl: string`, `downloadUrl: string`.
- `shared/version.ts` (novo): constantes com a URL de verificação, a URL do repositório
  (`https://github.com/MateusGabi/OpenGrokBot`) e a URL de downloads
  (`https://github.com/MateusGabi/OpenGrokBot/releases`).
- `server/index.ts`: endpoint `GET /api/version`:
  - lê `version` do `package.json` da raiz do projeto;
  - busca o JSON remoto com timeout (~5s), usando cache em memória (~10 min) e, em caso de falha,
    reaproveitando o último resultado válido ou devolvendo `latest: null`;
  - compara versões por `major.minor.patch` numéricos (ignora sufixo de prerelease);
  - devolve `repoUrl` e `downloadUrl` junto, para a UI não duplicar essas URLs.
- `client/src/api.ts`: função `fetchVersion()` chamando `/api/version`.
- `client/src/components/Settings.tsx`: adicionar `'about'` a `SettingsSection`, item "About" (ícone
  ℹ️) no `NAV` e renderizar o componente `About`:
  - card com "Current version" (`v0.5.0`), "Update status" com badge "Up to date" (verde) /
    "Update available" (destaque) / "Couldn't check" (neutro);
  - botão "Download update" (link externo para a página de releases) quando houver atualização, e
    link "View on GitHub" para o repositório;
  - estado de carregamento enquanto a requisição é feita e ação de tentar de novo em caso de erro.
- `client/src/settings.css`: estilos dos badges/links da nova seção, seguindo as classes existentes.

## Deixado para o builder (decisões menores, já resolvidas aqui)

- O badge de "up to date" usa a classe de cor de sucesso existente, se houver; caso contrário, uma
  classe nova e simples.
- O download permanece habilitado mesmo quando não há atualização, para permitir reinstalar.
- A checagem roda quando a seção é aberta, sem polling automático.
