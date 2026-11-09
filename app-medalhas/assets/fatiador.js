/*
 * Fatiador do Forja 3D para a Snapmaker U1.
 *
 * Feito só para as peças do próprio app: pilhas de formas planas (base, relevo colorido,
 * degraus do pedestal). Cada camada é calculada direto dos contornos 2D, sem cortar malha.
 * Início, troca de cabeça, final e bloco de configuração seguem um G-code real do
 * Snapmaker Orca 2.4.1 que imprimiu na U1 (assets/modelo_u1.js).
 */
'use strict';

const Fatiador = (() => {
  const SC = 1000;                       // unidades do Clipper por mm
  const CL = () => ClipperLib;
  const AREA_FIL = Math.PI * 0.875 * 0.875;   // filamento 1,75 mm
  const MESA = { cx: 135.5, cy: 135.5, max: 270 };
  const TORRE = { x: 21, y: 21, l: 30 };

  // ------------------------------------------------------------ geometria 2D
  function exec(tipo, a, b) {
    const c = new (CL().Clipper)();
    if (a && a.length) c.AddPaths(a, CL().PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, CL().PolyType.ptClip, true);
    const o = new (CL().Paths)();
    c.Execute(tipo, o, CL().PolyFillType.pftNonZero, CL().PolyFillType.pftNonZero);
    return o;
  }
  const uni = (a, b) => exec(CL().ClipType.ctUnion, a, b || []);
  const dif = (a, b) => (b && b.length ? exec(CL().ClipType.ctDifference, a, b) : a);
  const inter = (a, b) => (a.length && b.length ? exec(CL().ClipType.ctIntersection, a, b) : []);
  function off(p, mm) {
    if (!p.length) return [];
    const co = new (CL().ClipperOffset)(2, 0.01 * SC);
    co.AddPaths(p, CL().JoinType.jtRound, CL().EndType.etClosedPolygon);
    const o = new (CL().Paths)(); co.Execute(o, mm * SC); return o;
  }
  const area = p => p.reduce((s, r) => s + CL().Clipper.Area(r), 0) / (SC * SC);
  const mover = (p, dx, dy, k = 1) => p.map(r => r.map(q => ({ X: Math.round(q.X * k + dx * SC), Y: Math.round(q.Y * k + dy * SC) })));
  const limpa = (p, min = 0.02) => p.filter(r => Math.abs(CL().Clipper.Area(r)) / (SC * SC) >= min);

  // linhas paralelas (hachura) recortadas pela área; devolve segmentos [[x,y],[x,y]] em mm
  function hachura(paths, angGraus, esp, fase = 0) {
    if (!paths.length) return [];
    const a = angGraus * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const rot = paths.map(r => r.map(q => ({ X: Math.round(q.X * c + q.Y * s), Y: Math.round(-q.X * s + q.Y * c) })));
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const r of rot) for (const q of r) { y0 = Math.min(y0, q.Y); y1 = Math.max(y1, q.Y); x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); }
    const E = esp * SC, linhas = [];
    for (let y = Math.ceil((y0 - fase * SC) / E) * E + fase * SC; y <= y1; y += E)
      linhas.push([{ X: x0 - 10, Y: Math.round(y) }, { X: x1 + 10, Y: Math.round(y) }]);
    if (!linhas.length) return [];
    const cp = new (CL().Clipper)();
    cp.AddPaths(linhas, CL().PolyType.ptSubject, false);
    cp.AddPaths(rot, CL().PolyType.ptClip, true);
    const t = new (CL().PolyTree)();
    cp.Execute(CL().ClipType.ctIntersection, t, CL().PolyFillType.pftNonZero, CL().PolyFillType.pftNonZero);
    const abertos = CL().Clipper.OpenPathsFromPolyTree(t);
    const segs = abertos.filter(p => p.length >= 2).map(p => {
      const [u, v] = [p[0], p[p.length - 1]];
      const y = u.Y, xa = Math.min(u.X, v.X), xb = Math.max(u.X, v.X);
      return { y, xa, xb };
    }).filter(sg => sg.xb - sg.xa > 0.15 * SC);
    segs.sort((p, q) => p.y - q.y || p.xa - q.xa);
    // zigue-zague: alterna o sentido a cada linha
    const out = []; let ultimoY = null, sentido = 1;
    for (const sg of segs) {
      if (sg.y !== ultimoY) { sentido = -sentido; ultimoY = sg.y; }
      const pa = [sg.xa, sg.y], pb = [sg.xb, sg.y];
      const [p, q] = sentido > 0 ? [pa, pb] : [pb, pa];
      const vol = ([x, y]) => [(x * c - y * s) / SC, (x * s + y * c) / SC];
      out.push([vol(p), vol(q)]);
    }
    return out;
  }

  // ordena trechos pelo mais próximo (pode inverter o sentido) e junta linhas vizinhas
  // numa polilinha contínua quando a ponte é curta (como o retilíneo "conectado" do Orca)
  function ordenar(segs, ponte) {
    const out = [], usado = new Uint8Array(segs.length);
    let px = null, py = null, atual = null;
    for (let n = 0; n < segs.length; n++) {
      let bi = -1, bd = Infinity, inv = false;
      for (let i = 0; i < segs.length; i++) {
        if (usado[i]) continue;
        if (px === null) { bi = i; break; }
        const a = segs[i][0], b = segs[i][segs[i].length - 1];
        const da = (a[0] - px) ** 2 + (a[1] - py) ** 2, db = (b[0] - px) ** 2 + (b[1] - py) ** 2;
        if (da < bd) { bd = da; bi = i; inv = false; }
        if (db < bd) { bd = db; bi = i; inv = true; }
        if (bd < 1e-6) break;
      }
      usado[bi] = 1;
      const sg = inv ? segs[bi].slice().reverse() : segs[bi];
      if (atual && ponte > 0 && Math.sqrt(bd) <= ponte) atual.push(...sg);
      else { atual = sg.slice(); out.push(atual); }
      [px, py] = sg[sg.length - 1];
    }
    return out;
  }

  // laço fechado em mm, começando no ponto mais ao fundo (costura alinhada)
  function laco(r) {
    let k = 0;
    for (let i = 1; i < r.length; i++) if (r[i].Y > r[k].Y || (r[i].Y === r[k].Y && r[i].X < r[k].X)) k = i;
    const p = [];
    for (let i = 0; i <= r.length; i++) { const q = r[(k + i) % r.length]; p.push([q.X / SC, q.Y / SC]); }
    return p;
  }

  // ------------------------------------------------------------ peça -> sólidos
  // sólido = {paths (mm em torno da origem do objeto), z0, z1, escala, fil (1..4), obj}
  function solidos(peca, objetos) {
    const out = [];
    const d0 = objetos[0].desloc;
    out.push({ paths: peca.contorno, z0: 0, z1: peca.espessura, escala: 1, fil: 1, obj: 0, desloc: d0 });
    peca.camadas.forEach((c, i) => out.push({ paths: c.paths, z0: peca.espessura, z1: peca.espessura + peca.relevo, escala: 1, fil: i + 2, obj: 0, desloc: d0 }));
    if (peca.extras.trofeu) {
      const d1 = objetos[1].desloc;
      peca.extras.trofeu.pedestal.niveis.forEach(n => out.push({ paths: n.paths, z0: n.z0, z1: n.z1, escala: n.escala || 1, fil: 1, obj: 1, desloc: d1 }));
    }
    return out;
  }

  // alturas das camadas: respeita exatamente o fim da base, do relevo e de cada degrau
  function planejarCamadas(sol, h, h0) {
    const zs = [...new Set(sol.flatMap(s => [s.z0, s.z1]).map(z => Math.round(z * 1000) / 1000))].sort((a, b) => a - b);
    const cam = [];
    let z = 0;
    for (let i = 1; i < zs.length; i++) {
      const a = zs[i - 1], b = zs[i];
      let ini = a;
      if (a === 0) { const p = Math.min(h0, b); cam.push({ z: p, h: p }); ini = p; }
      const L = b - ini;
      if (L < 0.05) { if (cam.length) { cam[cam.length - 1].z = b; cam[cam.length - 1].h += L; } continue; }
      const n = Math.max(1, Math.round(L / h));
      for (let k = 1; k <= n; k++) cam.push({ z: ini + L * k / n, h: L / n });
    }
    return cam.map(c => ({ z: Math.round(c.z * 1000) / 1000, h: Math.round(c.h * 1000) / 1000 }));
  }

  // ------------------------------------------------------------ fatiar
  function fatiar(peca, objetos, opt) {
    const P = Object.assign({
      h: 0.2, h0: 0.25, paredes: 2, topo: 5, fundo: 3, infill: 0.15,
      ferro: 'top', ferroFluxo: 0.10, ferroEsp: 0.13, ferroVel: 30,
      temps: [220, 220, 220, 220], mesa: 65, tipos: ['PLA', 'PLA', 'PLA', 'PLA'], cores: ['#000000', '#FF0000', '#FFFF00', '#FFFFFF'],
      vitrificacao: 45,
    }, opt);
    const V = { externa: 80, interna: 120, esparso: 270, solido: 250, topo: 80, prim: 50, primInfill: 105, viagem: 500, torre: 90 };
    const W = { externa: 0.42, interna: 0.45, esparso: 0.45, solido: 0.42, topo: 0.42, prim: 0.5, torre: 0.5 };
    const VOLMAX = 12;           // mm³/s (filament_max_volumetric_speed)
    const RET = 1.5, RET_TROCA = 10, HOP = 0.4;

    const sol = solidos(peca, objetos);
    const camadas = planejarCamadas(sol, P.h, P.h0);
    const N = camadas.length;
    const nObj = Math.max(...sol.map(s => s.obj)) + 1;

    // regiões por camada, objeto e filamento (já na posição da mesa)
    const reg = camadas.map(c => {
      const zm = c.z - c.h / 2;
      const porObj = [];
      for (let o = 0; o < nObj; o++) {
        const porFil = {};
        for (const s of sol) {
          if (s.obj !== o || !(s.z0 < zm && zm < s.z1)) continue;
          const k = 1 + (s.escala - 1) * (zm - s.z0) / (s.z1 - s.z0);
          const p = mover(s.paths, MESA.cx + s.desloc[0], MESA.cy + s.desloc[1], k);
          porFil[s.fil] = porFil[s.fil] ? uni(porFil[s.fil], p) : uni(p);
        }
        const tudo = Object.values(porFil).reduce((a, p) => uni(a, p), []);
        porObj.push({ porFil, tudo });
      }
      return porObj;
    });

    const T = Math.max(P.topo, Math.ceil(1.0 / P.h)), B = Math.max(P.fundo, Math.ceil(0.8 / P.h));
    const ocupado = (l, o) => (l < 0 || l >= N ? [] : reg[l][o].tudo);

    // ---- plano de cada camada: para cada filamento, a lista de trajetos
    // trajeto = {tipo, pts:[[x,y]...], fechado, w, v, fluxo}
    const plano = camadas.map((c, l) => {
      const primeira = l === 0;
      const porFil = {};
      for (let o = 0; o < nObj; o++) {
        // miolo (coberto por cima e por baixo) é o que pode ter preenchimento esparso
        let miolo = ocupado(l, o);
        for (let j = 1; j <= T && miolo.length; j++) miolo = inter(miolo, ocupado(l + j, o));
        for (let j = 1; j <= B && miolo.length; j++) miolo = inter(miolo, ocupado(l - j, o));
        const acima = ocupado(l + 1, o), abaixo = ocupado(l - 1, o);
        for (const [fs, R] of Object.entries(reg[l][o].porFil)) {
          const f = +fs, lista = porFil[f] = porFil[f] || [];
          const wo = primeira ? W.prim : W.externa, wi = primeira ? W.prim : W.interna;
          // paredes: de dentro para fora
          const voltas = [];
          for (let k = 0; k < P.paredes; k++) {
            const d = k === 0 ? wo / 2 : wo + wi * (k - 0.5);
            const lp = limpa(off(R, -d), 0.01);
            if (!lp.length) break;
            voltas.push({ lp, w: k === 0 ? wo : wi, ext: k === 0 });
          }
          for (const vt of voltas.slice().reverse()) {
            const lacos = vt.lp.map(laco), feitos = new Uint8Array(lacos.length);
            let ux = null, uy = null;
            for (let n = 0; n < lacos.length; n++) {
              let bi = 0, bd = Infinity;
              lacos.forEach((lp, i) => { if (feitos[i]) return; const d = ux === null ? 0 : (lp[0][0] - ux) ** 2 + (lp[0][1] - uy) ** 2; if (d < bd) { bd = d; bi = i; } });
              feitos[bi] = 1; [ux, uy] = lacos[bi][0];
              lista.push({ tipo: vt.ext ? 'Outer wall' : 'Inner wall', pts: lacos[bi], w: vt.w, v: primeira ? V.prim : (vt.ext ? V.externa : V.interna), obj: o });
            }
          }
          // partes finas demais para uma parede: um contorno estreito
          const fino = limpa(dif(R, off(off(R, -wo / 2), wo / 2 + 0.02)), 0.05);
          for (const r of limpa(off(fino, -0.12), 0.02)) lista.push({ tipo: 'Outer wall', pts: laco(r), w: 0.3, v: primeira ? V.prim : V.externa, obj: o });
          // área de preenchimento
          const dentro = voltas.length ? off(R, -(wo + wi * (voltas.length - 1) - 0.15 * wi)) : [];
          if (!dentro.length) continue;
          const topo = limpa(inter(dentro, dif(R, acima)), 0.05);
          const fundo = primeira ? dentro : limpa(inter(dentro, dif(R, abaixo)), 0.05);
          const solido = limpa(dif(dentro, miolo), 0.03);
          const interno = limpa(dif(dif(solido, topo), fundo), 0.03);
          const esparso = limpa(inter(dentro, miolo), 0.03);
          const ang = l % 2 ? -45 : 45;
          const add = (segs, tipo, w, v, ponte = 1.6 * w) => { for (const s of ordenar(segs, ponte)) lista.push({ tipo, pts: s, w, v, obj: o }); };
          if (primeira) add(hachura(dentro, ang, W.prim), 'Bottom surface', W.prim, V.primInfill);
          else {
            add(hachura(fundo, ang, W.solido), 'Bottom surface', W.solido, V.solido);
            add(hachura(interno, ang, W.solido), 'Internal solid infill', W.solido, V.solido);
            if (esparso.length && P.infill > 0) {
              const esp = 2 * W.esparso / P.infill;          // grade: duas direções na mesma camada
              add(hachura(esparso, 45, esp).concat(hachura(esparso, -45, esp)), 'Sparse infill', W.esparso, V.esparso, 0);
            }
            add(hachura(topo, ang, W.topo), 'Top surface', W.topo, V.topo);
          }
          // passar ferro
          const ehTopoFinal = !acima.length || area(inter(R, acima)) < 0.01;
          const quer = P.ferro === 'top' ? topo.length > 0 : P.ferro === 'topmost' ? (ehTopoFinal && topo.length > 0) : P.ferro === 'solid' ? solido.length > 0 : false;
          if (quer && !primeira) {
            const alvo = P.ferro === 'solid' ? solido : topo;
            for (const s of ordenar(hachura(limpa(off(alvo, -W.topo / 2), 0.05), ang + 90, P.ferroEsp), 1.6 * P.ferroEsp))
              lista.push({ tipo: 'Ironing', pts: s, w: W.topo, v: P.ferroVel, fluxo: P.ferroFluxo, esp: P.ferroEsp, obj: o });
          }
        }
      }
      return porFil;
    });

    // ---- ordem das cabeças em cada camada e torre de limpeza
    const usados = new Set(); plano.forEach(pf => Object.keys(pf).forEach(f => { if (pf[f].length) usados.add(+f); }));
    const multicor = usados.size > 1;
    let atual = Math.min(...usados);
    const ordem = plano.map((pf, l) => {
      const fs = Object.keys(pf).map(Number).filter(f => pf[f].length).sort((a, b) => a - b);
      if (l % 2) fs.reverse();
      const i = fs.indexOf(atual);
      if (i > 0) { fs.splice(i, 1); fs.unshift(atual); }
      if (fs.length) atual = fs[fs.length - 1];
      return fs;
    });
    let ultimaTroca = -1, ant = ordem[0][0];
    ordem.forEach((fs, l) => { fs.forEach(f => { if (f !== ant) ultimaTroca = l; ant = f; }); });
    const alturaTorre = multicor ? ultimaTroca : -1;

    // ------------------------------------------------------------ G-code
    const g = [], prev = [];        // prev: trajetos de cada camada para a pré-visualização
    let x = 0, y = 0, z = 0, cab = 0, recolhido = 0, tipoAt = '', wAt = 0, acel = 0, tempo = 0, tempo1 = 0;
    const usoE = [0, 0, 0, 0];
    const f3 = v => (Math.round(v * 1000) / 1000).toString();
    const eMm = (w, h) => ((w - h) * h + Math.PI * (h / 2) ** 2) / AREA_FIL * 0.98;
    const setAcel = a => { if (a !== acel) { g.push(`SET_VELOCITY_LIMIT ACCEL=${a} ACCEL_TO_DECEL=${a / 2}`); acel = a; } };
    const recolher = (mm = RET) => { if (recolhido < mm) { g.push(`G1 E-${f3(mm - recolhido)} F1800`); recolhido = mm; } };
    const devolver = () => { if (recolhido > 0) { g.push(`G1 E${f3(Math.min(recolhido, RET))} F1800`); recolhido = 0; } };
    function viajar(nx, ny, zc) {
      const d = Math.hypot(nx - x, ny - y);
      if (d < 0.01) return;
      if (d > 2) {
        recolher();
        g.push(`G1 Z${f3(zc + HOP)} F30000`, `G1 X${f3(nx)} Y${f3(ny)} F30000`, `G1 Z${f3(zc)}`);
      } else g.push(`G1 X${f3(nx)} Y${f3(ny)} F30000`);
      tempo += d / V.viagem + (d > 2 ? 0.15 : 0);
      x = nx; y = ny;
    }
    function extrudar(t, zc, h, l) {
      const pts = t.pts;
      viajar(pts[0][0], pts[0][1], zc);
      devolver();
      if (t.tipo !== tipoAt) { g.push(`;TYPE:${t.tipo}`); tipoAt = t.tipo; }
      if (t.w !== wAt) { g.push(`;WIDTH:${t.w}`); wAt = t.w; }
      setAcel(l === 0 ? 500 : t.tipo === 'Outer wall' ? 5000 : (t.tipo === 'Top surface' || t.tipo === 'Ironing') ? 2000 : 10000);
      // passar ferro como no Orca: fluxo × espaçamento × altura da camada
      const em = t.fluxo ? t.fluxo * t.esp * h / AREA_FIL : eMm(t.w, h);
      let v = t.v;
      if (!t.fluxo) v = Math.min(v, VOLMAX / ((t.w - h) * h + Math.PI * (h / 2) ** 2));
      let primeiro = true;
      for (let i = 1; i < pts.length; i++) {
        const [nx, ny] = pts[i], d = Math.hypot(nx - x, ny - y);
        if (d < 0.005) continue;
        const e = d * em; usoE[cab] += e;
        g.push(`G1 X${f3(nx)} Y${f3(ny)} E${e.toFixed(5)}${primeiro ? ` F${Math.round(v * 60)}` : ''}`);
        primeiro = false;
        tempo += d / v; x = nx; y = ny;
      }
      prev[l].push({ f: cab + 1, tipo: t.tipo, pts });
    }
    function torre(l, zc, h, faixa, nFaixas, cheia) {
      if (l > alturaTorre) return;
      const { x: tx, y: ty, l: tl } = TORRE, w = W.torre;
      const borda = [[tx, ty], [tx + tl, ty], [tx + tl, ty + tl], [tx, ty + tl], [tx, ty]];
      if (faixa === 0) extrudar({ tipo: 'Prime tower', pts: borda, w, v: l === 0 ? V.prim : V.torre }, zc, h, l);
      const y0 = ty + w + (tl - 2 * w) * faixa / nFaixas, y1 = ty + w + (tl - 2 * w) * (faixa + 1) / nFaixas;
      const esp = cheia ? w : 3;
      let lado = 0;
      for (let yy = y0 + w / 2; yy <= y1 - w / 2 + 1e-6; yy += esp, lado ^= 1) {
        const a = [tx + w, yy], b = [tx + tl - w, yy];
        extrudar({ tipo: 'Prime tower', pts: lado ? [b, a] : [a, b], w, v: l === 0 ? V.prim : V.torre }, zc, h, l);
      }
    }
    function trocar(nova, l, zc) {
      const velha = cab;
      recolher(RET_TROCA);
      g.push(`M104 S${P.temps[velha] - 150} T${velha} ; set nozzle temperature ;cooldown`,
        ';===== date: 20261003 =====================',
        `; Change Tool${velha} -> Tool${nova} (layer ${l})`,
        `; max_layer_z ${f3(zc)}`, '; max_print_height 270', '; print_sequence by layer', '',
        'G91', 'G1 Z1.5 F600', 'G90', 'G1 F21000', '', `; ${l}`,
        `M104 S${P.temps[nova]} T${nova}`, 'M400', `T${nova}`, `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=${nova}`, 'G90',
        'M106 P2 S178', 'M106 S255', `M104 S${P.temps[nova]} T${nova} ; set nozzle temperature`);
      cab = nova; recolhido = 0; tipoAt = ''; wAt = 0; acel = 0;
      tempo += 28;
      // a nova cabeça vem por cima: vai até a torre e desce
      g.push(`G1 X${f3(TORRE.x)} Y${f3(TORRE.y)} F30000`, `G1 E-${RET} F1800`, `G1 Z${f3(zc)} F30000`, `G1 E${RET} F1800`);
      x = TORRE.x; y = TORRE.y;
    }

    // objetos para exclusão (Klipper)
    const nomesObj = [], defs = [];
    for (let o = 0; o < nObj; o++) {
      const base = sol.filter(s => s.obj === o && s.z0 === 0).flatMap(s => mover(s.paths, MESA.cx + s.desloc[0], MESA.cy + s.desloc[1]));
      const pts = base.flat().map(q => [q.X / SC, q.Y / SC]);
      const casca = envoltoria(pts);
      const cx = casca.reduce((a, p) => a + p[0], 0) / casca.length, cy = casca.reduce((a, p) => a + p[1], 0) / casca.length;
      const nome = (objetos[o].nome || 'peca').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_') + `_id_${o}_copy_0`;
      nomesObj.push(nome);
      defs.push(`EXCLUDE_OBJECT_DEFINE NAME=${nome} CENTER=${f3(cx)},${f3(cy)} POLYGON=[${casca.map(p => `[${p[0].toFixed(1)},${p[1].toFixed(1)}]`).join(',')}]`);
    }

    // corpo
    const corpo = [];
    const progresso = [];   // [índice em g, tempo acumulado]
    cab = 0;   // o início (PRINT_START) deixa a cabeça T0 pronta
    g.push(`G1 Z${f3(camadas[0].z)} F30000`, 'M106 S0', 'M106 P2 S0');
    camadas.forEach((c, l) => {
      prev.push([]);
      progresso.push([g.length, tempo]);
      g.push('{M73}');
      g.push(';LAYER_CHANGE', `;Z:${f3(c.z)}`, `;HEIGHT:${f3(c.h)}`, ';BEFORE_LAYER_CHANGE', `;${f3(c.z)}`, 'G92 E0',
        'TIMELAPSE_TAKE_FRAME', 'DEFECT_DETECTION_DETECT', ';AFTER_LAYER_CHANGE', `;${f3(c.z)}`,
        `SET_PRINT_STATS_INFO TOTAL_LAYER=${N} CURRENT_LAYER=${l + 1}`);
      recolher();
      g.push(`G1 Z${f3(c.z)} F30000`); z = c.z;
      const fs = ordem[l];
      fs.forEach((f, i) => {
        const tc = f - 1;
        if (tc !== cab) trocar(tc, l, c.z);
        if (multicor) torre(l, c.z, c.h, i, fs.length, l === 0 || fs.length > 1 || (i === 0 && l > 0 && ordem[l - 1].slice(-1)[0] !== f));
        for (let o = 0; o < nObj; o++) {
          const ts = (plano[l][f] || []).filter(t => t.obj === o);
          if (!ts.length) continue;
          g.push(`EXCLUDE_OBJECT_START NAME=${nomesObj[o]}`);
          for (const t of ts) extrudar(t, c.z, c.h, l);
          recolher();
          g.push(`EXCLUDE_OBJECT_END NAME=${nomesObj[o]}`);
        }
      });
      if (fs.length === 0 && multicor) torre(l, c.z, c.h, 0, 1, false);
      if (l === 0) { tempo1 = tempo; g.push('M106 S255', 'M106 P2 S178'); }
    });
    recolher();
    g.push('M106 S0', 'M106 P2 S0', ';TYPE:Custom', ';===== date: 20261003 =====================', `; layer ${N}`,
      `; max_layer_z ${f3(camadas[N - 1].z)}`, '; print_sequence by layer', '', '', '', 'PRINT_END', 'TIMELAPSE_STOP', 'M73 P100 R0');

    // tempo total: corpo + aceleração (estimativa) + início
    const INICIO = 6 * 60, fatorAcel = 1.25;
    const total = INICIO + tempo * fatorAcel;
    for (const [i, t] of progresso) {
      const feito = INICIO + t * fatorAcel;
      g[i] = `M73 P${Math.min(99, Math.floor(100 * feito / total))} R${Math.max(0, Math.round((total - feito) / 60))}`;
    }
    const trocas = g.filter(s => /^; Change Tool/.test(s)).length;
    const mm = usoE, cm3 = mm.map(v => v * AREA_FIL / 1000), gr = cm3.map(v => v * 1.24);
    return {
      camadas, prev, linhas: g, defs, tempoTotal: total, tempoPrimeira: tempo1 * fatorAcel, trocas,
      uso: { mm, cm3, gr }, multicor, alturaTorre, P,
    };
  }

  function envoltoria(pts) {      // casca convexa (monotone chain)
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }

  // ------------------------------------------------------------ arquivo final
  function hms(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? `${h}h ` : '') + (h || m ? `${m}m ` : '') + `${ss}s`; }

  function miniatura(png64, w, h) {
    const linhas = [`; thumbnail begin ${w}x${h} ${png64.length}`];
    for (let i = 0; i < png64.length; i += 78) linhas.push('; ' + png64.slice(i, i + 78));
    linhas.push('; thumbnail end');
    return ['; THUMBNAIL_BLOCK_START', '', ';', ...linhas, '; THUMBNAIL_BLOCK_END', ''];
  }

  function montarArquivo(r, miniaturas, ajustesConfig) {
    const P = r.P, N = r.camadas.length, agora = new Date();
    const d2 = n => String(n).padStart(2, '0');
    const data = `${agora.getFullYear()}-${d2(agora.getMonth() + 1)}-${d2(agora.getDate())} at ${d2(agora.getHours())}:${d2(agora.getMinutes())}:${d2(agora.getSeconds())}`;
    const cab = ['; HEADER_BLOCK_START', `; generated by Snapmaker Orca 2.4.1 on ${data}`, `; total layer number: ${N}`,
      '; filament_density: 1.24,1.24,1.24,1.24', '; filament_diameter: 1.75,1.75,1.75,1.75', `; max_z_height: ${r.camadas[N - 1].z.toFixed(2)}`,
      '; HEADER_BLOCK_END', '', '; Fatiado pelo Forja 3D (fatiador de pecas planas)', ''];
    const mini = miniaturas.flatMap(m => miniatura(m.b64, m.w, m.h));
    const larg = ['; external perimeters extrusion width = 0.42mm', '; perimeters extrusion width = 0.45mm', '; infill extrusion width = 0.45mm',
      '; solid infill extrusion width = 0.42mm', '; top infill extrusion width = 0.42mm', '; first layer extrusion width = 0.50mm', ''];
    const purif = P.vitrificacao <= 50 ? '; 强冷\nSET_PURIFIER_MODE MODE=1 DESIRE_TEMP=42 ALARM_TEMP=48 FAN_SPEED=0.6 DELAY_OFF=0'
      : P.vitrificacao <= 70 ? 'SET_PURIFIER_MODE MODE=1 DESIRE_TEMP=45 ALARM_TEMP=51 FAN_SPEED=0.6 DELAY_OFF=0 ; weak cooling'
        : 'SET_PURIFIER_MODE MODE=3 DESIRE_TEMP=45 FAN_SPEED=0.6 DELAY_OFF=600 ; keep warm';
    const inicio = MODELO_U1.inicio.replace('{L}', N).replace(/\{BED\}/g, P.mesa).replace(/\{T0\}/g, P.temps[0]).replace('{PURIFICADOR}', purif);
    const exec = ['; EXECUTABLE_BLOCK_START', ...r.defs, `M73 P0 R${Math.round(r.tempoTotal / 60)}`, inicio, ...r.linhas, '; EXECUTABLE_BLOCK_END', ''];
    const fmt = a => a.map(v => v.toFixed(2)).join(', ');
    const tot = r.uso.gr.reduce((a, b) => a + b, 0);
    const rod = [`; filament used [mm] = ${fmt(r.uso.mm)}`, `; filament used [cm3] = ${fmt(r.uso.cm3)}`, `; filament used [g] = ${fmt(r.uso.gr)}`,
      `; filament cost = ${fmt(r.uso.gr.map(v => v * 0.02))}`, `; total filament used [g] = ${tot.toFixed(2)}`, `; total filament cost = ${(tot * 0.02).toFixed(2)}`,
      `; total filament change = ${r.trocas}`, `; total layers count = ${N}`,
      `; estimated printing time (normal mode) = ${hms(r.tempoTotal)}`, `; estimated first layer printing time (normal mode) = ${hms(r.tempoPrimeira)}`, ''];
    const cfg = MODELO_U1.config.map(l => {
      const m = /^; ([a-z0-9_]+) = /.exec(l);
      return m && m[1] in ajustesConfig ? `; ${m[1]} = ${ajustesConfig[m[1]]}` : l;
    });
    return [...cab, ...mini, ...larg, ...exec, ...rod, ...cfg, ''].join('\n');
  }

  return { fatiar, montarArquivo, hms };
})();
