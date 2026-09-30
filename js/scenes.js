/*
 * Procedurally painted scenery that sits behind the glass.
 *
 * Each scene paints a static backdrop onto a 2D canvas and describes a set of
 * animated light sources (car lights, boat lights, a lighthouse...) that the
 * WebGL renderer draws on top, so the view outside the window feels alive.
 */
(function (global) {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    const v = typeof c === 'string' ? hex(c) : c;
    return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')';
  }
  function mix(a, b, t) {
    const x = hex(a), y = hex(b);
    return [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); });
  }

  function glow(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.18, rgba(color, alpha * 0.5));
    g.addColorStop(0.5, rgba(color, alpha * 0.12));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function softBlob(ctx, x, y, rx, ry, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }

  function vGradient(ctx, y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }

  // A vertical, wavering reflection streak on wet ground or water.
  function reflection(ctx, x, y0, y1, width, color, alpha, rnd) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.35, rgba(color, alpha * 0.45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    const steps = 18;
    const seg = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) {
      const w = width * (0.6 + rnd() * 0.8) * (1 + i / steps);
      const x0 = x - w / 2 + (rnd() - 0.5) * width * 0.5;
      ctx.fillRect(x0, y0 + i * seg, w, seg * (0.55 + rnd() * 0.5));
    }
  }

  const WARM = ['#ffd29a', '#ffc27a', '#ffe2b8', '#ffb86b', '#fff1d6'];
  const COOL = ['#cfe0ff', '#b8d0ff', '#e6f0ff', '#a9ffe9'];

  function litWindows(ctx, x, y, bw, bh, cell, rnd, prob, u) {
    const cw = cell * u, ch = cell * 1.35 * u;
    const ww = cw * 0.55, wh = ch * 0.55;
    for (let fy = y + ch * 0.7; fy < y + bh - ch * 0.6; fy += ch) {
      const rowProb = prob * (rnd() < 0.15 ? 2.6 : rnd() < 0.3 ? 0.2 : 1);
      for (let fx = x + cw * 0.45; fx < x + bw - ww - cw * 0.2; fx += cw) {
        if (rnd() < rowProb) {
          const pal = rnd() < 0.78 ? WARM : COOL;
          const c = pal[(rnd() * pal.length) | 0];
          ctx.fillStyle = rgba(c, 0.35 + rnd() * 0.65);
          ctx.fillRect(fx, fy, ww, wh);
          // Light spilling from the room, so windows survive the blur.
          if (rnd() < 0.12) glow(ctx, fx + ww / 2, fy + wh / 2, cw * 2.2, c, 0.22);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* City at night                                                        */
  /* ------------------------------------------------------------------ */
  function paintCity(ctx, w, h, rnd) {
    const u = h / 1000;
    const street = h * 0.8;

    ctx.fillStyle = vGradient(ctx, 0, street, [
      [0, '#05070e'], [0.45, '#10152a'], [0.8, '#2a2438'], [1, '#4a3336']
    ]);
    ctx.fillRect(0, 0, w, h);

    // Low clouds lit from below by the city.
    for (let i = 0; i < 55; i++) {
      const y = rnd() * h * 0.55;
      const r = (140 + rnd() * 360) * u;
      const lit = y / (h * 0.55);
      softBlob(ctx, rnd() * w, y, r * 1.8, r, lit > 0.6 ? '#5a4550' : '#2a3048', 0.12 + rnd() * 0.12);
    }
    ctx.globalCompositeOperation = 'lighter';
    softBlob(ctx, w * 0.5, street, w * 0.8, h * 0.35, '#ff8a4a', 0.16);
    ctx.globalCompositeOperation = 'source-over';

    // Far skyline.
    let x = -30 * u;
    while (x < w) {
      const bw = (40 + rnd() * 100) * u;
      const bh = (120 + rnd() * 300) * u;
      const top = street - bh - 40 * u;
      ctx.fillStyle = '#121626';
      ctx.fillRect(x, top, bw, bh + 40 * u);
      ctx.globalCompositeOperation = 'lighter';
      litWindows(ctx, x, top, bw, bh, 9, rnd, 0.2, u);
      ctx.globalCompositeOperation = 'source-over';
      x += bw + rnd() * 10 * u;
    }

    // A tall landmark tower with an aviation light.
    const tx = w * (0.62 + rnd() * 0.2);
    const tTop = street - 640 * u;
    ctx.fillStyle = '#0e1120';
    ctx.fillRect(tx, tTop, 70 * u, 640 * u);
    ctx.fillRect(tx + 30 * u, tTop - 90 * u, 8 * u, 90 * u);
    ctx.globalCompositeOperation = 'lighter';
    litWindows(ctx, tx, tTop, 70 * u, 640 * u, 10, rnd, 0.22, u);
    glow(ctx, tx + 34 * u, tTop - 92 * u, 40 * u, '#ff3b30', 0.9);
    ctx.globalCompositeOperation = 'source-over';

    // Mid-ground buildings.
    x = -60 * u;
    const neonColors = ['#ff3d7f', '#3de0ff', '#ffb13d', '#9d6bff', '#58ff9c'];
    while (x < w) {
      const bw = (90 + rnd() * 170) * u;
      const bh = (180 + rnd() * 330) * u;
      const top = street - bh;
      ctx.fillStyle = rnd() < 0.5 ? '#080a12' : '#0a0c15';
      ctx.fillRect(x, top, bw, bh);
      ctx.globalCompositeOperation = 'lighter';
      litWindows(ctx, x, top, bw, bh, 15, rnd, 0.32, u);
      if (rnd() < 0.5) glow(ctx, x + bw * 0.5, top - 4 * u, 22 * u, '#ff3b30', 0.7);
      if (rnd() < 0.45) {
        // Neon sign on the facade.
        const c = neonColors[(rnd() * neonColors.length) | 0];
        const sx = x + bw * (0.15 + rnd() * 0.4), sy = street - (60 + rnd() * 120) * u;
        const sw = (40 + rnd() * 70) * u, sh = (12 + rnd() * 16) * u;
        ctx.fillStyle = rgba(c, 0.95);
        ctx.fillRect(sx, sy, sw, sh);
        glow(ctx, sx + sw / 2, sy + sh / 2, sw * 1.6, c, 0.45);
      }
      ctx.globalCompositeOperation = 'source-over';
      x += bw + rnd() * 30 * u;
    }

    // Street and wet asphalt.
    ctx.fillStyle = vGradient(ctx, street, h, [[0, '#15151c'], [0.2, '#0b0c12'], [1, '#050609']]);
    ctx.fillRect(0, street, w, h - street);
    ctx.fillStyle = '#1b1b22';
    ctx.fillRect(0, street, w, 14 * u);

    // Street lamps with sodium glow and reflections.
    ctx.globalCompositeOperation = 'lighter';
    const lampCount = Math.max(4, Math.round(w / (h * 0.42)));
    for (let i = 0; i < lampCount; i++) {
      const lx = (i + 0.3 + rnd() * 0.4) * (w / lampCount);
      const ly = street - 230 * u;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a0a0e';
      ctx.fillRect(lx - 3 * u, ly, 6 * u, 230 * u);
      ctx.fillRect(lx - 3 * u, ly, 30 * u, 5 * u);
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, lx + 26 * u, ly + 6 * u, 55 * u, '#ffb050', 0.95);
      glow(ctx, lx + 26 * u, ly + 6 * u, 240 * u, '#ff9a40', 0.22);
      reflection(ctx, lx + 26 * u, street + 18 * u, h, 22 * u, '#ffa850', 0.4, rnd);
    }
    // Traffic lights.
    for (let i = 0; i < 3; i++) {
      const lx = rnd() * w, ly = street - (120 + rnd() * 30) * u;
      const c = rnd() < 0.5 ? '#ff3020' : '#30ff90';
      glow(ctx, lx, ly, 26 * u, c, 0.9);
      reflection(ctx, lx, street + 20 * u, h * 0.97, 14 * u, c, 0.25, rnd);
    }
    // Scattered neon reflections on the road.
    for (let i = 0; i < 8; i++) {
      const c = neonColors[(rnd() * neonColors.length) | 0];
      reflection(ctx, rnd() * w, street + 20 * u, h * (0.9 + rnd() * 0.1), 16 * u, c, 0.14, rnd);
    }
    ctx.globalCompositeOperation = 'source-over';
    return {};
  }

  function cityLights(meta) {
    const lanes = [
      { y: 0.838, dir: 1, col: [1.0, 0.12, 0.06], size: 0.022, gain: 0.7, spread: 0.026 },
      { y: 0.885, dir: -1, col: [1.0, 0.88, 0.68], size: 0.03, gain: 0.75, spread: 0.034 }
    ];
    const cars = [];
    lanes.forEach(function (lane, li) {
      for (let i = 0; i < 4; i++) {
        cars.push({
          lane: lane,
          phase: Math.random() * 3,
          speed: 0.035 + Math.random() * 0.05,
          wobble: Math.random() * 6.28,
          li: li
        });
      }
    });
    return {
      count: cars.length * 2,
      update: function (t, aspect, pos, col) {
        const margin = 0.25;
        const span = 1 + margin * 2;
        let k = 0;
        cars.forEach(function (c) {
          const L = c.lane;
          let p = (c.phase + t * c.speed) % span;
          let x = L.dir > 0 ? p - margin : 1 + margin - p;
          const half = L.spread / aspect;
          const flick = 0.9 + 0.1 * Math.sin(t * 3 + c.wobble);
          for (let s = -1; s <= 1; s += 2) {
            pos[k * 4] = x + s * half;
            pos[k * 4 + 1] = L.y;
            pos[k * 4 + 2] = L.size;
            pos[k * 4 + 3] = L.gain * flick;
            col[k * 3] = L.col[0]; col[k * 3 + 1] = L.col[1]; col[k * 3 + 2] = L.col[2];
            k++;
          }
        });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Misty forest                                                         */
  /* ------------------------------------------------------------------ */
  function conifer(ctx, x, base, hgt, wid, rnd) {
    const tiers = 6 + ((rnd() * 5) | 0);
    const right = [];
    for (let k = 1; k <= tiers; k++) {
      const f = k / tiers;
      const ty = base - hgt + hgt * 0.9 * f;
      const tw = wid * 0.5 * f * (0.75 + rnd() * 0.5);
      right.push([x + tw, ty]);
      right.push([x + tw * 0.35, ty - hgt * 0.015]);
    }
    ctx.beginPath();
    ctx.moveTo(x, base - hgt);
    right.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(x + wid * 0.05, base - hgt * 0.1);
    ctx.lineTo(x + wid * 0.05, base + 2);
    ctx.lineTo(x - wid * 0.05, base + 2);
    ctx.lineTo(x - wid * 0.05, base - hgt * 0.1);
    for (let i = right.length - 1; i >= 0; i--) {
      const p = right[i];
      ctx.lineTo(x - (p[0] - x) * (0.85 + rnd() * 0.3), p[1] + (rnd() - 0.5) * hgt * 0.01);
    }
    ctx.closePath();
    ctx.fill();
  }

  function paintForest(ctx, w, h, rnd) {
    const u = h / 1000;
    ctx.fillStyle = vGradient(ctx, 0, h, [
      [0, '#2a3842'], [0.35, '#5d6f77'], [0.58, '#98a6a6'], [1, '#6c7875']
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    softBlob(ctx, w * 0.68, h * 0.38, w * 0.5, h * 0.3, '#ffe6c8', 0.1);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 40; i++) {
      softBlob(ctx, rnd() * w, rnd() * h * 0.45, (200 + rnd() * 400) * u * 1.8, (200 + rnd() * 400) * u * 0.6, '#27323a', 0.1 + rnd() * 0.1);
    }

    // Distant ridge.
    ctx.fillStyle = rgba(mix('#8b9899', '#4b5859', 0.5), 1);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 20 * u) {
      const y = h * 0.52 - Math.sin(x / (w * 0.21) + 1.3) * 60 * u - Math.sin(x / (w * 0.07)) * 18 * u;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.fill();

    const layers = 6;
    let cabin = null;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const base = h * (0.6 + t * 0.34);
      const col = mix('#8e9c9c', '#131c18', Math.pow(t, 1.1));
      ctx.fillStyle = rgba(col, 1);
      ctx.fillRect(0, base, w, h - base);
      const spacing = (22 + t * 55) * u;
      for (let x = -40 * u; x < w + 40 * u; x += spacing * (0.5 + rnd())) {
        const hgt = (140 + rnd() * 200) * u * (1 + t * 1.8);
        conifer(ctx, x, base + rnd() * 20 * u, hgt, hgt * (0.32 + rnd() * 0.12), rnd);
      }
      if (i === 3) {
        // A small cabin with warm windows.
        const cx = w * (0.25 + rnd() * 0.15), cy = base + 8 * u;
        const cw = 150 * u, ch = 80 * u;
        ctx.fillStyle = rgba(mix('#2c3431', '#141a17', 0.5), 1);
        ctx.fillRect(cx, cy - ch, cw, ch);
        ctx.beginPath();
        ctx.moveTo(cx - 14 * u, cy - ch);
        ctx.lineTo(cx + cw / 2, cy - ch - 55 * u);
        ctx.lineTo(cx + cw + 14 * u, cy - ch);
        ctx.fill();
        cabin = { x: cx, y: cy, w: cw, h: ch };
      }
      // Fog band rolling in front of the layer.
      ctx.fillStyle = vGradient(ctx, base - 260 * u * (1 + t), base + 60 * u, [
        [0, 'rgba(160,172,172,0)'], [0.7, rgba('#a4b0af', 0.32 * (1 - t * 0.7))], [1, 'rgba(160,172,172,0)']
      ]);
      ctx.fillRect(0, base - 260 * u * (1 + t), w, 320 * u * (1 + t));
    }
    if (cabin) {
      ctx.globalCompositeOperation = 'lighter';
      const u2 = u;
      [[0.2, 0.35], [0.62, 0.35]].forEach(function (p) {
        const wx = cabin.x + cabin.w * p[0], wy = cabin.y - cabin.h * (1 - p[1]) - 30 * u2;
        ctx.fillStyle = 'rgba(255,190,110,0.95)';
        ctx.fillRect(wx, wy, 26 * u2, 22 * u2);
        glow(ctx, wx + 13 * u2, wy + 11 * u2, 90 * u2, '#ffb060', 0.55);
      });
      glow(ctx, cabin.x + cabin.w + 40 * u, cabin.y - 90 * u, 30 * u, '#ffc880', 0.8);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Foreground grass tint.
    ctx.fillStyle = vGradient(ctx, h * 0.9, h, [[0, 'rgba(5,9,7,0)'], [1, 'rgba(5,9,7,0.9)']]);
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
    return {};
  }

  /* ------------------------------------------------------------------ */
  /* Harbor at dusk                                                       */
  /* ------------------------------------------------------------------ */
  function paintHarbor(ctx, w, h, rnd) {
    const u = h / 1000;
    const horizon = h * 0.6;
    ctx.fillStyle = vGradient(ctx, 0, horizon, [
      [0, '#141629'], [0.4, '#302c4d'], [0.75, '#6f4e67'], [1, '#c98470']
    ]);
    ctx.fillRect(0, 0, w, horizon);
    ctx.globalCompositeOperation = 'lighter';
    softBlob(ctx, w * 0.36, horizon, w * 0.45, h * 0.22, '#ff9a6a', 0.25);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 26; i++) {
      softBlob(ctx, rnd() * w, rnd() * horizon * 0.85, (250 + rnd() * 500) * u * 2, (40 + rnd() * 70) * u, '#1d1a30', 0.3 + rnd() * 0.3);
    }

    // Far hills on the left and a headland on the right.
    ctx.fillStyle = '#231f36';
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= w * 0.55; x += 10 * u) {
      const f = x / (w * 0.55);
      ctx.lineTo(x, horizon - (1 - f) * (110 + Math.sin(x / (60 * u)) * 12) * u - Math.sin(f * 3.1) * 30 * u);
    }
    ctx.lineTo(w * 0.55, horizon);
    ctx.fill();
    const headX = w * 0.72;
    ctx.beginPath();
    ctx.moveTo(headX, horizon);
    for (let x = headX; x <= w; x += 10 * u) {
      const f = (x - headX) / (w - headX);
      ctx.lineTo(x, horizon - Math.min(1, f * 3) * (85 + Math.sin(x / (40 * u)) * 6) * u);
    }
    ctx.lineTo(w, horizon);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const x = rnd() * w * 0.5;
      const f = x / (w * 0.55);
      const y = horizon - rnd() * (1 - f) * 100 * u;
      glow(ctx, x, y, (6 + rnd() * 8) * u, '#ffc27a', 0.7);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Lighthouse.
    const lhX = headX + (w - headX) * 0.5;
    const lhBase = horizon - 85 * u;
    ctx.fillStyle = '#3a3346';
    ctx.beginPath();
    ctx.moveTo(lhX - 12 * u, lhBase);
    ctx.lineTo(lhX - 8 * u, lhBase - 110 * u);
    ctx.lineTo(lhX + 8 * u, lhBase - 110 * u);
    ctx.lineTo(lhX + 12 * u, lhBase);
    ctx.fill();
    ctx.fillStyle = '#1c1826';
    ctx.fillRect(lhX - 11 * u, lhBase - 128 * u, 22 * u, 18 * u);

    // Sea.
    ctx.fillStyle = vGradient(ctx, horizon, h, [[0, '#6a4a5c'], [0.25, '#2c2640'], [1, '#07080f']]);
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.globalCompositeOperation = 'lighter';
    reflection(ctx, w * 0.36, horizon, h * 0.95, 140 * u, '#ff9a6a', 0.14, rnd);
    for (let i = 0; i < 260; i++) {
      const y = horizon + Math.pow(rnd(), 1.6) * (h - horizon);
      const d = (y - horizon) / (h - horizon);
      ctx.fillStyle = rgba('#ffb9a0', (0.05 + rnd() * 0.08) * (1 - d));
      ctx.fillRect(rnd() * w, y, (30 + rnd() * 140) * u * (0.4 + d), (1 + d * 3) * u);
    }
    for (let i = 0; i < 16; i++) {
      reflection(ctx, rnd() * w * 0.5, horizon + 4 * u, horizon + (60 + rnd() * 60) * u, 6 * u, '#ffc27a', 0.25, rnd);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Pier in the foreground.
    const pierY = h * 0.84;
    ctx.fillStyle = '#0b0a10';
    ctx.beginPath();
    ctx.moveTo(0, pierY);
    ctx.lineTo(w * 0.62, pierY + 20 * u);
    ctx.lineTo(w * 0.62, pierY + 36 * u);
    ctx.lineTo(0, pierY + 48 * u);
    ctx.fill();
    for (let x = 20 * u; x < w * 0.62; x += 70 * u) {
      const f = x / (w * 0.62);
      ctx.fillRect(x, pierY + 20 * u * f, 8 * u, h - pierY);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = w * (0.08 + i * 0.2);
      const f = x / (w * 0.62);
      const top = pierY + 20 * u * f - 190 * u;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#08070c';
      ctx.fillRect(x - 3 * u, top, 6 * u, 190 * u);
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, top, 50 * u, '#ffc27a', 0.95);
      glow(ctx, x, top, 200 * u, '#ffa060', 0.2);
      reflection(ctx, x, pierY + 50 * u, h, 20 * u, '#ffb070', 0.35, rnd);
    }
    ctx.globalCompositeOperation = 'source-over';
    return { lighthouse: [lhX / w, (lhBase - 119 * u) / h] };
  }

  function harborLights(meta) {
    const boats = [];
    for (let i = 0; i < 4; i++) {
      boats.push({
        x: 0.1 + Math.random() * 0.8,
        y: 0.64 + Math.random() * 0.1,
        drift: (Math.random() - 0.5) * 0.004,
        ph: Math.random() * 6.28,
        side: Math.random() < 0.5 ? [1, 0.12, 0.1] : [0.2, 1, 0.45]
      });
    }
    const lh = meta.lighthouse || [0.86, 0.43];
    return {
      count: boats.length * 2 + 1,
      update: function (t, aspect, pos, col) {
        let k = 0;
        function put(x, y, size, gain, c) {
          pos[k * 4] = x; pos[k * 4 + 1] = y; pos[k * 4 + 2] = size; pos[k * 4 + 3] = gain;
          col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
          k++;
        }
        boats.forEach(function (b) {
          let x = (b.x + t * b.drift) % 1.2;
          if (x < -0.1) x += 1.2;
          const scale = (b.y - 0.6) * 6;
          const bob = Math.sin(t * 0.9 + b.ph) * 0.0025;
          put(x, b.y - 0.035 * scale + bob, 0.012 + 0.006 * scale, 0.7, [1, 0.93, 0.78]);
          put(x + 0.01 * scale, b.y + bob * 1.2, 0.01 + 0.005 * scale, 0.75, b.side);
        });
        // Rotating lighthouse beam: a bright pulse every ~7 seconds.
        const phase = (t / 7) % 1;
        const beam = Math.pow(Math.max(0, Math.cos(phase * Math.PI * 2)), 18);
        put(lh[0], lh[1], 0.018 + beam * 0.04, 0.15 + beam * 1.4, [1, 0.95, 0.82]);
      }
    };
  }

  const SCENES = {
    city: { name: 'City at night', paint: paintCity, lights: cityLights },
    forest: { name: 'Misty forest', paint: paintForest, lights: function () { return { count: 0, update: function () {} }; } },
    harbor: { name: 'Harbor at dusk', paint: paintHarbor, lights: harborLights }
  };

  global.Scenes = {
    list: Object.keys(SCENES).map(function (id) { return { id: id, name: SCENES[id].name }; }),
    /**
     * Paints scene `id` into `canvas` at the given pixel size.
     * Returns { canvas, lights } where lights is an animated light set.
     */
    create: function (id, canvas, w, h) {
      const scene = SCENES[id] || SCENES.city;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const rnd = mulberry32(id.length * 7919 + 1234);
      const meta = scene.paint(ctx, w, h, rnd) || {};
      return { canvas: canvas, lights: scene.lights(meta) };
    }
  };
})(window);
