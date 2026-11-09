/*
 * Abre 3MF/STL, posiciona na mesa da U1 e fatia malhas 3D em camadas.
 * Usa o núcleo do Fatiador para gerar o G-code.
 */
'use strict';

const Malhas = (() => {
  const F = () => Fatiador;

  // ------------------------------------------------------------ zip (3MF)
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fim = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('arquivo 3MF inválido (não é zip)');
    const n = dv.getUint16(fim + 10, true);
    let p = dv.getUint32(fim + 16, true);
    const arq = {};
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
      const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const nome = dec.decode(bytes.subarray(p + 46, p + 46 + ln));
      p += 46 + ln + le + lc;
      const ln2 = dv.getUint16(off + 26, true), le2 = dv.getUint16(off + 28, true);
      const dados = bytes.subarray(off + 30 + ln2 + le2, off + 30 + ln2 + le2 + comp);
      arq[nome.replace(/^\//, '')] = { metodo, dados };
    }
    return async nome => {
      const a = arq[nome.replace(/^\//, '')];
      if (!a) return null;
      if (a.metodo === 0) return a.dados;
      const s = new Blob([a.dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    };
  }

  // ------------------------------------------------------------ matrizes 3MF (3x4, linhas)
  const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const lerMat = t => { if (!t) return ID.slice(); const v = t.trim().split(/\s+/).map(Number); return v.length === 12 ? v : ID.slice(); };
  // 3MF: ponto linha * M  (x' = x*m0 + y*m3 + z*m6 + m9)
  function mult(a, b) { // aplica a depois b
    const r = new Array(12);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      let s = i === 3 ? b[9 + j] : 0;
      for (let k = 0; k < 3; k++) s += (i < 3 ? a[i * 3 + k] : a[9 + k]) * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
    return r;
  }

  // ------------------------------------------------------------ leitura
  async function ler(bytes, nomeArquivo) {
    if (/\.stl$/i.test(nomeArquivo)) return lerSTL(bytes, nomeArquivo);
    return ler3MF(bytes, nomeArquivo);
  }

  function lerSTL(bytes, nome) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let tri;
    const nBin = bytes.length >= 84 ? dv.getUint32(80, true) : 0;
    if (bytes.length === 84 + nBin * 50) {
      tri = new Float32Array(nBin * 9);
      for (let i = 0; i < nBin; i++) for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
    } else {
      const txt = new TextDecoder().decode(bytes);
      const v = [...txt.matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)].map(m => [+m[1], +m[2], +m[3]]);
      tri = new Float32Array(v.flat());
    }
    return { objetos: [{ nome: nome.replace(/\.[^.]+$/, ''), volumes: [{ nome: 'peça', fil: 1, tri }] }], cores: [], avisos: [] };
  }

  async function ler3MF(bytes, nomeArquivo) {
    const abrir = await unzip(bytes);
    const dec = new TextDecoder(), avisos = [];
    const xml = async n => { const b = await abrir(n); return b ? new DOMParser().parseFromString(dec.decode(b), 'application/xml') : null; };
    // descobre o modelo principal
    let principal = '3D/3dmodel.model';
    const rels = await abrir('_rels/.rels');
    if (rels) { const m = /Target="\/?([^"]+\.model)"/i.exec(dec.decode(rels)); if (m) principal = m[1]; }
    const docs = {};
    const doc = async caminho => {
      caminho = caminho.replace(/^\//, '');
      if (!(caminho in docs)) docs[caminho] = await xml(caminho);
      return docs[caminho];
    };
    const raiz = await doc(principal);
    if (!raiz) throw new Error('3MF sem modelo 3D');
    const unidade = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[raiz.documentElement.getAttribute('unit') || 'millimeter'] || 1;
    const app = (raiz.querySelector('metadata[name="Application"]') || {}).textContent || '';
    const cache = {};
    // malha de um objeto (com índices) a partir do arquivo e id
    async function objetoXml(caminho, id) {
      const d = await doc(caminho);
      if (!d) return null;
      for (const o of d.getElementsByTagName('object')) if (o.getAttribute('id') === String(id)) return { o, caminho };
      return null;
    }
    let pintado = false;
    async function malha(o) {
      const chave = o.caminho + '#' + o.o.getAttribute('id');
      if (cache[chave]) return cache[chave];
      const m = o.o.getElementsByTagName('mesh')[0];
      if (!m) return null;
      const vs = m.getElementsByTagName('vertex'), ts = m.getElementsByTagName('triangle');
      const V = new Float64Array(vs.length * 3);
      for (let i = 0; i < vs.length; i++) { V[i * 3] = +vs[i].getAttribute('x'); V[i * 3 + 1] = +vs[i].getAttribute('y'); V[i * 3 + 2] = +vs[i].getAttribute('z'); }
      const T = new Uint32Array(ts.length * 3);
      const P1 = new Int32Array(ts.length).fill(-1);
      const pidObj = o.o.getAttribute('pid'), idxObj = o.o.getAttribute('pindex');
      for (let i = 0; i < ts.length; i++) {
        const p1 = ts[i].getAttribute('p1');
        P1[i] = p1 !== null ? +p1 : (idxObj !== null ? +idxObj : -1);
        T[i * 3] = +ts[i].getAttribute('v1'); T[i * 3 + 1] = +ts[i].getAttribute('v2'); T[i * 3 + 2] = +ts[i].getAttribute('v3');
        if (!pintado && (ts[i].hasAttribute('paint_color') || ts[i].hasAttribute('slic3rpe:mmu_segmentation'))) pintado = true;
      }
      const pid = ts.length && ts[0].getAttribute('pid') ? ts[0].getAttribute('pid') : pidObj;
      return (cache[chave] = { V, T, P1, pid, caminho: o.caminho });
    }
    // expande componentes: lista de {malha, matriz, idParte, caminho}
    async function expandir(o, mat, nivel = 0) {
      const out = [];
      const mesh = await malha(o);
      if (mesh) out.push({ mesh, mat, idParte: o.o.getAttribute('id'), nome: o.o.getAttribute('name') || '' });
      const comps = o.o.getElementsByTagName('components')[0];
      if (comps && nivel < 6) for (const c of comps.getElementsByTagName('component')) {
        const caminho = (c.getAttribute('p:path') || c.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', 'path') || o.caminho).replace(/^\//, '');
        const filho = await objetoXml(caminho, c.getAttribute('objectid'));
        if (filho) out.push(...await expandir(filho, mult(lerMat(c.getAttribute('transform')), mat), nivel + 1));
      }
      return out;
    }

    // configurações de cor por parte
    const filPorParte = {}, filPorObjeto = {}, nomePorObjeto = {}, subtipo = {};
    const ms = await xml('Metadata/model_settings.config');
    if (ms) for (const ob of ms.getElementsByTagName('object')) {
      const id = ob.getAttribute('id');
      for (const md of ob.children) if (md.tagName === 'metadata') {
        if (md.getAttribute('key') === 'extruder') filPorObjeto[id] = +md.getAttribute('value');
        if (md.getAttribute('key') === 'name') nomePorObjeto[id] = md.getAttribute('value');
      }
      for (const pt of ob.getElementsByTagName('part')) {
        const pid = pt.getAttribute('id');
        subtipo[id + '/' + pid] = pt.getAttribute('subtype') || 'normal_part';
        for (const md of pt.getElementsByTagName('metadata')) if (md.getAttribute('key') === 'extruder') filPorParte[id + '/' + pid] = +md.getAttribute('value');
      }
    }
    const pe = await xml('Metadata/Slic3r_PE_model.config');
    const faixasPrusa = {};
    if (pe) for (const ob of pe.getElementsByTagName('object')) {
      const id = ob.getAttribute('id'), lista = [];
      for (const md of ob.children) if (md.tagName === 'metadata' && md.getAttribute('key') === 'extruder') filPorObjeto[id] = +md.getAttribute('value');
      for (const vol of ob.getElementsByTagName('volume')) {
        let ext = 0, tipo = 'ModelPart', nome = '';
        for (const md of vol.getElementsByTagName('metadata')) {
          if (md.getAttribute('key') === 'extruder') ext = +md.getAttribute('value');
          if (md.getAttribute('key') === 'volume_type') tipo = md.getAttribute('value');
          if (md.getAttribute('key') === 'name') nome = md.getAttribute('value');
        }
        lista.push({ a: +vol.getAttribute('firstid'), b: +vol.getAttribute('lastid'), ext, tipo, nome });
      }
      faixasPrusa[id] = lista;
    }
    // cores dos filamentos do projeto
    let cores = [];
    const ps = await abrir('Metadata/project_settings.config');
    if (ps) { try { const j = JSON.parse(dec.decode(ps)); if (Array.isArray(j.filament_colour)) cores = j.filament_colour.map(c => String(c).slice(0, 7)); } catch (e) { } }
    if (!cores.length) {
      const pc = await abrir('Metadata/Slic3r_PE.config');
      if (pc) { const m = /; (?:filament|extruder)_colour = ([^\n]+)/.exec(dec.decode(pc)); if (m) cores = m[1].split(';').map(s => s.trim()); }
    }

    // cores de materiais (basematerials/colorgroup) por arquivo
    const paletas = {};
    async function paleta(caminho, pid) {
      const k = caminho + '#' + pid;
      if (k in paletas) return paletas[k];
      const d = await doc(caminho); let cores_ = null;
      if (d) for (const g of [...d.getElementsByTagName('basematerials'), ...d.getElementsByTagName('m:colorgroup'), ...d.getElementsByTagName('colorgroup')])
        if (g.getAttribute('id') === String(pid)) cores_ = [...g.children].map(c => (c.getAttribute('displaycolor') || c.getAttribute('color') || '').slice(0, 7));
      return (paletas[k] = cores_);
    }
    const corDoFil = {};

    // monta objetos a partir do build
    const objetos = [];
    const itens = raiz.getElementsByTagName('item');
    for (const it of itens) {
      if (it.getAttribute('printable') === '0') continue;
      const oid = it.getAttribute('objectid');
      const caminho = (it.getAttribute('p:path') || principal).replace(/^\//, '');
      const o = await objetoXml(caminho, oid);
      if (!o) continue;
      const matItem = lerMat(it.getAttribute('transform'));
      const partes = await expandir(o, matItem);
      const volumes = [];
      for (const pt of partes) {
        const sub = subtipo[oid + '/' + pt.idParte] || 'normal_part';
        if (sub === 'modifier_part' || sub === 'support_blocker' || sub === 'support_enforcer') continue;
        const faixas = faixasPrusa[oid];
        const grupos = faixas && pt.idParte === oid ? faixas.filter(f => f.tipo === 'ModelPart' || f.tipo === 'NegativeVolume') : [{ a: 0, b: pt.mesh.T.length / 3 - 1 }];
        for (const gr of grupos) {
          const n = gr.b - gr.a + 1, tri = new Float32Array(n * 9), M = pt.mat, { V, T } = pt.mesh;
          for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
            const vi = T[(gr.a + i) * 3 + k] * 3, x = V[vi], y = V[vi + 1], z = V[vi + 2];
            tri[i * 9 + k * 3] = (x * M[0] + y * M[3] + z * M[6] + M[9]) * unidade;
            tri[i * 9 + k * 3 + 1] = (x * M[1] + y * M[4] + z * M[7] + M[10]) * unidade;
            tri[i * 9 + k * 3 + 2] = (x * M[2] + y * M[5] + z * M[8] + M[11]) * unidade;
          }
          const fil = gr.ext || filPorParte[oid + '/' + pt.idParte] || filPorObjeto[oid] || 1;
          if (!corDoFil[fil] && pt.mesh.pid !== null && pt.mesh.pid !== undefined) {
            const pal = await paleta(pt.mesh.caminho, pt.mesh.pid), i1 = pt.mesh.P1[gr.a];
            if (pal && i1 >= 0 && pal[i1]) corDoFil[fil] = pal[i1];
          }
          volumes.push({ nome: gr.nome || pt.nome || 'parte', fil, tri, negativo: sub === 'negative_part' || gr.tipo === 'NegativeVolume' });
        }
      }
      if (volumes.length) objetos.push({ nome: nomePorObjeto[oid] || o.o.getAttribute('name') || ('Objeto ' + (objetos.length + 1)), volumes });
    }
    for (const [f, c] of Object.entries(corDoFil)) if (!cores[f - 1]) cores[f - 1] = c;
    if (pintado) avisos.push('Este arquivo tem cores pintadas à mão nos triângulos. Essa pintura ainda não é suportada: cada parte sai na cor do filamento dela.');
    if (/BambuStudio/i.test(app)) avisos.push('Arquivo do Bambu Studio: as cores e posições foram lidas; confira o mapa de cores antes de imprimir.');
    if (!objetos.length) throw new Error('nenhum objeto imprimível no arquivo');
    return { objetos, cores, avisos };
  }

  // ------------------------------------------------------------ posicionar na mesa
  function posicionar(modelo) {
    const M = F().MESA;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of modelo.objetos) {
      let zmin = Infinity;
      for (const v of o.volumes) for (let i = 2; i < v.tri.length; i += 3) zmin = Math.min(zmin, v.tri[i]);
      for (const v of o.volumes) for (let i = 0; i < v.tri.length; i += 3) {
        v.tri[i + 2] -= zmin;
        x0 = Math.min(x0, v.tri[i]); x1 = Math.max(x1, v.tri[i]); y0 = Math.min(y0, v.tri[i + 1]); y1 = Math.max(y1, v.tri[i + 1]);
      }
    }
    // mantém posições relativas e centraliza o conjunto na mesa (a torre fica livre no canto)
    const dx = M.cx + 8 - (x0 + x1) / 2, dy = M.cy + 8 - (y0 + y1) / 2;
    let zmax = 0;
    for (const o of modelo.objetos) for (const v of o.volumes) for (let i = 0; i < v.tri.length; i += 3) { v.tri[i] += dx; v.tri[i + 1] += dy; zmax = Math.max(zmax, v.tri[i + 2]); }
    modelo.tamanho = { x: x1 - x0, y: y1 - y0, z: zmax };
    modelo.cabe = x1 - x0 <= 230 && y1 - y0 <= 230 && zmax <= 265;
    return modelo;
  }

  // ------------------------------------------------------------ fatiar malha
  // corta um volume em todas as alturas zs (meio de cada camada); devolve paths do Clipper por camada
  function cortar(tri, zs) {
    const SC = F().SC, nT = tri.length / 9;
    // vértices únicos para chavear arestas
    const mapa = new Map(), idx = new Uint32Array(nT * 3), P = [];
    for (let i = 0; i < nT * 3; i++) {
      const x = tri[i * 3], y = tri[i * 3 + 1], z = tri[i * 3 + 2];
      const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      let id = mapa.get(k);
      if (id === undefined) { id = P.length / 3; P.push(x, y, z); mapa.set(k, id); }
      idx[i] = id;
    }
    const ordemT = [...Array(nT).keys()].sort((a, b) => Math.min(tri[a * 9 + 2], tri[a * 9 + 5], tri[a * 9 + 8]) - Math.min(tri[b * 9 + 2], tri[b * 9 + 5], tri[b * 9 + 8]));
    const zmaxT = new Float32Array(nT); for (let t = 0; t < nT; t++) zmaxT[t] = Math.max(tri[t * 9 + 2], tri[t * 9 + 5], tri[t * 9 + 8]);
    let cursor = 0, ativos = [];
    const out = [];
    for (const z0 of zs) {
      const z = z0 + 1e-5;
      while (cursor < nT && Math.min(tri[ordemT[cursor] * 9 + 2], tri[ordemT[cursor] * 9 + 5], tri[ordemT[cursor] * 9 + 8]) <= z) ativos.push(ordemT[cursor++]);
      ativos = ativos.filter(t => zmaxT[t] >= z);
      const prox = new Map(), pos = new Map();
      for (const t of ativos) {
        const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
        const vz = [P[a * 3 + 2], P[b * 3 + 2], P[c * 3 + 2]], vv = [a, b, c];
        const pts = [];
        for (let k = 0; k < 3; k++) {
          const i = vv[k], j = vv[(k + 1) % 3], zi = vz[k], zj = vz[(k + 1) % 3];
          if ((zi < z) !== (zj < z)) {
            const key = i < j ? i + '_' + j : j + '_' + i;
            if (!pos.has(key)) { const u = (z - zi) / (zj - zi); pos.set(key, [P[i * 3] + (P[j * 3] - P[i * 3]) * u, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * u]); }
            pts.push(key);
          }
        }
        if (pts.length !== 2) continue;
        // orienta pelo normal: material à esquerda
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz;
        const [p, q] = [pos.get(pts[0]), pos.get(pts[1])];
        const dir = (q[0] - p[0]) * (-ny) + (q[1] - p[1]) * nx;
        if (dir >= 0) prox.set(pts[0], pts[1]); else prox.set(pts[1], pts[0]);
      }
      // encadeia em laços
      const lacos = [], visto = new Set();
      for (const ini of prox.keys()) {
        if (visto.has(ini)) continue;
        const lp = []; let k = ini;
        while (k !== undefined && !visto.has(k)) { visto.add(k); const p = pos.get(k); lp.push({ X: Math.round(p[0] * SC), Y: Math.round(p[1] * SC) }); k = prox.get(k); }
        if (lp.length >= 3) lacos.push(lp);
      }
      // une e simplifica (tira pontos quase em linha reta; resolução como a do Orca)
      out.push(lacos.length ? ClipperLib.Clipper.CleanPolygons(F().uni(ClipperLib.Clipper.SimplifyPolygons(lacos, ClipperLib.PolyFillType.pftNonZero)), 0.025 * SC).filter(r => r.length >= 3) : []);
    }
    return out;
  }

  function fatiarModelo(modelo, opt, progresso) {
    const { h, h0 } = opt, zmax = modelo.tamanho.z;
    const camadas = [];
    let z = Math.min(h0, zmax);
    camadas.push({ z: +z.toFixed(3), h: +z.toFixed(3) });
    while (z < zmax - 0.02) { const hh = Math.min(h, zmax - z); z += hh; camadas.push({ z: +z.toFixed(3), h: +hh.toFixed(3) }); }
    const zs = camadas.map(c => c.z - c.h / 2);
    const nObj = modelo.objetos.length;
    const reg = camadas.map(() => []);
    modelo.objetos.forEach((o, oi) => {
      const fatias = o.volumes.map(v => cortar(v.tri, zs));
      for (let l = 0; l < camadas.length; l++) {
        const porFil = {}; let acc = [];
        for (let vi = o.volumes.length - 1; vi >= 0; vi--) {      // partes de cima da lista têm prioridade nas sobreposições
          const v = o.volumes[vi], p = fatias[vi][l];
          if (!p.length) continue;
          if (v.negativo) { acc = F().uni(acc, p); continue; }
          const livre = acc.length ? F().dif(p, acc) : p;
          acc = F().uni(acc, p);
          if (livre.length) porFil[v.fil] = porFil[v.fil] ? F().uni(porFil[v.fil], livre) : livre;
        }
        const negs = o.volumes.map((v, i) => v.negativo ? fatias[i][l] : []).flat();
        if (negs.length) for (const f in porFil) porFil[f] = F().dif(porFil[f], negs);
        for (const f in porFil) { porFil[f] = F().limpa(porFil[f], 0.01); if (!porFil[f].length) delete porFil[f]; }
        const tudo = Object.values(porFil).reduce((a, p) => F().uni(a, p), []);
        reg[l][oi] = { porFil, tudo };
      }
      if (progresso) progresso(oi + 1, nObj);
    });
    const suporte = opt.suporte && opt.suporte !== 'off' ? calcularSuporte(reg, camadas, opt) : null;
    return F().nucleo(camadas, reg, modelo.objetos.map(o => o.nome), opt, { suporte });
  }

  // ------------------------------------------------------------ suportes (grade simples)
  function calcularSuporte(reg, camadas, opt) {
    const N = camadas.length;
    const U = reg.map(r => r.reduce((a, o) => F().uni(a, o.tudo), []));
    const angulo = (opt.anguloSuporte || 30) * Math.PI / 180;
    const balanco = l => {             // partes da camada l sem apoio na de baixo
      if (l === 0) return [];
      const tol = camadas[l].h / Math.tan(angulo);
      return F().limpa(F().dif(U[l], F().off(U[l - 1], tol)), 0.02);   // anéis finos somam ao longo das camadas
    };
    const S = new Array(N).fill(null).map(() => []);
    let bruto = [];                     // acumula sem limpar: os anéis finos de cada camada somam
    for (let l = N - 3; l >= 0; l--) {
      bruto = F().uni(bruto, balanco(l + 2));
      bruto = F().dif(bruto, F().off(U[l], 0.4));
      if (l + 1 < N) bruto = F().dif(bruto, F().off(U[l + 1], 0.4));
      bruto = F().limpa(bruto, 0.01);
      S[l] = F().limpa(F().off(F().off(bruto, -0.3), 0.3), 0.5);
    }
    if (opt.suporte === 'mesa') {      // só a partir da mesa: coluna para onde encontra a peça
      let bloq = [];
      for (let l = 0; l < N; l++) {
        if (l > 0) bloq = F().uni(bloq, U[l - 1]);
        if (bloq.length) S[l] = F().limpa(F().dif(S[l], F().off(bloq, 0.4)), 0.5);
      }
    }
    return S;
  }

  return { ler, posicionar, fatiarModelo, calcularSuporte };
})();
