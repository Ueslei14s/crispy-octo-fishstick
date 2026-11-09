'use strict';
const $ = id => document.getElementById(id);
const st = {
  img: null, nome: 'peca', produto: 'medalha', formato: 'contorno', cores: 4, tol: 60, pedestal: 'ret2',
  an: null, corUser: {}, peca: null, objetos: null,
};

// ---------------------------------------------------------------- imagem
$('bFoto').onclick = () => $('inFoto').click();
$('inFoto').onchange = e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  st.nome = (f.name || 'peca').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'peca';
  abrirUrl(URL.createObjectURL(f));
  e.target.value = '';
};
// chamada pelo Android quando a imagem chega por "Compartilhar"
window.abrirImagemDataUrl = (url, nome) => { if (nome) st.nome = nome.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_'); abrirUrl(url); };

function abrirUrl(url) {
  const img = new Image();
  img.onload = () => {
    st.img = img; st.corUser = {};
    $('imgOrig').src = url; $('semImg').style.display = 'none';
    analisar();
  };
  img.onerror = () => msg('Não consegui abrir essa imagem.', 'err');
  img.src = url;
}

function analisar() {
  if (!st.img) return;
  st.an = Motor.analisar(st.img, { tolerancia: st.tol, cores: st.cores });
  st.corUser = {};
  desenharCores();
  listarCores();
  $('bGerar').disabled = false;
  limpar3D();
}

function corDe(i) { return st.corUser[i] || st.an.grupos.centros[i]; }

function desenharCores() {
  const { im, sil, grupos } = st.an, cv = $('cvCores');
  cv.width = im.W; cv.height = im.H;
  const ctx = cv.getContext('2d'), d = ctx.createImageData(im.W, im.H);
  for (let i = 0; i < im.W * im.H; i++) {
    const r = grupos.rotulos[i];
    const c = sil[i] && r >= 0 ? corDe(r) : [40, 44, 52];
    d.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  ctx.putImageData(d, 0, 0);
}

function ordemCores() {
  const { grupos } = st.an;
  const idx = grupos.centros.map((_, i) => i).filter(i => i !== st.an.base && grupos.contagem[i] > 0);
  idx.sort((a, b) => grupos.contagem[b] - grupos.contagem[a]);
  return [st.an.base, ...idx];
}

function listarCores() {
  const box = $('listaCores'); box.innerHTML = '';
  const tot = st.an.grupos.contagem.reduce((a, b) => a + b, 0);
  ordemCores().forEach((ci, pos) => {
    const el = document.createElement('div'); el.className = 'cor';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = Motor.hex(corDe(ci)).toLowerCase();
    inp.oninput = () => { st.corUser[ci] = [1, 3, 5].map(k => parseInt(inp.value.substr(k, 2), 16)); desenharCores(); recolorir(); };
    const n = document.createElement('div'); n.className = 'n';
    n.textContent = `Filamento ${pos + 1} · ${Math.round(100 * st.an.grupos.contagem[ci] / tot)}% da peça`;
    const tag = document.createElement('span'); tag.className = 'tag' + (pos === 0 ? ' base' : ''); tag.textContent = pos === 0 ? 'base' : 'relevo';
    el.append(inp, n, tag);
    if (pos > 0) {
      const b = document.createElement('button'); b.textContent = 'Usar como base';
      b.onclick = () => { st.an.base = ci; listarCores(); limpar3D(); };
      el.append(b);
    }
    box.append(el);
  });
}

// ---------------------------------------------------------------- opções
function segmento(id, fn) {
  $(id).querySelectorAll('button').forEach(b => b.onclick = () => {
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}
segmento('segProd', v => {
  st.produto = v;
  const P = Motor.PRODUTOS[v];
  $('nLarg').value = P.largura; $('nBase').value = P.base; $('nRelevo').value = P.relevo;
  $('boxPed').hidden = v !== 'trofeu';
  marcarEsp();
  limpar3D();
});
$('selForma').onchange = () => { st.formato = $('selForma').value; limpar3D(); };
segmento('segEsp', v => { $('nBase').value = v; limpar3D(); });
function marcarEsp() { $('segEsp').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === +$('nBase').value)); }

// pedestais: miniatura vista de lado (níveis empilhados)
(function montarPedestais() {
  const g = $('gradePed');
  Object.entries(Motor.Pedestais.lista).forEach(([id, def]) => {
    const b = document.createElement('button'); b.dataset.v = id; if (id === st.pedestal) b.className = 'on';
    const cv = document.createElement('canvas'); cv.width = 144; cv.height = 96;
    const ped = Motor.Pedestais.construir(id, 100, 22, 4);
    const ctx = cv.getContext('2d');
    let x0 = Infinity, x1 = -Infinity, zt = 0;
    ped.niveis.forEach(n => n.paths.forEach(r => r.forEach(q => { x0 = Math.min(x0, q.X / 1000); x1 = Math.max(x1, q.X / 1000); })) || (zt = Math.max(zt, n.z1)));
    ped.niveis.forEach(n => { zt = Math.max(zt, n.z1); });
    const k = Math.min(130 / (x1 - x0), 60 / zt), cx = 72, base = 88;
    ctx.fillStyle = '#ffc531'; ctx.fillRect(cx - 11 * k, base - zt * k - 30, 22 * k, 30);
    ped.niveis.forEach(n => {
      let a = Infinity, z = -Infinity; n.paths.forEach(r => r.forEach(q => { a = Math.min(a, q.X / 1000); z = Math.max(z, q.X / 1000); }));
      const e = n.escala || 1;
      ctx.fillStyle = '#d9dee6';
      ctx.beginPath();
      ctx.moveTo(cx + a * k, base - n.z0 * k); ctx.lineTo(cx + z * k, base - n.z0 * k);
      ctx.lineTo(cx + z * e * k, base - n.z1 * k); ctx.lineTo(cx + a * e * k, base - n.z1 * k); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#111317'; ctx.lineWidth = 1; ctx.stroke();
    });
    const t = document.createElement('span'); t.textContent = def.nome;
    b.append(cv, t);
    b.onclick = () => { st.pedestal = id; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); limpar3D(); if (st.an) $('bGerar').click(); };
    g.append(b);
  });
})();

// ---------------------------------------------------------------- otimizador
const TIPOS = Object.keys(PERFIS_U1.filamentos);
(function montarFilamentos() {
  for (let i = 0; i < 4; i++) {
    const l = document.createElement('label'); l.className = 'f'; l.textContent = 'Filamento ' + (i + 1);
    const sel = document.createElement('select'); sel.id = 'fil' + i;
    TIPOS.forEach(t => { const o = document.createElement('option'); o.value = o.textContent = t; sel.append(o); });
    l.append(sel); $('listaFil').append(l);
  }
})();
const RECOMENDADO = { selQual: '0.12', selFerro: 'top', nFerroFluxo: 12, nFerroEsp: 0.12, nFerroVel: 30, nParedes: 3, nTopo: 5, nInfill: 20 };
function aplicarRecomendado() { for (const [k, v] of Object.entries(RECOMENDADO)) $(k).value = v; $('selFerro').onchange(); }
$('selFerro').onchange = () => { $('boxFerro').style.opacity = $('selFerro').value === 'no ironing' ? .4 : 1; };
$('bRecom').onclick = () => { aplicarRecomendado(); msg('Configuração recomendada aplicada: camada 0,12 mm, passar ferro em todas as superfícies de cima, 3 paredes.', 'ok'); };
aplicarRecomendado();
function ajustesImpressao() {
  const a = {
    wall_loops: +$('nParedes').value, top_shell_layers: +$('nTopo').value,
    sparse_infill_density: $('nInfill').value + '%', ironing_type: $('selFerro').value,
  };
  if ($('selFerro').value !== 'no ironing') {
    a.ironing_flow = $('nFerroFluxo').value + '%'; a.ironing_spacing = $('nFerroEsp').value; a.ironing_speed = $('nFerroVel').value;
  }
  return a;
}
segmento('segCores', v => { st.cores = +v; analisar(); });
$('rTol').oninput = () => { $('tolTxt').textContent = $('rTol').value; };
$('rTol').onchange = () => { st.tol = +$('rTol').value; analisar(); };
['nLarg', 'nBase', 'nRelevo'].forEach(id => $(id).onchange = () => { marcarEsp(); limpar3D(); });

// ---------------------------------------------------------------- 3D
function criarVisor(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6); sol.position.set(60, -80, 160); scene.add(sol);
  const grupo = new THREE.Group(); scene.add(grupo);
  let rx = -0.55, rz = 0.0, dist = 200;
  function tam() {
    const w = cv.clientWidth || 300;
    renderer.setSize(w, w, false); cam.aspect = 1; cam.updateProjectionMatrix();
  }
  function desenhar() {
    grupo.rotation.set(rx, 0, rz);
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
  }
  // gestos: arrastar gira, pinça/roda aproxima
  const toques = new Map(); let pinca = 0;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]); });
  cv.addEventListener('pointerup', e => { toques.delete(e.pointerId); pinca = 0; });
  cv.addEventListener('pointercancel', e => { toques.delete(e.pointerId); pinca = 0; });
  cv.addEventListener('pointermove', e => {
    if (!toques.has(e.pointerId)) return;
    const [x0, y0] = toques.get(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]);
    if (toques.size === 1) { rz += (e.clientX - x0) * 0.01; rx += (e.clientY - y0) * 0.01; }
    else if (toques.size === 2) {
      const [a, b] = [...toques.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinca) dist = Math.min(1500, Math.max(30, dist * pinca / d));
      pinca = d;
    }
    desenhar();
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(1500, Math.max(30, dist * (1 + e.deltaY * 0.001))); desenhar(); }, { passive: false });
  window.addEventListener('resize', () => { tam(); desenhar(); });
  tam(); desenhar();
  const redesenhar = () => { tam(); desenhar(); };
  return {
    mostrar(objetos) {
      grupo.clear();
      let raio = 10;
      objetos.forEach(ob => ob.partes.forEach(p => {
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(p.malha.pos);
        for (let i = 0; i < pos.length; i += 3) { pos[i] += ob.desloc[0]; pos[i + 1] += ob.desloc[1]; }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(p.malha.idx);
        const ng = g.toNonIndexed(); ng.computeVertexNormals();
        const c = p.cor;
        const m = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255), roughness: 0.55, metalness: 0.05 }));
        m.userData.parte = p;
        grupo.add(m);
        g.computeBoundingSphere(); raio = Math.max(raio, g.boundingSphere.radius + Math.hypot(...ob.desloc));
      }));
      dist = raio * 4; rx = -0.55; rz = 0;
      desenhar();
    },
    recolorir() {
      grupo.children.forEach(m => { const c = m.userData.parte.cor; m.material.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); });
      desenhar();
    },
    limpar() { grupo.clear(); desenhar(); },
    redesenhar,
  };
}
const R = criarVisor($('view'));

function coresPeca() {
  // [base, depois cada camada na ordem de st.peca.camadas]
  return [corDe(st.an.base), ...st.peca.camadas.map(c => corDe(c.indice))];
}
function recolorir() {
  if (!st.objetos) return;
  const cores = coresPeca();
  st.objetos.forEach((ob, k) => ob.partes.forEach(p => { p.cor = cores[p.filamento - 1] || cores[0]; }));
  R.recolorir();
}
function limpar3D() {
  st.peca = null; st.objetos = null;
  $('b3mf').disabled = $('bStl').disabled = $('bOrca').disabled = $('bFatiar').disabled = true;
  limparFatia(); $('info').textContent = '';
  R.limpar();
}

$('bGerar').onclick = () => {
  if (!st.an) return;
  msg('Gerando…');
  setTimeout(() => {
    try {
      const t0 = performance.now();
      st.peca = Motor.montar(st.an, {
        produto: st.produto, formato: st.formato, pedestal: st.pedestal,
        largura: +$('nLarg').value, base: +$('nBase').value, relevo: +$('nRelevo').value,
      });
      st.objetos = Motor.gerar3D(st.peca, coresPeca());
      R.mostrar(st.objetos);
      let tri = 0; st.objetos.forEach(o => o.partes.forEach(p => { tri += p.malha.idx.length / 3; }));
      const P = st.peca;
      $('info').textContent = `${Motor.PRODUTOS[P.produto].nome}: ${P.largura.toFixed(1)} × ${P.altura.toFixed(1)} mm · ` +
        `${(P.espessura + P.relevo).toFixed(1)} mm de espessura · ${P.camadas.length + 1} cores` +
        (P.extras.trofeu ? ` · pedestal ${P.extras.trofeu.pedestal.nome}, encaixe de ${P.extras.trofeu.pedestal.profundidade} mm` : '') + ` · ${Math.round(tri / 1000)} mil triângulos`;
      $('b3mf').disabled = $('bStl').disabled = $('bOrca').disabled = $('bFatiar').disabled = false;
      msg(`Pronto em ${((performance.now() - t0) / 1000).toFixed(1)} s. Arraste para girar e use dois dedos para aproximar.`, 'ok');
    } catch (e) {
      console.error(e);
      msg('Não consegui gerar a peça: ' + e.message, 'err');
    }
  }, 30);
};

// ---------------------------------------------------------------- salvar
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function salvar(nome, mime, bytes) {
  if (window.Android && Android.saveFile) { Android.saveFile(nome, mime, b64(bytes)); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = nome; a.click();
  msg('Arquivo gerado: ' + nome, 'ok');
}
window.onSaved = (ok, texto) => msg(texto, ok ? 'ok' : 'err');
const nomeArq = ext => `${st.nome}_${st.produto}.${ext}`;
$('b3mf').onclick = async () => {
  msg('Montando o 3MF…');
  try { salvar(nomeArq('3mf'), 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', await Motor.exportar3MF(st.objetos, st.nome)); }
  catch (e) { msg('Erro ao gerar o 3MF: ' + e.message, 'err'); }
};
$('bStl').onclick = async () => {
  try { salvar(`${st.nome}_${st.produto}_STLs_por_cor.zip`, 'application/zip', await Motor.exportarSTLs(st.objetos, coresHex())); }
  catch (e) { msg('Erro ao gerar os STLs: ' + e.message, 'err'); }
};
const PADRAO = ['#111111', '#E3001B', '#FFD400', '#FFFFFF'];
function coresHex() {
  const c = coresPeca().map(Motor.hex);
  for (let i = c.length; i < 4; i++) c.push(PADRAO[i]);
  return c;
}
$('bOrca').onclick = async () => {
  msg('Montando o projeto do Snapmaker Orca…');
  try {
    const bytes = await Motor.exportarOrca(st.objetos, st.nome, {
      qualidade: $('selQual').value,
      filamentos: [0, 1, 2, 3].map(i => $('fil' + i).value),
      cores: coresHex(),
      ajustes: ajustesImpressao(),
    });
    salvar(`${st.nome}_${st.produto}_U1.3mf`, 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', bytes);
  } catch (e) { console.error(e); msg('Erro ao gerar o projeto: ' + e.message, 'err'); }
};

// ---------------------------------------------------------------- fatiar e imprimir
st.fatia = null;
function limparFatia() {
  st.fatia = null; st.gcode = null;
  $('bGcode').disabled = $('bEnviar').disabled = true; $('boxPrev').hidden = true; $('resumoFat').textContent = '';
}
try { $('ipU1').value = localStorage.getItem('ipU1') || ''; } catch (e) {}
$('ipU1').onchange = () => { try { localStorage.setItem('ipU1', $('ipU1').value.trim()); } catch (e) {} };

function opcoesFatia() {
  const PF = PERFIS_U1, fil = [0, 1, 2, 3].map(i => PF.filamentos[$('fil' + i).value] || PF.filamentos.PLA);
  const temps = fil.map(f => +f.cfg.nozzle_temperature[0]);
  // PLA: 65 °C, como na impressão real que deu certo na U1; outros materiais: perfil oficial
  const mesa = Math.max(...fil.map(f => /^PLA/.test(f.cfg.filament_type[0]) ? 65 : +(f.cfg.textured_plate_temp || ['65'])[0]));
  const vitr = Math.min(...fil.map(f => +(f.cfg.temperature_vitrification || ['45'])[0]));
  const h = +$('selQual').value;
  return {
    h, h0: h <= 0.12 ? 0.2 : 0.25, paredes: +$('nParedes').value, topo: +$('nTopo').value, fundo: 3,
    infill: +$('nInfill').value / 100, ferro: $('selFerro').value, ferroFluxo: +$('nFerroFluxo').value / 100,
    ferroEsp: +$('nFerroEsp').value, ferroVel: +$('nFerroVel').value, temps, mesa, vitrificacao: vitr,
    tipos: fil.map(f => f.cfg.filament_type[0]), cores: coresHex(),
  };
}
function miniatura(lado) {
  const cv = document.createElement('canvas'); cv.width = cv.height = lado;
  const ctx = cv.getContext('2d');
  const P = st.peca, k = lado * 0.9 / Math.max(P.largura, P.altura), m = lado / 2;
  const desenha = (paths, cor) => {
    ctx.beginPath();
    for (const r of paths) r.forEach((q, i) => { const x = m + q.X / 1000 * k, y = m - q.Y / 1000 * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fillStyle = cor; ctx.fill('nonzero');
  };
  const cores = coresHex();
  desenha(P.contorno, cores[0]);
  P.camadas.forEach((c, i) => desenha(c.paths, cores[i + 1]));
  return { w: lado, h: lado, b64: cv.toDataURL('image/png').split(',')[1] };
}
$('bFatiar').onclick = () => {
  msg('Fatiando…'); $('bFatiar').disabled = true;
  setTimeout(() => {
    try {
      const t0 = performance.now(), o = opcoesFatia();
      const r = Fatiador.fatiar(st.peca, st.objetos, o);
      const cfg = {
        layer_height: o.h, initial_layer_print_height: o.h0, wall_loops: o.paredes, top_shell_layers: o.topo,
        sparse_infill_density: Math.round(o.infill * 100) + '%', ironing_type: o.ferro, ironing_flow: Math.round(o.ferroFluxo * 100) + '%',
        ironing_spacing: o.ferroEsp, ironing_speed: `${o.ferroVel},${o.ferroVel}`, filament_colour: o.cores.join(';'),
        filament_type: o.tipos.join(';'), nozzle_temperature: o.temps.join(','), nozzle_temperature_initial_layer: o.temps.join(','),
        textured_plate_temp: Array(4).fill(o.mesa).join(','), textured_plate_temp_initial_layer: Array(4).fill(o.mesa).join(','),
        hot_plate_temp: Array(4).fill(o.mesa).join(','), hot_plate_temp_initial_layer: Array(4).fill(o.mesa).join(','),
      };
      st.gcode = Fatiador.montarArquivo(r, [miniatura(48), miniatura(300)], cfg);
      st.fatia = r;
      const g = r.uso.gr.reduce((a, b) => a + b, 0);
      $('resumoFat').textContent = `${r.camadas.length} camadas · ${Fatiador.hms(r.tempoTotal)} (estimativa) · ${g.toFixed(1)} g de filamento · ` +
        `${r.trocas} trocas de cabeça · G-code de ${(st.gcode.length / 1048576).toFixed(1)} MB · fatiado em ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      $('rCamada').max = r.camadas.length; $('rCamada').value = r.camadas.length;
      $('boxPrev').hidden = false; desenharCamada();
      $('bGcode').disabled = $('bEnviar').disabled = false;
      msg('Fatiado. Confira as camadas abaixo antes de imprimir.', 'ok');
    } catch (e) { console.error(e); msg('Erro ao fatiar: ' + e.message, 'err'); }
    $('bFatiar').disabled = false;
  }, 30);
};
const COR_TIPO = { 'Ironing': '#3aa0ff', 'Prime tower': '#7a828c' };
function desenharCamada() {
  const r = st.fatia; if (!r) return;
  const l = +$('rCamada').value - 1, c = r.camadas[l];
  $('txtCamada').textContent = `${l + 1} de ${r.camadas.length} · Z ${c.z.toFixed(2)} mm · altura ${c.h.toFixed(2)} mm`;
  const cv = $('cvCamada'), lado = cv.clientWidth * 2 || 600; cv.width = cv.height = lado;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#c8ced6'; ctx.fillRect(0, 0, lado, lado);
  // enquadra peças + torre
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  r.prev.forEach(cam => cam.forEach(t => t.pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); })));
  const k = lado * 0.94 / Math.max(x1 - x0, y1 - y0), ox = (lado - (x1 - x0) * k) / 2, oy = (lado - (y1 - y0) * k) / 2;
  const cores = coresHex();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const t of r.prev[l]) {
    ctx.strokeStyle = COR_TIPO[t.tipo] || cores[t.f - 1];
    ctx.lineWidth = Math.max(1, 0.42 * k * (t.tipo === 'Ironing' ? 0.35 : 0.9));
    ctx.beginPath();
    t.pts.forEach(([x, y], i) => { const px = ox + (x - x0) * k, py = lado - (oy + (y - y0) * k); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  }
}
$('rCamada').oninput = desenharCamada;
const nomeG = () => `${st.nome}_${st.produto}_U1.gcode`;
$('bGcode').onclick = () => salvar(nomeG(), 'text/x-gcode', new TextEncoder().encode(st.gcode));
$('bEnviar').onclick = () => {
  const ip = $('ipU1').value.trim();
  if (!ip) { msgEnvio('Digite o IP da impressora (aparece na tela da U1, em Configurações → Wi-Fi).', 'err'); return; }
  try { localStorage.setItem('ipU1', ip); } catch (e) {}
  if (!(window.Android && Android.enviarGcode)) { msgEnvio('O envio só funciona dentro do app no celular.', 'err'); return; }
  $('bEnviar').disabled = true; $('barEnvio').style.width = '0';
  msgEnvio('Enviando para a impressora…');
  Android.enviarGcode(ip, nomeG(), b64(new TextEncoder().encode(st.gcode)), false);
};
window.onEnvioProgresso = p => { $('barEnvio').style.width = p + '%'; msgEnvio('Enviando… ' + p + '%'); };
window.onEnvioFim = async (status, texto) => {
  $('bEnviar').disabled = false;
  if (status === 200 || status === 201) {
    $('barEnvio').style.width = '100%'; msgEnvio('Arquivo na impressora. Iniciando…');
    window.iniciarImpressao($('ipU1').value.trim(), nomeG()).then(r => r.status === 200
      ? msgEnvio('Impressão iniciada! Acompanhe a primeira camada.', 'ok')
      : msgEnvio('Enviado, mas a impressora não iniciou (erro ' + r.status + '). Inicie pela tela da U1.', 'err'));
  }
  else if (status === 0) msgEnvio('Sem resposta da impressora. Confira o IP e se o celular está no mesmo Wi-Fi.\n' + texto, 'err');
  else if (status === 401 || status === 403) msgEnvio('A impressora recusou a conexão (erro ' + status + ').', 'err');
  else msgEnvio('Erro ' + status + ': ' + texto.slice(0, 200), 'err');
};
function msgEnvio(t, cls) { $('msgEnvio').textContent = t; $('msgEnvio').className = 'msg ' + (cls || ''); }

function msg(t, cls) { $('msg').textContent = t; $('msg').className = 'msg ' + (cls || ''); }

// abas
segmento('abas', v => {
  $('abaCriar').hidden = v !== 'criar'; $('abaFatiar').hidden = v !== 'fatiar';
  window.scrollTo(0, 0);
  if (v === 'fatiar' && window.R2) R2.redesenhar();
});
