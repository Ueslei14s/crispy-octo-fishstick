'use strict';
// Aba "Fatiar arquivo": qualquer 3MF/STL -> G-code da Snapmaker U1, com gerenciamento de cores.

const PRESETS = {
  ultra:     { nome: 'Ultra qualidade (0,08 mm)', desc: 'Detalhes máximos e topo passado a ferro. Lento.', h: 0.08, h0: 0.2, paredes: 3, topo: 10, fundo: 7, infill: 0.15, ferro: 'topmost', velFator: 0.7 },
  alta:      { nome: 'Alta qualidade (0,12 mm)', desc: 'Ótimo acabamento para peças com detalhes, miniaturas e logos.', h: 0.12, h0: 0.2, paredes: 3, topo: 7, fundo: 5, infill: 0.15, ferro: 'top', velFator: 0.85 },
  otima:     { nome: 'Ótima (0,16 mm)', desc: 'Equilíbrio entre qualidade e tempo.', h: 0.16, h0: 0.25, paredes: 3, topo: 6, fundo: 4, infill: 0.15, ferro: 'no ironing', velFator: 1 },
  padrao:    { nome: 'Padrão (0,20 mm)', desc: 'O perfil padrão da U1 para o dia a dia.', h: 0.20, h0: 0.25, paredes: 2, topo: 5, fundo: 3, infill: 0.15, ferro: 'no ironing', velFator: 1 },
  resistente:{ nome: 'Resistente (0,20 mm)', desc: 'Mais paredes e preenchimento para peças funcionais.', h: 0.20, h0: 0.25, paredes: 4, topo: 6, fundo: 4, infill: 0.40, ferro: 'no ironing', velFator: 1 },
  rascunho:  { nome: 'Rascunho rápido (0,28 mm)', desc: 'Para testar tamanho e encaixe rapidamente.', h: 0.28, h0: 0.3, paredes: 2, topo: 4, fundo: 3, infill: 0.10, ferro: 'no ironing', velFator: 1 },
};
const MATERIAL_PERFIL = { PLA: 'PLA', 'PLA SILK': 'PLA Silk', 'PLA HS': 'PLA Alta Velocidade', PETG: 'PETG' };

const fa = { modelo: null, mapa: {}, slots: null, fatia: null, gcode: null, nome: 'peca' };
const R2 = criarVisor($('view2'));
window.R2 = R2;

// ---------------------------------------------------------------- perfis
Object.entries(PRESETS).forEach(([id, p]) => { const o = document.createElement('option'); o.value = id; o.textContent = p.nome; $('selPreset').append(o); });
$('selPreset').value = 'padrao';
$('selPreset').onchange = () => { $('descPreset').textContent = PRESETS[$('selPreset').value].desc; limparFatia2(); };
$('selPreset').onchange();
['selSup', 'nBrim', 'selFerro2', 'nInfill2'].forEach(id => $(id).onchange = limparFatia2);

// ---------------------------------------------------------------- abrir arquivo
$('bModelo').onclick = () => $('inModelo').click();
$('inModelo').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  await abrirModelo(new Uint8Array(await f.arrayBuffer()), f.name);
};
window.abrirModeloBase64 = async (b64, nome) => {   // vindo do "Compartilhar"/"Abrir com"
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  $('abas').querySelector('[data-v=fatiar]').click();
  await abrirModelo(u, nome);
};
async function abrirModelo(bytes, nome) {
  msg2('Abrindo ' + nome + '…');
  $('avisosModelo').textContent = '';
  try {
    const lido = await Malhas.ler(bytes, nome);
    fa.lido = lido;
    const sel = $('selPlaca'); sel.innerHTML = '';
    lido.placas.forEach(p => { const o = document.createElement('option'); o.value = p.n; o.textContent = `Placa ${p.n}${p.nome ? ' · ' + p.nome : ''} (${lido.objetos.filter(x => x.placa === p.n).length} objeto(s))`; sel.append(o); });
    $('boxPlaca').hidden = lido.placas.length < 2;
    $('selOrigem').value = lido.config ? 'arquivo' : 'perfil';
    $('selOrigem').querySelector('[value=arquivo]').disabled = !lido.config;
    const m = Malhas.posicionar(lido, lido.placas.length > 1 ? lido.placas[0].n : undefined);
    fa.modelo = m; fa.nome = nome.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'peca';
    const fils = filamentosDoModelo();
    let tri = 0; m.objetos.forEach(o => o.volumes.forEach(v => { tri += v.tri.length / 9; }));
    $('infoModelo').textContent = `${nome}: ${m.objetos.length} objeto(s), ${m.objetos.reduce((a, o) => a + o.volumes.length, 0)} parte(s), ` +
      `${fils.length} cor(es), ${Math.round(tri / 1000)} mil triângulos · ${m.tamanho.x.toFixed(1)} × ${m.tamanho.y.toFixed(1)} × ${m.tamanho.z.toFixed(1)} mm`;
    const av = m.avisos.slice();
    if (!m.cabe) av.push('A peça é maior que a área útil da U1 (270 × 270 × 270 mm). Reduza a escala no fatiador do computador antes.');
    if (fils.length > 4) av.push(`O arquivo usa ${fils.length} cores e a U1 tem 4 cabeças: algumas cores vão dividir a mesma cabeça.`);
    $('avisosModelo').textContent = av.join('\n');
    fa.mapa = {}; fils.forEach((f, i) => { fa.mapa[f] = (f - 1) % 4; });
    if (fa.slots) autoMapa();
    montarMapa();
    mostrarModelo();
    $('bFatiar2').disabled = !m.cabe;
    atualizarOrigem();
    limparFatia2();
    msg2('Arquivo aberto. Confira as cores e o perfil e toque em Fatiar.', 'ok');
  } catch (e) { console.error(e); msg2('Não consegui abrir: ' + e.message, 'err'); }
}
$('selPlaca').onchange = () => {
  fa.modelo = Malhas.posicionar(fa.lido, +$('selPlaca').value);
  const m = fa.modelo;
  $('infoModelo').textContent = `Placa ${$('selPlaca').value}: ${m.objetos.length} objeto(s), ${m.objetos.reduce((a, o) => a + o.volumes.length, 0)} parte(s), ` +
    `${filamentosDoModelo().length} cor(es) · ${m.tamanho.x.toFixed(1)} × ${m.tamanho.y.toFixed(1)} × ${m.tamanho.z.toFixed(1)} mm`;
  const fils = filamentosDoModelo(); fils.forEach(f => { if (fa.mapa[f] === undefined) fa.mapa[f] = (f - 1) % 4; });
  if (fa.slots) autoMapa();
  montarMapa(); mostrarModelo(); limparFatia2();
  $('bFatiar2').disabled = !fa.modelo.cabe;
};
$('selOrigem').onchange = () => { atualizarOrigem(); limparFatia2(); };
function atualizarOrigem() {
  const arq = $('selOrigem').value === 'arquivo' && fa.lido && fa.lido.config;
  $('boxPreset').hidden = $('descPreset').hidden = !!arq;
  $('resumoCfg').textContent = arq ? configDoArquivo().resumo : (fa.lido && !fa.lido.config ? 'Este arquivo não traz configurações de impressão (ex.: STL ou 3MF simples): escolha um perfil.' : '');
}

// ---------------------------------------------------------------- configurações salvas no 3MF
const num = (v, i = 0) => {
  if (v === undefined || v === null) return undefined;
  const lista = Array.isArray(v) ? v : String(v).split(/[,;]/);
  const x = parseFloat(lista[i] !== undefined ? lista[i] : lista[0]);
  return isNaN(x) ? undefined : x;
};
const CHAPA = { 'Textured PEI Plate': 'textured_plate_temp', 'Cool Plate': 'cool_plate_temp', 'Engineering Plate': 'eng_plate_temp', 'High Temp Plate': 'hot_plate_temp', 'Smooth PEI Plate': 'hot_plate_temp', 'Supertack Plate': 'supertack_plate_temp' };
const NOME_CHAPA = { 'Textured PEI Plate': 'PEI texturizada', 'Cool Plate': 'chapa fria', 'Engineering Plate': 'chapa de engenharia', 'High Temp Plate': 'chapa de alta temperatura', 'Smooth PEI Plate': 'PEI lisa', 'Supertack Plate': 'Supertack' };
function traduzAjustes(c) {     // chaves do Orca -> opções do fatiador (só as presentes)
  const o = {}, n = k => num(c[k]);
  if (n('wall_loops') !== undefined) o.paredes = n('wall_loops');
  if (n('top_shell_layers') !== undefined) o.topo = n('top_shell_layers');
  if (n('bottom_shell_layers') !== undefined) o.fundo = n('bottom_shell_layers');
  if (n('sparse_infill_density') !== undefined) o.infill = n('sparse_infill_density') / 100;
  if (c.ironing_type) o.ferro = String(c.ironing_type);
  if (n('ironing_flow') !== undefined) o.ferroFluxo = n('ironing_flow') / 100;
  if (n('ironing_spacing') !== undefined) o.ferroEsp = n('ironing_spacing');
  if (n('ironing_speed') !== undefined) o.ferroVel = n('ironing_speed');
  if (c.brim_type) o.brimTipo = String(c.brim_type);
  if (n('brim_width') !== undefined) o.brimLarg = n('brim_width');
  return o;
}
function configDoArquivo() {
  const c = fa.lido.config, o = traduzAjustes(c), res = [], ign = [];
  o.h = num(c.layer_height) || 0.2; o.h0 = num(c.initial_layer_print_height) || Math.max(0.2, o.h);
  if (o.paredes === undefined) o.paredes = 2; if (o.topo === undefined) o.topo = 5; if (o.fundo === undefined) o.fundo = 3;
  if (o.infill === undefined) o.infill = 0.15; if (!o.ferro) o.ferro = 'no ironing';
  o.ferroFluxo = o.ferroFluxo || 0.10; o.ferroEsp = o.ferroEsp || 0.13; o.ferroVel = o.ferroVel || 30;
  const sup = String(c.enable_support) === '1' || c.enable_support === true;
  o.suporte = !sup ? 'off' : (String(c.support_on_build_plate_only) === '1' ? 'mesa' : 'tudo');
  o.anguloSuporte = num(c.support_threshold_angle) || 30;
  const vel = { externa: 'outer_wall_speed', interna: 'inner_wall_speed', esparso: 'sparse_infill_speed', solido: 'internal_solid_infill_speed', topo: 'top_surface_speed',
    prim: 'initial_layer_speed', primInfill: 'initial_layer_infill_speed', viagem: 'travel_speed', suporte: 'support_speed' };
  o.vel = {}; for (const [k, ch] of Object.entries(vel)) { const v = num(c[ch]); if (v) o.vel[k] = v; }
  o.tempsFil = Array.isArray(c.nozzle_temperature) || c.nozzle_temperature ? [...Array(16).keys()].map(i => num(c.nozzle_temperature, i)) : null;
  const chapa = c.curr_bed_type || 'Textured PEI Plate';
  o.mesaFil = c[CHAPA[chapa]] ? [...Array(16).keys()].map(i => num(c[CHAPA[chapa]], i)) : null;
  o.volMaxFil = c.filament_max_volumetric_speed ? [...Array(16).keys()].map(i => num(c.filament_max_volumetric_speed, i)) : null;
  o.tiposFil = c.filament_type ? (Array.isArray(c.filament_type) ? c.filament_type : String(c.filament_type).split(/[;,]/)) : null;
  // resumo
  const pct = v => Math.round(v * 100) + '%';
  const ferroTxt = { 'no ironing': 'sem passar ferro', top: 'passar ferro nas superfícies de cima', topmost: 'passar ferro só na mais alta', solid: 'passar ferro em todas as sólidas' };
  res.push(`camada ${o.h.toFixed(2)} mm (1ª ${o.h0.toFixed(2)})`, `${o.paredes} paredes`, `topo ${o.topo} / fundo ${o.fundo}`, `${pct(o.infill)} de preenchimento`, ferroTxt[o.ferro] || o.ferro);
  res.push(o.suporte === 'off' ? 'sem suporte' : `suporte ${o.suporte === 'mesa' ? 'só a partir da mesa' : 'em todo lugar'} (${o.anguloSuporte}°)`);
  res.push(o.brimTipo === 'no_brim' ? 'sem brim' : o.brimTipo === 'auto_brim' ? 'brim automático' : `brim de ${o.brimLarg || 5} mm`);
  res.push(`chapa ${NOME_CHAPA[chapa] || chapa}`);
  if (o.tempsFil) res.push('bico ' + [...new Set(filamentosDoModelo().map(f => o.tempsFil[f - 1]).filter(Boolean))].join('/') + ' °C');
  if (sup && /tree/.test(String(c.support_type))) ign.push('suporte em árvore (sai como suporte em grade)');
  if (c.sparse_infill_pattern && !/grid|rectilinear|line|zig/i.test(c.sparse_infill_pattern)) ign.push(`preenchimento ${c.sparse_infill_pattern} (sai em grade)`);
  if (String(c.spiral_mode) === '1') ign.push('modo vaso (espiral)');
  const objs = fa.modelo.objetos.filter(x => x.ajustes && Object.keys(x.ajustes).length);
  if (objs.length) res.push(`${objs.length} objeto(s) com ajustes próprios`);
  if (objs.some(x => x.ajustes.layer_height)) ign.push('altura de camada diferente por objeto');
  return { o, resumo: `Configurações do ${fa.lido.origemConfig}: ${res.join(' · ')}.` + (ign.length ? `\nAinda não aplicado: ${ign.join('; ')}.` : '') };
}

function filamentosDoModelo() {
  const s = new Set(); fa.modelo.objetos.forEach(o => o.volumes.forEach(v => { if (!v.negativo) s.add(v.fil); }));
  return [...s].sort((a, b) => a - b);
}
const PADRAO_CORES = ['#E8E8E8', '#E3001B', '#1D5BD6', '#FFD400', '#2BA84A', '#FF7A00', '#8E44AD', '#111111'];
function corArquivo(f) { return (fa.modelo.cores[f - 1] || PADRAO_CORES[(f - 1) % PADRAO_CORES.length]).slice(0, 7); }
const rgb = h => [1, 3, 5].map(k => parseInt(h.substr(k, 2), 16));
function mostrarModelo() {
  const M = Fatiador.MESA, cz = fa.modelo.tamanho.z / 2;
  R2.mostrar(fa.modelo.objetos.map(o => ({
    desloc: [0, 0],
    partes: o.volumes.filter(v => !v.negativo).map(v => {
      const pos = new Float32Array(v.tri.length);
      for (let i = 0; i < pos.length; i += 3) { pos[i] = v.tri[i] - M.cx - 8; pos[i + 1] = v.tri[i + 1] - M.cy - 8; pos[i + 2] = v.tri[i + 2] - cz; }
      return { malha: { pos, idx: [...Array(pos.length / 3).keys()] }, cor: rgb(corCabeca(fa.mapa[v.fil] ?? 0) || corArquivo(v.fil)) };
    }),
  })));
  avisoMateriais();
}
// 3) aviso de materiais diferentes no mesmo objeto
function avisoMateriais() {
  const el = $('avisoMat') || (() => { const d = document.createElement('div'); d.id = 'avisoMat'; d.className = 'msg warn'; $('mapaCores').after(d); return d; })();
  if (!fa.slots || !fa.modelo) { el.textContent = ''; return; }
  const cabecas = [...new Set(filamentosDoModelo().map(f => fa.mapa[f]))];      // só as cores desta placa
  const tipos = new Set(cabecas.map(i => fa.slots[i] && fa.slots[i].existe ? fa.slots[i].tipo : null).filter(Boolean));
  const vazias = cabecas.filter(i => !fa.slots[i] || !fa.slots[i].existe).map(i => i + 1);
  const av = [];
  if (tipos.size > 1) av.push(`Atenção: a peça vai misturar materiais diferentes (${[...tipos].join(' + ')}). Eles podem não grudar bem um no outro.`);
  if (vazias.length) av.push(`A cabeça ${vazias.join(', ')} está sem filamento na impressora.`);
  const cfg = fa.lido && fa.lido.config, tiposArq = cfg && cfg.filament_type ? (Array.isArray(cfg.filament_type) ? cfg.filament_type : String(cfg.filament_type).split(/[;,]/)) : null;
  if (tiposArq) filamentosDoModelo().forEach(f => {
    const s = fa.slots[fa.mapa[f]], ta = tiposArq[f - 1];
    if (s && s.existe && ta && s.tipo.toUpperCase() !== String(ta).toUpperCase())
      av.push(`A cor ${f} foi configurada para ${ta} no arquivo, mas a cabeça ${fa.mapa[f] + 1} tem ${s.tipo}: vou usar as temperaturas de ${s.tipo}.`);
  });
  el.textContent = av.join('\n');
}

// ---------------------------------------------------------------- impressora
try { $('ipU1b').value = localStorage.getItem('ipU1') || ''; } catch (e) { }
$('ipU1b').onchange = () => { $('ipU1').value = $('ipU1b').value.trim(); try { localStorage.setItem('ipU1', $('ipU1b').value.trim()); } catch (e) { } };
$('ipU1').addEventListener('change', () => { $('ipU1b').value = $('ipU1').value.trim(); });
// zera o mapa de cabeças da U1 (o G-code já usa as cabeças certas) e inicia a impressão
async function iniciarImpressao(ip, nome) {
  for (let i = 0; i < 4; i++) await pedir('POST', '/printer/gcode/script?script=' + encodeURIComponent(`SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=${i} MAP_EXTRUDER=${i}`), ip);
  return pedir('POST', '/printer/print/start?filename=' + encodeURIComponent(nome), ip);
}
window.iniciarImpressao = iniciarImpressao;
const pend2 = {}; let seq2 = 0;
function pedir(metodo, caminho, ip = $('ipU1b').value.trim()) {
  return new Promise(res => {
    if (window.Android && Android.requisicao) {
      const id = 'q' + (++seq2); pend2[id] = res;
      Android.requisicao(id, metodo, ip, caminho);
    } else {          // navegador (testes): mesmo servidor
      fetch(caminho, { method: metodo }).then(async r => res({ status: r.status, json: await r.json().catch(() => null) })).catch(e => res({ status: 0, texto: String(e) }));
    }
  });
}
window.onResp2 = (id, status, texto) => { const f = pend2[id]; delete pend2[id]; let json = null; try { json = JSON.parse(texto); } catch (e) { } f && f({ status, texto, json }); };

$('bLerImp').onclick = lerImpressora;
async function lerImpressora() {
  if (!$('ipU1b').value.trim() && window.Android) { msgImp('Digite o IP da impressora.', 'err'); return; }
  try { localStorage.setItem('ipU1', $('ipU1b').value.trim()); } catch (e) { }
  msgImp('Lendo a impressora…');
  const r = await pedir('GET', '/printer/objects/query?print_task_config&print_stats');
  if (r.status !== 200 || !r.json) { msgImp(r.status ? 'A impressora respondeu com erro ' + r.status : 'Sem resposta. Confira o IP e o Wi-Fi.', 'err'); return; }
  const c = r.json.result.status.print_task_config;
  if (!c) { msgImp('Esta impressora não informou os filamentos (print_task_config).', 'err'); return; }
  fa.estado = (r.json.result.status.print_stats || {}).state;
  fa.slots = [0, 1, 2, 3].map(i => ({
    tipo: (c.filament_type || [])[i] || 'NONE', sub: (c.filament_sub_type || [])[i] || '', marca: (c.filament_vendor || [])[i] || '',
    cor: '#' + String((c.filament_color_rgba || [])[i] || 'FFFFFFFF').slice(0, 6), existe: !!(c.filament_exist || [])[i], oficial: !!(c.filament_official || [])[i],
  }));
  desenharSlots();
  if (fa.modelo) { autoMapa(); montarMapa(); mostrarModelo(); }
  msgImp('Filamentos lidos da impressora.' + (fa.estado === 'printing' ? ' Atenção: ela está imprimindo agora.' : ''), 'ok');
}
function corCabeca(i) { return fa.slots && fa.slots[i] && fa.slots[i].existe ? fa.slots[i].cor : null; }
function desenharSlots() {
  const box = $('slots'); box.innerHTML = '';
  fa.slots.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'slot';
    d.innerHTML = `<div class="topo"><span class="bola" style="background:${s.existe ? s.cor : 'transparent'}"></span>Cabeça ${i + 1}</div>` +
      `<div>${s.existe ? `${s.tipo}${s.sub && s.sub !== 'NONE' ? ' ' + s.sub : ''} · ${s.marca && s.marca !== 'NONE' ? s.marca : 'sem marca'}${s.oficial ? ' · RFID' : ''}` : 'sem filamento'}</div>`;
    if (!s.oficial) {
      const tipo = document.createElement('select');
      ['PLA', 'PETG', 'ABS', 'TPU', 'PLA-CF', 'PETG-CF'].forEach(t => { const o = document.createElement('option'); o.value = o.textContent = t; tipo.append(o); });
      tipo.value = ['PLA', 'PETG', 'ABS', 'TPU', 'PLA-CF', 'PETG-CF'].includes(s.tipo) ? s.tipo : 'PLA';
      const cor = document.createElement('input'); cor.type = 'color'; cor.value = s.cor.toLowerCase();
      const b = document.createElement('button'); b.textContent = 'Salvar na impressora';
      b.onclick = async () => {
        const rgba = cor.value.slice(1).toUpperCase() + 'FF';
        const cmd = `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=${i} VENDOR=Generic FILAMENT_TYPE=${tipo.value} FILAMENT_SUBTYPE=Basic FILAMENT_COLOR_RGBA=${rgba}`;
        msgImp('Gravando na impressora…');
        const r = await pedir('POST', '/printer/gcode/script?script=' + encodeURIComponent(cmd));
        if (r.status === 200) { await lerImpressora(); msgImp(`Cabeça ${i + 1} atualizada.`, 'ok'); }
        else msgImp('A impressora recusou a alteração (erro ' + r.status + ').', 'err');
      };
      d.append(tipo, cor, b);
    } else {
      const t = document.createElement('div'); t.className = 'dim'; t.textContent = 'Rolo oficial lido pelo RFID (não editável).'; d.append(t);
    }
    box.append(d);
  });
}

// ---------------------------------------------------------------- mapa de cores
function distCor(a, b) { const x = rgb(a), y = rgb(b); return (x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11; }
function autoMapa() {
  if (!fa.modelo || !fa.slots) return;
  const fils = filamentosDoModelo(), livres = new Set([0, 1, 2, 3].filter(i => fa.slots[i].existe));
  if (!livres.size) return;
  // atribuição gulosa: pares mais parecidos primeiro, uma cabeça por cor enquanto houver
  const pares = [];
  fils.forEach(f => [...livres].forEach(i => pares.push([distCor(corArquivo(f), fa.slots[i].cor), f, i])));
  pares.sort((a, b) => a[0] - b[0]);
  const feito = new Set(), usada = new Set();
  for (const [, f, i] of pares) if (!feito.has(f) && !usada.has(i)) { fa.mapa[f] = i; feito.add(f); usada.add(i); }
  for (const f of fils) if (!feito.has(f)) {     // mais cores que cabeças: a mais parecida
    let bi = [...livres][0], bd = Infinity; livres.forEach(i => { const d = distCor(corArquivo(f), fa.slots[i].cor); if (d < bd) { bd = d; bi = i; } }); fa.mapa[f] = bi;
  }
}
$('bAutoMapa').onclick = () => { if (!fa.slots) { msg2('Leia os filamentos da impressora primeiro (seção 2).', 'err'); return; } autoMapa(); montarMapa(); mostrarModelo(); limparFatia2(); };
function montarMapa() {
  const box = $('mapaCores'); box.innerHTML = '';
  filamentosDoModelo().forEach(f => {
    const d = document.createElement('div'); d.className = 'mapa';
    d.innerHTML = `<span class="bola" style="background:${corArquivo(f)}"></span><span class="n">Cor ${f} do arquivo</span><span>→</span>`;
    const sel = document.createElement('select');
    for (let i = 0; i < 4; i++) {
      const o = document.createElement('option'); o.value = i;
      const s = fa.slots && fa.slots[i];
      o.textContent = `Cabeça ${i + 1}` + (s ? (s.existe ? ` · ${s.tipo} ${nomeCor(s.cor)}` : ' · vazia') : '');
      sel.append(o);
    }
    sel.value = fa.mapa[f];
    const bola = document.createElement('span'); bola.className = 'bola'; bola.style.background = corCabeca(fa.mapa[f]) || 'transparent';
    sel.onchange = () => { fa.mapa[f] = +sel.value; bola.style.background = corCabeca(fa.mapa[f]) || 'transparent'; mostrarModelo(); limparFatia2(); };
    d.append(sel, bola);
    box.append(d);
  });
}
function nomeCor(h) {
  const [r, g, b] = rgb(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 50) return 'preto'; if (mn > 205) return 'branco'; if (mx - mn < 30) return 'cinza';
  const hue = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360;
  return hue < 15 || hue >= 340 ? 'vermelho' : hue < 45 ? 'laranja' : hue < 70 ? 'amarelo' : hue < 160 ? 'verde' : hue < 250 ? 'azul' : hue < 290 ? 'roxo' : 'rosa';
}

// ---------------------------------------------------------------- fatiar
function limparFatia2() { fa.fatia = null; fa.gcode = null; $('bGcode2').disabled = $('bEnviar2').disabled = true; $('boxPrev2').hidden = true; $('resumo2').textContent = ''; }
function opcoes2() {
  const doArquivo = $('selOrigem').value === 'arquivo' && fa.lido && fa.lido.config;
  const pr = doArquivo ? configDoArquivo().o : PRESETS[$('selPreset').value], PF = PERFIS_U1;
  const perfilDe = i => {
    const s = fa.slots && fa.slots[i];
    const chave = s ? (MATERIAL_PERFIL[(s.tipo + (s.sub && /silk/i.test(s.sub) ? ' SILK' : '')).toUpperCase()] || MATERIAL_PERFIL[s.tipo.toUpperCase()] || 'PLA') : 'PLA';
    return PF.filamentos[chave] || PF.filamentos.PLA;
  };
  const fil = [0, 1, 2, 3].map(perfilDe);
  const usadas = new Set(Object.values(fa.mapa));
  const temps = fil.map(f => +f.cfg.nozzle_temperature[0]);
  let mesa = Math.max(...[...usadas].map(i => /^PLA/.test(fil[i].cfg.filament_type[0]) ? 65 : +(fil[i].cfg.textured_plate_temp || ['65'])[0]));
  let volMax;
  if (doArquivo) {      // temperaturas, mesa e fluxo máximo vêm do filamento de cada cor no arquivo
    const fs = filamentosDoModelo();
    // a temperatura do arquivo só vale se o material carregado na cabeça for o mesmo do arquivo
    for (let t = 0; t < 4; t++) {
      const f = fs.find(f => fa.mapa[f] === t); if (!f || !pr.tempsFil || !pr.tempsFil[f - 1]) continue;
      const s = fa.slots && fa.slots[t], tipoArq = pr.tiposFil && pr.tiposFil[f - 1];
      if (!s || !s.existe || !tipoArq || s.tipo.toUpperCase() === String(tipoArq).toUpperCase()) temps[t] = pr.tempsFil[f - 1];
    }
    if (pr.mesaFil) {   // mesa: a do arquivo quando o material bate; senão, a do material carregado
      const m = Math.max(...fs.map(f => {
        const t = fa.mapa[f], s = fa.slots && fa.slots[t], tipoArq = pr.tiposFil && pr.tiposFil[f - 1];
        const bate = !s || !s.existe || !tipoArq || s.tipo.toUpperCase() === String(tipoArq).toUpperCase();
        return bate ? (pr.mesaFil[f - 1] || 0) : (/^PLA/.test(fil[t].cfg.filament_type[0]) ? 65 : +(fil[t].cfg.textured_plate_temp || ['65'])[0]);
      }));
      if (m > 0) mesa = m;
    }
    if (pr.volMaxFil) { const v = Math.min(...fs.map(f => pr.volMaxFil[f - 1] || 99)); if (v < 99) volMax = v; }
  }
  const mapa = []; for (let f = 1; f <= 32; f++) mapa.push(fa.mapa[f] !== undefined ? fa.mapa[f] : (f - 1) % 4);
  const inf = $('nInfill2').value;
  // brim: do campo, ou do arquivo (automático só para peças altas e finas), ou nenhum
  const brimDe = (o, aj) => {
    if ($('nBrim').value !== '') return +$('nBrim').value;
    const tipo = (aj && aj.brimTipo) || pr.brimTipo, larg = (aj && aj.brimLarg) || pr.brimLarg || 5;
    if (!tipo || tipo === 'no_brim') return 0;
    if (tipo !== 'auto_brim') return larg;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z1 = 0;
    o.volumes.forEach(v => { for (let i = 0; i < v.tri.length; i += 3) { x0 = Math.min(x0, v.tri[i]); x1 = Math.max(x1, v.tri[i]); y0 = Math.min(y0, v.tri[i + 1]); y1 = Math.max(y1, v.tri[i + 1]); z1 = Math.max(z1, v.tri[i + 2]); } });
    return z1 / Math.max(1, Math.min(x1 - x0, y1 - y0)) > 2.5 ? larg : 0;
  };
  const porObjeto = fa.modelo.objetos.map(o => {
    const aj = doArquivo && o.ajustes ? traduzAjustes(o.ajustes) : {};
    return Object.assign(aj, { brim: brimDe(o, aj) });
  });
  return {
    h: pr.h, h0: pr.h0, paredes: pr.paredes, topo: pr.topo, fundo: pr.fundo, velFator: pr.velFator || 1, vel: pr.vel, volMax,
    infill: inf === '' ? pr.infill : +inf / 100,
    ferro: $('selFerro2').value === 'preset' ? pr.ferro : $('selFerro2').value, ferroFluxo: pr.ferroFluxo || 0.10, ferroEsp: pr.ferroEsp || 0.13, ferroVel: pr.ferroVel || 30,
    temps, mesa, vitrificacao: Math.min(...fil.map(f => +(f.cfg.temperature_vitrification || ['45'])[0])),
    mapa, suporte: $('selSup').value === 'auto' ? (pr.suporte || 'off') : $('selSup').value, anguloSuporte: pr.anguloSuporte || 30,
    brim: 0, porObjeto, filPadrao: filamentosDoModelo()[0],
    cores: [0, 1, 2, 3].map(i => corCabeca(i) || ['#FFFFFF', '#E3001B', '#1D5BD6', '#FFD400'][i]),
    tipos: fil.map(f => f.cfg.filament_type[0]),
  };
}
$('bFatiar2').onclick = () => {
  if (!fa.modelo) return;
  $('bFatiar2').disabled = true; msg2('Fatiando… peças grandes podem levar alguns segundos.');
  setTimeout(() => {
    try {
      const t0 = performance.now(), o = opcoes2();
      const r = Malhas.fatiarModelo(fa.modelo, o);
      const cfg = {
        layer_height: o.h, initial_layer_print_height: o.h0, wall_loops: o.paredes, top_shell_layers: o.topo, bottom_shell_layers: o.fundo,
        sparse_infill_density: Math.round(o.infill * 100) + '%', ironing_type: o.ferro, enable_support: o.suporte === 'off' ? 0 : 1,
        filament_colour: o.cores.join(';'), filament_type: o.tipos.join(';'), nozzle_temperature: o.temps.join(','), nozzle_temperature_initial_layer: o.temps.join(','),
        textured_plate_temp: Array(4).fill(o.mesa).join(','), textured_plate_temp_initial_layer: Array(4).fill(o.mesa).join(','),
        hot_plate_temp: Array(4).fill(o.mesa).join(','), hot_plate_temp_initial_layer: Array(4).fill(o.mesa).join(','),
      };
      fa.gcode = Fatiador.montarArquivo(r, [miniatura2(48), miniatura2(300)], cfg);
      fa.fatia = r; fa.opcoes = o;
      const g = r.uso.gr.reduce((a, b) => a + b, 0);
      $('resumo2').textContent = `${r.camadas.length} camadas · ${Fatiador.hms(r.tempoTotal)} (estimativa) · ${g.toFixed(1)} g · ${r.trocas} trocas de cabeça · ` +
        `G-code de ${(fa.gcode.length / 1048576).toFixed(1)} MB · fatiado em ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      $('rCamada2').max = r.camadas.length; $('rCamada2').value = 1;
      $('boxPrev2').hidden = false; desenharCamada2();
      $('bGcode2').disabled = $('bEnviar2').disabled = false;
      msg2('Fatiado. Passe pelas camadas para conferir antes de imprimir.', 'ok');
    } catch (e) { console.error(e); msg2('Erro ao fatiar: ' + e.message, 'err'); }
    $('bFatiar2').disabled = false;
  }, 30);
};
function miniatura2(lado) {
  // vista de cima simples com as cores das cabeças
  const cv = document.createElement('canvas'); cv.width = cv.height = lado;
  const ctx = cv.getContext('2d'), m = fa.modelo, M = Fatiador.MESA;
  const k = lado * 0.9 / Math.max(m.tamanho.x, m.tamanho.y, 1);
  const tris = [];
  m.objetos.forEach(o => o.volumes.forEach(v => { if (!v.negativo) for (let i = 0; i < v.tri.length; i += 9) tris.push([v, i, Math.max(v.tri[i + 2], v.tri[i + 5], v.tri[i + 8])]); }));
  tris.sort((a, b) => a[2] - b[2]);
  const cx = M.cx + 8, cy = M.cy + 8;
  for (const [v, i, zt] of tris) {
    const c = rgb(corCabeca(fa.mapa[v.fil]) || corArquivo(v.fil)), s = 0.55 + 0.45 * Math.min(1, zt / Math.max(1, m.tamanho.z));
    ctx.fillStyle = `rgb(${c[0] * s | 0},${c[1] * s | 0},${c[2] * s | 0})`;
    ctx.beginPath();
    for (let j = 0; j < 3; j++) { const x = lado / 2 + (v.tri[i + j * 3] - cx) * k, y = lado / 2 - (v.tri[i + j * 3 + 1] - cy) * k; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill();
  }
  return { w: lado, h: lado, b64: cv.toDataURL('image/png').split(',')[1] };
}
const COR_TIPO2 = { 'Ironing': '#3aa0ff', 'Prime tower': '#7a828c', 'Support': '#9aa3ae', 'Support interface': '#c3cad3', 'Brim': '#6b7280' };
function desenharCamada2() {
  const r = fa.fatia; if (!r) return;
  const l = +$('rCamada2').value - 1, c = r.camadas[l];
  $('txtCamada2').textContent = `${l + 1} de ${r.camadas.length} · Z ${c.z.toFixed(2)} mm`;
  const cv = $('cvCamada2'), lado = cv.clientWidth * 2 || 600; cv.width = cv.height = lado;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#c8ced6'; ctx.fillRect(0, 0, lado, lado);
  if (!fa.caixa) { }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  r.prev.forEach((cam, i) => { if (i % 4) return; cam.forEach(t => t.pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); })); });
  const k = lado * 0.94 / Math.max(x1 - x0, y1 - y0, 1), ox = (lado - (x1 - x0) * k) / 2, oy = (lado - (y1 - y0) * k) / 2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const t of r.prev[l]) {
    ctx.strokeStyle = COR_TIPO2[t.tipo] || r.P.cores[t.f - 1] || '#333';
    ctx.lineWidth = Math.max(1, 0.42 * k * (t.tipo === 'Ironing' ? 0.35 : 0.9));
    ctx.beginPath();
    t.pts.forEach(([x, y], i) => { const px = ox + (x - x0) * k, py = lado - (oy + (y - y0) * k); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  }
}
$('rCamada2').oninput = desenharCamada2;
const nomeG2 = () => `${fa.nome}_U1.gcode`;
$('bGcode2').onclick = () => salvar(nomeG2(), 'text/x-gcode', new TextEncoder().encode(fa.gcode));

// enviar: sobe o arquivo, deixa o mapa de cabeças da U1 "direto" (o G-code já usa as cabeças certas) e inicia
$('bEnviar2').onclick = () => {
  const ip = $('ipU1b').value.trim();
  if (!ip) { msg2('Digite o IP da impressora na seção 2.', 'err'); return; }
  if (!(window.Android && Android.enviarGcode)) { msg2('O envio só funciona dentro do app no celular.', 'err'); return; }
  try { localStorage.setItem('ipU1', ip); } catch (e) { }
  $('bEnviar2').disabled = true; $('barEnvio2').style.width = '0';
  msg2('Enviando para a impressora…');
  window.__envio2 = true;
  Android.enviarGcode(ip, nomeG2(), b64(new TextEncoder().encode(fa.gcode)), false);
};
const fimEnvioAnterior = window.onEnvioFim, progAnterior = window.onEnvioProgresso;
window.onEnvioProgresso = p => { if (window.__envio2) { $('barEnvio2').style.width = p + '%'; msg2('Enviando… ' + p + '%'); } else progAnterior && progAnterior(p); };
window.onEnvioFim = async (status, texto) => {
  if (!window.__envio2) return fimEnvioAnterior && fimEnvioAnterior(status, texto);
  window.__envio2 = false; $('bEnviar2').disabled = false;
  if (status !== 200 && status !== 201) { msg2(status ? 'Erro ' + status + ' ao enviar: ' + texto.slice(0, 200) : 'Sem resposta da impressora. Confira o IP e o Wi-Fi.', 'err'); return; }
  $('barEnvio2').style.width = '100%';
  msg2('Arquivo na impressora. Ajustando o mapa de cabeças e iniciando…');
  const r = await iniciarImpressao($('ipU1b').value.trim(), nomeG2());
  if (r.status === 200) msg2('Impressão iniciada! Acompanhe a primeira camada.', 'ok');
  else msg2('O arquivo foi enviado, mas a impressora não iniciou (erro ' + r.status + '). Inicie pela tela da U1 ou pelo Envia U1.', 'err');
};

function msg2(t, cls) { $('msg2').textContent = t; $('msg2').className = 'msg ' + (cls || ''); }
function msgImp(t, cls) { $('msgImp').textContent = t; $('msgImp').className = 'msg ' + (cls || ''); }
