/* ===== glcore.js — WebGL2 の土台（行列・シェーダ・バッファ） ==================
 * 世界座標はゲームと同じ (x, y) = 地面、z = 上。1単位 = 1セル ≒ 1.85m。
 * 画面の右 = (-sin a, cos a) というゲーム側の約束に合わせてあるため、
 * 座標系は左手系になる。面の裏表は使わない（カリング無し・法線は明示）。
 * ========================================================================= */
(function (g) {
  'use strict';

  /* ---------------- 行列（列優先 Float32Array(16)） ---------------- */
  const M4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    mul(out, a, b) {
      const r = out === a || out === b ? new Float32Array(16) : out;
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
        r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
      }
      if (r !== out) out.set(r);
      return out;
    },
    /**
     * 視点行列。カメラの基底（右・上・前）と位置から作る。
     * ビュー空間: x=右 y=上 z=後ろ（GLの慣習）
     */
    view(out, pos, r, u, f) {
      out[0] = r[0]; out[4] = r[1]; out[8] = r[2];
      out[1] = u[0]; out[5] = u[1]; out[9] = u[2];
      out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2];
      out[3] = 0; out[7] = 0; out[11] = 0;
      out[12] = -(r[0] * pos[0] + r[1] * pos[1] + r[2] * pos[2]);
      out[13] = -(u[0] * pos[0] + u[1] * pos[1] + u[2] * pos[2]);
      out[14] = (f[0] * pos[0] + f[1] * pos[1] + f[2] * pos[2]);
      out[15] = 1;
      return out;
    },
    /** 透視投影。fx, fy は NDC 上の焦点距離（= 2*焦点px / 画面px） */
    persp(out, fx, fy, near, far) {
      out.fill(0);
      out[0] = fx; out[5] = fy;
      out[10] = -(far + near) / (far - near);
      out[11] = -1;
      out[14] = -2 * far * near / (far - near);
      return out;
    },
    ortho(out, l, r, b, t, n, f) {
      out.fill(0);
      out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
      out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1;
      return out;
    },
    /** 平行移動 + Z軸回転 + 一様拡大 */
    trs(out, x, y, z, ang, s, sy, sz) {
      const c = Math.cos(ang), sn = Math.sin(ang);
      const kx = s, ky = sy == null ? s : sy, kz = sz == null ? s : sz;
      out.fill(0);
      out[0] = c * kx; out[1] = sn * kx;
      out[4] = -sn * ky; out[5] = c * ky;
      out[10] = kz;
      out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
      return out;
    }
  };

  /* ---------------- 色 ---------------- */
  const _lin = {};
  /** "#rrggbb"(sRGB) → 線形RGB [0..1] */
  function lin(hex) {
    let v = _lin[hex];
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    v = _lin[hex] = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
    return v;
  }

  /* ---------------- シェーダの共通部 ---------------- */
  const COMMON = `
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_skyCol;
uniform vec3 u_gndCol;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_fogCol;
uniform float u_fogDen;
uniform vec3 u_camPos;
uniform float u_exposure;
uniform sampler2DShadow u_shadow;
uniform mat4 u_shadowMat;
uniform float u_shadowOn;
uniform float u_shadowTexel;
uniform vec4 u_flash;      // xyz = 位置, w = 強さ（発砲光）
float shadowAt(vec3 wp, vec3 n) {
  if (u_shadowOn < 0.5) return 1.0;
  vec4 sp = u_shadowMat * vec4(wp + n * 0.035, 1.0);
  vec3 s = sp.xyz * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float z = s.z - 0.0012;
  float t = u_shadowTexel;
  float sum = texture(u_shadow, vec3(s.xy + vec2(-0.5, -0.5) * t, z));
  sum += texture(u_shadow, vec3(s.xy + vec2(0.5, -0.5) * t, z));
  sum += texture(u_shadow, vec3(s.xy + vec2(-0.5, 0.5) * t, z));
  sum += texture(u_shadow, vec3(s.xy + vec2(0.5, 0.5) * t, z));
  return sum * 0.25;
}
vec3 skyColor(vec3 d) {
  float h = d.z;
  vec3 c = mix(u_horizon, u_zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  float s = max(dot(d, u_sunDir), 0.0);
  c += u_sunCol * (pow(s, 900.0) * 6.0 + pow(s, 10.0) * 0.10 + pow(s, 3.0) * 0.04);
  if (h < 0.0) c = mix(c, u_horizon * 0.72, clamp(-h * 4.0, 0.0, 1.0));
  return c;
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = wp - u_camPos;
  float d = length(v);
  float hk = exp(-max(wp.z, 0.0) * 0.012);                 // 高い所ほど霞が薄い
  float f = 1.0 - exp(-d * u_fogDen * hk);
  float sa = pow(max(dot(v / max(d, 1e-4), u_sunDir), 0.0), 6.0);
  vec3 fc = mix(u_fogCol, u_fogCol * 0.6 + u_sunCol * 0.22, sa);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
vec3 tonemap(vec3 c) {
  c *= u_exposure;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 shade(vec3 alb, vec3 n, vec3 wp, float spec, float ao, float sh) {
  vec3 v = normalize(u_camPos - wp);
  float ndl = dot(n, u_sunDir);
  float wrap = max(ndl, 0.0);
  vec3 amb = mix(u_gndCol, u_skyCol, n.z * 0.5 + 0.5) * ao;
  vec3 h = normalize(v + u_sunDir);
  float sp = pow(max(dot(n, h), 0.0), 48.0) * spec * step(0.0, ndl);
  vec3 col = alb * (amb + u_sunCol * wrap * sh) + u_sunCol * sp * sh;
  // 逆光のふち（人物の輪郭を背景から浮かせる）
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
  col += u_skyCol * rim * ao;
  if (u_flash.w > 0.0) {
    vec3 lv = u_flash.xyz - wp;
    float ld = length(lv);
    float att = u_flash.w / (1.0 + ld * ld * 1.8);
    col += alb * vec3(1.0, 0.72, 0.38) * att * max(dot(n, lv / max(ld, 1e-4)), 0.0) * 3.0;
  }
  return col;
}
`;

  const SRC = {};

  /* --- 静的な世界（壁・屋根・木・岩・小物） --- */
  SRC.litVS = `#version 300 es
precision highp float;
in vec3 a_pos; in vec3 a_nrm; in vec2 a_uv; in float a_layer; in vec3 a_col;
uniform mat4 u_vp; uniform mat4 u_model;
uniform float u_time; uniform float u_wind;
out vec3 v_wp; out vec3 v_n; out vec2 v_uv; flat out float v_layer; out vec3 v_col;
void main() {
  vec4 wp = u_model * vec4(a_pos, 1.0);
  // 葉は風で少し揺らす（高い所ほど大きく）
  if (u_wind > 0.0 && (a_layer == 9.0 || a_layer == 10.0)) {
    float k = max(wp.z - 0.3, 0.0) * 0.018 * u_wind;
    wp.x += sin(u_time * 1.7 + wp.y * 0.6 + wp.x * 0.3) * k;
    wp.y += cos(u_time * 1.3 + wp.x * 0.5) * k;
  }
  v_wp = wp.xyz;
  v_n = mat3(u_model) * a_nrm;
  v_uv = a_uv; v_layer = a_layer; v_col = a_col;
  gl_Position = u_vp * wp;
}`;
  SRC.litFS = `#version 300 es
${COMMON}
uniform sampler2DArray u_tex;
uniform float u_cutout;
uniform float u_groundAO;
uniform float u_emit;
in vec3 v_wp; in vec3 v_n; in vec2 v_uv; flat in float v_layer; in vec3 v_col;
out vec4 o;
float dither4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void main() {
  vec4 t = texture(u_tex, vec3(v_uv, v_layer));
  if (u_cutout > 0.5 && t.a < 0.5) discard;
  // カメラのすぐ前の葉は透かす（三人称で木に寄ったときに画面が葉で埋まらないように）
  if (v_layer == 9.0 || v_layer == 10.0) {
    float cd = length(u_camPos - v_wp);
    if (cd < 1.6 && dither4(gl_FragCoord.xy) > smoothstep(0.5, 1.6, cd)) discard;
  }
  vec3 n = normalize(v_n);
  vec3 v = normalize(u_camPos - v_wp);
  if (dot(n, v) < 0.0) n = -n;
  vec3 alb = t.rgb * v_col;
  float spec = u_cutout > 0.5 ? 0.04 : t.a * 0.9;
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.55, v_wp.z)) * mix(1.0, 1.0, u_groundAO);
  float sh = shadowAt(v_wp, n);
  vec3 col;
  if (v_layer == 6.0 && t.a < 0.5) {
    // 窓ガラス: 空を映す＋少しだけ室内の暗さ
    vec3 r = reflect(-v, n);
    float fr = 0.18 + 0.82 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = mix(alb * 0.25, skyColor(normalize(r + vec3(0.0, 0.0, 0.05))) * 0.85, fr);
    col += u_sunCol * pow(max(dot(r, u_sunDir), 0.0), 200.0) * 2.0 * sh;
  } else {
    col = shade(alb, n, v_wp, spec, ao, sh);
  }
  col += alb * u_emit;
  o = vec4(tonemap(applyFog(col, v_wp)), u_cutout > 0.5 ? clamp((t.a - 0.5) * 3.0 + 0.5, 0.0, 1.0) : 1.0);
}`;

  /* --- 地面 --- */
  SRC.groundVS = `#version 300 es
precision highp float;
in vec3 a_pos; in vec3 a_nrm;
uniform mat4 u_vp;
out vec3 v_wp; out vec3 v_n;
void main() { v_wp = a_pos; v_n = a_nrm; gl_Position = u_vp * vec4(a_pos, 1.0); }`;
  SRC.groundFS = `#version 300 es
${COMMON}
uniform sampler2D u_ground;
uniform sampler2DArray u_tex;
uniform vec3 u_gOrg;     // x = 原点, y = 大きさ
in vec3 v_wp; in vec3 v_n;
out vec4 o;
void main() {
  vec2 guv = (v_wp.xy - u_gOrg.x) / u_gOrg.y;
  vec3 alb = texture(u_ground, guv).rgb;
  float dist = length(u_camPos - v_wp);
  float d1 = texture(u_tex, vec3(v_wp.xy * 0.85, 22.0)).r;
  float d2 = texture(u_tex, vec3(v_wp.xy * 0.19 + 0.37, 22.0)).r;
  float nearK = exp(-dist * 0.045);
  alb *= mix(1.0, 0.62 + d1 * 0.9, nearK) * (0.82 + d2 * 0.4);
  vec3 n = normalize(v_n);
  // 近景の細かい凹凸を法線にも少し入れる
  n = normalize(n + vec3(d1 - 0.5, d2 - 0.5, 0.0) * 0.35 * nearK);
  float sh = shadowAt(v_wp, n);
  vec3 col = shade(alb, n, v_wp, 0.05, 1.0, sh);
  o = vec4(tonemap(applyFog(col, v_wp)), 1.0);
}`;

  /* --- 水面 --- */
  SRC.waterVS = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_vp;
out vec3 v_wp;
void main() { v_wp = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`;
  SRC.waterFS = `#version 300 es
${COMMON}
uniform sampler2DArray u_tex;
uniform sampler2D u_shore;
uniform float u_time;
uniform float u_mapW;
in vec3 v_wp;
out vec4 o;
void main() {
  vec2 p = v_wp.xy;
  float t = u_time;
  float n1 = texture(u_tex, vec3(p * 0.11 + vec2(t * 0.012, t * 0.007), 22.0)).r;
  float n2 = texture(u_tex, vec3(p * 0.23 - vec2(t * 0.009, -t * 0.013), 22.0)).r;
  float n3 = texture(u_tex, vec3(p * 0.6 + vec2(t * 0.03, t * 0.02), 22.0)).r;
  vec3 n = normalize(vec3(
    sin(p.x * 0.9 + p.y * 0.4 + t * 1.2) * 0.03 + (n1 - n2) * 0.45 + (n3 - 0.5) * 0.22,
    cos(p.y * 0.8 - p.x * 0.3 + t * 1.0) * 0.03 + (n2 - n1 * 0.7) * 0.38 + (n3 - 0.5) * 0.18,
    1.0));
  vec2 suv = p / u_mapW;
  float depth = texture(u_shore, clamp(suv, 0.0, 1.0)).r;
  if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) depth = 1.0;
  vec3 v = normalize(u_camPos - v_wp);
  float dist = length(u_camPos - v_wp);
  vec3 shallow = vec3(0.06, 0.32, 0.30);
  vec3 deep = vec3(0.010, 0.060, 0.090);
  vec3 base = mix(shallow, deep, smoothstep(0.0, 0.5, depth));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = skyColor(reflect(-v, n));
  float sh = shadowAt(v_wp, vec3(0.0, 0.0, 1.0));
  vec3 col = base * (u_skyCol * 0.9 + u_sunCol * max(u_sunDir.z, 0.0) * 0.35 * sh);
  col = mix(col, refl, clamp(fres, 0.0, 1.0));
  vec3 rs = reflect(-u_sunDir, n);
  col += u_sunCol * pow(max(dot(rs, v), 0.0), 420.0) * 1.6 * sh * (0.4 + n3);
  // 波打ち際の泡
  float shore = 1.0 - smoothstep(0.0, 0.07, depth);
  float foam = smoothstep(0.45, 0.75, n3 + shore * 0.6 + sin(depth * 60.0 - t * 1.6) * 0.15) * shore;
  col = mix(col, vec3(0.9, 0.95, 0.95) * (u_skyCol + u_sunCol * 0.5), foam * 0.8);
  float a = mix(0.45, 0.94, smoothstep(0.0, 0.25, depth));
  a = max(a, clamp(fres, 0.0, 1.0));
  a = mix(a, 1.0, clamp(dist / 120.0, 0.0, 1.0));
  o = vec4(tonemap(applyFog(col, v_wp)), max(a, foam));
}`;

  /* --- 空（全画面三角形） --- */
  SRC.skyVS = `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  v_ndc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;
  SRC.skyFS = `#version 300 es
${COMMON}
uniform sampler2DArray u_tex;
uniform mat4 u_invVP;
uniform float u_time;
uniform float u_clouds;
in vec2 v_ndc;
out vec4 o;
void main() {
  vec4 a = u_invVP * vec4(v_ndc, -1.0, 1.0);
  vec4 b = u_invVP * vec4(v_ndc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  vec3 col = skyColor(d);
  if (u_clouds > 0.5 && d.z > 0.0) {
    // 空を平面に投影して雲を流す
    vec2 cp = d.xy / (d.z + 0.12) * 0.9 + vec2(u_time * 0.004, u_time * 0.002);
    float c = texture(u_tex, vec3(cp * 0.35, 22.0)).r * 0.6 + texture(u_tex, vec3(cp * 0.9 + 0.3, 22.0)).r * 0.4;
    float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.0, 0.18, d.z);
    float lit = 0.8 + 0.4 * pow(max(dot(d, u_sunDir), 0.0), 4.0);
    vec3 cc = mix(u_horizon * 1.05, vec3(1.0) * 1.35, lit * 0.5) * lit;
    col = mix(col, cc, cov * 0.85);
  }
  o = vec4(tonemap(col), 1.0);
}`;

  /* --- キャラクター（骨ごとの剛体スキニング） --- */
  SRC.charVS = `#version 300 es
precision highp float;
in vec3 a_pos; in vec3 a_nrm; in vec2 a_uv; in vec3 a_col; in float a_bone; in float a_layer;
uniform mat4 u_vp;
uniform mat4 u_bones[21];
out vec3 v_wp; out vec3 v_n; out vec2 v_uv; out vec3 v_col; flat out float v_layer;
void main() {
  mat4 B = u_bones[int(a_bone + 0.5)];
  vec4 wp = B * vec4(a_pos, 1.0);
  v_wp = wp.xyz;
  v_n = mat3(B) * a_nrm;
  v_uv = a_uv; v_col = a_col; v_layer = a_layer;
  gl_Position = u_vp * wp;
}`;
  SRC.charFS = `#version 300 es
${COMMON}
uniform sampler2DArray u_tex;
uniform vec4 u_tint;
uniform float u_alpha;
uniform float u_shadowK;
uniform float u_fill;
in vec3 v_wp; in vec3 v_n; in vec2 v_uv; in vec3 v_col; flat in float v_layer;
out vec4 o;
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void main() {
  if (u_alpha < 0.999 && bayer(gl_FragCoord.xy) > u_alpha) discard;
  vec4 t = texture(u_tex, vec3(v_uv, v_layer));
  vec3 n = normalize(v_n);
  vec3 v = normalize(u_camPos - v_wp);
  if (dot(n, v) < 0.0) n = -n;
  vec3 alb = t.rgb * v_col;
  float sh = mix(1.0, shadowAt(v_wp, n), u_shadowK);
  vec3 col = shade(alb, n, v_wp, t.a * 0.8, 1.0, sh);
  // 一人称の銃は手元なので、視線側からの補助光で形を見せる
  col += alb * u_fill * (0.35 + 0.65 * max(dot(n, v), 0.0));
  col = mix(col, u_tint.rgb, u_tint.a);
  o = vec4(tonemap(applyFog(col, v_wp)), 1.0);
}`;

  /* --- 草（カメラの周りをぐるぐる使い回す） --- */
  SRC.grassVS = `#version 300 es
precision highp float;
in vec3 a_pos; in vec2 a_base; in float a_rnd; in vec2 a_uv;
uniform mat4 u_vp;
uniform vec2 u_cam;
uniform float u_patch;
uniform sampler2D u_mask;
uniform vec3 u_gOrg;
uniform float u_time;
out vec3 v_wp; out vec2 v_uv; out float v_k;
void main() {
  vec2 base = u_cam + mod(a_base - u_cam, u_patch) - u_patch * 0.5;
  float m = textureLod(u_mask, (base - u_gOrg.x) / u_gOrg.y, 0.0).r;
  float d = distance(base, u_cam);
  float s = smoothstep(0.25, 0.6, m) * smoothstep(u_patch * 0.5, u_patch * 0.3, d) * (0.65 + a_rnd * 0.7);
  float a = a_rnd * 6.2831;
  vec2 lp = mat2(cos(a), sin(a), -sin(a), cos(a)) * a_pos.xy * s;
  float sway = sin(u_time * 2.1 + base.x * 0.7 + base.y * 0.4) * 0.06 * a_uv.y * s;
  vec3 wp = vec3(base + lp + vec2(sway, sway * 0.5), a_pos.z * s);
  v_wp = wp; v_uv = a_uv; v_k = a_rnd;
  gl_Position = u_vp * vec4(wp, 1.0);
}`;
  SRC.grassFS = `#version 300 es
${COMMON}
uniform sampler2DArray u_tex;
uniform sampler2D u_ground;
uniform vec3 u_gOrg;
in vec3 v_wp; in vec2 v_uv; in float v_k;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, vec3(v_uv, 12.0));
  if (t.a < 0.3) discard;
  vec3 gcol = texture(u_ground, (v_wp.xy - u_gOrg.x) / u_gOrg.y).rgb;
  vec3 alb = mix(gcol * 1.15, t.rgb, 0.45) * (0.75 + v_uv.y * 0.5);
  float sh = shadowAt(v_wp, vec3(0.0, 0.0, 1.0));
  vec3 col = shade(alb, vec3(0.0, 0.0, 1.0), v_wp, 0.0, 0.85 + v_uv.y * 0.15, sh);
  o = vec4(tonemap(applyFog(col, v_wp)), clamp((t.a - 0.3) * 2.5, 0.0, 1.0));
}`;

  /* --- エフェクト（ビルボード。加算/半透明の両用） --- */
  SRC.fxVS = `#version 300 es
precision highp float;
in vec3 a_pos; in vec2 a_uv; in vec4 a_col; in float a_shape;
uniform mat4 u_vp;
out vec2 v_uv; out vec4 v_col; flat out float v_shape; out vec3 v_wp;
void main() { v_uv = a_uv; v_col = a_col; v_shape = a_shape; v_wp = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`;
  SRC.fxFS = `#version 300 es
${COMMON}
in vec2 v_uv; in vec4 v_col; flat in float v_shape; in vec3 v_wp;
uniform float u_add;
out vec4 o;
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float a;
  if (v_shape < 0.5) {            // やわらかい丸
    a = smoothstep(1.0, 0.0, length(p));
    a *= a;
  } else if (v_shape < 1.5) {     // 光の筋（トレーサー）
    a = smoothstep(1.0, 0.0, abs(p.y)) * smoothstep(1.0, 0.7, abs(p.x));
  } else if (v_shape < 2.5) {     // 輪
    float r = length(p);
    a = smoothstep(0.12, 0.0, abs(r - 0.82)) + smoothstep(0.9, 0.0, r) * 0.18;
  } else if (v_shape < 3.5) {     // マズルフラッシュ（星形）
    float r = length(p);
    float ang = atan(p.y, p.x);
    float spikes = pow(abs(cos(ang * 3.0)), 12.0) * 0.8 + 0.25;
    a = smoothstep(spikes, 0.0, r) + smoothstep(0.35, 0.0, r);
  } else {                        // 四角（破片）
    a = step(max(abs(p.x), abs(p.y)), 0.8);
  }
  vec4 c = v_col;
  if (u_add > 0.5) {
    o = vec4(tonemap(c.rgb * a * c.a), 1.0);
  } else {
    vec3 col = applyFog(c.rgb, v_wp);
    o = vec4(tonemap(col), a * c.a);
  }
}`;

  /* --- 安全地帯の壁（青い幕） --- */
  SRC.zoneVS = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_vp;
uniform vec4 u_zone;      // cx, cy, r, h
out vec3 v_wp; out vec2 v_p;
void main() {
  vec3 wp = vec3(u_zone.x + a_pos.x * u_zone.z, u_zone.y + a_pos.y * u_zone.z, a_pos.z * u_zone.w - 1.0);
  v_wp = wp; v_p = vec2(atan(a_pos.y, a_pos.x) * u_zone.z, wp.z);
  gl_Position = u_vp * vec4(wp, 1.0);
}`;
  SRC.zoneFS = `#version 300 es
${COMMON}
uniform float u_time;
uniform float u_inside;
in vec3 v_wp; in vec2 v_p;
out vec4 o;
void main() {
  // 細かい六角形っぽい格子がゆっくり流れる、半透明の青い幕
  vec2 q = vec2(v_p.x * 1.6, v_p.y * 1.6 + u_time * 0.25);
  vec2 cell = abs(fract(q) - 0.5);
  float grid = smoothstep(0.44, 0.5, max(cell.x, cell.y)) * 0.22;
  float wave = sin(v_p.x * 0.35 + v_p.y * 0.5 - u_time * 1.2) * 0.5 + 0.5;
  float fade = 1.0 - smoothstep(2.0, 45.0, v_wp.z);
  float d = length(u_camPos - v_wp);
  float nearK = smoothstep(0.0, 5.0, d) * (1.0 - smoothstep(60.0, 140.0, d) * 0.6);
  float a = (0.10 + grid + wave * 0.06) * fade * nearK;
  vec3 c = vec3(0.16, 0.36, 1.0) * (1.3 + grid * 3.0);
  o = vec4(tonemap(c), clamp(a, 0.0, 0.85));
}`;

  /* --- 影（深度だけ） --- */
  SRC.depthVS = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_vp; uniform mat4 u_model;
void main() { gl_Position = u_vp * u_model * vec4(a_pos, 1.0); }`;
  SRC.depthCharVS = `#version 300 es
precision highp float;
in vec3 a_pos; in float a_bone;
uniform mat4 u_vp; uniform mat4 u_bones[21];
void main() { gl_Position = u_vp * u_bones[int(a_bone + 0.5)] * vec4(a_pos, 1.0); }`;
  SRC.depthFS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }`;

  /* ---------------- プログラム ---------------- */
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader: ' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 3000));
    }
    return s;
  }
  /**
   * プログラムを作り、属性の位置を名前で固定する（VAOを使い回せるように）。
   * @returns {{p, u: Object<string, WebGLUniformLocation>}}
   */
  const ATTRS = ['a_pos', 'a_nrm', 'a_uv', 'a_layer', 'a_col', 'a_bone', 'a_base', 'a_rnd', 'a_shape'];
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    ATTRS.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  /**
   * 頂点配列を作る。layout は [名前, 要素数] の並び。
   * @returns {{vao, vbo, count, stride, layout}}
   */
  function mesh(gl, data, layout, usage) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
    let stride = 0;
    layout.forEach(l => { stride += l[1]; });
    let off = 0;
    layout.forEach(l => {
      const loc = ATTRS.indexOf(l[0]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, l[1], gl.FLOAT, false, stride * 4, off * 4);
      off += l[1];
    });
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / stride, stride, layout, cap: data.length };
  }
  /** 動的メッシュの中身を差し替える（容量が足りなければ作り直す） */
  function update(gl, m, data, n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    if (n > m.cap) {
      m.cap = Math.max(n, m.cap * 2);
      gl.bufferData(gl.ARRAY_BUFFER, m.cap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n);
    m.count = n / m.stride;
  }

  /* ---------------- ジオメトリの組み立て ---------------- */
  /** 頂点を詰めていく可変長バッファ */
  function Builder(stride) {
    this.stride = stride;
    this.a = new Float32Array(stride * 4096);
    this.n = 0;
  }
  Builder.prototype.push = function (arr) {
    if (this.n + arr.length > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + arr.length));
      b.set(this.a.subarray(0, this.n)); this.a = b;
    }
    for (let i = 0; i < arr.length; i++) this.a[this.n++] = arr[i];
  };
  Builder.prototype.data = function () { return this.a.subarray(0, this.n); };

  g.GLC = { M4, lin, SRC, program, mesh, update, Builder, ATTRS };
})(window);
