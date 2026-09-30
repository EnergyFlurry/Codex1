/*
 * Water-on-glass simulation.
 *
 * The glass is represented by a height map drawn into a 2D canvas: every drop
 * is a spherical-cap "sprite" whose alpha encodes the water height, and drops
 * are blended additively so neighbouring water merges like real surface
 * tension. The WebGL renderer turns that height map into normals and refracts
 * the scene through it.
 *
 * Three layers of water live on the glass:
 *   - condensation: countless tiny droplets painted into a persistent canvas
 *     that slowly evaporates and is wiped clean wherever a drop runs through;
 *   - drops: individual rain drops that land, sit, merge with neighbours and,
 *     once heavy enough, slide down in a stick-slip motion leaving a trail of
 *     beads behind them;
 *   - fog: a lower-resolution misting of the glass. Running water wipes a
 *     clear channel through it, and the mist slowly creeps back.
 */
(function (global) {
  'use strict';

  const CONTACT_ANGLE = 70 * Math.PI / 180;   // how "tall" a drop sits on the glass
  const SIN = Math.sin(CONTACT_ANGLE), COS = Math.cos(CONTACT_ANGLE);
  const CAP = (1 - COS) / SIN;                 // centre height / base radius
  const RREF = 30;                              // CSS px radius whose cap height maps to alpha 1
  const FOG_DIV = 4;                            // fog map is 1/4 of the water map
  const TAILS = [0.35, 0.8, 1.3, 1.9, 2.6];     // teardrop tail lengths, in body radii

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeSprite(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    const c0 = 1 / SIN;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half;
        const d2 = dx * dx + dy * dy;
        let hgt = 0;
        if (d2 < 1) {
          // Height of a spherical cap, normalised to 1 at the centre.
          hgt = (Math.sqrt(c0 * c0 - d2) - COS / SIN) / CAP;
        }
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.max(0, Math.min(255, Math.round(hgt * 255)));
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // A running drop: a round, heavy front with a tapering tail dragged behind
  // it. Body radius is 1 unit; the sprite spans x in [-1, 1] and y in
  // [-tail, 1], with the body centred at y = 0.
  function makeTeardrop(tail) {
    const res = 32;
    const c = document.createElement('canvas');
    c.width = res * 2;
    c.height = Math.round(res * (1 + tail));
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    const c0 = 1 / SIN;
    for (let py = 0; py < c.height; py++) {
      const y = (py + 0.5) / res - tail;
      for (let px = 0; px < c.width; px++) {
        const x = (px + 0.5) / res - 1;
        let d2, scale = 1;
        if (y >= 0) {
          d2 = x * x + y * y;
        } else {
          const w = Math.sin((1 + y / tail) * Math.PI / 2);
          d2 = w > 0.001 ? (x / w) * (x / w) : 2;
          scale = Math.pow(w, 0.8);
        }
        let hgt = 0;
        if (d2 < 1) hgt = ((Math.sqrt(c0 * c0 - d2) - COS / SIN) / CAP) * scale;
        const i = (py * c.width + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.max(0, Math.min(255, Math.round(hgt * 255)));
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function RainSim() {
    this.drops = [];
    this.sprite = makeSprite(128);
    this.smallSprite = makeSprite(32);
    this.teardrops = TAILS.map(makeTeardrop);
    this.water = document.createElement('canvas');
    this.mist = document.createElement('canvas');
    this.fog = document.createElement('canvas');
    this.wctx = this.water.getContext('2d');
    this.mctx = this.mist.getContext('2d');
    this.fctx = this.fog.getContext('2d');
    this.rainAcc = 0;
    this.mistAcc = 0;
    this.evapTimer = 0;
    this.fogTimer = 0;
    this.onImpact = null;
  }

  RainSim.prototype.resize = function (cssW, cssH, scale, settings) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.k = scale;
    const W = Math.max(64, Math.round(cssW * scale));
    const H = Math.max(64, Math.round(cssH * scale));
    this.W = W; this.H = H;
    this.water.width = this.mist.width = W;
    this.water.height = this.mist.height = H;
    this.fog.width = Math.ceil(W / FOG_DIV);
    this.fog.height = Math.ceil(H / FOG_DIV);
    this.fctx.fillStyle = '#fff';
    this.fctx.fillRect(0, 0, this.fog.width, this.fog.height);
    this.drops = [];
    this.warmUp(settings);
  };

  // Pre-soak the window so it already looks wet on the first frame.
  RainSim.prototype.warmUp = function (s) {
    const area = this.area();
    this.mctx.globalCompositeOperation = 'lighter';
    const mistCount = Math.round(2600 * area * (0.2 + s.condensation));
    for (let i = 0; i < mistCount; i++) this.addMist(Math.random() * this.W, Math.random() * this.H, s);
    this.mctx.globalAlpha = 1;
    const n = Math.round(420 * area * (0.25 + s.intensity));
    for (let i = 0; i < n; i++) this.spawnDrop(s, Math.random() * this.W, Math.random() * this.H, true);
    const impact = this.onImpact;
    this.onImpact = null;
    for (let i = 0; i < 420; i++) this.update(16.7, s);
    this.onImpact = impact;
  };

  RainSim.prototype.area = function () {
    return (this.cssW * this.cssH) / (1920 * 1080);
  };

  RainSim.prototype.sizeK = function (s) { return this.k * s.dropSize; };
  RainSim.prototype.rrefPx = function (s) { return RREF * this.sizeK(s); };

  RainSim.prototype.alphaFor = function (r, s) {
    return Math.min(1, (r / this.rrefPx(s)) * CAP);
  };

  RainSim.prototype.addMist = function (x, y, s, r) {
    const k = this.sizeK(s);
    r = r || (0.9 + Math.pow(Math.random(), 2.2) * 2.6) * k;
    const c = this.mctx;
    c.globalAlpha = this.alphaFor(r, s);
    const sx = r * rand(0.85, 1.15), sy = r * rand(0.85, 1.15);
    c.drawImage(r < 6 ? this.smallSprite : this.sprite, x - sx, y - sy, sx * 2, sy * 2);
  };

  RainSim.prototype.spawnDrop = function (s, x, y, quiet) {
    const k = this.sizeK(s);
    const r = (2.2 + Math.pow(Math.random(), 2.2) * 12) * k;
    const d = {
      x: x, y: y, r: r,
      vx: 0, vy: 0, drift: 0,
      moving: false,
      thr: rand(8, 11.5) * k,
      sx: rand(0.88, 1.12), sy: rand(0.88, 1.12),
      trail: 0,
      born: performance.now(),
      dead: false
    };
    this.drops.push(d);
    if (!quiet) {
      // The impact throws off a spray of micro droplets.
      if (r > 4 * k) {
        const n = 3 + (Math.random() * 8) | 0;
        this.mctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, dist = r * rand(1.2, 3.5);
          this.addMist(x + Math.cos(a) * dist, y + Math.sin(a) * dist, s, rand(0.6, 1.6) * k);
        }
      }
      if (this.onImpact) this.onImpact(r / k, x / this.W);
    }
    return d;
  };

  RainSim.prototype.update = function (dtMs, s) {
    const dt = Math.min(dtMs, 50) / 16.667;
    const k = this.sizeK(s);
    const area = this.area();
    const mc = this.mctx;

    // --- New rain landing on the glass -------------------------------
    this.rainAcc += Math.pow(s.intensity, 1.4) * 4.2 * area * dt;
    while (this.rainAcc >= 1) {
      this.rainAcc -= 1;
      this.spawnDrop(s, Math.random() * this.W, Math.random() * this.H * 1.05 - this.H * 0.05);
    }

    // --- Condensation / fine spray -----------------------------------
    mc.globalCompositeOperation = 'lighter';
    this.mistAcc += s.condensation * (0.25 + s.intensity) * 16 * area * dt;
    while (this.mistAcc >= 1) {
      this.mistAcc -= 1;
      this.addMist(Math.random() * this.W, Math.random() * this.H, s);
    }
    mc.globalAlpha = 1;

    // Evaporation: fade the condensation layer a little every second.
    this.evapTimer += dtMs;
    if (this.evapTimer > 1000) {
      this.evapTimer = 0;
      mc.globalCompositeOperation = 'destination-out';
      mc.fillStyle = 'rgba(0,0,0,' + (0.05 + (1 - s.condensation) * 0.12) + ')';
      mc.fillRect(0, 0, this.W, this.H);
    }

    // Fog slowly creeps back over cleared glass.
    this.fogTimer += dtMs;
    if (this.fogTimer > 400) {
      this.fogTimer = 0;
      this.fctx.globalCompositeOperation = 'source-over';
      this.fctx.fillStyle = 'rgba(255,255,255,0.024)';
      this.fctx.fillRect(0, 0, this.fog.width, this.fog.height);
    }

    // --- Drop dynamics --------------------------------------------------
    const drops = this.drops;
    const fc = this.fctx;
    mc.globalCompositeOperation = 'destination-out';
    mc.strokeStyle = '#000';
    mc.lineCap = 'round';
    fc.globalCompositeOperation = 'destination-out';
    fc.strokeStyle = 'rgba(0,0,0,0.92)';
    fc.lineCap = 'round';
    const trailSpawn = [];

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (d.dead) continue;

      if (!d.moving) {
        // Tiny amount of evaporation on still water.
        d.r -= 0.0006 * k * dt;
        if (d.r < 0.5 * k) { d.dead = true; continue; }
        if (d.r > d.thr) {
          d.moving = true;
          d.vy = 0.2 * this.k;
          d.drift = rand(-0.25, 0.25);
        } else continue;
      }

      const massF = d.r / d.thr;
      // Stick-slip: drops hesitate on dry glass, then lurch forward.
      if (Math.random() < 0.03 * dt / Math.max(0.6, massF)) d.vy *= 0.12;
      d.vy += 0.1 * this.k * Math.min(2.5, massF) * dt;
      const vmax = (1.2 + Math.min(2.5, massF) * 3.2) * this.k;
      if (d.vy > vmax) d.vy = vmax;
      d.drift += (Math.random() - 0.5) * 0.12 * dt;
      d.drift *= 0.97;
      const px = d.x, py = d.y;
      d.x += d.drift * d.vy * 0.35 * dt;
      d.y += d.vy * dt;

      // Clear the condensation and fog along the path.
      mc.lineWidth = d.r * 2 * d.sx;
      mc.beginPath(); mc.moveTo(px, py); mc.lineTo(d.x, d.y); mc.stroke();
      fc.lineWidth = (d.r * 2.3) / FOG_DIV;
      fc.beginPath(); fc.moveTo(px / FOG_DIV, py / FOG_DIV); fc.lineTo(d.x / FOG_DIV, d.y / FOG_DIV); fc.stroke();

      // Leave little beads of water behind.
      d.trail += Math.hypot(d.x - px, d.y - py);
      if (d.trail > d.r * rand(0.7, 1.9)) {
        d.trail = 0;
        const tr = d.r * rand(0.16, 0.34);
        if (tr > 0.6 * k) {
          const tail = TAILS[this.tailIndex(d)];
          trailSpawn.push({ x: d.x + (Math.random() - 0.5) * d.r * 0.4, y: d.y - d.r * (tail + rand(0.5, 0.9)), r: tr });
          d.r = Math.cbrt(Math.max(0, d.r * d.r * d.r - tr * tr * tr));
        }
      }
      if (d.r < d.thr * 0.45) { d.moving = false; d.vy = 0; d.thr *= 1.08; }
      if (d.y - d.r * 2 > this.H) d.dead = true;
    }
    mc.globalCompositeOperation = 'source-over';
    fc.globalCompositeOperation = 'source-over';

    for (let i = 0; i < trailSpawn.length; i++) {
      const t = trailSpawn[i];
      drops.push({
        x: t.x, y: t.y, r: t.r, vx: 0, vy: 0, drift: 0, moving: false,
        thr: rand(8, 11.5) * k, sx: rand(0.85, 1.1), sy: rand(0.9, 1.25),
        trail: 0, born: performance.now(), dead: false
      });
    }

    this.collide(k);

    // Compact the array and keep the total count bounded.
    const maxDrops = Math.max(400, Math.min(3000, Math.round(1500 * area)));
    let alive = drops.filter(function (d) { return !d.dead; });
    if (alive.length > maxDrops) {
      let excess = alive.length - maxDrops;
      for (let i = 0; i < alive.length && excess > 0; i++) {
        if (!alive[i].moving) { alive[i].dead = true; excess--; }
      }
      alive = alive.filter(function (d) { return !d.dead; });
    }
    this.drops = alive;
  };

  // Merge touching drops using a uniform spatial grid.
  RainSim.prototype.collide = function (k) {
    const drops = this.drops;
    const cell = 26 * k;
    const cols = Math.ceil(this.W / cell) + 1;
    const grid = new Map();
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (d.dead) continue;
      const key = Math.floor(d.y / cell) * cols + Math.floor(d.x / cell);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(d);
    }
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.dead) continue;
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = grid.get((cy + oy) * cols + cx + ox);
          if (!bucket) continue;
          for (let j = 0; j < bucket.length; j++) {
            const b = bucket[j];
            if (b === a || b.dead || a.dead) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            // Water joins as soon as the edges touch.
            const reach = (a.r + b.r) * 0.95;
            if (dx * dx + dy * dy > reach * reach) continue;
            // The moving (or larger) drop swallows the other one.
            let big = a, small = b;
            if (b.moving && !a.moving) { big = b; small = a; }
            else if (a.moving === b.moving && b.r > a.r) { big = b; small = a; }
            // A running drop doesn't reach back for beads in its own tail.
            if (big.moving && !small.moving && small.y < big.y - big.r * 0.4) continue;
            const v1 = big.r * big.r * big.r, v2 = small.r * small.r * small.r;
            if (!big.moving) {
              big.x = (big.x * v1 + small.x * v2) / (v1 + v2);
              big.y = (big.y * v1 + small.y * v2) / (v1 + v2);
            } else {
              big.x += (small.x - big.x) * 0.15;
              big.vy *= 1.04;
            }
            big.r = Math.cbrt(v1 + v2);
            small.dead = true;
          }
        }
      }
    }
  };

  RainSim.prototype.tailIndex = function (d) {
    const f = d.vy / (5 * this.k) + (d.r / d.thr - 1) * 0.6;
    return Math.max(0, Math.min(TAILS.length - 1, Math.floor(f * TAILS.length)));
  };

  // Wipe the glass with a finger / cursor between two points (CSS px).
  RainSim.prototype.wipe = function (x0, y0, x1, y1, radiusCss) {
    const k = this.k;
    const ax = x0 * k, ay = y0 * k, bx = x1 * k, by = y1 * k;
    const r = radiusCss * k;
    const mc = this.mctx, fc = this.fctx;
    mc.globalCompositeOperation = 'destination-out';
    mc.lineCap = 'round';
    mc.lineWidth = r * 2;
    mc.strokeStyle = '#000';
    mc.beginPath(); mc.moveTo(ax, ay); mc.lineTo(bx, by); mc.stroke();
    mc.globalCompositeOperation = 'source-over';
    fc.globalCompositeOperation = 'destination-out';
    fc.lineCap = 'round';
    fc.lineWidth = (r * 2.4) / FOG_DIV;
    fc.strokeStyle = '#000';
    fc.beginPath(); fc.moveTo(ax / FOG_DIV, ay / FOG_DIV); fc.lineTo(bx / FOG_DIV, by / FOG_DIV); fc.stroke();
    fc.globalCompositeOperation = 'source-over';
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      let t = ((d.x - ax) * vx + (d.y - ay) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + vx * t - d.x, qy = ay + vy * t - d.y;
      const rr = r + d.r * 0.5;
      if (qx * qx + qy * qy < rr * rr) d.dead = true;
    }
    // A wiped streak leaves a little water pushed to its lower edge.
    if (Math.random() < 0.5) {
      const s = this.lastSettings;
      if (s) {
        const d = this.spawnDrop(s, bx + rand(-r, r), by + r * rand(0.9, 1.15), true);
        d.r *= 0.6;
      }
    }
  };

  // Render the height map for this frame.
  RainSim.prototype.draw = function (s) {
    this.lastSettings = s;
    const c = this.wctx;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.mist, 0, 0);
    c.globalCompositeOperation = 'lighter';
    const drops = this.drops;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const rx = d.r * d.sx, ry = d.r * d.sy;
      const sprite = d.r < 6 ? this.smallSprite : this.sprite;
      c.globalAlpha = this.alphaFor(d.r, s);
      if (d.moving) {
        // One continuous teardrop whose tail grows with speed.
        const ti = this.tailIndex(d);
        const tail = TAILS[ti];
        const bw = d.r * (1 - ti * 0.02);
        c.drawImage(this.teardrops[ti], d.x - bw, d.y - bw * tail, bw * 2, bw * (1 + tail));
      } else {
        c.drawImage(sprite, d.x - rx, d.y - ry, rx * 2, ry * 2);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  };

  RainSim.RREF = RREF;
  RainSim.FOG_DIV = FOG_DIV;
  global.RainSim = RainSim;
})(window);
