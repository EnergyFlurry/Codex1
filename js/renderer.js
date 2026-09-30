/*
 * WebGL renderer: composites the out-of-focus scene behind the glass with the
 * water height map from the simulation. Each drop acts as a tiny lens that
 * shows a sharp, inverted and minified view of the world outside, with dark
 * rims, specular glints and fogged glass between the drops.
 */
(function (global) {
  'use strict';

  const MAX_LIGHTS = 16;

  const VERT = [
    'attribute vec2 aPos;',
    'uniform float uFlip;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = vec2(aPos.x * 0.5 + 0.5, uFlip > 0.5 ? 0.5 - aPos.y * 0.5 : aPos.y * 0.5 + 0.5);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  const BLUR_FRAG = [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUv) * 0.2270270270;',
    '  c += texture2D(uTex, vUv + uDir * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv - uDir * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv + uDir * 3.2307692308) * 0.0702702703;',
    '  c += texture2D(uTex, vUv - uDir * 3.2307692308) * 0.0702702703;',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');

  const MAIN_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uWater;',
    'uniform sampler2D uFog;',
    'uniform sampler2D uBg;',
    'uniform sampler2D uBgBlur;',
    'uniform vec2 uWaterTexel;',
    'uniform vec2 uBlurTexel;',
    'uniform float uAspect;',
    'uniform float uTime;',
    'uniform float uRefract;',
    'uniform float uHeightScale;',
    'uniform float uFogAmt;',
    'uniform float uLightning;',
    'uniform float uRain;',
    'uniform float uBrightness;',
    'uniform float uBokeh;',
    'uniform float uLightCount;',
    'uniform vec4 uLightPos[' + MAX_LIGHTS + '];',
    'uniform vec3 uLightCol[' + MAX_LIGHTS + '];',
    '',
    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    '',
    // Out-of-focus light sources: flat bokeh discs with a slightly brighter rim.
    'vec3 lightsBlur(vec2 uv) {',
    '  vec3 c = vec3(0.0);',
    '  for (int i = 0; i < ' + MAX_LIGHTS + '; i++) {',
    '    if (float(i) >= uLightCount) break;',
    '    vec4 L = uLightPos[i];',
    '    float d = length((uv - L.xy) * vec2(uAspect, 1.0));',
    '    float r = L.z * (0.35 + uBokeh);',
    '    float disc = smoothstep(r, r * 0.86, d);',
    '    float rim = smoothstep(r * 0.55, r * 0.95, d) * disc;',
    '    float halo = exp(-d * d / (r * r * 2.5)) * 0.18;',
    '    c += uLightCol[i] * L.w * (disc * 0.3 + rim * 0.14 + halo);',
    '  }',
    '  return c;',
    '}',
    '',
    // The same lights seen in focus through a drop.
    'vec3 lightsSharp(vec2 uv) {',
    '  vec3 c = vec3(0.0);',
    '  for (int i = 0; i < ' + MAX_LIGHTS + '; i++) {',
    '    if (float(i) >= uLightCount) break;',
    '    vec4 L = uLightPos[i];',
    '    float d = length((uv - L.xy) * vec2(uAspect, 1.0));',
    '    float s = L.z * 0.12;',
    '    c += uLightCol[i] * L.w * (exp(-d * d / (s * s)) * 1.4 + exp(-d * d / (s * s * 16.0)) * 0.25);',
    '  }',
    '  return c;',
    '}',
    '',
    // Rain falling outside, well behind the focal plane: soft slanted streaks.
    'float streaks(vec2 uv) {',
    '  vec2 p = vec2(uv.x * uAspect, uv.y);',
    '  p.x += p.y * 0.1;',
    '  float s = 0.0;',
    '  for (int i = 0; i < 3; i++) {',
    '    float fi = float(i);',
    '    float cols = 55.0 + fi * 45.0;',
    '    float cx = floor(p.x * cols);',
    '    float fx = fract(p.x * cols);',
    '    float rnd = hash12(vec2(cx, fi * 17.0));',
    '    float speed = 2.6 + rnd * 1.2 - fi * 0.5;',
    '    float yy = p.y * (2.2 + fi) - uTime * speed + rnd * 10.0;',
    '    float cell = floor(yy);',
    '    float fy = fract(yy);',
    '    float on = step(hash12(vec2(cx, cell + fi * 31.0)), uRain * 0.55);',
    '    float offs = 0.5 + (hash12(vec2(cell, cx)) - 0.5) * 0.6;',
    '    float w = 0.09 + fi * 0.05;',
    '    float line = smoothstep(w, 0.0, abs(fx - offs));',
    '    float len = smoothstep(0.0, 0.25, fy) * smoothstep(0.75, 0.35, fy);',
    '    s += on * line * len * (0.55 - fi * 0.15);',
    '  }',
    '  return s;',
    '}',
    '',
    'vec3 flash(vec2 uv) {',
    '  return uLightning * vec3(0.72, 0.78, 1.0) * (0.25 + 0.75 * smoothstep(0.9, 0.0, uv.y));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float h  = texture2D(uWater, uv).a;',
    '  float hl = texture2D(uWater, uv - vec2(uWaterTexel.x, 0.0)).a;',
    '  float hr = texture2D(uWater, uv + vec2(uWaterTexel.x, 0.0)).a;',
    '  float hu = texture2D(uWater, uv - vec2(0.0, uWaterTexel.y)).a;',
    '  float hd = texture2D(uWater, uv + vec2(0.0, uWaterTexel.y)).a;',
    '  vec2 slope = vec2(hr - hl, hd - hu) * 0.5 * uHeightScale;',
    '  vec3 n = normalize(vec3(-slope, 1.0));',
    '  float mask = smoothstep(3.5 / 255.0, 9.0 / 255.0, h);',
    '',
    // ---- Glass between the drops: blurred scene, rain, fog.
    '  vec3 bg = texture2D(uBgBlur, uv).rgb * 1.15;',
    '  bg += lightsBlur(uv);',
    '  float bgLum = dot(bg, vec3(0.299, 0.587, 0.114));',
    '  bg += streaks(uv) * uRain * (0.03 + bgLum * 0.45) * vec3(0.85, 0.9, 1.0);',
    '  bg += flash(uv) * 0.55;',
    // Fog map: 1 = fully misted, 0 = just wiped by running water.
    '  float fogMap = texture2D(uFog, uv).a;',
    '  float edge = smoothstep(0.15, 0.85, length((uv - 0.5) * vec2(1.0, 1.25)));',
    '  float grain = hash12(floor(uv / (uWaterTexel * 1.5)));',
    '  float fog = uFogAmt * fogMap * mix(0.8, 1.0, edge) * (0.9 + 0.2 * grain);',
    '  if (fog > 0.002) {',
    // Misted glass scatters light: a wide, milky blur of the scene.
    '    vec3 fb = vec3(0.0);',
    '    for (int i = 0; i < 8; i++) {',
    '      float a = float(i) * 0.785398 + 0.39;',
    '      fb += texture2D(uBgBlur, uv + vec2(cos(a), sin(a)) * uBlurTexel * 9.0).rgb;',
    '    }',
    '    fb = fb * 0.125 * 1.15 + lightsBlur(uv) * 0.6 + flash(uv) * 0.5;',
    '    float fl = dot(fb, vec3(0.299, 0.587, 0.114));',
    '    vec3 milk = fb * 0.55 + vec3(fl * 0.45) + vec3(0.085, 0.092, 0.105);',
    '    bg = mix(bg, milk, clamp(fog, 0.0, 1.0) * 0.94);',
    '  }',
    '',
    // ---- Inside a drop: a sharp, inverted view of the scene.
    '  vec2 off = n.xy * uRefract * vec2(0.24 / uAspect, 0.24);',
    '  vec2 ruv = clamp(uv - off, 0.0, 1.0);',
    '  vec3 dc = texture2D(uBg, ruv).rgb;',
    '  dc = mix(dc, texture2D(uBgBlur, ruv).rgb, 0.18);',
    '  dc += lightsSharp(ruv) + flash(ruv) * 0.8;',
    '  float rim = 1.0 - n.z;',
    '  float thick = smoothstep(0.008, 0.07, h);',
    '  dc *= 1.0 - smoothstep(0.22, 0.64, rim) * mix(0.35, 0.85, thick);',
    '  dc *= 1.22;',
    '  vec3 Ld = normalize(vec3(-0.35, -0.75, 0.6));',
    '  vec3 R = reflect(-Ld, n);',
    '  float spec = pow(max(R.z, 0.0), 28.0);',
    '  float sceneLum = dot(texture2D(uBgBlur, vec2(0.5, 0.25)).rgb, vec3(0.333));',
    '  dc += spec * (0.12 + sceneLum * 0.5 + uLightning * 1.2) * vec3(0.9, 0.95, 1.0);',
    '  dc += pow(rim, 3.0) * 0.08 * (0.3 + sceneLum) * vec3(0.8, 0.85, 1.0);',
    '',
    '  vec3 col = mix(bg, dc, mask);',
    '',
    // ---- Faint reflection of a warm room on the inside of the glass.
    '  col += vec3(1.0, 0.7, 0.42) * 0.028 * smoothstep(1.3, 0.0, length((uv - vec2(0.08, 1.1)) * vec2(uAspect * 0.55, 1.0)));',
    '  col *= uBrightness;',
    '  float vig = length((uv - 0.5) * vec2(uAspect * 0.62, 1.0));',
    '  col *= mix(1.0, 0.45, smoothstep(0.35, 1.05, vig));',
    '  col = col / (1.0 + max(col - 1.0, 0.0));',
    '  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5) * 0.018;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    this.gl = gl;
    this.ok = !!gl;
    if (!gl) return;
    this.main = program(gl, VERT, MAIN_FRAG);
    this.blur = program(gl, VERT, BLUR_FRAG);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.tex = {
      water: this.makeTex(), fog: this.makeTex(), bg: this.makeTex(), small: this.makeTex(),
      a: this.makeTex(), b: this.makeTex()
    };
    this.fbA = gl.createFramebuffer();
    this.fbB = gl.createFramebuffer();
    this.sizes = {};
    this.blurAmount = 0.6;
    this.lightPos = new Float32Array(MAX_LIGHTS * 4);
    this.lightCol = new Float32Array(MAX_LIGHTS * 3);
  }

  Renderer.MAX_LIGHTS = MAX_LIGHTS;

  Renderer.prototype.makeTex = function () {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return t;
  };

  // Upload a canvas, reusing storage when the size hasn't changed.
  Renderer.prototype.upload = function (name, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const s = this.sizes[name];
    if (s && s[0] === canvas.width && s[1] === canvas.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      this.sizes[name] = [canvas.width, canvas.height];
    }
  };

  Renderer.prototype.setBackground = function (bgCanvas) {
    this.upload('bg', bgCanvas);
    // Downsample to a quarter size in two halving steps for a clean blur base.
    let src = bgCanvas;
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width / 2));
      c.height = Math.max(1, Math.round(src.height / 2));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      src = c;
    }
    this.upload('small', src);
    this.smallW = src.width;
    this.smallH = src.height;
    const gl = this.gl;
    [['a', this.fbA], ['b', this.fbB]].forEach(function (pair) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[pair[0]]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pair[1]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex[pair[0]], 0);
    }, this);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.rebuildBlur();
  };

  Renderer.prototype.setBlur = function (amount) {
    this.blurAmount = amount;
    if (this.smallW) this.rebuildBlur();
  };

  // Separable Gaussian blur, ping-ponging between two framebuffers.
  Renderer.prototype.rebuildBlur = function () {
    const gl = this.gl;
    const b = this.blur;
    gl.useProgram(b.p);
    gl.uniform1i(b.u.uTex, 0);
    gl.uniform1f(b.u.uFlip, 0);
    gl.viewport(0, 0, this.smallW, this.smallH);
    gl.activeTexture(gl.TEXTURE0);
    const iterations = 1 + Math.round(this.blurAmount * 4);
    const spread = 0.5 + this.blurAmount * 1.1;
    const tx = spread / this.smallW, ty = spread / this.smallH;
    let src = this.tex.small;
    for (let i = 0; i < iterations; i++) {
      const grow = 1 + i * 0.25;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform2f(b.u.uDir, tx * grow, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.a);
      gl.uniform2f(b.u.uDir, 0, ty * grow);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      src = this.tex.b;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  Renderer.prototype.resize = function (w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  };

  /**
   * state: { water, fog, time, refract, heightScale, fogAmt, lightning,
   *          rain, brightness, lights: {count, pos, col} }
   */
  Renderer.prototype.render = function (st) {
    const gl = this.gl;
    this.upload('water', st.water);
    this.upload('fog', st.fog);

    const m = this.main;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(m.p);
    const units = [['uWater', 'water'], ['uFog', 'fog'], ['uBg', 'bg'], ['uBgBlur', 'b']];
    for (let i = 0; i < units.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[units[i][1]]);
      gl.uniform1i(m.u[units[i][0]], i);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(m.u.uFlip, 1);
    gl.uniform2f(m.u.uWaterTexel, 1 / st.water.width, 1 / st.water.height);
    gl.uniform2f(m.u.uBlurTexel, 1 / this.smallW, 1 / this.smallH);
    gl.uniform1f(m.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(m.u.uTime, st.time);
    gl.uniform1f(m.u.uRefract, st.refract);
    gl.uniform1f(m.u.uHeightScale, st.heightScale);
    gl.uniform1f(m.u.uFogAmt, st.fogAmt);
    gl.uniform1f(m.u.uLightning, st.lightning);
    gl.uniform1f(m.u.uRain, st.rain);
    gl.uniform1f(m.u.uBrightness, st.brightness);
    gl.uniform1f(m.u.uBokeh, this.blurAmount);
    const count = Math.min(MAX_LIGHTS, st.lights.count);
    gl.uniform1f(m.u.uLightCount, count);
    if (m.u.uLightPos) gl.uniform4fv(m.u.uLightPos, st.lights.pos);
    if (m.u.uLightCol) gl.uniform3fv(m.u.uLightCol, st.lights.col);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  global.Renderer = Renderer;
})(window);
