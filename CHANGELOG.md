# Changelog

## 0.5.0 — 2026-11-26

Etapa 5: inteligência e comportamento sobrenatural.

### Adicionado

- Máquina de estados da entidade (adormecida, surgindo, observando, desaparecendo,
  sendo exorcizada e exorcizada), com transições inválidas recusadas.
- Aparições em lugares variados, com intervalos sorteados, distância limitada pela
  neblina e linha de visão conferida (`systems/spawn.js`).
- Três comportamentos (parada, tímida e esquiva), fuga quando o jogador chega perto
  e tempo de graça após interromper o exorcismo (`systems/haunting.js`).
- Orientação lenta para o jogador, olhar periódico e variação de tamanho,
  transparência e cor.
- Estrutura para sons da entidade, sem arquivos (`audio/entitySounds.js`).
- Testes unitários e de navegador da etapa.

### Alterado

- A entidade não fica mais parada na trilha desde o início: surge sozinha após
  alguns segundos de jogo e não aparece no menu.
- Os estados `present` e `exorcising` viraram `watching` e `exorcizing`.

### Corrigido

- Engasgo na primeira aparição (~0,1 s) e na primeira vez que a cruz subia (até
  ~1,4 s no Chrome sem placa de vídeo): os shaders são preparados no carregamento.

## 0.4.2 — 2026-11-26

Passos sonoros.

### Adicionado

- Passos com `assets/sounds/footsteps/dirt_gravel.mp3`, tocados pela distância
  percorrida, mais frequentes e agudos na corrida, silenciados na pausa e no menu.
- `tools/analyze-footsteps.mjs` (`npm run footsteps`) e testes do áudio.

## 0.4.1 — 2026-11-26

Manutenção: repositório Git e desempenho sem placa de vídeo. Sem mudanças na
jogabilidade.

### Adicionado

- Repositório Git local (branch `main`, tag `v0.4.0` como base) e `.gitignore`.
- Qualidade gráfica (Alta, Média, Baixa, Muito baixa e Automática) em
  Configurações e em `graphics` (`config.js`), também por
  `./start.sh --qualidade` ou `?qualidade=`.
- Modo automático: desce um nível se o jogo ficar abaixo de 28 FPS e avisa.
- Resoluções 512x288 e 426x240 (16:9).
- `tools/benchmark.mjs` (`npm run benchmark`): medição reproduzível no Chrome.

### Alterado

- Sprites da floresta em uma malha por material, com atlas de texturas e
  orientação para a câmera calculada no JavaScript (antes, instâncias).
- Grama e sombras em malhas por região, com descarte fora da vista e grama mais
  rala ao longe (antes, instâncias finas).
- Chão em 3x3 regiões; luz ambiente e luar do chão e das trilhas calculados uma
  vez (mesmo resultado); céu desenhado só acima do horizonte.
- Software com janela, qualidade Média: 40 → 50 FPS na floresta; Muito baixa: 68.
- Chamadas de desenho: 24 → 32 na Média, 23 na Muito baixa.

### Corrigido

- Trocar a resolução dos sprites podia desenhar um quadro com a floresta antiga já
  descartada (erro no console). A nova é montada antes de a antiga sair.

## 0.4.0 — 2026-11-26

Etapa 4: cruz e sistema de exorcismo.

### Adicionado

- Cruz na mão do jogador, erguida com o botão esquerdo, com animação de subida e
  descida (`player/cross.js`, sprite substituível `held_cross`).
- Mira por raycast com alcance e bloqueio por obstáculos
  (`systems/interaction.js`).
- Exorcismo por tempo, independente da taxa de quadros (`systems/exorcism.js`).
- Entidade de teste com os estados presente, sendo exorcizada e exorcizada, com
  efeitos e desaparecimento suave (`entities/entity.js`).
- Mira, aviso de cruz erguida, barra de progresso, mensagem e clarão
  (`ui/hud.js`).
- Testes unitários e de navegador da etapa.

### Alterado

- O fantasma deixou de ser um objeto decorativo da floresta e passou a ser a
  entidade de teste, no mesmo lugar.

## 0.3.0 — 2026-11-26

Etapa 3: floresta e ambientação noturna.

### Adicionado

- Trilhas de terra com bordas irregulares e chão com variação de tom.
- Árvores altas, pequenas e secas, arbustos, plantas, grama, pedras e troncos
  caídos, com 12 sprites provisórios novos e a textura `path.png`.
- Céu em degradê, silhuetas de floresta no horizonte e sombras fixas no chão.
- Lanterna em cone presa à câmera, ligada e desligada com `F`.
- Distância de desenho ligada à densidade da neblina.
- `world/environment.js` e testes da floresta, da iluminação e da lanterna.

### Alterado

- Área explorável ampliada de raio 27 para 32; chão de 120 para 180.
- A luz pontual que seguia o jogador deu lugar à lanterna.
- Luz ambiente e luar agora afetam chão, trilhas e troncos; os sprites recebem a
  cor da noite e a lanterna.

### Corrigido

- O servidor local recusava conexões ao carregar muitos arquivos de uma vez.
- Os testes de navegador não encontravam o Chrome nem o Python no Windows.

## 0.2.0 — 2026-11-26

Etapa 2: jogador e câmera em primeira pessoa.

### Adicionado

- Movimento com WASD e corrida com Shift, com aceleração, diagonal normalizada e
  passo fixo independente da taxa de quadros.
- Câmera com mouse look suavizado, limite vertical e balanço de caminhada.
- Colisões com árvores e pedras (`collisionRadius` no manifesto) e limite do
  terreno.
- Pointer Lock, tela de pausa e alternativa de arrastar para olhar.
- Testes unitários e de navegador para os itens acima, e teste opcional com
  captura real do mouse.

### Alterado

- A câmera saiu de `player.js` para `core/camera.js`; o balanço automático ficou
  restrito ao menu.
- O aviso "Cena de demonstração" e seu botão deram lugar à tela de pausa.
- Terreno ampliado de 90 para 120 e novo anel externo de árvores.
- A lanterna e a lua acompanham o jogador.

## 0.1.0 — 2026-11-26

Etapa 1: fundação e arquitetura.

### Adicionado

- Estrutura modular em ES Modules, com Babylon.js 9.37.2 armazenado localmente.
- `SpriteManager`: manifesto de sprites, grupos, cache e alternativa visual para
  arquivos ausentes.
- `PixelRenderer`: redução nearest-neighbor, filtros de textura, resolução de
  renderização e pixelização de imagens de interface.
- Cena noturna de demonstração com chão, lua, neblina, iluminação, árvores,
  vegetação, pedras, entidade e cruz.
- Pixel art provisória original, gerada por script.
- Menu com Jogar, Configurações e Sair.
- Execução offline por servidor local (`start.sh` / `serve.py`) e aviso para
  `file://`.
- Build de distribuição e testes unitários e de navegador.
