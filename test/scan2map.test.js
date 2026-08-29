/* =========================================================================
 * scan2map.test.js — 合成したLiDARスキャンから元の間取りを復元できるか検証する
 *
 * 既知のマップ（ゲーム本体のステージ）を 3D の点群に「スキャン」し直し、
 * ノイズ・欠損・傾き・任意の原点/座標系を加えたうえで scan2map に通して、
 * 元の間取りがどれだけ正確に戻ってくるかを測る。
 *   node test/scan2map.test.js
 * ======================================================================= */
const S = require('../tools/scan2map.js');

let pass = 0, fail = 0;
const log = [];
function ok(name, cond, info) {
  if (cond) { pass++; log.push('  \x1b[32m✓\x1b[0m ' + name + (info ? '  \x1b[90m' + info + '\x1b[0m' : '')); }
  else { fail++; log.push('  \x1b[31m✗ ' + name + '\x1b[0m' + (info ? '  ' + info : '')); }
}
function section(t) { log.push('\n\x1b[36m▌' + t + '\x1b[0m'); }

/* --- ゲーム本体のステージ定義を素の Node で読み込む --- */
global.window = global;
global.U = { clamp: (v, a, b) => v < a ? a : v > b ? b : v };
require('../js/data.js');
const DATA = global.DATA;

/* --- 既知の間取りを「LiDAR でスキャンした点群」に変換する --- */
function synthScan(rows, opt) {
  const o = Object.assign({
    wallStep: 0.07,      // 壁面のサンプル間隔 (m)
    floorStep: 0.14,
    height: 2.6,         // 天井高
    noise: 0.02,         // 測距ノイズ (m)
    dropout: 0.12,       // 欠損率（遮蔽・反射で取れない点）
    tilt: 2 * Math.PI / 180,
    origin: [13.7, -4.2, 5.9],
    upAxis: 1,           // 0=x 1=y 2=z
    seed: 20260829
  }, opt || {});
  let rnd = o.seed >>> 0;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => (rand() + rand() + rand() - 1.5) * 2;

  const h = rows.length, w = rows[0].length;
  const solid = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? true : '#=%*'.indexOf(rows[y][x]) >= 0;

  const pts = [];
  const push = (px, py, pz) => {
    if (rand() < o.dropout) return;
    // 測距ノイズ
    px += gauss() * o.noise; py += gauss() * o.noise; pz += gauss() * o.noise;
    // 微小な傾き（スキャン端末の姿勢誤差）
    const c = Math.cos(o.tilt), s = Math.sin(o.tilt);
    const ry = py * c - pz * s, rz = py * s + pz * c;
    py = ry; pz = rz;
    // 任意の原点へ移動し、指定の上方向軸へ入れ替える
    const v = [px + o.origin[0], py + o.origin[1], pz + o.origin[2]];
    if (o.upAxis === 1) pts.push(v[0], v[2], v[1]);        // z が高さ → y-up へ
    else if (o.upAxis === 0) pts.push(v[2], v[0], v[1]);
    else pts.push(v[0], v[1], v[2]);                        // z-up のまま
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) {
      // 空間に面している壁面だけをサンプリング（内部からのスキャンを再現）
      const faces = [
        { d: [1, 0], fx: x + 1, fy: null }, { d: [-1, 0], fx: x, fy: null },
        { d: [0, 1], fx: null, fy: y + 1 }, { d: [0, -1], fx: null, fy: y }
      ];
      faces.forEach(f => {
        if (!solid(x + f.d[0], y + f.d[1])) {
          for (let t = 0; t <= 1; t += o.wallStep) {
            for (let z = 0.02; z < o.height; z += o.wallStep) {
              if (f.fx != null) push(f.fx, y + t, z);
              else push(x + t, f.fy, z);
            }
          }
        }
      });
    } else {
      for (let a = 0; a < 1; a += o.floorStep) for (let b = 0; b < 1; b += o.floorStep) {
        push(x + a, y + b, 0.0);              // 床
        push(x + a, y + b, o.height);         // 天井
      }
    }
  }
  return { xyz: Float32Array.from(pts), count: pts.length / 3, faces: null };
}

/* --- 復元したグリッドと正解の一致度（平行移動を許した IoU） --- */
function bestIoU(rows, g) {
  const h = rows.length, w = rows[0].length;
  const truth = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 1 : ('#=%*'.indexOf(rows[y][x]) >= 0 ? 1 : 0);
  let best = 0, bestOff = null;
  for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
    let inter = 0, uni = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const a = g.grid[y * g.w + x];
      const b = truth(x + ox, y + oy);
      if (a && b) inter++;
      if (a || b) uni++;
    }
    const iou = uni ? inter / uni : 0;
    if (iou > best) { best = iou; bestOff = [ox, oy]; }
  }
  return { iou: best, off: bestOff };
}

const dump = g => {
  const out = [];
  for (let y = 0; y < g.h; y++) {
    let l = '';
    for (let x = 0; x < g.w; x++) l += g.grid[y * g.w + x] ? '#' : '.';
    out.push('    ' + l);
  }
  return out.join('\n');
};

/* =====================================================================
 *  実行
 * ===================================================================*/
const stage = DATA.STAGES[1];          // CARGO DEPOT (24x16) を正解とする

section('1. 合成スキャンの生成');
const cloud = synthScan(stage.map);
ok('点群が生成される', cloud.count > 50000, cloud.count.toLocaleString() + ' 点');
const b = S.bounds(cloud);
ok('境界ボックスが妥当', b.size[0] > 10 && b.size[2] > 10, 'size=' + b.size.map(v => v.toFixed(1)).join(' × ') + ' m');

section('2. 上方向軸と床面の自動推定');
const up = S.detectUpAxis(cloud);
ok('上方向軸をY軸と判定する', up === 1, 'axis=' + 'xyz'[up]);
const floor = S.detectFloor(cloud, up);
// 合成時に上方向へ +5.9 のオフセットと 2度の傾きを入れてある（傾きぶん最大 +0.56m ずれる）
ok('床の高さを推定できる', floor >= 5.8 && floor <= 6.6, 'floor=' + floor.toFixed(2) + ' (合成値 5.90〜6.46)');
const plane = S.fitFloorPlane(cloud, up, floor);
ok('床の傾きを検出して補正できる', Math.abs(plane.tiltDeg - 2) < 0.6, 'tilt=' + plane.tiltDeg.toFixed(2) + '° (合成値 2.00°)');

section('3. 占有グリッドへの変換と整形');
let g = S.gridify(cloud, { cell: 1.0 });
ok('グリッド化が成功する', !g.error, g.error || (g.w + '×' + g.h + ' cell=' + g.cell.toFixed(2) + 'm thr=' + g.threshold));
g = S.cleanup(g);
ok('整形後もサイズが妥当', g.w >= 20 && g.w <= 30 && g.h >= 12 && g.h <= 22, g.w + '×' + g.h);
ok('空間がひと繋がりになる', g.freeCells > 150, 'free=' + g.freeCells + ' cells');
const m = bestIoU(stage.map, g);
ok('元の間取りを再現できている (IoU≥0.75)', m.iou >= 0.75, 'IoU=' + m.iou.toFixed(3) + ' offset=' + JSON.stringify(m.off));

section('4. スポーンと敵の自動配置');
const spawn = S.pickSpawn(g);
ok('開けた場所にスポーンが置かれる', !!spawn && !g.grid[spawn.y * g.w + spawn.x], spawn ? `(${spawn.x},${spawn.y})` : 'なし');
const enemies = S.placeEnemies(g, spawn, { grunt: 4, rusher: 2, shooter: 1 });
ok('敵が7体配置される', enemies.length === 7, enemies.length + '体');
ok('敵が壁に埋まっていない', enemies.every(e => !g.grid[e.y * g.w + e.x]));
ok('敵がスポーンから離れている', enemies.every(e => Math.hypot(e.x - spawn.x, e.y - spawn.y) >= 4));

section('5. エンジンが読める形式で出力できる');
const rows = S.toMapRows(g, spawn, enemies);
const v = S.validate(rows);
ok('検証をすべて通過する', v.ok, v.problems.slice(0, 3).join(' / ') || `${v.w}×${v.h} 敵${v.enemies}体 到達${v.reachable}セル`);
ok('全行の長さが揃っている', rows.every(r => r.length === rows[0].length));
ok('外周が閉じている', rows[0].split('').every(c => c === '#') && rows[rows.length - 1].split('').every(c => c === '#'));
const src = S.toStageSource(rows, { id: 6, name: 'SCANNED SITE' });
ok('data.js に貼れるステージ定義が出る', /map: \[/.test(src) && /id: 6/.test(src), src.split('\n').length + ' 行');

section('6. 実際にゲームエンジンで読み込める');
const fakeStage = { map: rows };
const parsed = DATA.parseMap(fakeStage);
ok('parseMap が通る', parsed.w === v.w && parsed.h === v.h, parsed.w + '×' + parsed.h);
ok('スポーンが壁の中でない', parsed.grid[(parsed.spawn.y | 0) * parsed.w + (parsed.spawn.x | 0)] === 0,
  `spawn=(${parsed.spawn.x},${parsed.spawn.y})`);
ok('敵スポーンが全て床の上', parsed.enemies.every(e => parsed.grid[(e.y | 0) * parsed.w + (e.x | 0)] === 0),
  parsed.enemies.length + '体');

section('7. 各ファイル形式のパーサ');
// OBJ
const objTxt = (() => {
  let s = '# synthetic\n';
  for (let i = 0; i < 3000; i++) s += `v ${cloud.xyz[i * 3].toFixed(3)} ${cloud.xyz[i * 3 + 1].toFixed(3)} ${cloud.xyz[i * 3 + 2].toFixed(3)}\n`;
  return s;
})();
const objCloud = S.parse('scan.obj', objTxt);
ok('OBJ を読める', objCloud.count === 3000, objCloud.count + ' 点');
// PLY ascii
const plyAscii = (() => {
  let s = `ply\nformat ascii 1.0\nelement vertex 3000\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
  for (let i = 0; i < 3000; i++) s += `${cloud.xyz[i * 3]} ${cloud.xyz[i * 3 + 1]} ${cloud.xyz[i * 3 + 2]}\n`;
  return s;
})();
const plyA = S.parse('scan.ply', plyAscii);
ok('PLY (ascii) を読める', plyA.count === 3000, plyA.count + ' 点');
// PLY binary little endian (色付き = Polycam などの実際の出力に近い)
const plyBin = (() => {
  const n = 3000;
  const head = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`, 'ascii');
  const body = Buffer.alloc(n * 15);
  for (let i = 0; i < n; i++) {
    body.writeFloatLE(cloud.xyz[i * 3], i * 15);
    body.writeFloatLE(cloud.xyz[i * 3 + 1], i * 15 + 4);
    body.writeFloatLE(cloud.xyz[i * 3 + 2], i * 15 + 8);
    body[i * 15 + 12] = 200; body[i * 15 + 13] = 180; body[i * 15 + 14] = 160;
  }
  return Buffer.concat([head, body]);
})();
const plyB = S.parse('scan.ply', plyBin.buffer.slice(plyBin.byteOffset, plyBin.byteOffset + plyBin.byteLength));
ok('PLY (binary + 色情報) を読める', plyB.count === 3000, plyB.count + ' 点');
ok('PLY binary の座標が一致する', Math.abs(plyB.xyz[0] - cloud.xyz[0]) < 1e-3 && Math.abs(plyB.xyz[7] - cloud.xyz[7]) < 1e-3);
// XYZ
const xyz = S.parse('scan.xyz', Array.from({ length: 500 }, (_, i) =>
  `${cloud.xyz[i * 3]} ${cloud.xyz[i * 3 + 1]} ${cloud.xyz[i * 3 + 2]}`).join('\n'));
ok('XYZ を読める', xyz.count === 500, xyz.count + ' 点');
// STL binary
const stlBuf = (() => {
  const tri = 400;
  const buf = Buffer.alloc(84 + tri * 50);
  buf.writeUInt32LE(tri, 80);
  for (let i = 0; i < tri; i++) {
    const o = 84 + i * 50 + 12;
    for (let v2 = 0; v2 < 3; v2++) {
      buf.writeFloatLE(cloud.xyz[(i * 3 + v2) * 3], o + v2 * 12);
      buf.writeFloatLE(cloud.xyz[(i * 3 + v2) * 3 + 1], o + v2 * 12 + 4);
      buf.writeFloatLE(cloud.xyz[(i * 3 + v2) * 3 + 2], o + v2 * 12 + 8);
    }
  }
  return buf;
})();
const stl = S.parse('scan.stl', stlBuf.buffer.slice(stlBuf.byteOffset, stlBuf.byteOffset + stlBuf.byteLength));
ok('STL (binary) を読める', stl.count === 1200, stl.count + ' 点');

section('8. 座標系が違うスキャン (Z-up)');
const zScan = synthScan(stage.map, { upAxis: 2, origin: [-30, 88, 2.5], seed: 777 });
const zUp = S.detectUpAxis(zScan);
let zg = S.gridify(zScan, { cell: 1.0 });
zg = S.cleanup(zg);
const zm = bestIoU(stage.map, zg);
ok('Z-up スキャンでも上方向を当てる', zUp === 2, 'axis=' + 'xyz'[zUp]);
ok('Z-up でも間取りを復元できる', zm.iou >= 0.75, 'IoU=' + zm.iou.toFixed(3));

section('9. 質の低いスキャンへの耐性');
// 実機のLiDAR室内スキャンは点間隔 1〜5cm 程度。ここでは「かなり雑に撮った」相当の
// 12〜18cm 間隔・欠損35%・ノイズ5cm・傾き4度を想定する。
const rough = synthScan(stage.map, {
  wallStep: 0.12, floorStep: 0.18, noise: 0.05, dropout: 0.35, tilt: 4 * Math.PI / 180, seed: 4242
});
let rg = S.gridify(rough, { cell: 1.0 });
rg = S.cleanup(rg);
const rm = bestIoU(stage.map, rg);
ok('雑なスキャンでも変換が通る', !rg.error && rg.freeCells > 150, 'free=' + rg.freeCells + ' (' + rough.count.toLocaleString() + ' 点)');
ok('雑なスキャンでも実用的な精度 (IoU≥0.75)', rm.iou >= 0.75, 'IoU=' + rm.iou.toFixed(3));
const rRows = S.toMapRows(rg, S.pickSpawn(rg), S.placeEnemies(rg, S.pickSpawn(rg), { grunt: 3 }));
ok('雑なスキャンからも遊べるマップが出る', S.validate(rRows).ok, S.validate(rRows).problems.slice(0, 2).join(' / '));

// 限界の確認: LiDARとしてあり得ないほど疎な点群 (40cm間隔)。
// 精度は落ちるが、セルサイズ自動調整で「破綻せず遊べるマップ」にはなること。
const sparse = synthScan(stage.map, { wallStep: 0.3, floorStep: 0.45, noise: 0.06, dropout: 0.45, seed: 99 });
const sug = S.suggestCell(sparse);
let sg = S.cleanup(S.gridify(sparse, { cell: 'auto' }));
const sRows = S.toMapRows(sg, S.pickSpawn(sg), S.placeEnemies(sg, S.pickSpawn(sg), { grunt: 3 }));
ok('疎な点群にはセルサイズを自動で粗くする', sug.cell > 1.0,
  '間隔≈' + sug.spacing.toFixed(2) + 'm → cell=' + sug.cell + 'm');
ok('疎な点群でも破綻せず遊べるマップになる', S.validate(sRows).ok && sg.freeCells > 20,
  sg.w + '×' + sg.h + ' free=' + sg.freeCells + ' / ' + (S.validate(sRows).problems.slice(0, 2).join(' / ') || 'OK'));

section('10. 間取り図画像からの変換（LiDARが無い場合）');
const imgW = 240, imgH = 160;
const img = { width: imgW, height: imgH, data: new Uint8ClampedArray(imgW * imgH * 4) };
for (let y = 0; y < imgH; y++) for (let x = 0; x < imgW; x++) {
  const i = (y * imgW + x) * 4;
  const wall = x < 6 || y < 6 || x >= imgW - 6 || y >= imgH - 6 || (Math.abs(x - 120) < 4 && y < 100);
  const c = wall ? 20 : 245;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = c; img.data[i + 3] = 255;
}
let ig = S.fromImageData(img, { cols: 24 });
ig = S.cleanup(ig);
const iRows = S.toMapRows(ig, S.pickSpawn(ig), S.placeEnemies(ig, S.pickSpawn(ig), { grunt: 3, rusher: 1 }));
ok('画像からグリッドが作れる', ig.w === 24 && ig.h === 16, ig.w + '×' + ig.h);
ok('画像由来のマップも検証を通る', S.validate(iRows).ok, S.validate(iRows).problems.slice(0, 2).join(' / '));

console.log(log.join('\n'));
console.log('\n  \x1b[90m復元されたマップ (CARGO DEPOT のスキャン):\x1b[0m');
console.log(dump(g));
console.log('\n  \x1b[90m正解:\x1b[0m');
console.log(stage.map.map(r => '    ' + r.replace(/[PgrshB]/g, '.')).join('\n'));
console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
