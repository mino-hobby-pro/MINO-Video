// index.js (ES module)
// Robust, bug-hardened stream player with ultra-fast bottom-up terminal loader.
// - Put your stream URL into data-src on the #player element (mp4 or .m3u8).
// - This file is self-contained and written defensively to avoid race conditions and double-trigger bugs.

const container = document.getElementById('player');
if (!container) throw new Error('player container not found');

const rawUrl = (container.dataset.src || '').trim();
container.innerHTML = ''; // clear any placeholder

/* ---------- DOM (player chrome) ---------- */
const video = document.createElement('video');
video.playsInline = true;
video.preload = 'metadata';
video.controls = false;
video.setAttribute('webkit-playsinline', '');
video.setAttribute('playsinline', '');
video.style.background = '#000';
video.style.display = 'block';

const center = document.createElement('div'); center.className = 'center-overlay';
const bigPlay = document.createElement('button'); bigPlay.className = 'big-play'; bigPlay.setAttribute('aria-label','play');
bigPlay.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 2v20l18-10L4 2z"></path></svg>`;
center.appendChild(bigPlay);

const controls = document.createElement('div'); controls.className = 'controls';
const playBtn = document.createElement('button'); playBtn.className = 'ctrl-btn'; playBtn.setAttribute('aria-label','play/pause');
playBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>`;

const progressWrap = document.createElement('div'); progressWrap.className = 'progress-wrap';
const progress = document.createElement('div'); progress.className = 'progress'; progress.innerHTML = '<div class="buffer"></div><i></i><div class="thumb"></div>';
progressWrap.appendChild(progress);

const time = document.createElement('div'); time.className = 'time'; time.textContent = '00:00 / 00:00';

const volumeWrap = document.createElement('div'); volumeWrap.className = 'volume';
const volBtn = document.createElement('button'); volBtn.className = 'ctrl-btn'; volBtn.setAttribute('aria-label','mute');
volBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 5V4L9 9H5z"></path></svg>`;
const volTrack = document.createElement('div'); volTrack.className = 'vol-track'; volTrack.innerHTML = '<i></i>';
volumeWrap.appendChild(volBtn); volumeWrap.appendChild(volTrack);

const speedSelect = document.createElement('select'); speedSelect.className = 'select';
[0.5,0.75,1,1.25,1.5,1.75,2].forEach(v => {
  const o = document.createElement('option'); o.value = v; o.textContent = v + 'x'; if (v===1) o.selected = true;
  speedSelect.appendChild(o);
});

const qualitySelect = document.createElement('select'); qualitySelect.className = 'select'; qualitySelect.style.display = 'none';

const captionsBtn = document.createElement('button'); captionsBtn.className = 'ctrl-btn'; captionsBtn.setAttribute('aria-label','captions');
captionsBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 6H3v12h18V6zM8 13H6v-2h2v2zm6 0h-4v-2h4v2z"/></svg>`;
captionsBtn.title = 'Captions';

const downloadBtn = document.createElement('button'); downloadBtn.className = 'ctrl-btn'; downloadBtn.setAttribute('aria-label','download');
downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zm7-18L5.33 9h3.67v6h6V9h3.67L12 2z"/></svg>`;
downloadBtn.title = 'Download / Open stream';

const pipBtn = document.createElement('button'); pipBtn.className = 'ctrl-btn'; pipBtn.setAttribute('aria-label','picture-in-picture');
pipBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H5V9h14v6zM7 11h4v2H7z"/></svg>`;

const fsBtn = document.createElement('button'); fsBtn.className = 'ctrl-btn'; fsBtn.setAttribute('aria-label','fullscreen');
fsBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm0-4h2V7h3V5H7v5zm10 9h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;

controls.appendChild(playBtn);
controls.appendChild(progressWrap);
controls.appendChild(time);
controls.appendChild(volumeWrap);
controls.appendChild(speedSelect);
controls.appendChild(qualitySelect);
controls.appendChild(captionsBtn);
controls.appendChild(downloadBtn);
controls.appendChild(pipBtn);
controls.appendChild(fsBtn);

const pipBadge = document.createElement('div'); pipBadge.className = 'pip-badge'; pipBadge.textContent = 'PiP';
pipBadge.style.display = 'none';

const message = document.createElement('div'); message.className = 'message'; message.style.display = 'none';
message.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="opacity:.95"><path d="M11 15h2v2h-2zM11 7h2v6h-2z"/></svg><div><div class="msg-text">Loading…</div><div class="diagnostics" style="display:none"></div></div>`;

/* terminal overlay (ultra-fast bottom-up output) */
const terminalOverlay = document.createElement('div');
terminalOverlay.className = 'terminal-overlay';
terminalOverlay.innerHTML = `
  <div class="terminal-window">
    <div class="terminal-lines" role="log" aria-live="polite"></div>
    <div class="terminal-status"><div class="left">Status</div><div class="right">0%</div></div>
  </div>
`;
terminalOverlay.style.display = 'none';

/* assemble into container */
container.appendChild(video);
container.appendChild(center);
container.appendChild(controls);
container.appendChild(pipBadge);
container.appendChild(message);
container.appendChild(terminalOverlay);

/* refs */
const progBar = progress.querySelector('i');
const bufferBar = progress.querySelector('.buffer');
const thumb = progress.querySelector('.thumb');
const volBar = volTrack.querySelector('i');
const msgText = message.querySelector('.msg-text');
const diagEl = message.querySelector('.diagnostics');
const terminalLines = terminalOverlay.querySelector('.terminal-lines');
const terminalStatusLeft = terminalOverlay.querySelector('.terminal-status .left');
const terminalStatusRight = terminalOverlay.querySelector('.terminal-status .right');

/* small helpers */
function fmt(s){
  if (!s || isNaN(s)) return '00:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function setPlayIcon(paused){
  playBtn.innerHTML = paused
    ? `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
}
function setMuteIcon(muted, vol){
  if (muted || vol === 0) {
    volBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-.77-3.36-1.98-4.47l-1.42 1.42A4.48 4.48 0 0 1 15.5 12c0 1.24-.5 2.36-1.3 3.16l1.42 1.42A6.48 6.48 0 0 0 16.5 12zM19 12c0 2.76-1.12 5.26-2.93 7.07l1.41 1.41C19.07 18.07 20 15.13 20 12s-.93-6.07-2.52-8.48l-1.41 1.41C17.88 6.74 19 9.24 19 12zM5 9v6h4l5 5V4L9 9H5z"/></svg>`;
  } else {
    volBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5z"/></svg>`;
  }
}
function showMessage(text, diagnostics){
  msgText.textContent = text;
  if (diagnostics) {
    diagEl.style.display = 'block';
    diagEl.textContent = diagnostics;
  } else {
    diagEl.style.display = 'none';
    diagEl.textContent = '';
  }
  message.style.display = 'flex';
}
function hideMessage(){ message.style.display = 'none'; }

/* ---------- showTerminalScan: returns a Promise and a cancel function ---------- */
/*
  options:
    durationMs: total duration
    density: 1..5 (higher = more lines per frame)
    onProgress(percent)
  returns:
    { promise, cancel } where promise resolves when scan completes (or rejects on cancel)
*/
function showTerminalScanPromise({ durationMs = 1000, density = 5, onProgress = null } = {}) {
  const D = Math.max(1, Math.min(5, Math.floor(density)));
  const basePerFrame = 8 * D;
  const burstMax = 40 * D;
  const start = performance.now();
  const end = start + durationMs;

  const verbs = ['mkdir','touch','ln','cp','mv','curl','openssl','ffprobe','ffmpeg','segmenter','hash','verify','stat','chmod','chown','rsync','wget','cat','sed','awk','split','tar','gzip'];
  const dirs = ['/var/cache/cdn','/tmp/segments','/srv/media','/mnt/storage','/opt/streamer','/run/session','/data/streams','/var/lib/hls','/usr/local/bin'];
  const files = ['segment-0001.ts','segment-0002.ts','index.m3u8','manifest.json','chunk-12.bin','init.mp4','audio-001.aac','meta.json','thumb.jpg'];
  const hosts = ['edge01.cdn.example','edge02.cdn.example','origin01.internal','proxy-nyc','proxy-sfo','cache-eu','cdn-lon'];
  const hashes = ['a3f5c2','9b7d1e','ff12ab','c0ffee','deadbe','b16b00b5','7e57c0de','8badf00d','cafebabe'];

  terminalLines.innerHTML = '';
  terminalOverlay.style.display = 'flex';
  terminalOverlay.style.pointerEvents = 'none';
  terminalStatusLeft.textContent = 'Scanning';
  terminalStatusRight.textContent = '0%';

  let raf = null;
  let cancelled = false;

  function nowTimestamp() {
    const d = new Date();
    return d.toISOString().replace('T',' ').split('.')[0];
  }
  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function genLine(t) {
    const r = Math.random();
    if (r < 0.10) {
      const d = dirs[randomInt(0, dirs.length - 1)];
      const name = Math.random().toString(36).slice(2, 9);
      return { text: `${nowTimestamp()}  mkdir -p ${d}/${name}`, cls: 'ok' };
    } else if (r < 0.22) {
      const d = dirs[randomInt(0, dirs.length - 1)];
      const f = files[randomInt(0, files.length - 1)];
      return { text: `${nowTimestamp()}  touch ${d}/${f}`, cls: 'ok' };
    } else if (r < 0.40) {
      const h = hosts[randomInt(0, hosts.length - 1)];
      const seg = `segment-${String(randomInt(1,9999)).padStart(4,'0')}.ts`;
      const kb = randomInt(20, 2000);
      const ms = randomInt(20, 600);
      return { text: `${nowTimestamp()}  curl -sS "https://${h}/${seg}" -o /tmp/${seg}  (${kb} KB, ${ms} ms)`, cls: 'ok' };
    } else if (r < 0.58) {
      const f = files[randomInt(0, files.length - 1)];
      const h = hashes[randomInt(0, hashes.length - 1)] + randomInt(0,999).toString(16);
      return { text: `${nowTimestamp()}  hash ${f} => ${h}`, cls: 'ok' };
    } else if (r < 0.72) {
      const f = files[randomInt(0, files.length - 1)];
      return { text: `${nowTimestamp()}  ffprobe -v error -show_format -show_streams ${f}`, cls: 'ok' };
    } else if (r < 0.86) {
      const mbps = (Math.random() * 120 + 10).toFixed(1);
      const eta = Math.max(1, Math.floor((1 - t) * (Math.random() * 30 + 2)));
      return { text: `${nowTimestamp()}  transfer: ${mbps} MB/s  ETA: ${eta}s`, cls: 'ok' };
    } else if (r < 0.98) {
      const w = ['WARN: segment mismatch','WARN: retrying fetch','WARN: slow peer detected','WARN: checksum delayed','WARN: high latency'];
      return { text: `${nowTimestamp()}  ${w[randomInt(0, w.length - 1)]}`, cls: 'warn' };
    } else {
      const e = ['ERROR: failed to verify signature','ERROR: segment corrupted','ERROR: network timeout','ERROR: disk write failed'];
      return { text: `${nowTimestamp()}  ${e[randomInt(0, e.length - 1)]} (code=${randomInt(100,999)})`, cls: 'err' };
    }
  }

  function appendLineBottom(text, cls = 'terminal-line ok') {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    terminalLines.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      terminalLines.scrollTop = terminalLines.scrollHeight;
    });
    // trim
    const maxLines = 1200;
    if (terminalLines.children.length > maxLines) {
      for (let i = 0; i < 120; i++) {
        if (terminalLines.firstChild) terminalLines.removeChild(terminalLines.firstChild);
      }
    }
  }

  function tick(now, resolve) {
    if (cancelled) {
      terminalOverlay.style.display = 'none';
      return resolve(new Error('cancelled'));
    }
    const t = Math.min(1, (now - start) / durationMs);
    const pct = Math.floor(t * 100);
    terminalStatusRight.textContent = `${pct}%`;

    const jitter = randomInt(0, 6 * D);
    const burst = (Math.random() < 0.12) ? randomInt(8 * D, burstMax) : 0;
    const count = basePerFrame + jitter + burst;

    for (let i = 0; i < count; i++) {
      const line = genLine(t);
      const cls = line.cls === 'ok' ? 'terminal-line ok' : (line.cls === 'warn' ? 'terminal-line warn' : 'terminal-line err');
      appendLineBottom(line.text, cls);
    }

    if (Math.random() < 0.12 * D) {
      const barPct = Math.min(100, Math.floor(pct + randomInt(-6, 6)));
      const filled = Math.floor(barPct / 4);
      const bar = `[${'█'.repeat(filled)}${' '.repeat(25 - filled)}] ${barPct}%`;
      appendLineBottom(`${nowTimestamp()}  ${bar}`, 'terminal-line ok');
    }

    if (onProgress) onProgress(pct);

    if (now < end) {
      raf = requestAnimationFrame(n => tick(n, resolve));
    } else {
      appendLineBottom(`${nowTimestamp()}  verifying segments... OK`, 'terminal-line ok');
      appendLineBottom(`${nowTimestamp()}  applying adaptive-bitrate policy... OK`, 'terminal-line ok');
      appendLineBottom(`${nowTimestamp()}  finalizing manifest... OK`, 'terminal-line ok');
      appendLineBottom(`${nowTimestamp()}  Scan complete. Preparing playback...`, 'terminal-line ok');
      terminalStatusRight.textContent = '100%';
      if (onProgress) onProgress(100);
      setTimeout(() => {
        terminalOverlay.style.display = 'none';
        resolve();
      }, 220);
    }
  }

  // return promise + cancel
  let resolveOuter, rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
    raf = requestAnimationFrame(n => tick(n, resolve));
  });

  const cancel = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    terminalOverlay.style.display = 'none';
    rejectOuter(new Error('cancelled'));
  };

  return { promise, cancel };
}

/* ---------- HLS / attach ---------- */
let hlsInstance = null;
async function attachSource(url) {
  if (!url) { showMessage('No source'); return; }
  const isHls = /\.m3u8($|\?)/i.test(url);
  const canPlayHlsNatively = video.canPlayType('application/vnd.apple.mpegurl') !== '';

  // show scan and wait for it to complete before attaching
  const { promise: scanPromise } = showTerminalScanPromise({ durationMs: 900, density: 5, onProgress: null });
  try {
    await scanPromise;
  } catch (err) {
    // if scan was cancelled or failed, continue to attempt attach but show message
    console.warn('scan aborted or failed', err);
  }

  if (isHls && !canPlayHlsNatively) {
    try {
      showMessage('Loading HLS engine…');
      const { default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js');
      if (Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true, capLevelToPlayerSize: true });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          hideMessage();
          populateQualityOptions();
        });
        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          console.warn('hls error', event, data);
          if (data.fatal) showMessage('Playback error (HLS).', `HLS error: ${data.type} ${data.details}`);
        });
        return;
      } else {
        showMessage('HLS not supported');
        return;
      }
    } catch (err) {
      console.warn('Failed to load hls.js', err);
      showMessage('HLS engine failed', String(err));
      return;
    }
  }

  // MP4 or native HLS: assign via <source>
  try {
    showMessage('Loading…');
    while (video.firstChild) video.removeChild(video.firstChild);
    const source = document.createElement('source');
    source.src = url;
    video.appendChild(source);
    video.load();
    await waitForEvent(video, 'loadedmetadata', 9000);
    hideMessage();
    try { await video.play(); } catch {}
    return;
  } catch (err) {
    console.warn('Direct assignment failed', err);
    const code = video.error?.code ?? 'none';
    const ns = video.networkState ?? 'unknown';
    const resolved = video.currentSrc || rawUrl;
    const diag = [
      `MediaError code: ${code}`,
      `networkState: ${ns}`,
      `currentSrc: ${resolved}`,
      `Signed URLs may expire or be restricted by IP/referrer.`,
      `Open the URL in a new tab to confirm it plays directly.`
    ].join('\n');
    showMessage('Unable to play stream. Check URL or server restrictions.', diag);
  }
}

/* helper to await event */
function waitForEvent(el, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    function onEvent() { if (done) return; done = true; cleanup(); resolve(); }
    function onError(e) { if (done) return; done = true; cleanup(); reject(e || new Error('error')); }
    function onTimeout() { if (done) return; done = true; cleanup(); reject(new Error('timeout')); }
    function cleanup() {
      el.removeEventListener(eventName, onEvent);
      el.removeEventListener('error', onError);
    }
    el.addEventListener(eventName, onEvent);
    el.addEventListener('error', onError);
    setTimeout(onTimeout, timeout);
  });
}

/* ---------- UI wiring (controls) ---------- */
bigPlay.addEventListener('click', ()=> video.play());
playBtn.addEventListener('click', ()=> video.paused ? video.play() : video.pause());

video.addEventListener('play', ()=> {
  setPlayIcon(false);
  center.style.display = 'none';
  controls.classList.remove('hidden');
});
video.addEventListener('pause', ()=> {
  setPlayIcon(true);
  center.style.display = '';
  controls.classList.remove('hidden');
});
video.addEventListener('timeupdate', ()=> {
  const pct = (video.currentTime / (video.duration || 1)) * 100;
  progBar.style.width = pct + '%';
  thumb.style.left = pct + '%';
  time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  updateBuffer();
});
video.addEventListener('loadedmetadata', ()=> {
  time.textContent = `${fmt(0)} / ${fmt(video.duration)}`;
  updateBuffer();
});
video.addEventListener('ended', ()=> {
  video.currentTime = 0;
  video.pause();
});

/* progress interactions */
let seeking = false;
function seekToRatio(ratio){
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(1, ratio)) * video.duration;
}
progress.addEventListener('click', (e) => {
  const r = progress.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  seekToRatio(x);
});
progress.addEventListener('pointerdown', (e) => {
  seeking = true;
  try { progress.setPointerCapture(e.pointerId); } catch {}
});
progress.addEventListener('pointermove', (e) => {
  if (!seeking) return;
  const r = progress.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  thumb.style.left = (x*100) + '%';
});
progress.addEventListener('pointerup', (e) => {
  if (!seeking) return;
  seeking = false;
  const r = progress.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  seekToRatio(x);
  try { progress.releasePointerCapture(e.pointerId); } catch {}
});

/* buffer indicator */
function updateBuffer(){
  try {
    const ranges = video.buffered;
    if (!ranges || ranges.length === 0) { bufferBar.style.width = '0%'; return; }
    const end = ranges.end(ranges.length - 1);
    const pct = (end / (video.duration || 1)) * 100;
    bufferBar.style.width = Math.min(100, pct) + '%';
  } catch (e) { bufferBar.style.width = '0%'; }
}

/* volume */
volTrack.addEventListener('click', (e) => {
  const r = volTrack.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  video.volume = x;
  video.muted = false;
  volBar.style.width = (x * 100) + '%';
  setMuteIcon(false, x);
});
volBtn.addEventListener('click', ()=> {
  video.muted = !video.muted;
  setMuteIcon(video.muted, video.volume);
  volBar.style.width = video.muted ? '0%' : (video.volume * 100) + '%';
});

/* speed */
speedSelect.addEventListener('change', ()=> {
  video.playbackRate = Number(speedSelect.value);
});

/* captions toggle */
captionsBtn.addEventListener('click', ()=> {
  const tracks = video.textTracks || [];
  if (tracks.length === 0) {
    showMessage('No captions available');
    setTimeout(hideMessage, 1200);
    return;
  }
  const t = tracks[0];
  t.mode = (t.mode === 'showing') ? 'disabled' : 'showing';
  captionsBtn.style.opacity = (t.mode === 'showing') ? '1' : '0.7';
});

/* fullscreen & double-click */
fsBtn.addEventListener('click', toggleFullscreen);
video.addEventListener('dblclick', toggleFullscreen);
function toggleFullscreen(){
  const el = container;
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

/* Picture-in-Picture */
pipBtn.addEventListener('click', async ()=> {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      pipBadge.style.display = 'none';
    } else {
      await video.requestPictureInPicture();
      pipBadge.style.display = 'block';
    }
  } catch (err) {
    console.warn('PiP failed', err);
    showMessage('PiP not available', String(err));
    setTimeout(hideMessage, 2500);
  }
});
document.addEventListener('leavepictureinpicture', ()=> pipBadge.style.display = 'none');

/* keyboard shortcuts */
window.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault(); video.paused ? video.play() : video.pause();
      break;
    case 'ArrowRight':
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      break;
    case 'ArrowLeft':
      video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'f':
      toggleFullscreen();
      break;
    case 'm':
      volBtn.click();
      break;
    case '.':
      video.playbackRate = Math.min(3, video.playbackRate + 0.25);
      speedSelect.value = video.playbackRate;
      break;
    case ',':
      video.playbackRate = Math.max(0.25, video.playbackRate - 0.25);
      speedSelect.value = video.playbackRate;
      break;
  }
});

/* auto-hide controls */
let hideTimer = null;
function showControls() {
  controls.classList.remove('hidden');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(()=> {
    if (!video.paused) controls.classList.add('hidden');
  }, 3000);
}
container.addEventListener('mousemove', showControls);
container.addEventListener('touchstart', showControls);

/* quality selector for HLS */
function populateQualityOptions(){
  if (!hlsInstance) return;
  const levels = hlsInstance.levels || [];
  qualitySelect.innerHTML = '';
  const autoOpt = document.createElement('option'); autoOpt.value = '-1'; autoOpt.textContent = 'Auto';
  qualitySelect.appendChild(autoOpt);
  levels.forEach((lvl, idx) => {
    const o = document.createElement('option');
    const res = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate/1000)}kbps`;
    o.value = String(idx);
    o.textContent = `${res} (${Math.round(lvl.bitrate/1000)} kbps)`;
    qualitySelect.appendChild(o);
  });
  qualitySelect.style.display = levels.length > 0 ? '' : 'none';
  qualitySelect.value = String(hlsInstance.currentLevel);
}
qualitySelect.addEventListener('change', ()=> {
  if (!hlsInstance) return;
  const v = Number(qualitySelect.value);
  hlsInstance.currentLevel = v;
});

/* diagnostics on error */
video.addEventListener('error', (ev) => {
  console.warn('Video element error', ev);
  const code = video.error?.code ?? 'none';
  const ns = video.networkState ?? 'unknown';
  const resolved = video.currentSrc || rawUrl;
  const diag = [
    `MediaError code: ${code}`,
    `networkState: ${ns}`,
    `currentSrc: ${resolved}`,
    `Signed URLs may expire or be restricted by IP/referrer.`,
    `Open the URL in a new tab to confirm it plays directly.`
  ].join('\n');
  showMessage('Unable to play stream. Server or CORS restrictions may apply.', diag);
});

/* ---------- Download button behavior (defensive) ---------- */
let downloadInProgress = false;
downloadBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  if (downloadInProgress) return;
  downloadInProgress = true;
  downloadBtn.disabled = true;
  downloadBtn.style.opacity = '0.6';

  // show scan and wait
  const { promise: scanPromise, cancel } = showTerminalScanPromise({ durationMs: 1200, density: 5, onProgress: null });
  try {
    await scanPromise;
    // open URL in new tab safely
    try {
      window.open(rawUrl, '_blank', 'noopener');
    } catch (err) {
      // fallback to same tab
      window.location.href = rawUrl;
    }
  } catch (err) {
    // scan was cancelled or failed; show a brief message
    console.warn('Download scan aborted or failed', err);
    showMessage('Download cancelled or failed');
    setTimeout(hideMessage, 1200);
  } finally {
    downloadInProgress = false;
    downloadBtn.disabled = false;
    downloadBtn.style.opacity = '';
  }
});

/* init UI */
setPlayIcon(true);
setMuteIcon(false, video.volume);
volBar.style.width = (video.volume * 100) + '%';
speedSelect.value = 1;

/* start attach */
attachSource(rawUrl);

/* cleanup on unload */
window.addEventListener('beforeunload', ()=> {
  try { if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; } } catch {}
});
