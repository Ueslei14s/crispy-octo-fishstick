/*
 * Motor do Forja 3D: imagem -> cores -> contornos -> peça 3D -> 3MF/STL.
 * Tudo roda no aparelho, sem internet. Depende de ClipperLib e earcut.
 */
'use strict';

const Motor = (() => {
  const SC = 1000; // unidades do Clipper por mm (micrometros)

  const PRODUTOS = {
    medalha:  { nome: 'Medalha',  largura: 70,  base: 3, relevo: 0.6, borda: 1.5 },
    chaveiro: { nome: 'Chaveiro', largura: 45,  base: 3, relevo: 0.6, borda: 1.5 },
    trofeu:   { nome: 'Troféu',   largura: 100, base: 4, relevo: 0.6, borda: 2.0 },
  };

  // ------------------------------------------------------------------ imagem
  function rasterizar(img, maxDim) {
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const W = Math.max(8, Math.round((img.naturalWidth || img.width) * k));
    const H = Math.max(8, Math.round((img.naturalHeight || img.height) * k));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    return { W, H, px: ctx.getImageData(0, 0, W, H).data };
  }

  const d2 = (px, i, c) => {
    const r = px[i] - c[0], g = px[i + 1] - c[1], b = px[i + 2] - c[2];
    return r * r + g * g + b * b;
  };

  // fundo: transparência, ou a cor das bordas espalhada a partir das beiradas
  function detectarFundo(im, tol) {
    const { W, H, px } = im;
    const N = W * H, fundo = new Uint8Array(N);
    let temAlfa = false;
    for (let i = 0; i < N; i++) if (px[i * 4 + 3] < 128) { temAlfa = true; break; }
    if (temAlfa) {
      for (let i = 0; i < N; i++) fundo[i] = px[i * 4 + 3] < 128 ? 1 : 0;
      return { fundo, cor: [255, 255, 255], porAlfa: true };
    }
    const borda = [];
    for (let x = 0; x < W; x++) { borda.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { borda.push(y * W, y * W + W - 1); }
    const med = [0, 1, 2].map(c => {
      const v = borda.map(i => px[i * 4 + c]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    const lim = tol * tol;
    const fila = new Int32Array(N);
    let ini = 0, fim = 0;
    for (const i of borda) if (!fundo[i] && d2(px, i * 4, med) <= lim) { fundo[i] = 1; fila[fim++] = i; }
    while (ini < fim) {
      const i = fila[ini++], x = i % W, y = (i / W) | 0;
      const viz = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of viz) if (j >= 0 && !fundo[j] && d2(px, j * 4, med) <= lim) { fundo[j] = 1; fila[fim++] = j; }
    }
    return { fundo, cor: med, porAlfa: false };
  }

  // morfologia binária com quadrado (2r+1), separável
  function dilatar(m, W, H, r) {
    if (r <= 0) return m.slice();
    const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let cnt = 0; const row = y * W;
      for (let x = -r; x < W; x++) {
        if (x + r < W && m[row + x + r]) cnt++;
        if (x - r - 1 >= 0 && m[row + x - r - 1]) cnt--;
        if (x >= 0) t[row + x] = cnt > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < W; x++) {
      let cnt = 0;
      for (let y = -r; y < H; y++) {
        if (y + r < H && t[(y + r) * W + x]) cnt++;
        if (y - r - 1 >= 0 && t[(y - r - 1) * W + x]) cnt--;
        if (y >= 0) o[y * W + x] = cnt > 0 ? 1 : 0;
      }
    }
    return o;
  }
  const inverter = m => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
  const erodir = (m, W, H, r) => inverter(dilatar(inverter(m), W, H, r));
  const abrir = (m, W, H, r) => dilatar(erodir(m, W, H, r), W, H, r);
  const fechar = (m, W, H, r) => erodir(dilatar(m, W, H, r), W, H, r);

  function preencherFuros(m, W, H) {
    const fora = new Uint8Array(W * H), fila = new Int32Array(W * H);
    let ini = 0, fim = 0;
    const add = i => { if (!m[i] && !fora[i]) { fora[i] = 1; fila[fim++] = i; } };
    for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
    while (ini < fim) {
      const i = fila[ini++], x = i % W, y = (i / W) | 0;
      if (x > 0) add(i - 1); if (x < W - 1) add(i + 1);
      if (y > 0) add(i - W); if (y < H - 1) add(i + W);
    }
    return inverter(fora);
  }

  // remove ilhas menores que minArea (pixels)
  function filtrarIlhas(m, W, H, minArea) {
    const lab = new Int32Array(W * H), fila = new Int32Array(W * H), o = new Uint8Array(W * H);
    let n = 0;
    for (let s = 0; s < W * H; s++) {
      if (!m[s] || lab[s]) continue;
      n++; let ini = 0, fim = 0; fila[fim++] = s; lab[s] = n;
      while (ini < fim) {
        const i = fila[ini++], x = i % W, y = (i / W) | 0;
        const viz = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of viz) if (j >= 0 && m[j] && !lab[j]) { lab[j] = n; fila[fim++] = j; }
      }
      if (fim >= minArea) for (let k = 0; k < fim; k++) o[fila[k]] = 1;
    }
    return o;
  }

  // Espaço de cor para agrupar: tom e saturação pesam mais que o brilho, então
  // sombras (vermelho escuro) ficam com a cor certa em vez de virar preto.
  function caracteristica(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255;
    let s = mx ? (mx - mn) / mx : 0;
    s *= Math.min(1, Math.max(0, (v - 0.08) / 0.17));   // quase preto não tem tom confiável
    let h = 0;
    if (mx !== mn) {
      if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
      h *= Math.PI / 3;
    }
    return [s * Math.cos(h), s * Math.sin(h), v * 0.9];
  }

  // k-means das cores dentro da silhueta
  function agruparCores(im, sil, k) {
    const { W, H, px } = im, N = W * H;
    const F = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const f = caracteristica(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      F[i * 3] = f[0]; F[i * 3 + 1] = f[1]; F[i * 3 + 2] = f[2];
    }
    const dist = (i, c) => { const a = F[i * 3] - c[0], b = F[i * 3 + 1] - c[1], d = F[i * 3 + 2] - c[2]; return a * a + b * b + d * d; };
    const idx = [];
    for (let i = 0; i < N; i++) if (sil[i]) idx.push(i);
    const passo = Math.max(1, Math.floor(idx.length / 30000));
    const amostra = idx.filter((_, j) => j % passo === 0);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pega = i => [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]];
    let melhor = null;
    for (let tentativa = 0; tentativa < 4; tentativa++) {       // várias sementes, fica a melhor
      const cent = [pega(amostra[Math.floor(rnd() * amostra.length)])];
      const dmin = new Float64Array(amostra.length).fill(Infinity);
      while (cent.length < k) {
        let tot = 0; const c = cent[cent.length - 1];
        for (let j = 0; j < amostra.length; j++) { dmin[j] = Math.min(dmin[j], dist(amostra[j], c)); tot += dmin[j]; }
        if (tot === 0) break;
        let alvo = rnd() * tot, j = 0;
        for (; j < amostra.length - 1 && alvo > dmin[j]; j++) alvo -= dmin[j];
        cent.push(pega(amostra[j]));
      }
      let erro = 0;
      for (let it = 0; it < 20; it++) {
        const soma = cent.map(() => [0, 0, 0, 0]); erro = 0;
        for (const i of amostra) {
          let b = 0, bd = Infinity;
          for (let c = 0; c < cent.length; c++) { const d = dist(i, cent[c]); if (d < bd) { bd = d; b = c; } }
          const s = soma[b]; s[0] += F[i * 3]; s[1] += F[i * 3 + 1]; s[2] += F[i * 3 + 2]; s[3]++; erro += bd;
        }
        soma.forEach((s, c) => { if (s[3]) cent[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
      }
      if (!melhor || erro < melhor.erro) melhor = { cent, erro };
    }
    const cent = melhor.cent;
    const rot = new Int8Array(N).fill(-1), cont = new Array(cent.length).fill(0);
    const rgb = cent.map(() => [0, 0, 0]);
    for (const i of idx) {
      let b = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) { const d = dist(i, cent[c]); if (d < bd) { bd = d; b = c; } }
      rot[i] = b; cont[b]++;
      rgb[b][0] += px[i * 4]; rgb[b][1] += px[i * 4 + 1]; rgb[b][2] += px[i * 4 + 2];
    }
    // cor exibida = cor mais "viva" do grupo (média dos 50% mais saturados/claros)
    const centros = rgb.map((s, c) => cont[c] ? s.map(v => Math.round(v / cont[c])) : [128, 128, 128]);
    return { centros, rotulos: limparRotulos(rot, W, H, cent.length), contagem: cont };
  }

  // filtro de moda 3x3: tira pixels soltos na borda entre duas cores
  function limparRotulos(rot, W, H, k) {
    const o = rot.slice(), cnt = new Int32Array(k);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (rot[i] < 0) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const r = rot[i + dy * W + dx]; if (r >= 0) cnt[r]++; }
      let b = rot[i]; for (let c = 0; c < k; c++) if (cnt[c] > cnt[b]) b = c;
      if (cnt[b] >= 5) o[i] = b;
    }
    return o;
  }

  // ------------------------------------------------------------------ análise completa (2D)
  function analisar(img, opt) {
    const im = rasterizar(img, opt.maxDim || 1400);
    const { W, H } = im;
    const fd = detectarFundo(im, opt.tolerancia);
    let fg = inverter(fd.fundo);
    fg = abrir(fg, W, H, 1);
    let sil = fechar(fg, W, H, Math.max(2, Math.round(Math.max(W, H) * 0.012)));
    sil = preencherFuros(sil, W, H);
    sil = filtrarIlhas(sil, W, H, Math.max(20, W * H * 0.0015));
    let area = 0; for (let i = 0; i < W * H; i++) area += sil[i];
    if (area < W * H * 0.01) { // nada destacado: usa a imagem inteira
      sil = new Uint8Array(W * H).fill(1);
    }
    const grupos = agruparCores(im, sil, opt.cores);
    // base = cor mais parecida com o fundo (ou a mais comum, se o fundo for transparente)
    let base = 0;
    if (fd.porAlfa) base = grupos.contagem.indexOf(Math.max(...grupos.contagem));
    else {
      let bd = Infinity;
      grupos.centros.forEach((c, i) => {
        const d = (c[0] - fd.cor[0]) ** 2 + (c[1] - fd.cor[1]) ** 2 + (c[2] - fd.cor[2]) ** 2;
        if (d < bd) { bd = d; base = i; }
      });
    }
    return { im, sil, grupos, base, corFundo: fd.cor };
  }

  // ------------------------------------------------------------------ contornos (marching squares suave)
  // A máscara é suavizada (média 3x3) e o contorno passa no nível 0,5, com posição
  // interpolada entre pixels: as bordas saem lisas em vez de "em degrau".
  function contornos(m, W, H) {
    const f = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) s += m[yy * W + xx];
      }
      f[y * W + x] = s / 9;
    }
    const PW = W + 2, PH = H + 2;
    const v = (x, y) => (x >= 1 && y >= 1 && x <= W && y <= H) ? f[(y - 1) * W + (x - 1)] : 0;
    const KW = 2 * PW + 2;
    const pos = new Map(), viz = new Map();
    const ponto = (k, xa, ya, va, xb, yb, vb) => {
      if (!pos.has(k)) { const t = Math.min(1, Math.max(0, (0.5 - va) / (vb - va))); pos.set(k, [xa + (xb - xa) * t - 1, ya + (yb - ya) * t - 1]); }
      return k;
    };
    const liga = (a, b) => {
      if (!viz.has(a)) viz.set(a, []); if (!viz.has(b)) viz.set(b, []);
      viz.get(a).push(b); viz.get(b).push(a);
    };
    for (let y = 0; y < PH - 1; y++) {
      for (let x = 0; x < PW - 1; x++) {
        const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
        const c = (tl > 0.5) * 8 + (tr > 0.5) * 4 + (br > 0.5) * 2 + (bl > 0.5);
        if (c === 0 || c === 15) continue;
        const T = () => ponto((2 * y) * KW + (2 * x + 1), x, y, tl, x + 1, y, tr);
        const R = () => ponto((2 * y + 1) * KW + (2 * x + 2), x + 1, y, tr, x + 1, y + 1, br);
        const B = () => ponto((2 * y + 2) * KW + (2 * x + 1), x, y + 1, bl, x + 1, y + 1, br);
        const L = () => ponto((2 * y + 1) * KW + (2 * x), x, y, tl, x, y + 1, bl);
        const centro = (tl + tr + br + bl) / 4 > 0.5;
        switch (c) {
          case 1: case 14: liga(L(), B()); break;
          case 2: case 13: liga(B(), R()); break;
          case 3: case 12: liga(L(), R()); break;
          case 4: case 11: liga(T(), R()); break;
          case 6: case 9: liga(T(), B()); break;
          case 7: case 8: liga(L(), T()); break;
          case 5: if (centro) { liga(L(), B()); liga(T(), R()); } else { liga(L(), T()); liga(B(), R()); } break;
          case 10: if (centro) { liga(L(), T()); liga(B(), R()); } else { liga(T(), R()); liga(L(), B()); } break;
        }
      }
    }
    const visto = new Set(), laços = [];
    for (const ini of viz.keys()) {
      if (visto.has(ini)) continue;
      const laço = []; let ant = -1, at = ini;
      while (at !== undefined && !visto.has(at)) {
        visto.add(at); laço.push(pos.get(at));
        const n = viz.get(at); const prox = n[0] !== ant ? n[0] : n[1];
        ant = at; at = prox;
      }
      if (laço.length >= 3) laços.push(laço);
    }
    return laços; // coordenadas de pixel (x para a direita, y para baixo)
  }

  // Ramer-Douglas-Peucker para laço fechado
  function simplificar(p, eps) {
    if (p.length < 8) return p;
    let a = 0, b = 0, dmax = -1;
    for (let i = 1; i < p.length; i++) { const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2; if (d > dmax) { dmax = d; b = i; } }
    const rdp = (pts) => {
      const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
      const pilha = [[0, pts.length - 1]];
      while (pilha.length) {
        const [i0, i1] = pilha.pop();
        const [x0, y0] = pts[i0], [x1, y1] = pts[i1], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1e-9;
        let im = -1, dm = eps;
        for (let i = i0 + 1; i < i1; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L; if (d > dm) { dm = d; im = i; } }
        if (im >= 0) { keep[im] = 1; pilha.push([i0, im], [im, i1]); }
      }
      return pts.filter((_, i) => keep[i]);
    };
    const s1 = rdp(p.slice(a, b + 1)), s2 = rdp([...p.slice(b), p[0]]);
    return [...s1.slice(0, -1), ...s2.slice(0, -1)];
  }

  // ------------------------------------------------------------------ geometria 2D (Clipper)
  const C = () => ClipperLib;
  function executar(tipo, a, b, preench) {
    const cp = new (C().Clipper)();
    if (a.length) cp.AddPaths(a, C().PolyType.ptSubject, true);
    if (b && b.length) cp.AddPaths(b, C().PolyType.ptClip, true);
    const out = new (C().Paths)();
    const f = preench === 'par' ? C().PolyFillType.pftEvenOdd : C().PolyFillType.pftNonZero;
    cp.Execute(tipo, out, f, C().PolyFillType.pftNonZero);
    return out;
  }
  const uniao = (a, b) => executar(C().ClipType.ctUnion, a, b || []);
  const diferenca = (a, b) => executar(C().ClipType.ctDifference, a, b);
  const intersecao = (a, b) => executar(C().ClipType.ctIntersection, a, b);
  function deslocar(p, mm) {
    if (!p.length) return [];
    const co = new (C().ClipperOffset)(2, 0.02 * SC);
    co.AddPaths(p, C().JoinType.jtRound, C().EndType.etClosedPolygon);
    const out = new (C().Paths)();
    co.Execute(out, mm * SC);
    return out;
  }
  const retangulo = (x0, y0, x1, y1) => [[{ X: x0 * SC, Y: y0 * SC }, { X: x1 * SC, Y: y0 * SC }, { X: x1 * SC, Y: y1 * SC }, { X: x0 * SC, Y: y1 * SC }]];
  const retArredondado = (x0, y0, x1, y1, r) => deslocar(retangulo(x0 + r, y0 + r, x1 - r, y1 - r), r);
  function circulo(cx, cy, r, n = 72) {
    const p = [];
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; p.push({ X: (cx + r * Math.cos(a)) * SC, Y: (cy + r * Math.sin(a)) * SC }); }
    return [p];
  }
  function limites(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of p) for (const q of r) { x0 = Math.min(x0, q.X); y0 = Math.min(y0, q.Y); x1 = Math.max(x1, q.X); y1 = Math.max(y1, q.Y); }
    return { x0: x0 / SC, y0: y0 / SC, x1: x1 / SC, y1: y1 / SC };
  }
  const areaPaths = p => p.reduce((s, r) => s + C().Clipper.Area(r), 0) / (SC * SC);
  function pecas(p) { // nº de partes externas
    return p.filter(r => C().Clipper.Orientation(r)).length;
  }

  // máscara -> paths em mm (y para cima), já limpos
  function mascaraParaPaths(m, W, H, mmPx) {
    const laços = contornos(m, W, H)
      .map(l => simplificar(l, Math.max(0.12, 0.025 / mmPx)))
      .filter(l => l.length >= 3)
      .map(l => l.map(([x, y]) => ({ X: Math.round(x * mmPx * SC), Y: Math.round((H - y) * mmPx * SC) })));
    return executar(C().ClipType.ctUnion, laços, [], 'par');
  }

  // ------------------------------------------------------------------ montagem da peça
  function montar(an, opt) {
    const { im, sil, grupos } = an;
    const { W, H } = im;
    const P = PRODUTOS[opt.produto];
    const borda = P.borda;
    const espessura = opt.base ?? P.base, relevo = opt.relevo ?? P.relevo;

    let xs0 = W, xs1 = 0;
    for (let i = 0; i < W * H; i++) if (sil[i]) { const x = i % W; if (x < xs0) xs0 = x; if (x > xs1) xs1 = x; }
    const mmPx = (opt.largura - 2 * borda) / Math.max(1, xs1 - xs0 + 1);

    // contorno da peça
    let silPaths = mascaraParaPaths(sil, W, H, mmPx);
    let contorno;
    if (opt.formato === 'circulo') {
      const b = limites(silPaths), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      let r = 0;
      for (const rr of silPaths) for (const q of rr) r = Math.max(r, Math.hypot(q.X / SC - cx, q.Y / SC - cy));
      contorno = circulo(cx, cy, r + borda, 144);
    } else {
      contorno = deslocar(silPaths, borda);
      for (const d of [2, 4, 7, 12]) {               // junta ilhas soltas
        if (pecas(contorno) <= 1) break;
        contorno = deslocar(deslocar(silPaths, borda + d), -d);
      }
    }

    // alça / argola / encaixe
    const b = limites(contorno), cx = (b.x0 + b.x1) / 2;
    const faixaTopo = (meia) => limites(intersecao(contorno, retangulo(cx - meia, b.y0, cx + meia, b.y1)));
    let furos = [];
    const extras = {};
    if (opt.produto === 'medalha') {
      const fl = opt.fita ?? 26, alcaL = fl + 8, alcaA = 11, fendaA = 4;
      const topo = faixaTopo(alcaL / 2 - 3).y1;
      const y0 = topo - 4;
      contorno = uniao(contorno, retArredondado(cx - alcaL / 2, y0, cx + alcaL / 2, y0 + alcaA, 3.5));
      const fy = y0 + alcaA - 2.5 - fendaA;
      furos = retArredondado(cx - fl / 2, fy, cx + fl / 2, fy + fendaA, 1.2);
    } else if (opt.produto === 'chaveiro') {
      const topo = faixaTopo(3).y1, rE = 6, rI = 2.6, cy = topo + rE - 2.5;
      contorno = uniao(contorno, uniao(circulo(cx, cy, rE), retangulo(cx - 4, topo - 3, cx + 4, cy)));
      furos = circulo(cx, cy, rI);
    } else if (opt.produto === 'trofeu') {
      const tabL = Math.min(30, Math.max(14, (b.x1 - b.x0) * 0.3));
      const hBase = 14;
      const fundo = limites(intersecao(contorno, retangulo(cx - tabL / 2, b.y0, cx + tabL / 2, b.y1))).y0;
      contorno = uniao(contorno, retangulo(cx - tabL / 2, fundo - (hBase - 1), cx + tabL / 2, fundo + 3));
      extras.trofeu = { tabL, hBase, espessura };
    }
    contorno = diferenca(contorno, furos);

    // camadas coloridas
    const zona = diferenca(deslocar(contorno, -0.4), deslocar(furos, 0.8));
    const rMin = Math.max(1, Math.round(0.18 / mmPx));
    const camadas = [];
    let usado = [];
    grupos.centros.forEach((cor, c) => {
      if (c === an.base) return;
      let m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = grupos.rotulos[i] === c ? 1 : 0;
      m = abrir(m, W, H, rMin);
      let p = mascaraParaPaths(m, W, H, mmPx);
      p = diferenca(intersecao(p, zona), usado);
      p = limparPequenos(p, 0.25);
      if (!p.length) return;
      usado = uniao(usado, p);
      camadas.push({ indice: c, cor, paths: p });
    });

    // centraliza
    const bb = limites(contorno), dx = -(bb.x0 + bb.x1) / 2, dy = -(bb.y0 + bb.y1) / 2;
    const mover = p => p.map(r => r.map(q => ({ X: q.X + dx * SC, Y: q.Y + dy * SC })));
    return {
      produto: opt.produto, espessura, relevo,
      contorno: mover(contorno), camadas: camadas.map(c => ({ ...c, paths: mover(c.paths) })),
      corBase: grupos.centros[an.base], largura: bb.x1 - bb.x0, altura: bb.y1 - bb.y0, extras,
    };
  }

  function limparPequenos(p, minArea) {
    const ex = C().JS.PolyTreeToExPolygons(arvore(p));
    const out = [];
    for (const e of ex) {
      const a = Math.abs(C().Clipper.Area(e.outer)) / (SC * SC);
      if (a < minArea) continue;
      out.push(e.outer, ...e.holes.filter(h => Math.abs(C().Clipper.Area(h)) / (SC * SC) >= 0.05));
    }
    return out;
  }
  function arvore(p) {
    const cp = new (C().Clipper)();
    cp.StrictlySimple = true; // separa polígonos que se tocam num ponto (a triangulação falha neles)
    cp.AddPaths(p, C().PolyType.ptSubject, true);
    const t = new (C().PolyTree)();
    cp.Execute(C().ClipType.ctUnion, t, C().PolyFillType.pftNonZero, C().PolyFillType.pftNonZero);
    return t;
  }

  // ------------------------------------------------------------------ malhas 3D
  function novaMalha() { return { pos: [], idx: [] }; }
  function extrudar(paths, z0, z1, malha) {
    // encolher 0,01 mm desfaz pontos onde um furo encosta na borda (geram malha aberta)
    const ex = C().JS.PolyTreeToExPolygons(arvore(deslocar(paths, -0.01)));
    for (const e of ex) {
      const aneis = [e.outer, ...e.holes].map(r => r.map(q => [q.X / SC, q.Y / SC]));
      aneis.forEach((r, i) => {
        let a = 0; for (let j = 0; j < r.length; j++) { const p = r[j], q = r[(j + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
        if ((i === 0) !== (a > 0)) r.reverse();      // externo anti-horário, furos horário
      });
      const plano = [], furos = [];
      for (const r of aneis) { if (plano.length) furos.push(plano.length / 2); for (const p of r) plano.push(p[0], p[1]); }
      const n = plano.length / 2, o = malha.pos.length / 3;
      for (let i = 0; i < n; i++) malha.pos.push(plano[2 * i], plano[2 * i + 1], z0);
      for (let i = 0; i < n; i++) malha.pos.push(plano[2 * i], plano[2 * i + 1], z1);
      const tri = earcut(plano, furos);
      for (let t = 0; t < tri.length; t += 3) {
        let [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
        const s = (plano[2 * b] - plano[2 * a]) * (plano[2 * c + 1] - plano[2 * a + 1]) - (plano[2 * c] - plano[2 * a]) * (plano[2 * b + 1] - plano[2 * a + 1]);
        if (s < 0) [b, c] = [c, b];
        malha.idx.push(o + n + a, o + n + b, o + n + c);   // topo
        malha.idx.push(o + a, o + c, o + b);               // fundo
      }
      let ini = 0;
      for (const r of aneis) {
        const L = r.length;
        for (let j = 0; j < L; j++) {
          const a = o + ini + j, b = o + ini + (j + 1) % L;
          malha.idx.push(a, b, b + n, a, b + n, a + n);
        }
        ini += L;
      }
    }
    return malha;
  }

  // gera os objetos 3D: [{nome, partes:[{nome, cor, filamento, malha}]}]
  function gerar3D(peca, cores) {
    const objetos = [];
    const partes = [{ nome: 'base', cor: cores[0], filamento: 1, malha: extrudar(peca.contorno, 0, peca.espessura, novaMalha()) }];
    peca.camadas.forEach((c, i) => partes.push({
      nome: 'cor_' + (i + 2), cor: cores[i + 1], filamento: i + 2,
      malha: extrudar(c.paths, peca.espessura, peca.espessura + peca.relevo, novaMalha()),
    }));
    objetos.push({ nome: PRODUTOS[peca.produto].nome, partes, desloc: [0, 0] });
    if (peca.extras.trofeu) {
      const { tabL, hBase, espessura } = peca.extras.trofeu;
      const L = Math.max(peca.largura * 0.75, tabL + 30), D = 30;
      const encaixe = retangulo(-(tabL + 0.5) / 2, -(espessura + 0.5) / 2, (tabL + 0.5) / 2, (espessura + 0.5) / 2);
      const pe = diferenca(retArredondado(-L / 2, -D / 2, L / 2, D / 2, 3), encaixe);
      objetos.push({
        nome: 'Base do troféu', desloc: [0, -(peca.altura / 2 + D / 2 + 8)],
        partes: [{ nome: 'pedestal', cor: cores[0], filamento: 1, malha: extrudar(pe, 0, hBase, novaMalha()) }],
      });
    }
    return objetos;
  }

  // ------------------------------------------------------------------ exportação
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflate(b) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const s = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (e) { return null; }
  }
  async function zip(arquivos) { // [{nome, dados(Uint8Array)}]
    const enc = new TextEncoder(), partes = [], central = [];
    let off = 0;
    for (const a of arquivos) {
      const nome = enc.encode(a.nome), crc = crc32(a.dados);
      const comp = await deflate(a.dados);
      const usa = comp && comp.length < a.dados.length;
      const dados = usa ? comp : a.dados, metodo = usa ? 8 : 0;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, metodo, true);
      h.setUint32(14, crc, true); h.setUint32(18, dados.length, true); h.setUint32(22, a.dados.length, true); h.setUint16(26, nome.length, true);
      partes.push(new Uint8Array(h.buffer), nome, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, metodo, true);
      c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, a.dados.length, true); c.setUint16(28, nome.length, true);
      c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nome);
      off += 30 + nome.length + dados.length;
    }
    const tamC = central.reduce((s, b) => s + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, arquivos.length, true); e.setUint16(10, arquivos.length, true);
    e.setUint32(12, tamC, true); e.setUint32(16, off, true);
    return new Uint8Array(await new Blob([...partes, ...central, new Uint8Array(e.buffer)]).arrayBuffer());
  }

  const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // 3MF no formato multicolor do PrusaSlicer (lido também por OrcaSlicer, Snapmaker Orca e Bambu Studio)
  async function exportar3MF(objetos, titulo) {
    const centro = 135; // centro da mesa da U1 (270 x 270)
    let objXml = '', itens = '', cfg = '';
    const mats = [];
    objetos.forEach((ob, k) => {
      const id = k + 2;
      const v = [], t = [], vols = [];
      let baseV = 0, baseT = 0;
      ob.partes.forEach(p => {
        let mi = mats.findIndex(m => m.nome === p.nome);
        if (mi < 0) { mats.push({ nome: p.nome, cor: hex(p.cor) }); mi = mats.length - 1; }
        const P = p.malha.pos, I = p.malha.idx;
        for (let i = 0; i < P.length; i += 3) v.push(`<vertex x="${P[i].toFixed(4)}" y="${P[i + 1].toFixed(4)}" z="${P[i + 2].toFixed(4)}"/>`);
        for (let i = 0; i < I.length; i += 3) t.push(`<triangle v1="${I[i] + baseV}" v2="${I[i + 1] + baseV}" v3="${I[i + 2] + baseV}" pid="1" p1="${mi}"/>`);
        vols.push({ p, a: baseT, b: baseT + I.length / 3 - 1 });
        baseV += P.length / 3; baseT += I.length / 3;
      });
      objXml += `<object id="${id}" name="${esc(ob.nome)}" type="model" pid="1" pindex="0"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>\n`;
      itens += `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${(centro + ob.desloc[0]).toFixed(3)} ${(centro + ob.desloc[1]).toFixed(3)} 0" printable="1"/>`;
      cfg += ` <object id="${id}" instances_count="1">\n  <metadata type="object" key="name" value="${esc(ob.nome)}"/>\n  <metadata type="object" key="extruder" value="1"/>\n`;
      for (const { p, a, b } of vols) {
        cfg += `  <volume firstid="${a}" lastid="${b}">\n` +
          `   <metadata type="volume" key="name" value="${esc(p.nome)}"/>\n` +
          `   <metadata type="volume" key="volume_type" value="ModelPart"/>\n` +
          `   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
          `   <metadata type="volume" key="extruder" value="${p.filamento}"/>\n` +
          `   <mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n  </volume>\n`;
      }
      cfg += ' </object>\n';
    });
    const modelo = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
<metadata name="slic3rpe:Version3mf">1</metadata>
<metadata name="Title">${esc(titulo)}</metadata>
<metadata name="Application">PrusaSlicer-2.8.1</metadata>
<resources>
<basematerials id="1">${mats.map(m => `<base name="${esc(m.nome)}" displaycolor="${m.cor}FF"/>`).join('')}</basematerials>
${objXml}</resources>
<build>${itens}</build>
</model>`;
    const enc = new TextEncoder();
    return zip([
      { nome: '[Content_Types].xml', dados: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/plain"/></Types>') },
      { nome: '_rels/.rels', dados: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { nome: '3D/3dmodel.model', dados: enc.encode(modelo) },
      { nome: 'Metadata/Slic3r_PE_model.config', dados: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${cfg}</config>\n`) },
    ]);
  }

  function exportarSTL(objetos) {
    let nt = 0;
    objetos.forEach(o => o.partes.forEach(p => { nt += p.malha.idx.length / 3; }));
    const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
    dv.setUint32(80, nt, true);
    let o = 84;
    objetos.forEach(ob => ob.partes.forEach(p => {
      const P = p.malha.pos, I = p.malha.idx, [dx, dy] = ob.desloc;
      for (let i = 0; i < I.length; i += 3) {
        o += 12;
        for (let k = 0; k < 3; k++) {
          const j = I[i + k] * 3;
          dv.setFloat32(o, P[j] + dx, true); dv.setFloat32(o + 4, P[j + 1] + dy, true); dv.setFloat32(o + 8, P[j + 2], true); o += 12;
        }
        o += 2;
      }
    }));
    return new Uint8Array(buf);
  }

  return { PRODUTOS, analisar, montar, gerar3D, exportar3MF, exportarSTL, hex, rasterizar };
})();
