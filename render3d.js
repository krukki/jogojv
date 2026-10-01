/* =====================================================================
   JOÃO VITÃO — RENDERIZADOR 3D (Three.js)
   ---------------------------------------------------------------------
   Desenha o estado do jogo que vive no index.html (L, P, V, G, MP, itens,
   portas…). A lógica, o online e a interface (HUD, páginas, diálogos)
   ficam lá; aqui fica tudo o que é imagem:
   - paredes, chão e teto montados a partir do mapa de tiles do nível,
     com texturas de foto (Poly Haven, CC0, em assets/tex) tingidas com
     as cores de cada nível;
   - a lanterna do celular é um holofote de verdade, com sombras, e a luz
     vermelha do João Vitão também faz sombra (no computador);
   - o celular na mão e o armário por dentro (cena própria, por cima);
   - os outros alunos (online) como bonecos 3D de moletom com capuz;
   - um passeio pela IFMT atrás do título, da sala e do final;
   - neblina, brilho (bloom), granulado de filme e aberração de lente.
   ===================================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// celular: menos pixels, sombras menores, sem sombra da luz vermelha e sem bloom
const MOBILE = document.body.classList.contains('touch');
const Q = MOBILE
  ? { pr:1, shadow:512, vShadow:false, bloom:false, aa:false }
  : { pr:Math.min(window.devicePixelRatio || 1, 1.5), shadow:1024, vShadow:true, bloom:true, aa:true };
const BAND = .42;          // altura do barrado (faixa colorida de baixo das paredes)
const MAX_MATES = 3;       // lanternas dos outros alunos (número fixo de luzes: trocar recompila os shaders)
const MATE_H = .68;        // altura dos alunos: os olhos ficam na altura da câmera (EYE)
const MENU_SEED = 31337;   // o corredor que aparece atrás do título é sempre o mesmo

const css = c => new THREE.Color(`rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);

export async function create(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:Q.aa, powerPreference:'high-performance' });
  renderer.setPixelRatio(Q.pr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, .075);
  const camera = new THREE.PerspectiveCamera(60, 16/9, .02, 60);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0x9aa6c0, 0x1a1410, .035));   // quase nada: o escuro é o escuro

  /* ---------- texturas ---------- */
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTex = (name, kind) => new Promise((res, rej) => loader.load(`assets/tex/${name}_${kind}.jpg`, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, () => rej(new Error('textura ' + name))));
  const pbr = async name => {
    const [map, normalMap, roughnessMap] = await Promise.all(['diff', 'nor', 'rough'].map(k => loadTex(name, k)));
    return { map, normalMap, roughnessMap };
  };
  const [TX_WALL, TX_FLOOR, TX_CEIL, TX_METAL, TX_WOOD] = await Promise.all(
    ['peeling_painted_wall', 'worn_tile_floor', 'ceiling_interior', 'rusty_painted_metal', 'wood_peeling_paint_weathered'].map(pbr));
  const canvasTex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const pbrMat = (tx, color, extra) => new THREE.MeshStandardMaterial(Object.assign({
    map:tx.map, normalMap:tx.normalMap, roughnessMap:tx.roughnessMap, color, roughness:1, metalness:0 }, extra));

  // armário: duas portas com frestas de ventilação e puxador, sobre o metal enferrujado
  const lockerCanvas = makeCanvas(256, 352, (g, w, h) => {
    g.fillStyle = '#8e9aa6'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2; k++){
      const x0 = 10 + k*123, dw = 113;
      g.fillStyle = '#7d8995'; g.fillRect(x0, 8, dw, h - 16);
      g.strokeStyle = '#3c444d'; g.lineWidth = 3; g.strokeRect(x0, 8, dw, h - 16);
      g.fillStyle = '#20252b';
      for (let s = 0; s < 6; s++) g.fillRect(x0 + 22, 26 + s*11, dw - 44, 5);          // frestas
      for (let s = 0; s < 4; s++) g.fillRect(x0 + 22, h - 70 + s*11, dw - 44, 5);
      g.fillStyle = '#c9ced4'; g.fillRect(x0 + dw - 20, h*.48, 8, 30);                   // puxador
      g.fillStyle = '#e8e4d8'; g.fillRect(x0 + 30, 106, 52, 20);                          // etiqueta
      g.fillStyle = '#5a5146'; g.font = '13px sans-serif'; g.fillText(['nº 13', 'nº 07'][k], x0 + 38, 121);
    }
  });
  const lockerMat = new THREE.MeshStandardMaterial({ map:canvasTex(lockerCanvas), normalMap:TX_METAL.normalMap, roughnessMap:TX_METAL.roughnessMap, roughness:1, metalness:.45 });

  /* ---------- luzes fixas (o número não muda: trocar recompila os shaders) ---------- */
  // lanterna do celular: holofote com sombra, saindo da mão (um pouco à direita e abaixo dos olhos)
  // queda 1.3 (e não a física, 2): de perto não estoura tudo em branco, de longe ainda alcança
  const flash = new THREE.SpotLight(0xf2f6ff, 0, 12, .43, .55, 1.3);
  flash.castShadow = true;
  flash.shadow.mapSize.set(Q.shadow, Q.shadow);
  flash.shadow.camera.near = .05; flash.shadow.camera.far = 14;
  flash.shadow.bias = -.0004; flash.shadow.normalBias = .02;
  scene.add(flash, flash.target);
  const spill = new THREE.PointLight(0xb8c8ff, 0, 2.6, 2);             // brilho da tela do celular
  scene.add(spill);
  const red = new THREE.PointLight(0xff2a18, 0, 9, 1.6);               // luz vermelha do João Vitão
  red.castShadow = Q.vShadow;
  red.shadow.mapSize.set(256, 256); red.shadow.camera.near = .1; red.shadow.camera.far = 9; red.shadow.bias = -.002;
  scene.add(red);
  const sky = new THREE.SpotLight(0xdfe8ff, 0, 6, .75, .9, 1.2);       // luz do dia pela claraboia da entrada
  scene.add(sky, sky.target);
  const mateLights = [];                                               // lanternas dos outros alunos (sem sombra)
  for (let k = 0; k < MAX_MATES; k++){ const s = new THREE.SpotLight(0xf2f6ff, 0, 9, .43, .6, 2); scene.add(s, s.target); mateLights.push(s); }

  /* ---------- desenhos do jogo (itens, brilhos) como texturas ---------- */
  const sprTex = new Map();
  const texOf = c => { let t = sprTex.get(c); if (!t){ t = canvasTex(c); sprTex.set(c, t); } return t; };
  const litMat = new Map();   // material iluminado (recebe a lanterna e faz sombra) para cada desenho
  const litOf = s => { let m = litMat.get(s); if (!m){ m = new THREE.MeshStandardMaterial({ map:texOf(s.img), alphaTest:.5, side:THREE.DoubleSide, roughness:.8 }); litMat.set(s, m); } return m; };
  const glowMat = (c, opacity) => new THREE.SpriteMaterial({ map:texOf(c), blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity, fog:true });

  // partículas (fumaça vermelha do João Vitão e brilhos dourados das chaves)
  const partPool = [];
  for (let k = 0; k < 160; k++){ const s = new THREE.Sprite(glowMat(SPR.glowRed, 0)); s.visible = false; scene.add(s); partPool.push(s); }

  // João Vitão: a foto num painel sempre virado para você, com aura
  const villainMat = new THREE.MeshBasicMaterial({ color:0xffffff, fog:true, alphaTest:.1 });
  const villain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), villainMat);
  const aura = new THREE.Sprite(glowMat(SPR.glowRed, .6));
  scene.add(villain, aura);
  // infecção: os colegas infectados também são João Vitão (mais cópias da mesma foto, criadas quando precisa)
  const extraV = [];
  function extraVillain(k){
    if (!extraV[k]){
      const m = new THREE.Mesh(villain.geometry, villainMat), a = new THREE.Sprite(glowMat(SPR.glowRed, .6));
      scene.add(m, a); extraV[k] = { m, a };
    }
    return extraV[k];
  }
  let villainTexReady = false;
  const specterTex = SPECTER.map(c => canvasTex(c));

  /* ---------- outros alunos: boneco 3D de moletom com capuz ---------- */
  const mates = new Map();
  const std = (color, roughness = .85, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness }, extra));
  const M_JEANS = std('#313b52'), M_SKIN = std('#a87858', .75), M_SHOE = std('#d6d2ca', .8), M_BAG = std('#2a2e35', .8),
        M_PHONE = std('#121418', .35, { metalness:.3 }), M_SCREEN = new THREE.MeshBasicMaterial({ color:0x7fa7e0 }), M_EYE = std('#1a1210', .4);
  const part = (geo, mat, x = 0, y = 0, z = 0, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m; };
  // tronco do moletom: perfil girado (mais largo no peito, barra embaixo), achatado na frente-trás
  const TORSO_GEO = new THREE.LatheGeometry([[0, .29], [.07, .29], [.083, .3], [.088, .34], [.09, .42], [.093, .49], [.082, .525], [.05, .548], [0, .552]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
  // capuz: casca de esfera aberta na frente (+x), por onde aparece o rosto na sombra
  const HOOD_GEO = new THREE.SphereGeometry(.074, 24, 16, Math.PI + .95, TAU - 1.9, 0, 2.35);
  const HEAD_GEO = new THREE.SphereGeometry(.054, 20, 14), NOSE_GEO = new THREE.ConeGeometry(.009, .022, 8);
  function makeMate(ci){
    const c = PLAYER_COLORS[ci] || PLAYER_COLORS[0];
    const hoodie = std(css(c), .95), hoodieD = std(css([c[0]*.72, c[1]*.72, c[2]*.72]), .95);
    const hoodIn = std(css([c[0]*.35, c[1]*.35, c[2]*.35]), 1, { side:THREE.DoubleSide });
    const root = new THREE.Group(), body = new THREE.Group();   // modelo olhando para +x; +z é a direita
    root.add(body);
    // pernas: um cilindro afinando, tênis com sola branca
    const leg = side => {
      const pivot = new THREE.Group(); pivot.position.set(0, .3, side*.042); body.add(pivot);
      part(new THREE.CylinderGeometry(.036, .029, .27, 12), M_JEANS, 0, -.135, 0, pivot);
      part(new THREE.BoxGeometry(.105, .03, .052), M_SHOE, .022, -.283, 0, pivot);
      part(new THREE.BoxGeometry(.1, .012, .054), std('#f2efe8', .7), .022, -.294, 0, pivot);
      return pivot;
    };
    const legL = leg(-1), legR = leg(1);
    part(TORSO_GEO, hoodie, 0, 0, 0, body).scale.set(.74, 1, 1);
    part(new THREE.CylinderGeometry(.067, .067, .022, 20), hoodieD, 0, .3, 0, body).scale.set(.74, 1, 1);   // barra
    part(new THREE.BoxGeometry(.012, .055, .1), hoodieD, .064, .37, 0, body);                               // bolso canguru
    for (const z of [-.018, .018]) part(new THREE.CylinderGeometry(.003, .003, .06, 5), std('#e9e2d4', .8), .07, .5, z, body);   // cordões
    part(new THREE.BoxGeometry(.075, .17, .13), M_BAG, -.095, .44, 0, body);                                // mochila
    part(new THREE.BoxGeometry(.035, .06, .1), std('#1a1d22', .8), -.135, .4, 0, body);
    for (const z of [-.05, .05]) part(new THREE.BoxGeometry(.13, .02, .016), M_BAG, -.005, .525, z, body).rotation.z = -.25;   // alças
    // braços: ombro → cotovelo → mão; o direito dobrado, segurando o celular na frente do peito
    const arm = (side, bent) => {
      const sh = new THREE.Group(); sh.position.set(0, .515, side*.098); body.add(sh);
      part(new THREE.CylinderGeometry(.027, .024, .13, 10), hoodieD, 0, -.065, 0, sh);
      const el = new THREE.Group(); el.position.y = -.13; sh.add(el);
      part(new THREE.CylinderGeometry(.024, .021, .12, 10), hoodieD, 0, -.06, 0, el);
      part(new THREE.SphereGeometry(.022, 10, 8), M_SKIN, 0, -.13, 0, el);
      if (bent){ sh.rotation.z = .3; el.rotation.z = 1.25; sh.rotation.x = side*.3; }   // cotovelo para a frente, mão diante do peito
      return { sh, el };
    };
    const armL = arm(-1, false), armR = arm(1, true);
    // no antebraço dobrado, o +x local aponta para cima: a tela fica desse lado, virada para o rosto
    const ph = part(new THREE.BoxGeometry(.01, .075, .038), M_PHONE, .014, -.14, 0, armR.el); ph.rotation.z = -.3;
    const scr = part(new THREE.PlaneGeometry(.03, .066), M_SCREEN, .0056, 0, 0, ph); scr.rotation.y = Math.PI/2; scr.castShadow = false;
    // cabeça: rosto, nariz, olhos, franja, e o capuz em volta
    part(new THREE.CylinderGeometry(.025, .028, .04, 10), M_SKIN, .004, .55, 0, body);   // pescoço
    const head = new THREE.Group(); head.position.set(.008, .6, 0); body.add(head);
    part(HEAD_GEO, M_SKIN, 0, 0, 0, head).scale.set(1, 1.12, .92);
    part(NOSE_GEO, M_SKIN, .055, -.004, 0, head).rotation.z = -Math.PI/2;
    for (const z of [-.019, .019]) part(new THREE.SphereGeometry(.0065, 8, 6), M_EYE, .049, .012, z, head);
    part(new THREE.SphereGeometry(.057, 16, 10, 0, TAU, 0, 1.2), std('#2a1c14', .9), -.004, .006, 0, head).rotation.z = -.35;   // cabelo/franja
    part(HOOD_GEO, hoodie, -.012, .004, 0, head).scale.set(1.02, 1.12, 1.02);
    part(HOOD_GEO, hoodIn, -.012, .004, 0, head).scale.set(.97, 1.07, .97);   // forro escuro por dentro
    part(new THREE.TorusGeometry(.066, .02, 8, 20), hoodie, -.01, .528, 0, body).rotation.x = Math.PI/2;   // capuz caído no pescoço
    scene.add(root);
    return { root, body, head, legL, legR, armL:armL.sh, elL:armL.el, armR:armR.sh, elR:armR.el, ci };
  }
  // pose do aluno: andando (s = balanço da passada) ou num emote (em, t = segundos desde que começou)
  // eixos de cada junta: rotation.z leva o braço/perna para a frente; rotation.x abre para o lado
  // (positivo abre o lado esquerdo, negativo o direito)
  function poseMate(mm, s, em, t){
    const { body, head, legL, legR, armL, elL, armR, elR } = mm;
    legL.rotation.set(0, 0, s*.55); legR.rotation.set(0, 0, -s*.55);
    armL.rotation.set(0, 0, -s*.45); elL.rotation.set(0, 0, 0);
    armR.rotation.set(.3, 0, .3); elR.rotation.set(0, 0, 1.25);   // segurando o celular
    body.rotation.set(0, 0, 0); body.position.set(0, Math.abs(s)*.012, 0);
    head.rotation.set(0, 0, 0);
    if (!em) return;
    const TAU2 = Math.PI*2;
    if (em === 1){
      // dança padrão: braços batendo em diagonal, um sobe enquanto o outro desce, e os pés chutando de lado
      const w = t*TAU2*1.1, a = Math.sin(w), b = Math.sin(w*2);
      body.position.y = Math.abs(b)*.025;
      body.rotation.x = a*.08;
      armL.rotation.set(.5 + .45*a, 0, .9 + .5*a); elL.rotation.z = 1.3 - .7*a;
      armR.rotation.set(-.5 + .45*a, 0, .9 - .5*a); elR.rotation.z = 1.3 + .7*a;
      legL.rotation.x = Math.max(0, a)*.45; legR.rotation.x = Math.min(0, a)*.45;
      head.rotation.x = -a*.15;
    } else if (em === 2){
      // floss: braços esticados indo juntos de um lado para o outro (um na frente, outro atrás) e o quadril ao contrário
      const w = t*TAU2*1.5, side = Math.sin(w), fb = Math.cos(w);
      armL.rotation.set(.3 + .55*side, 0, .55*fb); elL.rotation.z = 0;
      armR.rotation.set(-.3 + .55*side, 0, -.55*fb); elR.rotation.z = 0;
      body.position.z = -.04*side; body.rotation.x = .1*side;
      legL.rotation.x = .12*side; legR.rotation.x = .12*side;
      head.rotation.x = -.12*side;
    } else if (em === 3){
      // acenar: braço direito para o alto, a mão balançando
      armR.rotation.set(-2.5, 0, .25); elR.rotation.set(.55*Math.sin(t*9), 0, .2);
      head.rotation.x = -.12; body.rotation.x = .05;
    } else if (em === 4){
      // comemorar: os dois braços para cima, pulando
      const j = Math.abs(Math.sin(t*5.5));
      body.position.y = j*.07;
      armL.rotation.set(2.6 + .2*Math.sin(t*11), 0, .2); elL.rotation.z = .3;
      armR.rotation.set(-2.6 - .2*Math.sin(t*11), 0, .2); elR.rotation.z = .3;
      legL.rotation.z = legR.rotation.z = -j*.25;
      head.rotation.z = .2;
    }
  }

  /* ---------- celular na mão e armário por dentro (cena própria, desenhada por cima) ---------- */
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(46, 16/9, .01, 3);
  vmScene.add(new THREE.HemisphereLight(0x8090b0, 0x201814, .07));
  const vmScreenLight = new THREE.PointLight(0x9fc0ff, 0, .5, 2);   // a tela ilumina os dedos
  const vmFlash = new THREE.DirectionalLight(0xe8eeff, 0);          // o facho da lanterna rebate de volta na mão
  vmFlash.position.set(.2, .6, -1);
  const vmRed = new THREE.PointLight(0xff2a18, 0, 1.5, 1.5);        // o João Vitão perto: a mão fica vermelha
  vmRed.position.set(0, .35, -.6);
  vmScene.add(vmScreenLight, vmFlash, vmRed);
  const hand = new THREE.Group(); vmScene.add(hand);
  const phone = new THREE.Group(); hand.add(phone);
  const vmStd = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  phone.add(new THREE.Mesh(new RoundedBoxGeometry(.072, .15, .009, 4, .008), vmStd(0x0d0f12, .35, .5)));
  const screenCanvas = makeCanvas(256, 540, () => {}), screenTex = canvasTex(screenCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.065, .141), new THREE.MeshBasicMaterial({ map:screenTex }));
  screen.position.z = .0047; phone.add(screen);
  // flash: o LED fica atrás, no topo; a luz vaza pela borda
  const ledGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map:texOf(SPR.glowWhite), blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:.9 }));
  ledGlow.position.set(-.02, .078, -.004); ledGlow.scale.set(.05, .05, 1); phone.add(ledGlow);
  const ledHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map:texOf(SPR.glowWhite), blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:.35 }));
  ledHalo.position.set(-.02, .08, -.006); ledHalo.scale.set(.2, .2, 1); phone.add(ledHalo);
  {
    const skin = vmStd(0x8d5a3c, .65), sleeve = vmStd(0x1b1d22, .95);
    const p = (geo, mat, x, y, z, rz = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); hand.add(m); return m; };
    p(new RoundedBoxGeometry(.07, .085, .03, 3, .012), skin, .004, -.06, -.02);                      // palma, atrás do celular
    p(new THREE.CapsuleGeometry(.0095, .04, 4, 8), skin, -.04, -.035, -.001, -.35);                  // polegar na borda esquerda
    for (let k = 0; k < 4; k++) p(new THREE.CapsuleGeometry(.0082, .016, 4, 8), skin, .0385, .03 - k*.024, -.006, Math.PI/2 + .12);   // dedos na direita
    p(new THREE.CylinderGeometry(.045, .055, .22, 14), sleeve, .03, -.19, -.05, .35, .25);           // manga do moletom
  }
  // armário por dentro: a porta de metal colada no rosto, com sete frestas por onde se vê o corredor
  const lockerInCanvas = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#5b6570'; g.fillRect(0, 0, w, h);
    const n = 7, gap = h*.05, sh = h*.018, sw = w*.46, x0 = (w - sw)/2, y0 = h*.5 - (n - 1)*gap/2;
    for (let k = 0; k < n; k++){
      const y = y0 + k*gap;
      g.clearRect(x0, y - sh/2, sw, sh);                                      // fresta (transparente)
      g.fillStyle = 'rgba(230,240,255,.9)'; g.fillRect(x0, y + sh/2, sw, 3);   // borda de baixo pegando luz
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x0, y - sh/2 - 3, sw, 3);
    }
  });
  // por dentro só entra a luz que vaza pelas frestas: o metal fica num cinza-azulado bem fraco
  const lockerIn = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map:canvasTex(lockerInCanvas), alphaTest:.5, color:0x2a3138 }));
  lockerIn.position.z = -.12; vmScene.add(lockerIn);
  let screenKey = '';
  function drawScreen(){
    const out = P.out, f = Math.round(P.fuel), blink = Math.sin(G.t*5) > 0;
    const key = out ? 'out' + blink : f + '|' + P.light;
    if (key === screenKey) return;
    screenKey = key;
    const g = screenCanvas.getContext('2d'), w = 256, h = 540;
    g.clearRect(0, 0, w, h);
    if (out){
      g.fillStyle = '#030405'; g.fillRect(0, 0, w, h);
      if (blink){ g.strokeStyle = '#ff4a3a'; g.lineWidth = 6; g.strokeRect(w/2 - 44, h/2 - 20, 88, 40); g.fillStyle = '#ff4a3a'; g.fillRect(w/2 + 44, h/2 - 9, 8, 18); }
    } else {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1d2b3f'); gr.addColorStop(1, '#0e1522');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(230,238,248,.95)'; g.textAlign = 'center';
      g.font = '600 64px sans-serif'; g.fillText('03:13', w/2, h*.36);
      g.font = '22px sans-serif'; g.fillStyle = 'rgba(200,215,235,.75)'; g.fillText(P.light ? 'Lanterna ligada' : 'Lanterna desligada', w/2, h*.36 + 40);
      g.font = '20px sans-serif'; g.fillText('Sem serviço', w/2, h*.36 - 92);
      const bx = w - 70, by = 16;
      g.strokeStyle = 'rgba(230,238,248,.85)'; g.lineWidth = 2.5; g.strokeRect(bx, by, 44, 20);
      g.fillStyle = f < 10 ? '#ff4a3a' : f < 25 ? '#f0b43c' : '#5fd36a'; g.fillRect(bx + 3, by + 3, 38*f/100, 14);
      g.fillStyle = 'rgba(230,238,248,.85)'; g.textAlign = 'right'; g.font = '18px sans-serif'; g.fillText(f + '%', bx - 6, by + 17);
    }
    screenTex.needsUpdate = true;
  }

  /* ---------- pós-processamento ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const vmPass = new RenderPass(vmScene, vmCam);
  vmPass.clear = false; vmPass.clearDepth = true;    // por cima do mundo, sem nunca atravessar a parede
  composer.addPass(vmPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .45, .55, .92);
  if (Q.bloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // vinheta + granulado de filme + aberração cromática nas bordas; visão vermelha do João Vitão; pânico
  const grain = new ShaderPass({
    uniforms:{ tDiffuse:{ value:null }, uTime:{ value:0 }, uAmount:{ value:.06 }, uCA:{ value:.0025 }, uRed:{ value:0 }, uPanic:{ value:0 } },
    vertexShader:'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader:`
      uniform sampler2D tDiffuse; uniform float uTime, uAmount, uCA, uRed, uPanic; varying vec2 vUv;
      float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
      void main(){
        vec2 d = vUv - .5; float r2 = dot(d, d);
        vec2 off = d*uCA*(1. + 6.*r2);
        vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        float n = rnd(vUv*vec2(1213.1, 717.7) + fract(uTime*7.31)) - .5;
        c += n*uAmount*(1. - .5*dot(c, vec3(.333)));
        c = mix(c, c*vec3(1.25, .55, .5), uRed);                       // visão vermelha do João Vitão (versus)
        float v = smoothstep(.12, .62, r2*1.6);
        c *= 1. - .62*v;                                                // vinheta
        c = mix(c, vec3(.28, 0., 0.), v*uPanic);                        // bateria acabou / choque: bordas vermelhas
        gl_FragColor = vec4(c, 1.);
      }`
  });
  composer.addPass(grain);

  /* ---------- nível ---------- */
  const level = new THREE.Group(); scene.add(level);
  let built = null, items = [], doors = [], traps = [];
  const levelMats = [], levelTex = [];   // o que é só deste nível (as texturas de foto e dos desenhos ficam)

  function clearLevel(){
    level.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    level.clear();
    for (const m of levelMats) m.dispose();
    for (const t of levelTex) t.dispose();
    levelMats.length = levelTex.length = 0;
    items = []; doors = []; traps = [];
  }
  // geometria montada à mão: quads com UV em unidades do mundo (a textura repete sem emenda)
  class Geo {
    constructor(){ this.p = []; this.n = []; this.uv = []; }
    quad(a, b, c, d, n, ua, va, ub, vb){   // a,b,c,d: baixo-esq, baixo-dir, cima-dir, cima-esq vistos de frente
      for (const [v, u, w] of [[a, ua, va], [b, ub, va], [c, ub, vb], [a, ua, va], [c, ub, vb], [d, ua, vb]]){
        this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, w);
      }
    }
    mesh(mat, shadow = true){
      if (!this.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = shadow;
      level.add(m); return m;
    }
  }
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; level.add(m); return m; };
  // faces internas de um poço de 1 tile (buraco da escada, claraboia)
  function shaftWalls(g, tx, tz, y0, y1){
    for (let k = 0; k < 4; k++){
      const n = [-DX[k], 0, -DY[k]], r = [n[2], 0, -n[0]];
      const cx = tx + .5 + DX[k]*.5, cz = tz + .5 + DY[k]*.5;
      const lx = cx - r[0]*.5, lz = cz - r[2]*.5, rx = cx + r[0]*.5, rz = cz + r[2]*.5;
      g.quad([lx, y0, lz], [rx, y0, rz], [rx, y1, rz], [lx, y1, lz], n, 0, y0, 1, y1);
    }
  }

  function build(lv){
    clearLevel();
    built = lv;
    const W = lv.W, H = lv.H, map = lv.map, pal = lv.cfg.pal;
    const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || map[y*W + x] === T_WALL;
    const mat = m => { levelMats.push(m); return m; };
    const mWall = mat(pbrMat(TX_WALL, css(pal.wall))), mBand = mat(pbrMat(TX_WALL, css(pal.band)));
    const mFloor = mat(pbrMat(TX_FLOOR, css(pal.floor))), mRoom = mat(pbrMat(TX_FLOOR, css(pal.floor2)));
    const mCeil = mat(pbrMat(TX_CEIL, css(pal.top)));
    const mMetal = mat(pbrMat(TX_METAL, new THREE.Color(0xb8bec6), { metalness:.7, roughness:.5 }));
    // poça d'água com o fio desencapado: quase espelho, reflete a lanterna
    const mPuddle = mat(pbrMat(TX_FLOOR, css(pal.floor2).multiplyScalar(.45), { roughnessMap:null, roughness:.06, metalness:.1 }));
    const gWall = new Geo(), gBand = new Geo(), gLocker = new Geo(), gFloor = new Geo(), gRoom = new Geo(), gPuddle = new Geo(), gCeil = new Geo();
    const trapAt = new Set(lv.traps.map(t => t.y*W + t.x));

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const j = y*W + x, t = map[j];
      if (t === T_WALL){
        // só as faces que dão para um corredor
        for (let k = 0; k < 4; k++){
          if (isWall(x + DX[k], y + DY[k])) continue;
          const n = [DX[k], 0, DY[k]], r = [DY[k], 0, -DX[k]];   // normal e "direita" de quem olha a parede
          const cx = x + .5 + DX[k]*.5, cz = y + .5 + DY[k]*.5;
          const lx = cx - r[0]*.5, lz = cz - r[2]*.5, rx = cx + r[0]*.5, rz = cz + r[2]*.5;
          const u0 = lx*r[0] + lz*r[2];
          if (lv.lockerAt.has(j)) gLocker.quad([lx, 0, lz], [rx, 0, rz], [rx, WALL_H, rz], [lx, WALL_H, lz], n, 0, 0, 1, 1);
          else {
            gBand.quad([lx, 0, lz], [rx, 0, rz], [rx, BAND, rz], [lx, BAND, lz], n, u0, 0, u0 + 1, BAND);
            gWall.quad([lx, BAND, lz], [rx, BAND, rz], [rx, WALL_H, rz], [lx, WALL_H, lz], n, u0, BAND, u0 + 1, WALL_H);
          }
        }
        continue;
      }
      if (t !== T_EXIT){
        const g = trapAt.has(j) ? gPuddle : lv.roomMask[j] ? gRoom : gFloor;
        g.quad([x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], [0, 1, 0], x*2, -(y + 1)*2, (x + 1)*2, -y*2);
      }
      if (!(x === lv.start.x && y === lv.start.y))
        gCeil.quad([x, WALL_H, y], [x + 1, WALL_H, y], [x + 1, WALL_H, y + 1], [x, WALL_H, y + 1], [0, -1, 0], x, y, x + 1, y + 1);
    }
    gWall.mesh(mWall); gBand.mesh(mBand); gLocker.mesh(lockerMat);
    gFloor.mesh(mFloor, false); gRoom.mesh(mRoom, false); gPuddle.mesh(mPuddle, false); gCeil.mesh(mCeil, false);

    // escada descendo pelo buraco da saída: degraus rasos (dá para ver cada um de cima),
    // faixa antiderrapante amarela na quina, e uma luz quente lá embaixo
    if (lv.exit){
      const ex = lv.exit.x, ez = lv.exit.y;
      let e = [1, 0];
      for (let k = 0; k < 4; k++) if (!isWall(ex + DX[k], ez + DY[k])){ e = [DX[k], DY[k]]; break; }
      const pit = new Geo(); shaftWalls(pit, ex, ez, -1.6, 0); pit.mesh(mBand);
      const mStep = mat(pbrMat(TX_CEIL, css(pal.floor2).multiplyScalar(.8)));
      const mStrip = mat(pbrMat(TX_METAL, new THREE.Color(0xc9a227), { metalness:.3 }));
      const steps = 6, sd = 1/steps, rise = .14;
      for (let i = 0; i < steps; i++){
        const off = .5 - (i + .5)*sd, top = -i*rise;
        const w = e[0] ? sd : 1, d = e[0] ? 1 : sd;
        box(w, rise, d, mStep, ex + .5 + e[0]*off, top - rise/2, ez + .5 + e[1]*off).castShadow = false;
        const eo = off + sd/2 - .02;
        box(e[0] ? .04 : .98, .006, e[0] ? .98 : .04, mStrip, ex + .5 + e[0]*eo, top + .003, ez + .5 + e[1]*eo).castShadow = false;
      }
      const glow = new THREE.Sprite(glowMat(SPR.glowWarm, .7)); levelMats.push(glow.material);
      glow.scale.set(1.4, 1, 1); glow.position.set(ex + .5 - e[0]*.42, -.95, ez + .5 - e[1]*.42); level.add(glow);
    }

    // claraboia: buraco no teto com luz do dia, e a escada de alumínio
    {
      const sx = lv.start.x, sz = lv.start.y, hgt = .45, shaft = new Geo();
      shaftWalls(shaft, sx, sz, WALL_H, WALL_H + hgt); shaft.mesh(mCeil, false);
      const day = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(new THREE.MeshBasicMaterial({ color:0xe6eeff, fog:false })));
      day.rotation.x = Math.PI/2; day.position.set(sx + .5, WALL_H + hgt, sz + .5); level.add(day);
      sky.position.set(sx + .5, WALL_H + hgt - .02, sz + .5); sky.target.position.set(sx + .5, 0, sz + .5); sky.intensity = 7;
      const a = openDirAngleIn(lv, sx, sz), ox = sx + .5 - Math.cos(a)*.3, oz = sz + .5 - Math.sin(a)*.3, px = -Math.sin(a)*.17, pz = Math.cos(a)*.17;
      box(.03, WALL_H + .4, .03, mMetal, ox + px, (WALL_H + .4)/2, oz + pz);
      box(.03, WALL_H + .4, .03, mMetal, ox - px, (WALL_H + .4)/2, oz - pz);
      for (let s = .16; s < WALL_H + .3; s += .18) box(.02, .02, .36, mMetal, ox, s, oz).rotation.y = -a;
    }

    // portas: folha de madeira que desliza para dentro da parede, com uma luzinha por chave exigida
    const mDoor = mat(pbrMat(TX_WOOD, new THREE.Color(0xffffff)));
    for (const d of lv.doors){
      const alongX = d.axis === 'y';   // porta 'y' = passagem na vertical: a folha fica no plano z = centro, deslizando em x
      const leaf = new THREE.Group(); level.add(leaf);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1 : .07, WALL_H, alongX ? .07 : 1), mDoor);
      slab.position.y = WALL_H/2; slab.castShadow = slab.receiveShadow = true; leaf.add(slab);
      const lamps = [];
      for (let i = 0; i < d.req; i++){
        const off = (i - (d.req - 1)/2)*.09;
        for (const s of [-1, 1]){
          const lm = new THREE.Mesh(new THREE.SphereGeometry(.018, 8, 6), mat(new THREE.MeshBasicMaterial({ color:0xc01c14, toneMapped:false })));
          lm.position.set(alongX ? off : s*.04, .62, alongX ? s*.04 : off); leaf.add(lm); lamps.push({ m:lm, i });
        }
      }
      doors.push({ d, leaf, lamps, alongX, x:d.x + .5, z:d.y + .5 });
    }

    // itens: os mesmos desenhos do jogo, agora iluminados pela lanterna
    for (const it of lv.items){
      const s = it.type === 'page' ? (PAGES[it.page].kind === 'stone' ? SPR.stone : SPR.page) : SPR[it.type];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.ww, s.wh), litOf(s));
      m.castShadow = true; level.add(m);
      let glow = null;
      if (it.type === 'key' || it.type === 'page'){
        glow = new THREE.Sprite(glowMat(it.type === 'key' ? SPR.glowGold : PAGES[it.page].kind === 'stone' ? SPR.glowCold : SPR.glowWarm, .3));
        levelMats.push(glow.material); level.add(glow);
      }
      const z0 = it.type === 'key' ? .22 : it.type === 'page' ? (s === SPR.stone ? .02 : .15) : .02;
      items.push({ it, m, glow, s, z0 });
    }

    // faíscas do fio desencapado sobre a poça
    for (const t of lv.traps){
      const sp = new THREE.Sprite(glowMat(SPR.spikes.img, 1)); levelMats.push(sp.material);
      sp.scale.set(SPR.spikes.ww, SPR.spikes.wh, 1); sp.position.set(t.x + .5, SPR.spikes.wh/2, t.y + .5); level.add(sp);
      traps.push({ t, sp });
    }

    // sala 13: o círculo de giz no chão, a carteira com a fita em sete voltas, a mochila e o boné
    if (lv.seal){
      const ch0 = lv.chamber, size = SEAL_TILES;
      const decalTex = canvasTex(sealDecal()); levelTex.push(decalTex);
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(new THREE.MeshStandardMaterial({
        map:decalTex, transparent:true, depthWrite:false, roughness:.95, polygonOffset:true, polygonOffsetFactor:-2 })));
      decal.rotation.x = -Math.PI/2; decal.position.set(ch0.x0 + size/2, .002, ch0.y0 + size/2); decal.receiveShadow = true; level.add(decal);
      const wood = mat(pbrMat(TX_WOOD, new THREE.Color(0xd9b48a)));
      const dx = lv.seal.x + .5, dz = lv.seal.y + .5;
      box(.5, .03, .36, wood, dx, .36, dz);
      for (const [ox, oz] of [[-.22, -.15], [.22, -.15], [-.22, .15], [.22, .15]]) box(.025, .36, .025, mMetal, dx + ox, .18, dz + oz);
      const ribbon = mat(new THREE.MeshStandardMaterial({ color:0xb01418, roughness:.6 }));
      for (let k = 0; k < 7; k++){ const r = new THREE.Mesh(new THREE.TorusGeometry(.12 + k*.012, .006, 6, 24), ribbon); r.rotation.x = Math.PI/2; r.position.set(dx, .38 + k*.004, dz); level.add(r); }
      for (const [s, x, z] of [[SPR.bag, lv.seal.x - .6, lv.seal.y + 1.5], [SPR.cap, lv.seal.x + 1.6, lv.seal.y + 1.5]]){
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s.ww, s.wh), litOf(s)); m.position.set(x, s.wh/2, z); m.castShadow = true; level.add(m);
        items.push({ it:null, m, glow:null, s, z0:0 });
      }
    }

    for (const m of mates.values()) m.root.visible = false;
  }
  function openDirAngleIn(lv, tx, ty){
    for (let k = 0; k < 4; k++){ const x = tx + DX[k], y = ty + DY[k]; if (x >= 0 && y >= 0 && x < lv.W && y < lv.H && lv.map[y*lv.W + x] !== T_WALL) return Math.atan2(DY[k], DX[k]); }
    return 0;
  }

  /* ---------- passeio atrás do título: o maior corredor reto do Bloco A ---------- */
  let menu = null;
  function menuLevel(){
    if (menu) return menu;
    const lv = generateLevel(0, MENU_SEED);
    let run = null;
    for (const [dx, dy] of [[1, 0], [0, 1]]) for (let y = 1; y < lv.H - 1; y++) for (let x = 1; x < lv.W - 1; x++){
      if (lv.map[y*lv.W + x] === T_WALL) continue;
      let n = 0; while (lv.map[(y + dy*(n + 1))*lv.W + x + dx*(n + 1)] !== T_WALL && n < 12) n++;
      if (!run || n > run.n) run = { x, y, dx, dy, n };
    }
    return (menu = { lv, run, v:{ x:0, y:0, state:'hidden', alpha:0 } });
  }

  /* ---------- explorado (minimapa) e linha de visão ---------- */
  function dda(x0, y0, dx, dy, maxD, visit){
    let mx = x0 | 0, my = y0 | 0;
    const ddx = dx === 0 ? 1e30 : Math.abs(1/dx), ddy = dy === 0 ? 1e30 : Math.abs(1/dy);
    let sx, sy, tx, ty;
    if (dx < 0){ sx = -1; tx = (x0 - mx)*ddx; } else { sx = 1; tx = (mx + 1 - x0)*ddx; }
    if (dy < 0){ sy = -1; ty = (y0 - my)*ddy; } else { sy = 1; ty = (my + 1 - y0)*ddy; }
    for (let i = 0; i < 80; i++){
      const t = Math.min(tx, ty);
      if (t > maxD) return false;
      if (tx < ty){ tx += ddx; mx += sx; } else { ty += ddy; my += sy; }
      if (mx < 0 || my < 0 || mx >= L.W || my >= L.H) return true;
      if (visit(my*L.W + mx, t)) return true;
    }
    return false;
  }
  const blocks = j => L.map[j] === T_WALL || (L.map[j] === T_DOOR && !L.doorAt.get(j).open);
  function markExplored(){
    const R = lightRadius() + .6, half = FOV_DEG*Math.PI/360, ex = L.explored;
    ex[(P.y | 0)*L.W + (P.x | 0)] = 1;
    for (let i = 0; i < 48; i++){
      const a = P.a + (i/47*2 - 1)*half;
      dda(P.x, P.y, Math.cos(a), Math.sin(a), R, j => { ex[j] = 1; return blocks(j); });
    }
  }
  const lineOfSight = (x, y) => { const dx = x - P.x, dy = y - P.y, d = Math.hypot(dx, dy); return d < .1 || !dda(P.x, P.y, dx/d, dy/d, d - .05, blocks); };

  /* ---------- quadro ---------- */
  const tmpV = new THREE.Vector3();
  function resize(){
    const w = viewW(), h = viewH();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w/2, h/2);
    camera.aspect = vmCam.aspect = w/h;
    vmCam.updateProjectionMatrix();
    // a porta do armário cobre a tela toda, em qualquer formato de tela
    const ph = 2*Math.tan(vmCam.fov*Math.PI/360)*.12*1.15;
    lockerIn.scale.set(ph*Math.max(1, vmCam.aspect)*1.1, ph, 1);
  }

  function render(){
    const t = G.t, game = !!L;
    const m = game ? null : menuLevel();
    const lv = game ? L : m.lv;
    if (built !== lv) build(lv);
    const vill = game && isVillain();

    // de onde se olha: você no jogo, ou o passeio lento pelo corredor atrás dos menus
    let cx, cy, yaw, pitch, eye, lightOn, R, vil;
    if (game){
      const shake = G.shake > 0 ? G.shake : 0;
      cx = P.x; cy = P.y;
      yaw = P.a + (shake ? (Math.random() - .5)*shake*.05 : 0);
      pitch = clamp(P.pitch, -PITCH_MAX, PITCH_MAX) + (shake ? (Math.random() - .5)*shake*.04 : 0);
      eye = EYE + (P.moving ? Math.sin(P.walkT)*.018 : 0);
      if (P.emote && !P.hidden){
        // emote: a câmera sai do corpo e fica na frente do aluno, olhando para ele (o mouse gira em volta)
        const ca = Math.cos(P.a), sa = Math.sin(P.a);
        let d = 1.5;
        dda(P.x, P.y, ca, sa, 1.5, (j, t) => { if (blocks(j)){ d = t - .2; return true; } return false; });
        d = Math.max(.35, d);
        cx = P.x + ca*d; cy = P.y + sa*d;
        yaw = P.a + Math.PI; eye = EYE + .08;
        pitch = clamp(-.18 + P.pitch*.5, -.7, .5);
      }
      lightOn = !P.out && P.light && !P.hidden && !vill;
      R = lightRadius();
      vil = V;
    } else {
      const r = m.run, len = Math.max(1.5, r.n - 2.2), p = (t*.18) % len;
      cx = r.x + .5 + r.dx*(p + .2); cy = r.y + .5 + r.dy*(p + .2);
      yaw = Math.atan2(r.dy, r.dx) + Math.sin(t*.37)*.06;
      pitch = -.03 + Math.sin(t*.23)*.03;
      eye = EYE + Math.sin(t*1.9)*.006;
      lightOn = true; R = 6.2*(1 + G.flick) * (Math.random() < .004 ? .5 : 1);
      // no fundo do corredor, ele aparece e some
      const show = p > len*.3 && p < len*.92;
      Object.assign(m.v, { x:r.x + .5 + r.dx*(r.n - .1), y:r.y + .5 + r.dy*(r.n - .1), state:show ? 'chase' : 'hidden', alpha:show ? 1 : 0 });
      vil = m.v;
    }
    const hfov = FOV_DEG*Math.PI/180;
    camera.fov = Math.min(100, 2*Math.atan(Math.tan(hfov/2)/camera.aspect)*180/Math.PI);
    camera.updateProjectionMatrix();
    const fx = Math.cos(yaw)*Math.cos(pitch), fy = Math.sin(pitch), fz = Math.sin(yaw)*Math.cos(pitch);
    camera.position.set(cx, eye, cy);
    camera.lookAt(cx + fx, eye + fy, cy + fz);

    // lanterna: alcance e força seguem a bateria, a tremida e as quedas do jogo
    const rx = -Math.sin(yaw), rz = Math.cos(yaw);
    flash.position.set(cx + rx*.13 + fx*.05, eye - .13, cy + rz*.13 + fz*.05);
    flash.target.position.set(cx + fx*6, eye + fy*6, cy + fz*6);
    flash.intensity = lightOn ? .2*R*R : 0;
    flash.distance = R*2.2;
    spill.position.set(cx + fx*.2, eye - .1, cy + fz*.2);
    spill.intensity = vill ? 0 : game && P.hidden ? .18 : lightOn ? .25 : .45;   // no armário: a luz fraca do corredor que entra pelas frestas
    spill.color.set(lightOn ? 0xe8eeff : 0x9fb4ff);

    // João Vitão
    const vOn = vil.alpha > .05 && vil.state !== 'hidden';
    const pulse = .85 + .15*Math.sin(t*4.2);
    red.visible = vOn;
    if (vOn){
      red.position.set(vil.x, vill ? eye + .1 : .95, vil.y);
      red.intensity = vil.alpha*pulse*(vil.state === 'final' ? 5 : vill ? 3.5 : 6);
      red.distance = vill ? 11 : vil.state === 'final' ? 7 : 8;
    }
    // a foto pode chegar depois; até lá, o espectro de reserva (8 quadros)
    if (villainImgReady && !villainTexReady){ villainMat.map = canvasTex(villainSpriteRed); villainMat.needsUpdate = true; villainTexReady = true; }
    else if (!villainImgReady){
      const tx = specterTex[Math.floor(t*6) % 8], first = !villainMat.map;
      villainMat.map = tx; if (first) villainMat.needsUpdate = true;
    }
    const placeV = (m, a, x, y, alpha, ph) => {
      const iw = villainImgReady ? villainSprite.width : 128, ih = villainImgReady ? villainSprite.height : 176;
      const h = VILLAIN_SPRITE_HEIGHT, w = h*iw/ih, bob = Math.sin(t*1.6 + ph)*.07;
      m.visible = a.visible = true;
      m.scale.set(w, h, 1);
      m.position.set(x, .02 + bob + h/2, y);
      m.rotation.set(0, Math.atan2(cx - x, cy - y), 0);
      a.position.set(x, .6, y); a.scale.set(h*2.4, h*2.4, 1);
      a.material.opacity = alpha*(.4 + .25*(.6 + .4*Math.sin(t*2.3 + ph)));
    };
    const showV = vOn && !vill;
    villain.visible = aura.visible = false;
    if (showV) placeV(villain, aura, vil.x, vil.y, vil.alpha, 0);
    // infecção: cada colega infectado é mais um João Vitão; a luz vermelha fica no mais perto
    let ei = 0;
    if (game && MP.on && MP.mode === 'infect'){
      let rd = vOn ? Math.hypot(vil.x - cx, vil.y - cy) : 1e9;
      for (const o of MP.others.values()){
        if (!otherVisible(o) || !isVillainId(o.id)) continue;
        const e = extraVillain(ei++);
        placeV(e.m, e.a, o.x, o.y, 1, ei*1.7);
        const d = Math.hypot(o.x - cx, o.y - cy);
        if (!vill && d < rd){ rd = d; red.visible = true; red.position.set(o.x, .95, o.y); red.intensity = pulse*6; red.distance = 8; }
      }
    }
    for (let k = ei; k < extraV.length; k++) extraV[k].m.visible = extraV[k].a.visible = false;

    // portas, itens e faíscas
    for (const o of doors){
      const a = o.d.anim;
      o.leaf.visible = a < .999;
      o.leaf.position.set(o.x + (o.alongX ? a : 0), 0, o.z + (o.alongX ? 0 : a));
      const keysHave = game ? G.keys : 0;
      for (const l of o.lamps) l.m.material.color.set(keysHave > l.i ? 0xffc850 : 0xc01c14);
    }
    for (const o of items){
      if (o.it && o.it.taken){ o.m.visible = false; if (o.glow) o.glow.visible = false; continue; }
      const x = o.it ? o.it.x + .5 : o.m.position.x, z = o.it ? o.it.y + .5 : o.m.position.z;
      const bob = o.it ? Math.sin(t*2.2 + o.it.bob)*.03 : 0;
      o.m.visible = true;
      o.m.position.set(x, o.z0 + bob + o.s.wh/2, z);
      o.m.rotation.y = Math.atan2(cx - x, cy - z);
      if (o.glow){ o.glow.visible = true; o.glow.position.set(x, o.z0 + bob + .1, z); o.glow.scale.set(.6, .6, 1); o.glow.material.opacity = .25 + .12*Math.sin(t*3 + o.it.bob); }
    }
    for (const o of traps){
      const ph = (t + o.t.phase) % TRAP_PERIOD, on = ph > TRAP_UP;
      o.sp.visible = on;
      if (on){ const k = Math.min(1, (ph - TRAP_UP)/.07); o.sp.material.opacity = .6 + .4*Math.random(); o.sp.position.y = SPR.spikes.wh*(k - .5); }
    }
    // partículas (no menu não há fumaça: o João Vitão do passeio é só a luz e a foto)
    let pi = 0;
    if (game) for (const p of parts){
      if (pi >= partPool.length) break;
      const s = partPool[pi++], a = p.life/p.max;
      s.visible = true; s.position.set(p.x, p.z, p.y);
      const want = p.type === 'smoke' ? texOf(SPR.glowRed) : texOf(SPR.glowGold);
      if (s.material.map !== want){ s.material.map = want; s.material.needsUpdate = true; }
      if (p.type === 'smoke'){ const sz = p.size*(1 + (1 - a))*1.3; s.scale.set(sz, sz, 1); s.material.opacity = a*.22*V.alpha; }
      else { s.scale.set(p.size*2, p.size*2, 1); s.material.opacity = a; }
    }
    for (; pi < partPool.length; pi++) partPool[pi].visible = false;

    // outros alunos (online)
    nameTags.length = 0;
    let li = 0;
    const seen = new Set();
    if (game && MP.on) for (const o of MP.others.values()){
      if (!otherVisible(o) || isVillainId(o.id)) continue;
      seen.add(o.id);
      let mm = mates.get(o.id);
      if (!mm || mm.ci !== o.color){ if (mm) scene.remove(mm.root); mm = makeMate(o.color); mates.set(o.id, mm); }
      mm.root.visible = true;
      mm.root.position.set(o.x, 0, o.y);
      mm.root.rotation.y = -o.a;
      poseMate(mm, o.f & F_MOVING && !o.em ? Math.sin(o.walkT*.62) : 0, o.em, o.emT);
      if (li < MAX_MATES && o.f & F_LIGHT){
        const L2 = mateLights[li++], ca = Math.cos(o.a), sa = Math.sin(o.a);
        L2.position.set(o.x + ca*.16 - sa*.1, .44, o.y + sa*.16 + ca*.1);
        L2.target.position.set(o.x + ca*5, .3, o.y + sa*5);
        L2.intensity = 12;
      }
      // nome em cima (o João Vitão do versus não vê nomes: eles entregariam quem está no escuro)
      const d = Math.hypot(o.x - P.x, o.y - P.y);
      if (!vill && d < 9 && lineOfSight(o.x, o.y)){
        tmpV.set(o.x, MATE_H + .04, o.y).project(camera);
        if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.1) nameTags.push({ name:o.name, x:(tmpV.x*.5 + .5)*cw, y:(-tmpV.y*.5 + .5)*ch, a:clamp(1.3 - d/9, .25, 1), color:o.color });
      }
    }
    for (; li < MAX_MATES; li++) mateLights[li].intensity = 0;
    // você mesmo, dançando (só aparece com a câmera do emote)
    if (game && P.emote && !P.hidden && !vill){
      const me = MP.on ? MP.players.find(p => p.id === MP.id) : null, ci = me ? me.color : 0;
      let mm = mates.get('__me');
      if (!mm || mm.ci !== ci){ if (mm) scene.remove(mm.root); mm = makeMate(ci); mates.set('__me', mm); }
      seen.add('__me');
      mm.root.visible = true;
      mm.root.position.set(P.x, 0, P.y);
      mm.root.rotation.y = -P.emoteA;
      poseMate(mm, 0, P.emote, P.emoteT);
    }
    for (const [id, mm] of mates) if (!seen.has(id)) mm.root.visible = false;

    // celular na mão (balança ao andar) ou a porta do armário por dentro
    const hidden = game && !!P.hidden && G.state === 'play';
    hand.visible = game && !hidden && !vill && !P.emote && G.state !== 'final';
    lockerIn.visible = hidden;
    if (hand.visible){
      drawScreen();
      const k = clamp(vmCam.aspect/1.78, .62, 1.15);
      const bx = P.moving ? Math.cos(P.walkT*.5)*.006 : 0, by = P.moving ? Math.abs(Math.sin(P.walkT*.5))*.007 : 0;
      hand.position.set(.145*k + bx + Math.sin(t*1.3)*.002, -.1 + by, -.35);
      hand.rotation.set(-.16, -.3, .07);
      const lit = !P.out && P.light;
      ledGlow.visible = ledHalo.visible = lit;
      ledHalo.material.opacity = (G.dip > 0 ? .2 : .35)*(.96 + .04*Math.sin(t*37));
      vmScreenLight.position.set(hand.position.x - .01, hand.position.y + .01, hand.position.z + .06);
      vmScreenLight.intensity = P.out ? 0 : .12;
      vmFlash.intensity = lit ? .1 : 0;
      const nv = nearestVillain(P.x, P.y);
      vmRed.intensity = nv ? Math.max(0, 1 - nv.d/7)*2.2*pulse : 0;
    }

    // olho se acostumando: com a lanterna encostada numa parede a imagem não estoura; no escuro, abre de novo
    let near = 8;
    if (game && lightOn){
      dda(cx, cy, Math.cos(yaw), Math.sin(yaw), 8, (j, d) => { if (blocks(j)){ near = d; return true; } return false; });
      // um colega bem na frente da lanterna também conta
      if (MP.on) for (const o of MP.others.values()){
        if (!otherVisible(o)) continue;
        const dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
        if (d < near && (dx*Math.cos(yaw) + dy*Math.sin(yaw))/d > .9) near = d;
      }
    }
    const expo = clamp(Math.pow(near/1.6, .7), .38, 1)*1.15;
    renderer.toneMappingExposure += (expo - renderer.toneMappingExposure)*Math.min(1, .08);

    if (game) markExplored();
    grain.uniforms.uTime.value = t;
    grain.uniforms.uRed.value = vill ? .55 : 0;
    grain.uniforms.uPanic.value = !game ? 0 : P.invT > .9 ? .55 : P.out && G.state === 'play' ? .25 + .12*Math.sin(t*6) : 0;
    composer.render();
  }

  resize();
  return { render, resize };
}
