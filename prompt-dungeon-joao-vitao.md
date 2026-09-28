# Prompt para Opus 5.5 — Jogo de Terror 3D "A Masmorra de João Vitão"

Copie e cole o texto abaixo diretamente para o Opus 5.5.

---

Você é um desenvolvedor front-end especialista em jogos de navegador em **3D usando Three.js** (WebGL), publicáveis como site estático no **GitHub Pages**. Crie um jogo de terror estilo **dungeon crawler em labirinto 3D**, seguindo todas as especificações abaixo.

## 1. Conceito geral

**Título:** A Masmorra de João Vitão

O jogador explora, em primeira pessoa, uma masmorra 3D escura e labiríntica. Sua única fonte de luz é uma **tocha**, e seu objetivo é encontrar **chaves** escondidas nos corredores para abrir **portas** que levam ao próximo nível, cada vez mais profundo e mais hostil. No fundo da masmorra vive **João Vitão**, guardião lendário do lugar — apresentado inicialmente como o vilão, mas cuja verdadeira história vai sendo revelada aos poucos através de livros e diários espalhados pelo mapa.

Atmosfera: terror psicológico e de perseguição, não gore. Tensão vem da escuridão, do som e da sensação de estar sendo observado — não de violência explícita.

## 2. Stack técnica

- **Three.js** via CDN (`import * as THREE from 'three'` com import map, ou `<script>` UMD — usar sempre uma versão fixa/pinada, ex. r160+, via `unpkg` ou `jsdelivr`).
- Sem etapa de build (sem Webpack/Vite obrigatório): o jogo deve rodar abrindo `index.html` direto ou via GitHub Pages, só com HTML + JS módulos nativos do navegador.
- Estrutura de arquivos pensada para um repositório GitHub que vira site com GitHub Pages (ver seção 9).

## 3. Movimento e câmera (visão em primeira pessoa)

- Controles em primeira pessoa usando `PointerLockControls` do Three.js (clique para travar o mouse, WASD para andar, mouse para olhar ao redor).
- Em mobile: controles alternativos com joystick virtual (toque) para movimento + arrastar a tela para olhar ao redor.
- Colisão simples com as paredes do labirinto (bounding box ou raycasting) para o jogador não atravessar paredes.

## 4. Mecânica de luz e tocha (o coração da atmosfera 3D)

- A cena inteira deve ter iluminação ambiente **muito baixa** (`THREE.AmbientLight` fraca) ou nenhuma, combinada com **`THREE.Fog` / `FogExp2`** para limitar a visibilidade a poucos metros — tudo além disso desaparece na escuridão.
- A tocha é uma **`THREE.PointLight`** (ou `SpotLight` levemente cônico) anexada à câmera/jogador, com cor quente (âmbar/laranja).
- Simule o tremular da chama variando a `intensity` da luz aleatoriamente a cada frame (pequenas oscilações senoidais + ruído).
- A tocha tem **combustível limitado**: a intensidade e o alcance da luz diminuem lentamente com o tempo. Itens de "óleo"/"tocha extra" no mapa recarregam o combustível.
- Quando o combustível acaba, a luz quase se apaga (intensidade mínima por alguns segundos) — momento de pânico controlado, não game over instantâneo.
- Opcional: um leve efeito de partículas (fumaça/brasas) saindo da tocha usando `THREE.Points`.

## 5. Estrutura do labirinto e progressão

- Cada nível é um labirinto 3D: paredes (`BoxGeometry` com textura de pedra), piso e teto, gerados a partir de uma matriz 2D (algoritmo tipo *recursive backtracking* para gerar o layout, depois "extrudado" em geometria 3D).
- Espalhadas pelo labirinto: **2 a 4 chaves por nível** (objetos 3D simples ou sprites com leve rotação/flutuação para chamar atenção), escondidas em becos e salas secundárias.
- Uma ou mais **portas trancadas** (`Mesh` com textura de madeira/metal) bloqueiam o caminho até o portal/escada do próximo nível. Cada porta exige uma quantidade específica de chaves, indicada visualmente (ex: símbolos na porta).
- A cada nível, aumente a dificuldade: labirintos maiores, tocha com combustível que dura menos, névoa mais densa, e presença de João Vitão mais frequente.
- Total sugerido: **5 níveis**, o último sendo o confronto final na câmara de João Vitão.

## 6. O vilão — João Vitão (sprite PNG flutuante em 3D)

João Vitão é o guardião da masmorra. Ele **flutua** pelos corredores, sem pressa, como uma presença que observa mais do que ataca — reforçando a ideia de um ser trágico, não um monstro raivoso.

**Implementação técnica — IMPORTANTE:**

- Renderize João Vitão como um **`THREE.Sprite`** (billboard que sempre encara a câmera) usando `SpriteMaterial` com uma textura PNG de fundo transparente. Isso permite usar uma imagem 2D (ilustração ou arte gerada por IA) dentro do mundo 3D, sempre virada para o jogador — efeito clássico de fantasmas em jogos 3D antigos, que funciona muito bem para uma presença "flutuante" e inquietante.
- Deixe uma constante clara e isolada no código, por exemplo:

```javascript
// SUBSTITUA pelo caminho da sua imagem PNG (fundo transparente, formato retrato)
const VILLAIN_SPRITE_PATH = "assets/joao_vitao.png";
```

- Carregue a textura via `THREE.TextureLoader().load(VILLAIN_SPRITE_PATH)`.
- Aplique **animação de flutuação**: oscilação suave da posição Y com `Math.sin(tempo)`.
- Adicione uma **luz pontual fraca e colorida** (ex: verde-pálida ou azul-fantasmagórica) presa à posição do sprite, criando um glow no ambiente ao redor dele mesmo sem shaders complexos.
- Opcional: partículas leves (`THREE.Points`) ao redor do sprite para reforçar a sensação sobrenatural.
- Caso o PNG ainda não exista (placeholder), use uma textura de fallback simples (ex: uma silhueta encapuzada semitransparente gerada via canvas 2D em runtime), para que o jogo funcione mesmo sem a imagem final.
- João Vitão deve se mover de forma lenta e deliberada pelos corredores (não persegue agressivamente), aparecendo e desaparecendo entre as sombras/fog — a tensão vem da incerteza de saber se ele está por perto.

## 7. Narrativa — os livros/diários espalhados

Este é o coração emocional do jogo. Espalhe pelos níveis **objetos 3D de livros/pergaminhos** (modelos simples: `BoxGeometry` texturizada ou planos com textura de capa de livro) que, ao serem interagidos (tecla E ou clique quando próximo, com prompt de interação na tela), abrem um overlay HTML sobreposto ao canvas com um trecho de texto.

- Cada nível deve conter **2 a 3 fragmentos de história**.
- Os textos devem, aos poucos, desconstruir a ideia de que João Vitão é um vilão: ele não está ali para caçar o jogador, mas para **proteger algo ou alguém** — a memória de uma pessoa querida, um segredo que traria tragédia maior ao mundo lá fora se libertado, ou uma promessa que ele continua cumprindo mesmo na morte.
- Arco narrativo sugerido (Opus pode adaptar e expandir criativamente):
  1. Primeiros fragmentos: relatos de outros exploradores descrevendo João Vitão como um monstro perigoso.
  2. Fragmentos intermediários: páginas do próprio diário de João Vitão, revelando que ele guarda a masmorra por escolha, não por maldição.
  3. Fragmentos finais: a verdade completa — ele protege o local de algo pior que poderia escapar, e cada "invasor" afastado é, na verdade, alguém que ele tenta salvar sem que perceba.
- No nível final, o confronto não precisa ser uma batalha convencional: pode ser uma escolha do jogador (confrontar, ouvir, fugir), reforçando o tema do vilão incompreendido.

## 8. Interface (HUD)

Overlay em HTML/CSS sobreposto ao `<canvas>` do Three.js (não elementos 3D):

- Indicador de **combustível da tocha** (barra ou ícone de chama).
- Contador de **chaves coletadas** no nível atual.
- Ícone de **livro** que pisca ao encontrar um novo fragmento, com contador (ex: "3/8 páginas encontradas").
- Prompt de interação contextual (ex: "Pressione E para pegar" / "Pressione E para ler") quando o jogador está perto de um objeto interativo.
- Nome do nível atual e fade to black entre níveis (overlay preto com opacidade animada via CSS).
- Crosshair simples no centro da tela (ponto ou cruz discreta).

## 9. Estrutura de arquivos para hospedar no GitHub Pages

```
/joao-vitao-dungeon
├── index.html          (ponto de entrada, carrega Three.js via CDN/import map)
├── css/
│   └── style.css        (HUD, overlays, fontes)
├── js/
│   ├── main.js           (setup da cena, loop de render)
│   ├── maze.js            (geração e construção 3D do labirinto)
│   ├── torch.js            (lógica da luz/tocha e combustível)
│   ├── villain.js           (lógica do sprite do João Vitão)
│   └── story.js              (fragmentos de texto e sistema de livros)
├── assets/
│   ├── joao_vitao.png       (PLACEHOLDER — substitua pelo PNG gerado por IA)
│   ├── textures/               (pedra, madeira, metal, etc.)
│   └── audio/                   (sons ambiente, opcional)
└── README.md
```

- No `README.md`, inclua instruções curtas de como habilitar o **GitHub Pages** no repositório (Settings → Pages → Branch: main → pasta raiz `/`) e o link resultante (`https://usuario.github.io/joao-vitao-dungeon/`).
- Use sempre **caminhos relativos** para assets e scripts (nunca caminhos absolutos como `/assets/...`), já que o GitHub Pages hospeda o site dentro de um subdiretório do domínio.
- Evite qualquer dependência de servidor backend — tudo deve rodar 100% client-side.

## 10. Áudio (opcional, mas recomendado)

- Ambiente sonoro de masmorra (gotejar de água, vento, ecos) via Web Audio API ou tags `<audio>` com arquivos na pasta `assets/audio/`.
- Efeito sonoro sutil quando João Vitão está próximo (batimento cardíaco leve, sussurro) para aumentar a tensão sem depender de jump scares.

## 11. Performance e compatibilidade

- Otimize a geometria do labirinto (reutilize geometrias/materiais via `InstancedMesh` para paredes repetidas, em vez de criar centenas de meshes únicos).
- Teste em resoluções diferentes (`renderer.setSize` responsivo ao `window.resize`).
- Garanta um frame rate estável mesmo em notebooks/celulares médios — evite sombras dinâmicas pesadas (shadow maps) em excesso; priorize fog + point lights baratas para a atmosfera.

## 12. Tom visual geral

Paleta escura (tons de preto, marrom e âmbar da tocha), texturas de pedra na masmorra, névoa densa fechando a visão a poucos metros, contraste forte entre a luz quente da tocha e a escuridão fria ao redor. O objetivo é uma atmosfera de **tensão melancólica**, não terror gráfico — o jogador deve terminar o jogo sentindo pena de João Vitão, não medo dele.

---

**Fim do prompt.** Adapte livremente qualquer detalhe técnico que julgar necessário, mas mantenha o tom emocional do vilão incompreendido, a mecânica central de tocha + chaves + portas + livros de história, e a estrutura de arquivos compatível com GitHub Pages.
