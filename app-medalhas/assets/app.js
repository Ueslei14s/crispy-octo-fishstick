'use strict';
const $ = id => document.getElementById(id);
const st = {
  img: null, nome: 'peca', produto: 'medalha', formato: 'contorno', cores: 4, tol: 60,
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
  limpar3D();
});
segmento('segForma', v => { st.formato = v; limpar3D(); });
segmento('segCores', v => { st.cores = +v; analisar(); });
$('rTol').oninput = () => { $('tolTxt').textContent = $('rTol').value; };
$('rTol').onchange = () => { st.tol = +$('rTol').value; analisar(); };
['nLarg', 'nBase', 'nRelevo'].forEach(id => $(id).onchange = limpar3D);

// ---------------------------------------------------------------- 3D
const R = (() => {
  const cv = $('view');
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
      dist = raio * 3.2; rx = -0.55; rz = 0;
      desenhar();
    },
    recolorir() {
      grupo.children.forEach(m => { const c = m.userData.parte.cor; m.material.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); });
      desenhar();
    },
    limpar() { grupo.clear(); desenhar(); },
  };
})();

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
  $('b3mf').disabled = $('bStl').disabled = true; $('info').textContent = '';
  R.limpar();
}

$('bGerar').onclick = () => {
  if (!st.an) return;
  msg('Gerando…');
  setTimeout(() => {
    try {
      const t0 = performance.now();
      st.peca = Motor.montar(st.an, {
        produto: st.produto, formato: st.formato,
        largura: +$('nLarg').value, base: +$('nBase').value, relevo: +$('nRelevo').value,
      });
      st.objetos = Motor.gerar3D(st.peca, coresPeca());
      R.mostrar(st.objetos);
      let tri = 0; st.objetos.forEach(o => o.partes.forEach(p => { tri += p.malha.idx.length / 3; }));
      const P = st.peca;
      $('info').textContent = `${Motor.PRODUTOS[P.produto].nome}: ${P.largura.toFixed(1)} × ${P.altura.toFixed(1)} mm · ` +
        `${(P.espessura + P.relevo).toFixed(1)} mm de espessura · ${P.camadas.length + 1} cores` +
        (P.extras.trofeu ? ' · placa + base de encaixe' : '') + ` · ${Math.round(tri / 1000)} mil triângulos`;
      $('b3mf').disabled = $('bStl').disabled = false;
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
$('bStl').onclick = () => salvar(nomeArq('stl'), 'model/stl', Motor.exportarSTL(st.objetos));

function msg(t, cls) { $('msg').textContent = t; $('msg').className = 'msg ' + (cls || ''); }
