# Forest Exorcist

Terror sobrenatural em primeira pessoa, em uma floresta à noite, com pixel art
em um ambiente 3D.

**Estado atual: Etapa 7 (investigação e pistas), versão 0.7.1.** Há uma cabana
explorável, três entidades que aparecem, observam, somem e podem ser expulsas com
a cruz, e uma investigação com documentos, caderno e objetivos. Nenhuma entidade
persegue nem ataca. A Etapa 8 ainda não foi feita.

## Como jogar (sem internet)

Requisitos: Google Chrome e Python 3 (já presente no Linux Mint). Não é preciso
instalar nada.

```sh
./start.sh
```

O comando inicia um servidor local e abre o jogo no Chrome. Para encerrar, feche
a aba e pressione `Ctrl+C` no terminal.

## Controles

| Tecla | Ação |
| --- | --- |
| `W` / `S` | Avançar / recuar |
| `A` / `D` | Andar para a esquerda / direita |
| Mouse | Olhar |
| `Shift` (segurar) | Correr |
| `1` | Pegar a cruz (de novo: guardar) |
| `G` | Guardar o item da mão |
| Botão esquerdo (segurar) | Usar a cruz que está na mão |
| `E` | Abrir ou fechar a porta, examinar objetos, ler documentos |
| `J` | Abrir o caderno de investigação |
| `F` | Ligar / desligar a lanterna |
| `Esc` | Liberar o mouse e pausar |

Na pausa, **Continuar** captura o mouse de novo e **Menu principal** encerra a
exploração (a próxima começa do ponto inicial). O jogo também pausa quando a
janela perde o foco.

### Captura do mouse

- Ao clicar em **Jogar**, o Chrome captura o mouse e mostra como soltá-lo.
- Logo depois de um `Esc`, o Chrome pode recusar uma nova captura por cerca de um
  segundo. O jogo continua pausado e explica; clique em **Continuar** outra vez.
- Se a captura for recusada, aparece **Jogar sem captura**: segure o botão
  esquerdo e arraste para olhar. Em navegadores sem Pointer Lock, esse modo é
  usado automaticamente.

| Situação | Comando |
| --- | --- |
| O arquivo perdeu a permissão de execução (pendrive, ZIP) | `sh start.sh` ou `python3 serve.py` |
| Escolher a porta (padrão 8000; se ocupada, tenta as seguintes) | `./start.sh --port 9000` |
| Não abrir o navegador | `./start.sh --no-browser` |
| Abrir já com uma qualidade gráfica (computador sem placa de vídeo) | `./start.sh --qualidade muito-baixo` |

O servidor escuta somente em `127.0.0.1`: outros computadores não o acessam.

### Por que não basta abrir o `index.html`?

Em endereços `file://`, o Chrome bloqueia módulos JavaScript (ES Modules) e o
uso de imagens como texturas WebGL. Nesse caso a página mostra um aviso com a
instrução acima. Não desative a segurança do navegador para contornar isso.

## A cabana

A sudoeste do ponto inicial há uma cabana abandonada. Siga a trilha para o sul e
pegue a picada de terra que sai dela. Aproxime-se da porta e aperte `E`.

- **Porta:** abre e fecha por dentro e por fora. Não termina de fechar enquanto
  você estiver no vão.
- **Interior:** mesa, cadeira, estante, armário, caixote, livros, papéis, um
  retrato e uma lamparina.
- **Examinar:** chegue perto, olhe para o objeto e aperte `E`. Há seis: papéis,
  estante, armário, cadeira, retrato e caixote.
- **Janelas:** são aberturas. Dá para ver (e ser visto) através delas, mas não
  passar.

| Ajuste (`src/config.js`) | Onde |
| --- | --- |
| Posição, tamanho, porta, janelas e telhado | `buildings[0]` |
| Móveis, objetos examináveis e mensagens | `buildings[0].furniture`, `examinables` |
| Lamparina e penumbra interna | `buildings[0].lamp`, `lighting.interiorColor` |
| Tecla E: ângulo, tempos e textos | `interaction` |
| Texturas (substituíveis, em potência de 2) | `assets/textures/cabin/`, `buildingMaterials` |

Para criar outro tipo de construção, escreva uma função de planta como `planCabin`
(`src/world/buildings/cabin.js`) e registre-a em `PLANNERS`
(`src/world/buildings/index.js`). Colisões, porta, visão, interação e aparições já
usam a planta.

## Investigação

A cabana pertenceu a um investigador. Oito documentos contam, aos poucos, o que
ele viu. Chegue perto, olhe para a pista e aperte `E`. Na floresta, procure
estacas com folhas presas, junto às trilhas.

- **Leitura:** o jogo para enquanto o documento está aberto. Feche com `E`, `Esc`
  ou o botão **Fechar**.
- **Caderno (`J`):** mostra só o que você encontrou, quando encontrou, os
  objetivos e as descobertas. Escolha com o mouse ou com as setas; feche com `J`,
  `Esc` ou **Fechar**.
- **Objetivos:** concluem sozinhos, em qualquer ordem, com um aviso no canto da
  tela. Não bloqueiam nada: dá para explorar e exorcizar sem segui-los.
- **Registros:** valem para a exploração atual. Voltar ao menu (ou fechar a
  página) começa do zero; não há salvamento em disco.

Ao fechar a leitura, o Chrome captura o mouse de novo. Se ele recusar, o jogo
fica pausado: clique em **Continuar**.

| Ajuste | Onde |
| --- | --- |
| Textos, lugares, objetivos e descobertas | `src/content/investigation.js` |
| Alcance de leitura e distância de desenho | `reach`, `drawDistance` (mesmo arquivo) |
| Tempo de cada aviso | `noticeDuration` (mesmo arquivo) |
| Aparência das peças | `src/world/buildings/clues.js` |

Um documento novo é uma entrada em `documents`, com `place.form` igual a `floor`,
`wall`, `photo`, `stake` ou `stone`. Para ele contar no objetivo de reunir tudo,
acrescente-o também à lista do objetivo `arquivo`.

## As entidades

| | Entidade (original) | Observadora | Instável |
| --- | --- | --- | --- |
| Aparência | vulto branco | figura alta, encapuzada | mancha violeta que pisca e salta |
| Primeira aparição | ~6 s | ~30 s | ~50 s |
| Distância ao surgir | 12–22 | 16–26 | 10–18 |
| Fica presente | 6–14 s | 12–20 s | 3,5–6 s |
| Intervalo | 8–18 s | 18–30 s | 14–26 s |
| Foge se chegar a | 5 | 7 | 4 |
| Exorcismo | 4 s | 5 s | 2,5 s |

- **Original:** como antes, com três comportamentos que se alternam: parada (parte
  quando o tempo acaba), tímida, azulada (some se encarada de perto por 3 s sem a
  cruz) e esquiva, esverdeada (some se você desviar o olhar depois de vê-la).
- **Observadora:** some se encarada de perto por 4,5 s sem a cruz. Quando **não
  está sendo vista**, pode mudar para um ponto próximo (até duas vezes).
- **Instável:** ao sumir, pode reaparecer logo em outro lugar (até duas vezes
  seguidas).

Todas voltam-se para você, não andam à vista e não bloqueiam a passagem. Perto da
cabana, podem surgir diante de uma janela ou da entrada, principalmente a
observadora.

**Regras entre elas** (`encounters`): no máximo 2 presentes; ao menos 5 s entre
aparições de entidades diferentes; nada novo durante um exorcismo; nunca
sobrepostas; nunca dentro de objetos ou da cabana.

Cada aparição segue os mesmos estados:

| Estado | O que acontece | Passa para |
| --- | --- | --- |
| `dormant` | Invisível, esperando | `appearing` |
| `appearing` | Surgindo; pode ser mirada a partir da metade | `watching`, `disappearing`, `exorcizing` |
| `watching` | Observando | `disappearing`, `exorcizing` |
| `disappearing` | Sumindo | `dormant` |
| `exorcizing` | Parada, sem poder sumir | `watching`, `exorcised` |
| `exorcised` | Expulsa: não volta (só ao retornar ao menu) | — |

Um tipo novo é uma entrada em `entityTypes`: `visual` substitui valores de
`entity`, `behavior` os de `haunting`, e `exorcism` define tempo e mensagem.

## A cruz na mão

A exploração começa com a cruz guardada. A barra no canto inferior esquerdo
mostra os itens; o que está na mão ganha a moldura dourada.

| Estado | Quando | O que aparece |
| --- | --- | --- |
| `unequipped` | Guardada (início, `G` ou `1`) | Nada na mão; o botão esquerdo não faz nada |
| `equipped_idle` | Depois de `1` | `held_cross.png`, parada |
| `equipped_using` | Botão esquerdo pressionado | Os quadros de `using_cross.png` |

A animação passa do primeiro ao último quadro (a cruz se vira para a frente) e
fica no último enquanto o botão durar. Soltar volta ao repouso na hora. Pausa,
documento e caderno encerram o uso; ao voltar, a cruz continua na mão e é preciso
apertar de novo. Pegar a cruz com o botão já pressionado também exige novo aperto.

Ajustes em `exorcism.cross` (`src/config.js`): `frames` e `fps` (12), `loop`
(`true` repete a sequência), `height`, `position` e `crop`. O `crop` é a faixa
transparente à esquerda e no topo das imagens, que não é desenhada: ao trocar a
arte, confira-o (um teste avisa se cortar o desenho).

Para um item novo: acrescente-o a `items` (`id`, `slot`, `name`) e registre em
`Game.equipment[id]` um objeto com `equip(valor, botãoPressionado)`.

## Exorcismo

1. Quando uma entidade aparecer, aproxime-se: dentro do alcance (10), a mira vira
   um losango vermelho.
2. Pegue a cruz (`1`), segure o botão esquerdo e mantenha a mira sobre a entidade.
3. Quando a barra se completar, a entidade é expulsa.

Com duas por perto, só a que está na mira progride. Soltar o botão ou desviar a
mira interrompe; o progresso fica guardado, inclusive se ela sumir e reaparecer.
Troncos, pedras altas e paredes a escondem da mira; janelas e porta aberta não.

| Ajuste (`src/config.js`) | Onde | Padrão |
| --- | --- | --- |
| Tempo da original (s); cada tipo pode ter o seu | `exorcism.duration`, `entityTypes` | 4 |
| Velocidade do progresso | `exorcism.speed` | 1 |
| Alcance máximo | `exorcism.range` | 10 |
| Quanto a cruz precisa estar erguida | `exorcism.requiredRaise` | 0,9 |
| Perda por segundo ao interromper | `exorcism.decayPerSecond` | 0 (guarda) |
| Obstáculos bloqueiam a mira | `exorcism.blockedByObstacles` | `true` |
| Mensagem e clarão ao concluir | `exorcism.message`, `messageDuration`, `flash` | — |
| Cruz: imagens, animação, tamanho, posição | `exorcism.cross` | — |

Com a perda por segundo em 0,25, por exemplo, a barra esvazia em 4 s. Para trocar
a cruz por um modelo, passe outra `createVisual` a `createCross`
(`src/player/cross.js`).

## Som

O jogo não depende de som. Há dois arquivos:

- `assets/sounds/footsteps/dirt_gravel.mp3`: passos; cada um é um trecho da faixa
  (`audio.footsteps.steps`), mais frequentes e agudos na corrida.
  `npm run footsteps` recalcula os inícios.
- `assets/sounds/entity/exorcism.mp3`: toca em laço durante o exorcismo
  (`audio.entity.exorcising`).

Os demais sons das entidades (`appear`, `presence`, `vanish`, `exorcised`) têm só a
estrutura. O som toca depois de um clique e para na pausa e no menu.

## Substituir um sprite

1. Salve sua imagem em PNG (com fundo transparente, se quiser recorte).
2. Copie sobre o arquivo atual, mantendo o mesmo nome. Exemplo:
   `assets/sprites/environment/tree_01.png`.
3. Recarregue a página (`F5`).

Nenhum código precisa mudar.

| ID | Arquivo em `assets/sprites/` | Tamanho provisório | Altura no jogo |
| --- | --- | --- | --- |
| `tree_01` / `tree_02` | `environment/` | 48x88 / 48x120 | 5,5 / 7,5 |
| `tree_small_01` | `environment/` | 32x48 | 3 |
| `dead_tree_01` / `dead_tree_02` | `environment/` | 40x72 / 44x96 | 4,5 / 6 |
| `bush_01` / `bush_02` | `environment/` | 20x14 / 28x20 | 0,875 / 1,25 |
| `fern_01` / `plant_01` | `environment/` | 22x15 / 13x11 | 0,7 / 0,55 |
| `grass_01` / `grass_02` | `environment/` | 18x10 / 18x7 | 0,5 / 0,35 |
| `rock_01` / `rock_02` | `environment/` | 20x12 / 30x24 | 0,75 / 1,3 |
| `log_01` | `environment/` | 80x16 | 0,7 (diâmetro) |
| `backdrop_01` | `environment/` | 256x64 | silhuetas do horizonte |
| `shadow_01` | `environment/` | 32x32 | sombra no chão |
| `ghost_01` | `entities/` | 28x40 | 2,5 |
| `watcher_01` | `entities/` | 30x56 | 3,3 (observadora) |
| `wisp_01` | `entities/` | 26x34 | 1,9 (instável) |
| `cross` | `items/` | 16x24 | 1,5 (cruz fincada na trilha) |
| `held_cross` | `items/` | 500x666 (resolução original) | cruz na mão, em repouso |
| `using_cross` | `items/` | 2500x666: 5 quadros de 500x666 em uma linha | animação de uso |

O arquivo de cada um é o próprio ID com `.png`.

Três imagens têm formato especial:

- `log_01`: o quadrado da esquerda é o corte do tronco (pontas); o restante é a
  casca, no sentido do comprimento.
- `backdrop_01`: silhuetas **brancas** em fundo transparente, que se repetem sem
  emendas na horizontal. A cor vem de `environment.backdrop` em `config.js`.
- `shadow_01`: mancha escura com transparência.

Regras:

- A imagem pode ter **qualquer dimensão**. A altura no jogo vem do manifesto e a
  largura acompanha a proporção da imagem.
- A base da imagem toca o chão. Margem transparente embaixo faz o objeto flutuar.
- No modo padrão (`cutout`), pixels com menos de 50% de opacidade somem. Para
  transparência parcial, use `"alphaMode": "blend"`.
- Os sprites são escurecidos para combinar com a noite e iluminados pela
  lanterna, exceto os marcados com `"shading": "glow"`, que brilham sozinhos.

Outras imagens substituíveis: o chão (`assets/textures/ground.png`) e a terra das
trilhas (`assets/textures/path.png`), de preferência quadradas, em potência de 2 e
sem emendas, e o título do menu (`assets/textures/ui/title.png`).

## Adicionar um sprite novo

Coloque o PNG na pasta e acrescente uma linha em
`assets/sprites/manifest.json`:

```json
"tree_03": { "file": "environment/tree_03.png", "group": "tree", "worldHeight": 6, "collisionRadius": 0.35 }
```

Sem `collisionRadius`, o objeto pode ser atravessado.

A floresta sorteia entre todos os sprites do mesmo grupo (`tree`, `tree_small`,
`dead_tree`, `vegetation`, `plant`, `grass`, `rock`, `log`), então a nova árvore
aparece sem alterar código. Os objetos
em posição fixa (cruz fincada, algumas árvores etc.) estão em `forest.landmarks`, em
`src/config.js`.

Em código, um ID com pasta também funciona sem registro:
`spriteManager.load('items/vela')` carrega `assets/sprites/items/vela.png`.

### Opções do manifesto

| Campo | Padrão | Função |
| --- | --- | --- |
| `file` | `<id>.png` | Caminho relativo a `assets/sprites/` |
| `group` | `misc` | Grupo usado pela floresta |
| `worldHeight` | `1` | Altura no mundo (a câmera está a 1,7) |
| `alphaMode` | `cutout` | `cutout` (bordas duras, mais leve) ou `blend` |
| `shading` | `scene` | `scene` (noite) ou `glow` (brilho próprio) |
| `collisionRadius` | `0` | Raio sólido na base (0 = atravessável) |
| `pixelHeight` | automático | Altura exata da textura, em pixels |
| `pixelsPerUnit` | `16` | Densidade de pixels deste sprite |
| `maxTextureSize` | `256` | Limite do maior lado |
| `alphaCutoff` | `0` | 1 a 255: força transparência binária |
| `colorLevels` | `0` | 2 a 64: reduz as cores (posterização) |

Caminhos remotos (`http:`, `data:`), absolutos ou com `..` são recusados.

### Sprite ausente ou corrompido

O jogo continua. No lugar aparece um xadrez magenta, o menu mostra um aviso e o
console (`F12`) informa o arquivo. Se o `manifest.json` tiver erro de sintaxe, o
aviso também aparece e a cena usa as alternativas visuais.

## Movimento e colisões

Os valores ficam em `src/config.js`:

| Ajuste | Onde | Padrão |
| --- | --- | --- |
| Velocidade andando / correndo | `player.walkSpeed`, `runSpeed` | 3 / 5,5 |
| Aceleração / frenagem | `player.acceleration`, `deceleration` | 24 / 30 |
| Altura dos olhos | `player.eyeHeight` | 1,7 |
| Limite do terreno (raio) | `player.boundaryRadius` | 32 |
| Sensibilidade do mouse | `camera.mouseSensitivity` | 0,0022 |
| Inverter eixo vertical | `camera.invertY` | `false` |
| Limite vertical da visão | `camera.pitchLimitDegrees` | 80 |
| Balanço da caminhada (0 desliga) | `camera.bob` | 0,04 / 0,075 |

- São sólidos as árvores (inclusive pequenas e secas), as pedras e os troncos
  caídos. Arbustos, plantas, grama, entidade e cruz podem ser atravessados.
- Um tronco caído usa uma fileira de obstáculos ao longo do comprimento.
- Cada obstáculo é um prisma invisível de 8 lados, com raio
  `collisionRadius × escala`, usado pelo `moveWithCollisions` do Babylon.js.
  Como ele às vezes deixa o jogador penetrar em um obstáculo, `player.js` o
  empurra de volta para fora e desfaz o passo se não houver espaço.
- A física avança em passos de 1/120 s, com interpolação: a velocidade não
  depende dos quadros por segundo. Abaixo de 10 FPS o jogo fica mais lento.

## Floresta, noite e lanterna

| Ajuste (`src/config.js`) | Onde | Padrão |
| --- | --- | --- |
| Quantidade e distribuição da vegetação | `forest.layers`, `forest.seed` | — |
| Traçado e largura das trilhas | `forest.paths`, `forest.pathHalfWidth` | 2 trilhas |
| Luz ambiente / luar | `lighting.ambient`, `lighting.moon` | 0,62 / 0,5 |
| Cor da noite nos sprites | `lighting.spriteTint` | `#53628f` |
| Lanterna: intensidade e alcance | `lighting.lantern.intensity`, `range` | 3 / 20 |
| Lanterna: abertura e suavidade | `lighting.lantern.angle`, `exponent` | 1,45 rad / 16 |
| Lanterna ligada ao começar | `lighting.lantern.startOn` | `true` |
| Neblina: cor e densidade | `environment.fog` | `#16223a` / 0,055 |
| Horizonte | `environment.sky`, `moon`, `backdrop` | — |
| Distância de desenho | `graphics.presets`, `environment.culling` | ver abaixo |

- As trilhas ficam sempre livres de obstáculos.
- A neblina é exponencial: quase invisível perto e total ao longe. O que ela
  esconde deixa de ser desenhado.
- São três luzes, sem sombras dinâmicas. As "sombras" no chão são manchas fixas.
- No chão e nas trilhas, que são planos, a luz ambiente e o luar entram como uma
  cor fixa com o mesmo resultado; só a lanterna é calculada a cada pixel.

## Qualidade gráfica e desempenho

Em **Configurações → Qualidade gráfica**:

| Nível | Resolução | Árvores e pedras | Arbustos e plantas | Grama (cheia até) | Sombras |
| --- | --- | --- | --- | --- | --- |
| Alta | 853x480 | até a neblina | 34 | 24 (16) | 36 |
| Média | 853x480 | até a neblina | 26 | 18 (10) | 28 |
| Baixa | 512x288 | 31 | 19 | 13 (7) | 18 |
| Muito baixa | 426x240 | 27 | 14 | 10 (5) | 12 |
| Automática (padrão) | começa na Média | | | | |

- Na **Automática**, se o jogo ficar abaixo de 28 FPS por 4 segundos, ele desce um
  nível e mostra um aviso no canto da tela (inclusive quando a resolução muda).
  Nunca sobe sozinho e não mede no menu nem na pausa.
- A qualidade só muda o que é desenhado e a resolução. Colisões, alcance da cruz,
  velocidade e controles são iguais em todos os níveis.
- A qualidade escolhe a resolução, que depois pode ser trocada em **Resolução da
  imagem**. Todas mantêm 16:9 e a ampliação sem suavização.
- Os níveis ficam em `graphics` (`src/config.js`). As escolhas valem até a página
  ser fechada; para fixar uma, use `./start.sh --qualidade <nível>` ou o endereço
  `?qualidade=<nível>`.

### Medições (v0.7.0, 27/11/2026)

`npm run benchmark -- --seconds 8 --quality <nível> --scenarios <cenas>`, Chrome
158 **sem janela, WebGL por software (SwiftShader)**, Windows 10, i5-12400F,
1280x720. "Antes" é o commit anterior à etapa (`c3f123c`), medido na mesma sessão,
alternando as versões; mediana de três rodadas. FPS médio e, entre parênteses, o
1% low.

| Cena | Muito baixa, antes | Muito baixa, 0.7.0 | Média, antes | Média, 0.7.0 |
| --- | --- | --- | --- | --- |
| Floresta (câmera girando) | 37,4 (21,7) | 37,4 (21,9) | 26,1 (18,6) | 26,1 (19,9) |
| Vegetação densa | 36,5 (26,4) | 36,5 (24,7) | 24,9 (20,7) | 24,8 (19,4) |
| Exterior da cabana | 35,4 (28,8) | 35,3 (29,6) | 22,9 (19,7) | 22,9 (19,7) |
| Interior da cabana | 34,0 (29,6) | 34,0 (28,2) | 21,8 (19,7) | 21,6 (18,7) |
| Exorcismo | 36,8 (32,7) | 36,9 (32,4) | 25,4 (21,8) | 25,4 (22,2) |
| Três entidades | 36,1 (26,9) | 36,1 (28,2) | 24,5 (20,8) | 24,4 (17,7) |
| Andando pela trilha | 37,5 (25,0) | 37,2 (26,0) | 25,6 (21,6) | 25,5 (21,2) |

| Tela parada | Imagens 3D por segundo, antes → 0.7.0 | JavaScript por quadro |
| --- | --- | --- |
| Pausa (Muito baixa) | 35 → 0 | 0,9 ms → ~0 |
| Pausa (Média) | 24 → 0 | 0,9 ms → ~0 |
| Leitura e caderno | não existiam → 0 | ~0 |

Nas telas paradas o navegador volta ao ritmo máximo dele (~180 quadros por
segundo nesta máquina) porque só mostra a interface; não é desempenho do 3D.

- **Muito baixa:** a média ficou acima de 30 FPS em todas as cenas. O 1% low ficou
  entre 22 e 32 FPS: a meta de 30 **não** vale para os piores quadros.
- **Média:** 21 a 26 FPS, antes e depois. Desde o commit anterior à etapa, ela
  desenha em 853x480 (eram 640x360). Sem placa de vídeo, use a Muito baixa. A
  Automática desce sozinha quando fica abaixo de 28 FPS.
- Em repetições só da cabana, a 0.7.0 ficou 0,2 a 0,4 FPS abaixo (cerca de 1%),
  com 1 a 2 chamadas de desenho a mais; a causa não foi isolada.
- A cena passou de 492 para 496 malhas e de 27 para 28 materiais.

### Medições (v0.6.0, 27/11/2026)

`npm run benchmark -- --seconds 10 --quality <nível> --scenarios
floresta,exorcismo,cabana,entidades`, Chrome 158, Windows 10, 1280x720, no mesmo
computador e no mesmo dia para as duas versões. Em software, média de duas
medições; FPS médio e, entre parênteses, o 1% low.

| Chrome | Cena | 0.5.0 | 0.6.0 |
| --- | --- | --- | --- |
| Software sem janela, Média | floresta | 31,8 (24,8) | 31,3 (18,5) |
| | exorcismo | 31,4 (26,1) | 30,0 (22,9) |
| | cabana | — | 27,1 (21,4) |
| | três entidades | — | 29,7 (25,7) |
| Software sem janela, Muito baixa | floresta | 37,3 (26,9) | 37,2 (23,5) |
| | exorcismo | 36,5 (26,3) | 36,5 (27,8) |
| | cabana | — | 33,9 (26,1) |
| | três entidades | — | 36,2 (31,9) |
| Software com janela, Média | floresta | 54,8 (36,2) | 54,0 (30,6) |
| | exorcismo | 53,3 (38,5) | 51,6 (37,2) |
| | cabana | — | 42,0 (32,5) |
| | três entidades | — | 48,2 (39,4) |
| Software com janela, Muito baixa | floresta | 72,7 (46,4) | 72,4 (40,8) |
| | cabana | — | 59,8 (41,0) |
| RTX 2060, Média (uma medição) | floresta | 180 (160) | 180 (163) |
| | cabana | — | 180 (162) |

- A média na floresta não mudou. O 1% low caiu ali por **um único quadro** de
  ~60–70 ms (os piores normais são ~45 ms), na primeira vez que o interior da cabana
  aparece na tela em software. Não depende de shaders nem do JavaScript, e o
  aquecimento no carregamento não o eliminou.
- Dentro da cabana é a cena mais pesada: cada pixel recebe a lamparina e a
  lanterna. Na qualidade Média sem janela fica abaixo de 30 FPS; use a Muito baixa.
- A cena passou de 460 para 492 malhas, de 14 para 27 materiais, de 3 para 4 luzes e
  de 31 para até 40 chamadas de desenho com a cabana à vista.

Otimizações desta versão: a floresta é desenhada até menos longe quando se está
dentro de uma construção (tempo de desenho ali: de 15,3 para 14,3 ms); obstáculos do
jogador guardados em lista; listas de visão e de construções reaproveitadas. As duas
últimas não geraram diferença mensurável no tempo de JavaScript (~1,5 ms).


### Medições (v0.4.1, 26/11/2026)

Medidas com `node tools/benchmark.mjs --seconds 10 --quality <nível>` (Chrome
158, Windows 10, 1280x720). A floresta é medida no ponto inicial, com a câmera
girando 360°; o exorcismo, diante da entidade com a cruz erguida. FPS médio e,
entre parênteses, o 1% low.

| Chrome | Cena | 0.4.0 | Média | Baixa | Muito baixa |
| --- | --- | --- | --- | --- | --- |
| Software, janela | floresta | 40,4 (30,7) | 50,2 (33,2) | 61,0 (41,5) | 68,4 (47,1) |
| Software, janela | exorcismo | 37,2 (31,4) | 48,7 (31,6) | 58,6 (46,3) | 64,1 (41,4) |
| Software, sem janela | floresta | 25,5 (20,6) | 29,7 (22,9) | 33,2 (26,2) | 35,0 (25,8) |
| Software, sem janela | exorcismo | 24,9 (21,3) | 29,4 (24,1) | 32,5 (26,8) | 34,4 (22,4) |
| RTX 2060, janela | floresta | 180 (139) | 180 (167) | 180 (168) | 180 (163) |

"Software" é o WebGL do SwiftShader, que o Chrome usa quando não há placa de vídeo
utilizável. Sem janela (`--headless`), o próprio Chrome limita até a cena vazia a
~41 FPS; com janela, a cena vazia chega a ~104 FPS. As medições foram feitas em
um processador rápido: em computadores mais lentos o modo software rende menos.

O que pesava (medido isoladamente, v0.4.0): no SwiftShader cada instância custa
quase o mesmo que uma chamada de desenho. A grama (535 tufos) custava ~5 ms por
quadro; os sprites (~500), ~4,5 ms; as sombras, ~2,7 ms; o chão, ~4,3 ms; o
céu, ~1,5 ms. O JavaScript, ~3 ms. Por isso a vegetação deixou de usar
instâncias (`src/graphics/batches.js`):

- Sprites: todos os de um material em uma malha, com as imagens em um atlas. O
  JavaScript os vira para a câmera e descarta os que estão longe ou fora da vista.
- Grama e sombras: malhas por região, descartadas fora da vista; a grama fica
  mais rala ao longe (só um trecho dos índices é desenhado).
- Chão em 3x3 regiões; céu só acima do horizonte.

Resultado na média: o tempo de desenho por quadro caiu de 16,8 para ~10 ms, e o
JavaScript de 3 para 1,7 ms. Malhas: 1.399 → 460; materiais: 26 → 14. As chamadas
de desenho subiram de 24 para 23–32 (regiões em vez de instâncias), o que custa
pouco no software.

## Pixelização

Tudo é controlado por `src/graphics/pixelRenderer.js`, com valores em
`CONFIG.pixel` (`src/config.js`). São quatro camadas:

1. **Resolução do sprite.** Altura da textura = `worldHeight × pixelsPerUnit`
   (ou `pixelHeight`). Assim o "tamanho do pixel" fica parecido entre objetos.
   Uma foto de 1000x2000 usada como árvore de altura 5,5 vira uma textura de
   44x88. Imagens pequenas nunca são ampliadas.
2. **Redução sem suavização** (nearest-neighbor), preservando o canal alfa.
3. **Filtro de textura.** Sprites usam nearest sem mipmaps. O chão usa nearest
   com mipmaps, para não cintilar ao longe.
4. **Imagem 3D.** A cena é desenhada em resolução menor (`renderScale: 2` dá
   640x360 em 1280x720; os níveis definem o próprio valor) e ampliada com `image-rendering: pixelated`, sem
   antialias.

Para imagens de interface, use `<img data-pixelate data-pixel-height="32">` ou
`pixelRenderer.pixelateElement(img, { pixelHeight: 32 })`. Sem altura definida,
a resolução original é mantida.

O menu **Configurações** ajusta a qualidade gráfica, a resolução da imagem, a
resolução dos sprites e a neblina. Os valores não são salvos.

Os sprites da floresta são reunidos em um atlas (uma textura por material) na
hora em que o jogo carrega, a partir das imagens já pixeladas. Substituir um PNG
continua funcionando do mesmo jeito.

## Estrutura

```
index.html, style.css     página e visual do menu
start.sh, serve.py        execução offline
lib/                      Babylon.js local, licença e versão
src/
  main.js                 inicialização
  boot.js                 aviso para file://
  config.js               configurações
  core/game.js            motor, cena, ciclo e modos (menu, jogo, pausa)
  core/input.js           teclado, mouse e Pointer Lock
  core/camera.js          rotação, limites de visão e balanço
  world/                  forest.js (vegetação), environment.js (terreno, céu,
                          neblina), lighting.js (noite e lanterna), colliders.js
  player/                 player.js (movimento e colisões), cross.js (cruz),
                          inventory.js (item selecionado)
  world/buildings/        index.js (montagem), cabin.js (planta), clues.js
                          (pistas), geometry.js (caixas reunidas em malhas)
  entities/entity.js      máquina de estados e aparência das entidades
  content/                investigation.js (documentos, objetivos e descobertas)
  systems/                investigation.js (registros), interaction.js (mira),
                          exorcism.js (regras do exorcismo),
                          haunting.js (comportamento), spawn.js (onde aparecer)
                          entityManager.js (tipos e limites), interact.js (tecla E)
  audio/                  footsteps.js (passos), entitySounds.js (entidades)
  graphics/               pixelRenderer.js, spriteManager.js, materials.js,
                          batches.js (atlas e geometria agrupada)
  ui/                     menu.js (menu e pausa), hud.js (mira, barra, avisos),
                          notebook.js (leitura e caderno)
assets/                   sprites/, textures/ (cabin/, ui/), sounds/, models/
tools/                    build, cópia da biblioteca, provisórios, benchmark.mjs
tests/                    unit/, browser/, real/, helpers/
```

## Desenvolvimento

Requer Node.js 22 ou mais novo. Build e testes não precisam de `node_modules`.

| Comando | Função |
| --- | --- |
| `npm run build` | Valida o projeto e gera `dist/` (versão para distribuir) |
| `npm test` | Testes unitários (cena 3D com o motor sem tela do Babylon) |
| `npm run test:browser` | Testes no Chrome, sem janela e sem acesso externo |
| `npm run check` | Os três acima |
| `npm run test:real` | Captura do mouse e `Esc` reais; abre uma janela por alguns segundos (requer Xephyr e `python3-xlib`) |
| `npm run placeholders` | Recria provisórios **ausentes** (`-- --force` sobrescreve todos) |
| `npm run vendor` | Atualiza `lib/` após `npm install` (único passo que usa internet) |
| `npm run footsteps` | Recalcula os inícios dos passos do arquivo de som |
| `npm run benchmark` | Mede o desempenho no Chrome (ver `tools/benchmark.mjs`); aceita `-- --quality muito-baixo` |

Opções dos testes de navegador: `FE_GPU=1` (usa a placa de vídeo em vez de WebGL
por software), `FE_VISIBLE=1` (abre uma janela), `FE_SCREENSHOTS=pasta` (salva
capturas), `CHROME_PATH=...`. Também funcionam no Windows (usam `python`).

Após substituir sprites provisórios, alguns testes podem falhar por esperar o
tamanho ou a cor originais; isso não indica defeito no jogo.

Para levar a outro computador, copie a pasta `dist/` e execute `start.sh` nela.

### Repositório Git

O projeto é um repositório Git local (branch `main`, tags `v0.4.0` e `v0.4.1`).
Ficam fora dele `node_modules/` (só serve para `npm run vendor`), resultados de
medições e testes, temporários e arquivos de ambiente (`.gitignore`).

`dist/` também fica fora: é gerada por `npm run build` a partir dos arquivos
versionados e seria uma segunda cópia de tudo (inclusive dos 9 MB do Babylon.js).
Para distribuir uma versão, faça `git checkout v0.4.1`, `npm run build` e copie
`dist/`. A biblioteca `lib/` é versionada, pois o jogo roda sem internet.

## Limitações conhecidas

- Os registros da investigação não são salvos entre explorações.
- As pistas da floresta não bloqueiam a passagem e aparecem até 20 unidades de
  distância (podem surgir um pouco de repente).
- Todos os documentos usam a mesma arte de papel; a fotografia usa a imagem do
  retrato. O texto conta o que ela mostra.
- Esta versão não foi testada em um computador com Linux Mint; as medições e os
  testes foram feitos no Windows.
- Há três entidades; nenhuma persegue, anda à vista ou ataca. Depois de expulsas,
  só voltam ao retornar ao menu.
- A visão ao surgir é conferida contra troncos e uma aproximação da folhagem: em
  mata fechada ela pode aparecer parcialmente encoberta. Se o jogador estiver dentro
  da copa de uma árvore, ela surge ao lado, fora da parte visível.
- Só uma construção (a cabana), sem escadas, segundo andar ou móveis que se movem.
- A luz da lamparina e a lanterna atravessam paredes (não há sombras dinâmicas).
- A porta aberta não tem colisão própria: dá para atravessar a folha.
- A vegetação em volta da cabana é plana e gira para a câmera.
- A cruz é um sprite plano, desenhado na resolução interna da imagem 3D. No modo
  sem captura, arrastar para olhar também a usa, se estiver na mão.
- As duas imagens da cruz têm enquadramentos diferentes: a mão de `held_cross.png`
  é maior que a do primeiro quadro da animação, e nota-se a troca ao apertar o
  botão. Abaixo de 12 FPS a animação fica mais lenta, sem pular quadros.
- A folha de animação (2500 px de largura) não funciona em placas de vídeo limitadas
  a texturas de 2048 px.
- A mira considera como bloqueio troncos, pedras, troncos caídos e paredes: copas,
  arbustos e móveis não escondem uma entidade.
- Em software, há um quadro mais lento na primeira vez que o interior da cabana
  aparece na tela.
- Sem placa de vídeo, a qualidade Média (853x480) fica abaixo de 30 FPS.
- É necessário o servidor local; `file://` não funciona.
- Sprites são planos voltados para a câmera (todos paralelos à tela, como em jogos
  clássicos); vistos de perto, não têm volume.
- Sem sombras dinâmicas: a lanterna atravessa árvores, pedras e paredes.
- Sprites são iluminados como planos de frente para a câmera, sem volume.
- Não há pulo, agachamento, gravidade nem relevo: o terreno é plano.
- A borda da área explorável é invisível; as trilhas continuam na neblina além
  dela.
- Sem placa de vídeo, a média fica acima de 30 FPS na qualidade Muito baixa, mas
  o 1% low fica entre 22 e 32 FPS no Chrome sem janela (ver Medições). Em
  computadores mais lentos que o usado nas medições, pode ser preciso também a
  neblina "Densa" ou a resolução 320x180.
- Nas qualidades Baixa e Muito baixa, árvores distantes surgem um pouco antes da
  neblina as esconder totalmente.
- Com a neblina "Leve", objetos distantes podem aparecer de repente.
- Somente teclado e mouse; as teclas não podem ser reconfiguradas no menu.
- A sensibilidade do mouse só é ajustada em `src/config.js`.
- Reduzir imagens muito detalhadas por nearest-neighbor pode gerar ruído. Para
  melhor resultado, desenhe a arte já próxima do tamanho final.
- Muitos sprites com `blend` sobrepostos custam desempenho e podem ser
  desenhados na ordem errada. Prefira `cutout`.
- O navegador não deixa o botão SAIR fechar a aba; o jogo mostra como fazer.
- `lib/babylon.js` tem cerca de 9 MB (biblioteca completa).

## Créditos

[Babylon.js](https://www.babylonjs.com/) sob licença Apache 2.0 (veja
`lib/babylon.LICENSE.md` e `lib/babylon.NOTICE.md`). A arte provisória foi criada
por código para este projeto (`tools/generate-placeholders.mjs`).
