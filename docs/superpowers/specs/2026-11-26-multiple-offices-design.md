# Múltiplos offices / workspaces — design

Um **office** é uma empresa independente de funcionários de IA: seu próprio `team.json` (com personas, providers e API keys), seu próprio `data/` (conversas, memória, uploads, routines, account) e sua própria pasta `workspace` (mais os `cwd`s por funcionário). Hoje o app roda exatamente um office por processo; o README ensina a abrir um segundo com variáveis de ambiente e outra porta, na mão.

Este projeto adiciona um **gerenciador de offices**: um registro pequeno, um comando de linha e um menu no Electron para criar, listar, abrir, renomear e remover offices. Cada office continua rodando no seu próprio **processo servidor**, na sua própria porta e no seu próprio diretório de estado. A UI web não muda: cada janela aponta para o servidor do seu office.

## Por que não colocar vários offices num único processo

Tudo no servidor é singleton de processo: barramento SSE (`events.ts`), `approvals`, `routines` (timers), `orchestrator`, `account`, `store`, `uploads`. Hospedar dois offices no mesmo processo exigiria chavear cada um por `officeId` e passar esse id em todas as rotas e todos os eventos. Uma única lacuna — uma aprovação do office A aparecendo no B, uma routine disparando na conversa errada, um `publicTeam` devolvendo a chave errada — é vazamento de dados entre "empresas". Além disso, `OPENGROKBOT_TOKEN` passaria a ser um token único para todas elas. O limite de processo é a fronteira de isolamento mais barata e mais fácil de auditar, e preserva a propriedade que o projeto anuncia (~5k linhas legíveis de uma tarde).

## Goals

- Criar um office novo por comando ou por uma tela minimalista dedicada, com `team.json` e `data/` próprios.
- Listar offices com nome, id, porta e diretório.
- Abrir um office (CLI) ou abrir/focar a janela dele (desktop), cada um com seu servidor.
- Renomear, adicionar e remover offices sem perder dados por acidente.
- Zero mudanças em `server/index.ts`, no cliente web de chat e no formato de `team.json`.
- Instalações existentes continuam funcionando sem migração: o office atual vira o office `default`.

## Non-goals

- Multi-tenancy em um único processo (um servidor, vários offices).
- Uma única URL/porta com proxy para offices filhos.
- Seletor de offices dentro da UI web de chat; notificações ou busca entre offices.
- Migração ou movimento de `team.json` / `data/` existentes.
- Tokens de acesso distintos por office (o token vem do ambiente, como hoje).
- Redesign do chat; as telas novas são apenas as do gerenciador de offices.

## Constraints

- TypeScript strict no servidor e no cliente; módulo novo de registro em `.cjs` para ser reaproveitável por Electron (CJS), CLI e testes, sem nova dependência.
- `npm run typecheck && npm test && npm run build` continuam passando.
- Nenhuma chave de API pode sair do `team.json` de cada office — o registro guarda só id, nome, caminho e porta.
- Nomes/paths são dados locais não confiáveis: validar slug e impedir remoção de diretórios fora de `<stateRoot>/offices/`.
- Telas seguem `ui-skills` MCP — `zeke/swiss-design` (grade, tipografia, hierarquia por opacidade, um único accent) e `pbakaus/distill` (uma ação principal, divulgação progressiva, sem ruído decorativo) — traduzidos para CSS puro com os tokens do app. Sem Tailwind, sem fontes ou CDN externos: o Electron roda offline.

## Approaches consideradas

1. **Vários offices em um processo, com seletor na UI.** Melhor UX de troca (dropdown), mas exige refatorar todos os singletons do servidor e adicionar `officeId` a cada rota/evento. Risco alto de vazamento cruzado; descartada.
2. **Uma URL, com proxy reverso para um processo filho por office.** Isolamento preservado e uma porta só, mas exige proxy de SSE, uploads de 60 MB e estáticos. Infraestrutura que o projeto não precisa para o valor entregue; descartada por enquanto.
3. **Instâncias isoladas + gerenciador (escolhida).** Um office = diretório de estado + porta + processo. Reusa `OPENGROKBOT_TEAM` / `OPENGROKBOT_DATA`, já documentados e testados. A troca acontece por janela/aba, não por dropdown. É a opção com menor superfície de mudança e fronteira de isolamento mais forte.

## Arquitetura

```
<stateRoot>/
├── team.json                  # office "default" (instalação existente)
├── data/                      # dados do office default
├── offices.json               # registro: id, nome, dir, porta
└── offices/
    └── <id>/
        ├── team.json          # office novo
        └── data/              # conversas, memória, uploads...
```

`<stateRoot>` é `app.getPath('userData')` no Electron e `process.cwd()` na CLI (sobrescrito por `OPENGROKBOT_STATE_ROOT`, se definido). O registro é incrementado na primeira execução do gerenciador; ele nunca move nem reescreve os dados existentes.

### `shared/offices.cjs` (novo, CommonJS, sem dependências além de `node:*`)

Registro puro, testável, usado pela CLI e pelo Electron:

- `officesPath(stateRoot)` → `<stateRoot>/offices.json`.
- `loadOffices(stateRoot): OfficesFile` — se o arquivo não existe, cria com um único entry `default`: `dir = stateRoot`, `port = Number(process.env.PORT ?? 4310)`, `name` lido de `<stateRoot>/team.json` (fallback `"Main office"`). Escrita atômica (temp + rename). Se o arquivo existe mas está corrompido ou `version !== 1`, lança `OfficesError` com mensagem acionável — nunca apaga registro sem pedir.
- `saveOffices(stateRoot, data)` — escrita atômica.
- `createOffice(stateRoot, name)` — valida nome (1–60 caracteres), gera slug único (`/^[a-z0-9][a-z0-9-]{0,39}$/`, `default` reservado; acentos são normalizados via NFD antes do slug), cria `<stateRoot>/offices/<id>/{team.json,data}`, copiando `team.example.json` da raiz da instalação, escolhe porta livre, salva entry e devolve `{ id, name, dir, port, createdAt }`.
- `addOffice(stateRoot, dir, name?)` — registra um diretório existente que já tenha `team.json`; o nome vem do parâmetro ou de `team.company`, e o slug é derivado do nome. É o caminho de reversão de um `remove` sem `--delete-data`. Slug duplicado gera sufixo `-2`, `-3`…
- `renameOffice(stateRoot, id, name)` — muda só o nome; `id` e `dir` permanecem estáveis (evita quebrar caminhos salvos em anexos). Nomes repetidos (case-insensitive) são recusados.
- `removeOffice(stateRoot, id, { deleteData?: boolean })` — recusa `default`; por padrão só remove do registro e mantém os arquivos. Com `deleteData`, apaga o diretório somente se ele for exatamente `<stateRoot>/offices/<id>/`.
- `officeEnv(office)` → `{ PORT, OPENGROKBOT_TEAM: <dir>/team.json, OPENGROKBOT_DATA: <dir>/data }`.
- `officeUrl(office)` → `http://127.0.0.1:<port>/`.
- `nextPort(offices)` — primeira porta a partir de 4311 não usada por outro office; checagem de disponibilidade com `net.createServer` antes de fixar a porta.

Schema:

```ts
interface OfficeEntry { id: string; name: string; dir: string; port: number; createdAt: number }
interface OfficesFile { version: 1; offices: OfficeEntry[]; lastId?: string }
```

### CLI (`scripts/office.cjs`, `npm run office -- ...`)

- `list` — imprime `id`, nome, porta e diretório de cada office.
- `create <name>` — cria e imprime o entry; sugere o comando `open`.
- `open <id>` — inicia `dist/server/index.js` com `officeEnv(office)` e `cwd: office.dir`, stdio herdado; bloqueia até Ctrl+C, como `npm start`. Marca `lastId`.
- `add <dir> [name]` — registra um diretório existente com `team.json` (reversão de `remove` sem `--delete-data`).
- `rename <id> <new name>`.
- `remove <id> [--delete-data]`.
- Comando ausente/argumentos inválidos → usage no stderr e exit 1.
- Requer `npm run build` prévio, mesma convenção de `npm start`.

### Electron (`desktop/main.cjs`)

- Substituir `server`/`URL` globais por `Map<id, { office, server, win }>`.
- `childOptions(port, office.dir, baseEnv)` continua sendo usado — ele já recebe porta e state dir, e o teste existente continua válido.
- `waitForServer(port)` generalizado.
- No startup, abrir `lastId`. Se `lastId` estiver ausente do registro ou o diretório não existir, cair para `default`; se `default` também não existir, mostrar `dialog.showErrorBox` e sair. Nunca criar dados no lugar errado.
- **Office ativo** = o office da janela focada, ou `lastId` se nenhuma janela estiver focada.
- `Menu.setApplicationMenu` com **Offices…** (abre/foca a tela do gerenciador) e a lista de offices, com checkmark nos que estão abertos. Criar, renomear e remover vivem na tela, não em diálogos nativos.
- Renomear atualiza o rótulo no registro, o título de todas as janelas abertas daquele office e o menu. Remover o office ativo derruba o servidor e fecha a janela dele, aponta `lastId` para `default` e atualiza o menu.
- Cada janela recebe título `${office.name} — OpenGrokBot` e `win.setTitle` após `loadURL` (com `page-title-updated` → `preventDefault`). Fechar uma janela derruba apenas o servidor daquele office; sair do app derruba todos.
- `build.files` em `package.json` passa a incluir `shared/offices.cjs`, `scripts/office.cjs` e `desktop/offices.*` (o Electron carrega o registro e a tela de dentro do app.asar).

### Tela do gerenciador (minimalista, via ui-skills)

Uma janela pequena e única, `desktop/offices.html`, carregada de `file://` com `contextIsolation` e um preload que expõe só `window.offices.{list,create,add,open,rename,remove,close}`. Sem React, Vite, Tailwind, fontes remotas ou chamadas de rede — a tela roda dentro do app instalado, offline. A API do preload usa `shared/offices.cjs` e o mapa de janelas do `main.cjs`; nenhum segredo (API keys) aparece na tela, só nome, id, porta e caminho.

Conteúdo, nesta ordem: uma linha de título (`Offices`); uma lista de uma coluna com o nome do office e `id · porta` em texto secundário, com uma ação principal por linha (`Open`); e um único campo de texto com `New office` para criar. Renomear e remover ficam atrás de um menu de três pontos em cada linha (divulgação progressiva); remover pede confirmação e nunca apaga arquivos sem uma segunda confirmação explícita.

Regras dos skills aplicadas em CSS puro, reaproveitando os tokens de tema do app:

- `pbakaus/distill`: uma ação principal por tela, sem cards dentro de cards, sem badges decorativos, cópia curta em voz ativa, fluxo linear de uma coluna.
- `zeke/swiss-design`: unidade de 8 px; hierarquia por opacidade, nunca por uma segunda cor; no máximo 3 tamanhos de fonte e 2 pesos; um único accent; muito espaço em branco; bordas retas; foco visível com `:focus-visible`; `prefers-reduced-motion`.
- A tela segue o tema claro/escuro do app pelos tokens `data-theme` (conjunto mínimo duplicado no CSS da tela, sem importar o bundle do chat).

### Servidor e cliente

Sem alterações. `server/index.ts` já lê `PORT`, `OPENGROKBOT_TEAM` e `OPENGROKBOT_DATA`; cada janela carrega a URL do seu próprio servidor. `team.company`, `team.workspace` e `agents[].cwd` continuam sendo editados em Settings → General / perfil, agora por office.

## Compatibilidade e dados

- Instalação existente: `team.json` + `data/` na raiz viram o office `default`, sem copiar nada.
- Ambos os mecanismos antigos continuam valendo: rodar o servidor com `OPENGROKBOT_TEAM` / `OPENGROKBOT_DATA` aponta para um diretório arbitrário, gerenciado ou não pelo registro.
- `remove` sem `--delete-data` é reversível com `add <dir>` (CLI) ou com a ação de adicionar da tela; com `--delete-data` é permanente e exige confirmação explícita.
- Um office com diretório ausente continua listado; abrir falha com erro claro em vez de criar dados no lugar errado.

## Testing

- `scripts/offices.test.mjs` (novo, roda via `node --test "scripts/*.test.mjs"`):
  - primeiro `loadOffices` cria o entry `default` a partir de um `team.json` temporário e não altera esse arquivo;
  - `createOffice` gera `team.json` + `data/`, slug único e portas distintas; nomes duplicados e slug `default` são recusados;
  - `renameOffice` preserva `id`/`dir`; `removeOffice` recusa `default` e mantém arquivos por padrão;
  - `removeOffice(..., { deleteData: true })` recusa um `dir` fora de `<stateRoot>/offices/`;
  - `officeEnv` / `officeUrl` produzem os valores esperados;
  - registro corrompido gera `OfficesError`.
- `server/desktop-child.test.ts` continua passando sem mudança; `server/desktop-build-config.test.ts` ganha asserções de que `shared/offices.cjs` e os arquivos `desktop/offices.*` estão incluídos no `build.files`.
- `server/desktop-assets.test.ts` ganha uma checagem de que a tela do gerenciador existe e não referencia fontes/URLs externas (app offline).
- Verificação final: `npm run typecheck && npm test && npm run build`.

## Documentação

Substituir a seção "Run a second, separate office (demos, tests)" do README por "Multiple offices / workspaces", com o modelo de isolamento, os comandos da CLI, a tela/menu do Electron, o layout em disco e o aviso sobre `--delete-data`.

## Decisões do autor (não precisam de confirmação)

- Nenhum plano de migração de dados: o office `default` aponta para o estado atual.
- Porta fixa por office, a partir de 4311.
- `lastId` em vez de "abrir todos os offices no startup"; `lastId` órfão cai para `default`.
- Office ativo = janela focada (ou `lastId`); renomear mantém `id`/`dir`; remover fecha janela e servidor do office ativo.
- A tela de gestão é uma janela Electron autocontida; o cliente React de chat não é alterado.
- `zeke/swiss-design` e `pbakaus/distill` são os dois skills `ui-skills` usados, traduzidos para CSS puro (sem Tailwind nem assets remotos). O skill `leonxlnx/minimalist-skill` não foi encontrado no registro.
- Slug de nomes acentuados é normalizado (NFD); nomes de exibição duplicados são recusados.
- Sem token por office nesta versão.
