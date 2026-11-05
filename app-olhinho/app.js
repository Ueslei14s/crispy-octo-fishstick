'use strict';
/* Olhinho — babá eletrônica P2P (WebRTC via PeerJS).
 * Câmera: abre câmera+mic, gera um código secreto e atende chamadas.
 * Monitor: digita o código, recebe vídeo/áudio, alerta de barulho e fala de volta. */

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- armazenamento local ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('olhinho.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('olhinho.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('olhinho.' + k); } catch {} },
};
const getSettings = () => Object.assign({ signal: '', turnUrl: '', turnUser: '', turnPass: '' }, store.get('settings', {}));

/* ---------- utilidades ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function show(name) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 's-' + name;
}
function setPill(el, text, kind) { el.textContent = text; el.className = 'pill ' + (kind || ''); }
const hhmm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Código secreto: 16 símbolos de um alfabeto de 31 (~79 bits). Gerado com crypto, sem viés.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let out = '';
  while (out.length < 16) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    for (const x of b) { if (x < 248 && out.length < 16) out += ALPHA[x % 31]; }
  }
  return out;
}
const normCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = c => c.match(/.{1,4}/g).join('-');
const validCode = c => c.length === 16 && [...c].every(ch => ALPHA.includes(ch));
const peerIdOf = code => 'olh-' + code;

function peerOptions() {
  const s = getSettings();
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (s.turnUrl) {
    iceServers.push({
      urls: s.turnUrl.split(',').map(x => x.trim()).filter(Boolean),
      username: s.turnUser, credential: s.turnPass,
    });
  }
  const o = { config: { iceServers }, debug: 0 };
  if (s.signal) {
    try {
      const u = new URL(/^https?:\/\//.test(s.signal) ? s.signal : 'https://' + s.signal);
      o.host = u.hostname; o.secure = u.protocol === 'https:';
      o.port = Number(u.port) || (o.secure ? 443 : 80);
      o.path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
    } catch {}
  }
  return o;
}

// Abre uma conexão com o servidor de sinalização. Rejeita com {type} em caso de erro.
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch {} reject({ type: 'timeout' }); } }, 15000);
    p.on('open', () => { if (!done) { done = true; clearTimeout(timer); resolve(p); } });
    p.on('error', e => { if (!done) { done = true; clearTimeout(timer); try { p.destroy(); } catch {} reject(e); } });
  });
}

// Mantém a tela acesa (a babá eletrônica só funciona com o app aberto).
let wakeSentinel = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeSentinel = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseAwake() { try { wakeSentinel && wakeSentinel.release(); } catch {} wakeSentinel = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (cam.active || mon.active)) keepAwake();
});

// Tela preta para economizar bateria (toque duplo para acender).
let lastTap = 0;
function dim(on) { $('#dim').hidden = !on; }
$('#dim').addEventListener('pointerup', () => {
  const now = Date.now();
  if (now - lastTap < 450) dim(false);
  lastTap = now;
});

/* =====================================================================
 *  CÂMERA
 * ===================================================================== */
const cam = {
  active: false, stopped: true, code: '', peer: null, stream: null, facing: 'environment',
  calls: new Set(), conns: new Set(), lastSeen: new Map(), locked: false,
  audioCtx: null, analyser: null, peak: 0, timers: [], retryTimer: null,
};

async function openStream(facing) {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
  });
}

async function startCamera() {
  show('camera');
  cam.stopped = false; cam.active = true; cam.locked = false;
  $('#cam-lock').setAttribute('aria-pressed', 'false');
  cam.facing = store.get('facing', 'environment');
  cam.code = store.get('code.camera', '');
  if (!validCode(cam.code)) { cam.code = newCode(); store.set('code.camera', cam.code); }
  $('#cam-code').textContent = fmtCode(cam.code);
  setPill($('#cam-signal'), 'Abrindo câmera…', 'wait');

  try {
    cam.stream = await openStream(cam.facing);
  } catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? 'Permita o acesso à câmera e ao microfone.'
      : e && e.name === 'NotFoundError' ? 'Este celular não tem câmera ou microfone disponível.'
      : !window.isSecureContext ? 'Abra o app por um endereço https.'
      : 'Não consegui abrir a câmera: ' + (e && e.message || e);
    toast(msg); stopCamera(); return;
  }
  $('#cam-preview').srcObject = cam.stream;
  $('#cam-info').textContent = 'Câmera ' + (cam.facing === 'user' ? 'frontal' : 'traseira');
  keepAwake(); startMeter(); startBattery();
  cam.timers.push(setInterval(camTick, 2000));
  camConnect();
}

function stopCamera() {
  cam.stopped = true; cam.active = false;
  clearTimeout(cam.retryTimer);
  cam.timers.forEach(clearInterval); cam.timers = [];
  for (const c of cam.conns) { try { c.send({ t: 'bye' }); } catch {} }
  try { cam.peer && cam.peer.destroy(); } catch {}
  cam.peer = null; cam.calls.clear(); cam.conns.clear(); cam.lastSeen.clear();
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; $('#cam-preview').srcObject = null;
  try { cam.audioCtx && cam.audioCtx.close(); } catch {}
  cam.audioCtx = null; cam.analyser = null;
  $('#talk-audio') && $('#talk-audio').remove();
  releaseAwake(); dim(false);
  show('home'); refreshHome();
}

async function camConnect() {
  if (cam.stopped) return;
  setPill($('#cam-signal'), 'Conectando…', 'wait');
  let p;
  try {
    p = await openPeer(peerIdOf(cam.code));
  } catch (e) {
    if (cam.stopped) return;
    // 'unavailable-id': o servidor ainda não liberou o código da sessão anterior.
    setPill($('#cam-signal'), e.type === 'unavailable-id' ? 'Aguardando liberar…' : 'Sem conexão', 'bad');
    cam.retryTimer = setTimeout(camConnect, e.type === 'unavailable-id' ? 4000 : 6000);
    return;
  }
  if (cam.stopped) { p.destroy(); return; }
  cam.peer = p;
  setPill($('#cam-signal'), 'Pronta', 'ok');

  p.on('call', call => {
    if (cam.locked) { setTimeout(() => { try { call.close(); } catch {} }, 1500); return; } // dá tempo do aviso 'deny' chegar
    // Um monitor que reconecta substitui a chamada antiga dele.
    for (const c of [...cam.calls]) if (c.peer === call.peer) { cam.calls.delete(c); try { c.close(); } catch {} }
    if (cam.calls.size >= 3) { call.close(); return; }
    call.answer(cam.stream);
    cam.calls.add(call); cam.lastSeen.set(call.peer, Date.now());
    toast('Monitor conectado às ' + hhmm());
    updateViewers();
    call.on('stream', playTalkback);
    const gone = () => { cam.calls.delete(call); updateViewers(); };
    call.on('close', gone); call.on('error', gone);
    limitBitrate(call);
  });
  p.on('connection', conn => {
    if (cam.locked) {
      conn.on('open', () => { try { conn.send({ t: 'deny' }); } catch {} setTimeout(() => { try { conn.close(); } catch {} }, 500); });
      return;
    }
    cam.conns.add(conn);
    conn.on('open', () => sendStatus(conn));
    conn.on('data', d => onCamData(conn, d));
    const gone = () => cam.conns.delete(conn);
    conn.on('close', gone); conn.on('error', gone);
  });
  p.on('disconnected', () => { if (!cam.stopped && cam.peer === p) setTimeout(() => { try { p.reconnect(); } catch {} }, 2000); });
  p.on('close', () => { if (!cam.stopped && cam.peer === p) { cam.peer = null; cam.retryTimer = setTimeout(camConnect, 3000); } });
  p.on('error', e => {
    if (cam.stopped || cam.peer !== p) return;
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
      setPill($('#cam-signal'), 'Sem conexão', 'bad');
      try { p.destroy(); } catch {}
    }
  });
}

function limitBitrate(call) {
  // Vídeo leve para funcionar bem em 4G: ~600 kbps.
  setTimeout(() => {
    try {
      for (const s of call.peerConnection.getSenders()) {
        if (s.track && s.track.kind === 'video') {
          const prm = s.getParameters(); prm.encodings = prm.encodings && prm.encodings.length ? prm.encodings : [{}];
          prm.encodings[0].maxBitrate = 600000; s.setParameters(prm).catch(() => {});
        }
      }
    } catch {}
  }, 1500);
}

// Áudio vindo do monitor (interfone). A tela já teve toque, então o autoplay é permitido.
function playTalkback(stream) {
  let a = $('#talk-audio');
  if (!a) { a = document.createElement('audio'); a.id = 'talk-audio'; a.autoplay = true; document.body.appendChild(a); }
  a.srcObject = stream; a.play().catch(() => {});
}

function onCamData(conn, d) {
  if (!d || typeof d !== 'object') return;
  cam.lastSeen.set(conn.peer, Date.now());
  if (d.t === 'flip') flipCamera();
  else if (d.t === 'bye') { for (const c of [...cam.calls]) if (c.peer === conn.peer) { cam.calls.delete(c); try { c.close(); } catch {} } updateViewers(); }
}

function broadcast(msg) { for (const c of cam.conns) { if (c.open) { try { c.send(msg); } catch {} } } }
function sendStatus(conn) {
  const m = { t: 'st', face: cam.facing, bat: cam.battery ? Math.round(cam.battery.level * 100) : null, chg: cam.battery ? cam.battery.charging : null, lock: cam.locked };
  if (conn) { try { conn.send(m); } catch {} } else broadcast(m);
}
function updateViewers() {
  const n = cam.calls.size;
  $('#cam-viewers').textContent = n ? (n === 1 ? '1 monitor assistindo' : n + ' monitores assistindo') : 'Ninguém assistindo';
}
function camTick() {
  // Remove monitores que sumiram sem avisar (sem sinal há 25 s).
  const now = Date.now();
  for (const c of [...cam.calls]) {
    const st = c.peerConnection && c.peerConnection.iceConnectionState;
    if (st === 'failed' || st === 'closed' || now - (cam.lastSeen.get(c.peer) || 0) > 25000) { cam.calls.delete(c); try { c.close(); } catch {} }
  }
  updateViewers(); sendStatus();
}

/* medidor de som (nível de 0 a 100 em escala de dB) */
function startMeter() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    cam.audioCtx = new AC();
    const src = cam.audioCtx.createMediaStreamSource(cam.stream);
    cam.analyser = cam.audioCtx.createAnalyser(); cam.analyser.fftSize = 1024;
    src.connect(cam.analyser);
    const buf = new Float32Array(cam.analyser.fftSize);
    cam.peak = 0;
    cam.timers.push(setInterval(() => {
      if (!cam.analyser) return;
      cam.analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-5));
      const lvl = Math.max(0, Math.min(100, (db + 60) * 2)); // -60 dB → 0, -10 dB → 100
      cam.peak = Math.max(cam.peak, lvl);
    }, 100));
    cam.timers.push(setInterval(() => {
      const v = Math.round(cam.peak); cam.peak = 0;
      $('#cam-meter').style.width = v + '%';
      broadcast({ t: 'lv', v });
    }, 500));
  } catch {}
}

async function startBattery() {
  try { cam.battery = navigator.getBattery ? await navigator.getBattery() : null; } catch { cam.battery = null; }
}

async function flipCamera() {
  if (!cam.stream) return;
  const next = cam.facing === 'user' ? 'environment' : 'user';
  try {
    const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } } });
    const nt = ns.getVideoTracks()[0];
    const old = cam.stream.getVideoTracks()[0];
    cam.stream.addTrack(nt);
    if (old) { cam.stream.removeTrack(old); old.stop(); }
    for (const c of cam.calls) {
      for (const s of c.peerConnection.getSenders()) if (s.track && s.track.kind === 'video') await s.replaceTrack(nt);
    }
    cam.facing = next; store.set('facing', next);
    $('#cam-preview').srcObject = cam.stream;
    $('#cam-info').textContent = 'Câmera ' + (next === 'user' ? 'frontal' : 'traseira');
    sendStatus();
  } catch { toast('Não foi possível trocar de câmera.'); }
}

/* =====================================================================
 *  MONITOR
 * ===================================================================== */
const mon = {
  active: false, stopped: true, code: '', peer: null, conn: null, call: null, lastMsg: 0,
  retryTimer: null, timers: [], state: '', audioCtx: null, mic: null, talking: false,
  hits: 0, lastAlert: 0, night: false, st: {},
};
const getSens = () => store.get('sens', 50);
const thresholdOf = sens => Math.round(85 - sens * 0.6); // sens 0→85, 50→55, 100→25

function monState(kind, text) {
  mon.state = kind;
  setPill($('#mon-state'), text, kind === 'live' ? 'ok' : kind === 'off' ? 'bad' : 'wait');
}

async function startMonitor(code) {
  mon.code = code; store.set('code.monitor', code);
  mon.stopped = false; mon.active = true; mon.hits = 0; mon.lastAlert = 0;
  show('monitor');
  try { const AC = window.AudioContext || window.webkitAudioContext; mon.audioCtx = mon.audioCtx || new AC(); mon.audioCtx.resume(); } catch {}
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  $('#mon-sens').value = getSens(); updateThreshold();
  $('#mon-meter').style.width = '0%'; $('#mon-info').textContent = '';
  keepAwake();
  mon.timers.push(setInterval(monWatchdog, 3000), setInterval(() => monSend({ t: 'hb' }), 5000));
  monAttempt();
}

function stopMonitor() {
  mon.stopped = true; mon.active = false;
  clearTimeout(mon.retryTimer);
  mon.timers.forEach(clearInterval); mon.timers = [];
  monSend({ t: 'bye' });
  monCleanup();
  try { mon.audioCtx && mon.audioCtx.close(); } catch {} mon.audioCtx = null;
  endTalk(true);
  releaseAwake(); dim(false);
  $('#mon-video').srcObject = null;
  show('home'); refreshHome();
}

function monCleanup() {
  const { call, conn, peer } = mon;
  mon.call = mon.conn = mon.peer = null;
  try { call && call.close(); } catch {}
  try { conn && conn.close(); } catch {}
  try { peer && peer.destroy(); } catch {}
}
function monSend(m) { try { if (mon.conn && mon.conn.open) mon.conn.send(m); } catch {} }

function monRetry(why) {
  if (mon.stopped || mon.retryTimer) return;
  monState('wait', why || 'Reconectando…');
  mon.retryTimer = setTimeout(() => { mon.retryTimer = null; monAttempt(); }, 4000);
}

async function monAttempt() {
  if (mon.stopped) return;
  monCleanup();
  monState('wait', 'Conectando…');
  let p;
  try { p = await openPeer(null); } catch { monRetry('Sem internet? Tentando…'); return; }
  if (mon.stopped) { p.destroy(); return; }
  mon.peer = p; mon.lastMsg = Date.now();
  const target = peerIdOf(mon.code);

  p.on('error', e => {
    if (mon.peer !== p) return;
    if (e.type === 'peer-unavailable') { monState('off', 'Câmera offline'); monCleanup(); monRetry('Câmera offline, tentando…'); }
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { monCleanup(); monRetry('Sem conexão, tentando…'); }
  });
  p.on('disconnected', () => { if (mon.peer === p && !mon.stopped) { try { p.reconnect(); } catch {} } });

  const conn = p.connect(target, { reliable: true });
  mon.conn = conn;
  conn.on('data', onMonData);
  conn.on('close', () => { if (mon.conn === conn) { monCleanup(); monRetry(); } });

  // A trilha de áudio é só do interfone; sem estes "constraints" a oferta não reserva espaço para receber o vídeo da câmera.
  const call = p.call(target, silentStream(), { constraints: { offerToReceiveVideo: true, offerToReceiveAudio: true } });
  mon.call = call;
  call.on('stream', s => {
    const v = $('#mon-video'); v.srcObject = s; mon.lastMsg = Date.now();
    v.play().then(() => { $('#mon-tap').hidden = true; }).catch(() => { $('#mon-tap').hidden = false; });
    monState('live', 'Ao vivo');
  });
  call.on('close', () => { if (mon.call === call) { monCleanup(); monRetry(); } });
  call.on('error', () => { if (mon.call === call) { monCleanup(); monRetry(); } });
}

// Chamada precisa de uma trilha de áudio; começa muda e vira o microfone quando o pai fala.
function silentStream() {
  const dst = mon.audioCtx.createMediaStreamDestination();
  return dst.stream;
}

function onMonData(d) {
  if (!d || typeof d !== 'object') return;
  mon.lastMsg = Date.now();
  if (d.t === 'lv') onLevel(d.v);
  else if (d.t === 'st') {
    mon.st = d;
    const parts = [];
    if (d.bat !== null && d.bat !== undefined) parts.push('🔋 ' + d.bat + '%' + (d.chg ? ' ⚡' : ''));
    parts.push(d.face === 'user' ? 'frontal' : 'traseira');
    if (d.lock) parts.push('bloqueada');
    $('#mon-info').textContent = parts.join(' · ');
    if (d.bat !== null && d.bat <= 15 && !d.chg && Date.now() - (mon.lowBatWarn || 0) > 600000) { mon.lowBatWarn = Date.now(); toast('Bateria da câmera em ' + d.bat + '%'); }
  } else if (d.t === 'bye') { monCleanup(); monRetry('Câmera encerrou'); }
  else if (d.t === 'deny') { monCleanup(); toast('A câmera está bloqueando novos acessos.'); monRetry('Acesso bloqueado na câmera'); }
}

function monWatchdog() {
  if (mon.stopped) return;
  if (mon.state === 'live' && Date.now() - mon.lastMsg > 15000) { monCleanup(); monRetry('Sinal perdido, reconectando…'); }
}

function updateThreshold() {
  $('#mon-thresh').style.left = thresholdOf(+$('#mon-sens').value) + '%';
}
function onLevel(v) {
  $('#mon-meter').style.width = v + '%';
  const th = thresholdOf(getSens());
  mon.hits = v >= th ? mon.hits + 1 : 0;
  if (mon.hits >= 2 && Date.now() - mon.lastAlert > 30000) { mon.lastAlert = Date.now(); noiseAlert(); }
}
function noiseAlert() {
  document.querySelector('#s-monitor .stats').classList.add('alert');
  setTimeout(() => document.querySelector('#s-monitor .stats').classList.remove('alert'), 2000);
  toast('🔔 Barulho no quarto às ' + hhmm());
  try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 300]); } catch {}
  beep();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker.getRegistration().then(r => r && r.showNotification('Olhinho', { body: 'Barulho no quarto às ' + hhmm(), tag: 'noise', renotify: true, vibrate: [300, 120, 300] })).catch(() => {});
  }
}
function beep() {
  try {
    const ctx = mon.audioCtx; if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.start(t); o.stop(t + 0.3);
    }
  } catch {}
}

/* interfone: segurar o botão para falar com a criança */
async function beginTalk() {
  if (!mon.call || mon.state !== 'live' || mon.talking) return;
  mon.talking = true; $('#mon-talk').classList.add('on'); $('#mon-talk').textContent = '🎙️ Falando…';
  try {
    if (!mon.mic) mon.mic = (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })).getAudioTracks()[0];
    if (!mon.talking) return endTalk();           // soltou o botão enquanto pedia permissão
    const s = mon.call.peerConnection.getSenders().find(x => x.track && x.track.kind === 'audio');
    if (s) await s.replaceTrack(mon.mic);
    $('#mon-video').muted = true;                  // evita microfonia
  } catch { toast('Permita o microfone para falar.'); endTalk(); }
}
function endTalk(release) {
  if (!mon.talking && !release) return;
  mon.talking = false; $('#mon-talk').classList.remove('on'); $('#mon-talk').textContent = '🎙️ Segure para falar';
  try {
    const s = mon.call && mon.call.peerConnection.getSenders().find(x => x.track && x.track.kind === 'audio');
    if (s) s.replaceTrack(silentStream().getAudioTracks()[0]);
  } catch {}
  $('#mon-video').muted = !!mon.userMuted;
  if (release && mon.mic) { mon.mic.stop(); mon.mic = null; }
}

/* =====================================================================
 *  TELA INICIAL, EVENTOS
 * ===================================================================== */
function refreshHome() {
  const saved = store.get('code.monitor', '');
  $('#in-code').value = validCode(saved) ? fmtCode(saved) : '';
}

$('#btn-role-camera').addEventListener('click', startCamera);
$('#btn-role-monitor').addEventListener('click', () => {
  const code = normCode($('#in-code').value);
  if (!validCode(code)) { toast('O código tem 16 letras e números. Confira na câmera.'); return; }
  startMonitor(code);
});
$('#in-code').addEventListener('input', e => {
  const c = normCode(e.target.value).slice(0, 16);
  e.target.value = c ? fmtCode(c) : '';
});
$('#cam-back').addEventListener('click', () => { if (confirm('Parar a câmera? O monitor perde a imagem.')) stopCamera(); });
$('#mon-back').addEventListener('click', stopMonitor);

$('#cam-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(fmtCode(cam.code)); toast('Código copiado'); } catch { toast('Não consegui copiar.'); }
});
$('#cam-share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '#m=' + cam.code;
  const text = 'Olhinho — para ver o quarto, abra o link no celular monitor. Código: ' + fmtCode(cam.code);
  try {
    if (navigator.share) await navigator.share({ title: 'Olhinho', text, url });
    else { await navigator.clipboard.writeText(text + '\n' + url); toast('Link copiado'); }
  } catch {}
});
$('#cam-newcode').addEventListener('click', () => {
  if (!confirm('Gerar um novo código? Os monitores atuais serão desconectados e precisarão do novo código.')) return;
  cam.code = newCode(); store.set('code.camera', cam.code);
  $('#cam-code').textContent = fmtCode(cam.code);
  broadcast({ t: 'bye' });
  for (const c of cam.calls) { try { c.close(); } catch {} } cam.calls.clear(); updateViewers();
  try { cam.peer && cam.peer.destroy(); } catch {}
  clearTimeout(cam.retryTimer); cam.peer = null; camConnect();
  toast('Novo código gerado');
});
$('#cam-flip').addEventListener('click', flipCamera);
$('#cam-lock').addEventListener('click', e => {
  cam.locked = !cam.locked;
  e.currentTarget.setAttribute('aria-pressed', String(cam.locked));
  toast(cam.locked ? 'Novos acessos bloqueados' : 'Novos acessos liberados'); sendStatus();
});
$('#cam-dim').addEventListener('click', () => dim(true));

$('#mon-dim').addEventListener('click', () => dim(true));
$('#mon-flip').addEventListener('click', () => monSend({ t: 'flip' }));
$('#mon-mute').addEventListener('click', e => {
  mon.userMuted = !mon.userMuted; $('#mon-video').muted = mon.userMuted;
  e.currentTarget.textContent = mon.userMuted ? '🔇 Sem som' : '🔊 Som';
});
$('#mon-night').addEventListener('click', e => {
  mon.night = !mon.night;
  $('#mon-video').style.filter = mon.night ? 'brightness(2.2) contrast(1.15) saturate(.7)' : '';
  e.currentTarget.setAttribute('aria-pressed', String(mon.night));
});
$('#mon-full').addEventListener('click', () => {
  const w = $('#mon-wrap'), v = $('#mon-video');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (w.requestFullscreen) w.requestFullscreen().catch(() => {});
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
});
$('#mon-tap').addEventListener('click', () => { $('#mon-video').play().then(() => { $('#mon-tap').hidden = true; }).catch(() => {}); });
$('#mon-sens').addEventListener('input', e => { store.set('sens', +e.target.value); updateThreshold(); });

const talk = $('#mon-talk');
talk.addEventListener('pointerdown', e => { e.preventDefault(); talk.setPointerCapture(e.pointerId); beginTalk(); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => talk.addEventListener(ev, () => endTalk()));
talk.addEventListener('contextmenu', e => e.preventDefault());

/* configurações */
$('#btn-settings').addEventListener('click', () => {
  const s = getSettings();
  $('#set-signal').value = s.signal; $('#set-turn').value = s.turnUrl;
  $('#set-turn-user').value = s.turnUser; $('#set-turn-pass').value = s.turnPass;
  $('#dlg-settings').showModal();
});
$('#set-save').addEventListener('click', () => {
  store.set('settings', {
    signal: $('#set-signal').value.trim(), turnUrl: $('#set-turn').value.trim(),
    turnUser: $('#set-turn-user').value.trim(), turnPass: $('#set-turn-pass').value,
  });
  toast('Configurações salvas');
});

window.addEventListener('pagehide', () => { if (mon.active) monSend({ t: 'bye' }); });

/* inicialização */
(function init() {
  refreshHome();
  // Link compartilhado pela câmera: abre já com o código preenchido.
  const m = /[#&]m=([A-Za-z0-9]+)/.exec(location.hash);
  if (m && validCode(normCode(m[1]))) {
    $('#in-code').value = fmtCode(normCode(m[1]));
    history.replaceState(null, '', location.pathname + location.search);
    toast('Código preenchido. Toque em Conectar.');
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!navigator.mediaDevices || !window.RTCPeerConnection) toast('Este navegador não suporta vídeo ao vivo. Use Chrome ou Safari atualizado.');
})();
