/*
 * Wires everything together: settings panel, render loop, lightning, input.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'rainy-window.settings.v1';

  const DEFAULTS = {
    intensity: 55,
    dropSize: 100,
    condensation: 60,
    fog: 45,
    storm: 25,
    scene: 'city',
    blur: 60,
    refraction: 60,
    brightness: 100,
    frame: true,
    quality: 'high',
    master: 70,
    rain: 70,
    music: 45,
    thunder: 60
  };

  const CONTROLS = [
    { group: 'Rain' },
    { key: 'intensity', label: 'Rain intensity', min: 0, max: 100, fmt: pct },
    { key: 'dropSize', label: 'Drop size', min: 50, max: 200, fmt: pct },
    { key: 'condensation', label: 'Condensation', min: 0, max: 100, fmt: pct },
    { key: 'fog', label: 'Fogged glass', min: 0, max: 100, fmt: pct },
    { key: 'storm', label: 'Thunderstorm', min: 0, max: 100, fmt: function (v) { return v === 0 ? 'Off' : v + '%'; } },
    { group: 'View' },
    { key: 'scene', label: 'Outside the window', type: 'select', options: Scenes.list.map(function (s) { return [s.id, s.name]; }) },
    { key: 'blur', label: 'Depth of field', min: 0, max: 100, fmt: pct },
    { key: 'refraction', label: 'Refraction', min: 0, max: 100, fmt: pct },
    { key: 'brightness', label: 'Brightness', min: 50, max: 150, fmt: pct },
    { key: 'frame', label: 'Window frame', type: 'toggle' },
    { key: 'quality', label: 'Quality', type: 'select', options: [['low', 'Low (faster)'], ['medium', 'Medium'], ['high', 'High']] },
    { group: 'Sound' },
    { key: 'master', label: 'Master volume', min: 0, max: 100, fmt: pct },
    { key: 'rain', label: 'Rain sounds', min: 0, max: 100, fmt: pct },
    { key: 'music', label: 'Calming music', min: 0, max: 100, fmt: pct },
    { key: 'thunder', label: 'Thunder', min: 0, max: 100, fmt: pct }
  ];

  const QUALITY = {
    low: { water: 0.5, dpr: 1 },
    medium: { water: 0.75, dpr: 1.5 },
    high: { water: 1, dpr: 2 }
  };

  function pct(v) { return v + '%'; }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return Object.assign({}, DEFAULTS);
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  let settings = load();
  if (!QUALITY[settings.quality]) settings.quality = DEFAULTS.quality;
  if (!Scenes.list.some(function (s) { return s.id === settings.scene; })) settings.scene = DEFAULTS.scene;

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('view');
  const renderer = new Renderer(canvas);
  if (!renderer.ok) {
    $('fallback').hidden = false;
    $('intro').classList.add('is-hidden');
    return;
  }
  const sim = new RainSim();
  const audio = new AmbientAudio();
  const bgCanvas = document.createElement('canvas');
  let lights = { count: 0, update: function () {} };
  const lightPos = new Float32Array(Renderer.MAX_LIGHTS * 4);
  const lightCol = new Float32Array(Renderer.MAX_LIGHTS * 3);

  // Normalised settings used by the simulation.
  function simSettings() {
    return {
      intensity: settings.intensity / 100,
      dropSize: settings.dropSize / 100,
      condensation: settings.condensation / 100
    };
  }

  /* ---------------------------- Layout -------------------------------- */
  let cssW = 0, cssH = 0;
  function resize(force) {
    const w = window.innerWidth, h = window.innerHeight;
    if (!force && w === cssW && h === cssH) return;
    cssW = w; cssH = h;
    const q = QUALITY[settings.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    // Keep the pixel count sane on very large displays.
    const maxPixels = 3200 * 1800;
    let scale = dpr;
    if (w * h * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (w * h));
    renderer.resize(Math.round(w * scale), Math.round(h * scale));
    let waterScale = q.water;
    const maxWater = 2200 * 1300;
    if (w * h * waterScale * waterScale > maxWater) waterScale = Math.sqrt(maxWater / (w * h));
    sim.resize(w, h, waterScale, simSettings());
    paintScene();
  }

  function paintScene() {
    const q = QUALITY[settings.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    let bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    const maxW = 2560;
    if (bw > maxW) { bh = Math.round(bh * maxW / bw); bw = maxW; }
    const res = Scenes.create(settings.scene, bgCanvas, Math.max(2, bw), Math.max(2, bh));
    lights = res.lights;
    renderer.blurAmount = settings.blur / 100;
    renderer.setBackground(res.canvas);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resize(false); }, 200);
  });

  /* ---------------------------- Lightning ----------------------------- */
  const storm = { next: 0, pulses: [], level: 0 };
  function scheduleStrike(now) {
    const s = settings.storm / 100;
    if (s <= 0) { storm.next = Infinity; return; }
    const mean = 95 - s * 80; // seconds between strikes
    storm.next = now + (-Math.log(1 - Math.random()) * mean + 4) * 1000;
  }
  function strike(now) {
    const distance = Math.random();
    const strength = 1 - distance * 0.6;
    const flickers = 2 + ((Math.random() * 3) | 0);
    let t = now;
    for (let i = 0; i < flickers; i++) {
      storm.pulses.push({ t: t, v: strength * (0.5 + Math.random() * 0.5), decay: 60 + Math.random() * 120 });
      t += 60 + Math.random() * 180;
    }
    const delay = 400 + distance * 5500;
    setTimeout(function () { audio.thunder(distance); }, delay);
  }
  function lightningLevel(now) {
    if (now >= storm.next) {
      strike(now);
      scheduleStrike(now);
    }
    let level = 0;
    storm.pulses = storm.pulses.filter(function (p) {
      const dt = now - p.t;
      if (dt < 0) return true;
      level = Math.max(level, p.v * Math.exp(-dt / p.decay));
      return dt < p.decay * 8;
    });
    return level;
  }

  /* ---------------------------- Main loop ----------------------------- */
  let paused = false;
  let last = performance.now();
  let sceneTime = 0;
  sim.onImpact = function (size, x) { audio.impact(size, x); };

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    const ss = simSettings();
    if (!paused) {
      sim.update(dt, ss);
      sceneTime += dt / 1000;
    }
    sim.draw(ss);
    lights.update(sceneTime, canvas.width / canvas.height, lightPos, lightCol);
    renderer.render({
      water: sim.water,
      fog: sim.fog,
      time: sceneTime,
      refract: 0.25 + (settings.refraction / 100) * 1.5,
      heightScale: sim.rrefPx(ss),
      fogAmt: settings.fog / 100,
      lightning: lightningLevel(now) * 0.9,
      rain: settings.intensity / 100,
      brightness: settings.brightness / 100,
      lights: { count: lights.count, pos: lightPos, col: lightCol }
    });
    requestAnimationFrame(frame);
  }

  /* ---------------------------- Settings UI --------------------------- */
  const body = $('panel-body');
  const inputs = {};

  function buildPanel() {
    body.innerHTML = '';
    let group = null;
    CONTROLS.forEach(function (c) {
      if (c.group) {
        group = document.createElement('section');
        group.className = 'group';
        const h = document.createElement('h3');
        h.textContent = c.group;
        group.appendChild(h);
        body.appendChild(group);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'ctl' + (c.type === 'toggle' ? ' ctl--toggle' : '');
      const row = document.createElement('div');
      row.className = 'ctl__row';
      const label = document.createElement('label');
      const id = 'ctl-' + c.key;
      label.htmlFor = id;
      label.textContent = c.label;
      row.appendChild(label);
      wrap.appendChild(row);
      let input;
      if (c.type === 'select') {
        input = document.createElement('select');
        c.options.forEach(function (o) {
          const opt = document.createElement('option');
          opt.value = o[0];
          opt.textContent = o[1];
          input.appendChild(opt);
        });
        input.value = settings[c.key];
        input.addEventListener('change', function () { update(c.key, input.value); });
        wrap.appendChild(input);
      } else if (c.type === 'toggle') {
        const sw = document.createElement('span');
        sw.className = 'switch';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!settings[c.key];
        input.addEventListener('change', function () { update(c.key, input.checked); });
        sw.appendChild(input);
        sw.appendChild(document.createElement('span'));
        row.appendChild(sw);
      } else {
        const val = document.createElement('span');
        val.className = 'ctl__val';
        row.appendChild(val);
        input = document.createElement('input');
        input.type = 'range';
        input.min = c.min;
        input.max = c.max;
        input.step = 1;
        input.value = settings[c.key];
        const paint = function () {
          const v = Number(input.value);
          val.textContent = c.fmt(v);
          input.style.setProperty('--pct', ((v - c.min) / (c.max - c.min)) * 100 + '%');
        };
        paint();
        input.addEventListener('input', function () { paint(); update(c.key, Number(input.value)); });
        wrap.appendChild(input);
      }
      input.id = id;
      inputs[c.key] = input;
      group.appendChild(wrap);
    });
  }

  let blurRaf = 0;
  function update(key, value) {
    settings[key] = value;
    save();
    apply(key);
  }

  function apply(key) {
    switch (key) {
      case 'scene':
        paintScene();
        break;
      case 'blur':
        cancelAnimationFrame(blurRaf);
        blurRaf = requestAnimationFrame(function () { renderer.setBlur(settings.blur / 100); });
        break;
      case 'quality':
      case 'dropSize':
        resize(true);
        break;
      case 'frame':
        $('frame').classList.toggle('is-hidden', !settings.frame);
        break;
      case 'storm':
        scheduleStrike(performance.now());
        break;
      case 'intensity':
        audio.setIntensity(settings.intensity / 100);
        break;
      case 'master': case 'rain': case 'music': case 'thunder':
        applyVolumes();
        break;
    }
  }

  function applyVolumes() {
    audio.setVolumes({
      master: settings.master / 100,
      rain: settings.rain / 100,
      music: settings.music / 100,
      thunder: settings.thunder / 100
    });
  }

  /* ---------------------------- Panel & dock -------------------------- */
  const panel = $('panel');
  const btnSettings = $('btn-settings');
  function setPanel(open) {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    btnSettings.setAttribute('aria-expanded', String(open));
    if (open) document.body.classList.remove('ui-hidden');
    poke();
  }
  btnSettings.addEventListener('click', function () { setPanel(!panel.classList.contains('is-open')); });
  $('btn-close').addEventListener('click', function () { setPanel(false); });

  const btnSound = $('btn-sound');
  function setMuted(m) {
    audio.setMuted(m);
    btnSound.classList.toggle('is-muted', m);
  }
  btnSound.addEventListener('click', function () {
    if (!audio.started) { startAudio(); return; }
    setMuted(!audio.muted);
  });

  const btnPause = $('btn-pause');
  function togglePause() {
    paused = !paused;
    btnPause.textContent = paused ? 'Resume rain' : 'Pause rain';
  }
  btnPause.addEventListener('click', togglePause);

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
  }
  $('btn-full').addEventListener('click', toggleFullscreen);

  $('btn-reset').addEventListener('click', function () {
    const prev = settings;
    settings = Object.assign({}, DEFAULTS);
    save();
    buildPanel();
    $('frame').classList.toggle('is-hidden', !settings.frame);
    applyVolumes();
    audio.setIntensity(settings.intensity / 100);
    scheduleStrike(performance.now());
    if (prev.quality !== settings.quality || prev.dropSize !== settings.dropSize) resize(true);
    else paintScene();
  });

  // Hide controls and cursor after a few seconds of stillness.
  let idleTimer = 0;
  function poke() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!panel.classList.contains('is-open')) document.body.classList.add('idle');
    }, 3500);
  }
  ['pointermove', 'pointerdown', 'keydown'].forEach(function (e) { window.addEventListener(e, poke, { passive: true }); });

  /* ---------------------------- Intro & audio ------------------------- */
  const intro = $('intro');
  function startAudio() {
    if (audio.start()) {
      audio.setIntensity(settings.intensity / 100, true);
      applyVolumes();
      setMuted(false);
    }
  }
  function dismissIntro(withSound) {
    if (withSound) startAudio();
    else btnSound.classList.add('is-muted');
    intro.classList.add('is-hidden');
    poke();
  }
  $('start').addEventListener('click', function (e) { e.stopPropagation(); dismissIntro(true); });
  $('start-silent').addEventListener('click', function (e) { e.stopPropagation(); dismissIntro(false); });

  /* ---------------------------- Wiping the glass ---------------------- */
  let wiping = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (!intro.classList.contains('is-hidden')) return;
    if (panel.classList.contains('is-open')) setPanel(false);
    wiping = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    sim.wipe(e.clientX, e.clientY, e.clientX + 0.1, e.clientY, wipeRadius());
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!wiping || wiping.id !== e.pointerId) return;
    sim.wipe(wiping.x, wiping.y, e.clientX, e.clientY, wipeRadius());
    wiping.x = e.clientX;
    wiping.y = e.clientY;
  });
  function endWipe(e) { if (wiping && wiping.id === e.pointerId) wiping = null; }
  canvas.addEventListener('pointerup', endWipe);
  canvas.addEventListener('pointercancel', endWipe);
  function wipeRadius() { return Math.max(18, Math.min(34, Math.min(cssW, cssH) * 0.03)); }

  /* ---------------------------- Keyboard ------------------------------ */
  window.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') && e.key !== 'Escape') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 's': setPanel(!panel.classList.contains('is-open')); break;
      case 'escape': setPanel(false); break;
      case 'm': if (!audio.started) startAudio(); else setMuted(!audio.muted); break;
      case 'f': toggleFullscreen(); break;
      case 'h': document.body.classList.toggle('ui-hidden'); break;
      case ' ':
        if (e.target === document.body) { e.preventDefault(); togglePause(); }
        break;
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!audio.ctx) return;
    // Keep the ambience going in the background, but let the render loop rest.
    last = performance.now();
  });

  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', function () { location.reload(); });

  /* ---------------------------- Boot ---------------------------------- */
  buildPanel();
  $('frame').classList.toggle('is-hidden', !settings.frame);
  resize(true);
  scheduleStrike(performance.now());
  // An early strike so the storm makes itself known.
  if (settings.storm > 0) storm.next = performance.now() + 12000 + Math.random() * 10000;
  requestAnimationFrame(function (t) { last = t; frame(t); });
})();
