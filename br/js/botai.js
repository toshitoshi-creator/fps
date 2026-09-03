/* ===== botai.js — Bot AI ====================================================
 * ステートマシン + 知覚 + 性格 + 遮蔽利用 + Zone判断。
 * 全Botを毎フレーム完全計算せず、プレイヤーからの距離でLOD更新する。
 * ========================================================================= */
(function (g) {
  'use strict';

  const D = () => g.BRDATA;
  const TIER_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const CLASS_SCORE = { PISTOL: 0, SMG: 2, SHOTGUN: 2, AR: 4, LMG: 4, DMR: 4, SNIPER: 5 };

  const BRBot = {

    init(b, br) {
      const pid = D().PERSONALITY_LIST[(Math.random() * D().PERSONALITY_LIST.length) | 0];
      const p = D().PERSONALITIES[pid];
      b.bot = {
        p, personality: pid,
        state: 'LANDING', prev: '', stateT: 0,
        target: null, lastSeenX: 0, lastSeenY: 0, seenT: 0,
        goalX: 0, goalY: 0, goal: null,
        acc: 0, interval: 1 / 60,
        reactT: 0, fireHold: 0, strafe: (Math.random() < 0.5 ? 1 : -1), strafeT: 0,
        stuckT: 0, lastX: 0, lastY: 0, repathT: 0,
        coverX: 0, coverY: 0, coverT: 0,
        dropAt: 0.5, landX: 0, landY: 0,
        skill: U.rand(0.75, 1.15)
      };
      b.maxHp = 100; b.hp = 100;
      return b;
    },

    setState(b, s) {
      if (b.bot.state === s) return;
      b.bot.prev = b.bot.state;
      b.bot.state = s;
      b.bot.stateT = 0;
    },

    /* ---------------- 知覚 ---------------- */
    canSee(b, o, br) {
      if (!o.alive || o.state !== 'ground') return false;
      const d = U.dist(b.x, b.y, o.x, o.y);
      const range = b.bot.p.engage + 12;
      if (d > range) return false;
      if (d > 3.5) {
        const a = Math.atan2(o.y - b.y, o.x - b.x);
        if (Math.abs(U.angDiff(b.ang, a)) > 1.15) return false;   // 視野約130度
      }
      return br.los(b.x, b.y, o.x, o.y);
    },

    hearNoise(b, src, br) {
      if (!b.alive || b.state !== 'ground') return;
      b.bot.lastSeenX = src.x; b.bot.lastSeenY = src.y;
      b.bot.seenT = 6;
      b.alertT = 0.8;
      if (!b.bot.target && b.bot.state !== 'COMBAT') this.setState(b, 'SEARCHING');
    },

    /* ---------------- 装備の評価 ---------------- */
    weaponScore(w) { return g.BR.weaponScore(w); },

    wants(b, l) {
      const dd = D();
      if (l.kind === 'weapon') {
        const def = dd.WEAPON_BY_ID[l.id];
        if (!def) return 0;
        if (!b.weapons[0] || !b.weapons[1]) return 100;
        const worst = Math.min(this.weaponScore(b.weapons[0]), this.weaponScore(b.weapons[1]));
        const pref = b.bot.p.prefer === def.cls ? 12 : 0;
        // 余裕を大きめに取り、僅差の武器で往復しないようにする
        return this.weaponScore({ def }) + pref > worst + 10 ? 70 : 0;
      }
      if (l.kind === 'ammo') {
        const used = b.weapons.filter(Boolean).map(w => w.def.ammo);
        if (used.indexOf(l.id) < 0) return 0;
        return (b.ammo[l.id] || 0) < 60 ? 60 : 5;
      }
      const def = dd.ITEMS[l.id];
      if (!def) return 0;
      // 防具を1つも持っていないうちは、上位装甲より優先して拾いに行く
      if (def.kind === 'armor') return def.ap > b.armorMax ? (b.armorMax ? 90 : 96) : 0;
      if (def.kind === 'helmet') return def.level > b.helmet ? 85 : 0;
      if (def.kind === 'heal') return (b.items.bandage + b.items.medkit) < 5 ? 55 : 0;
      if (def.kind === 'boost') return b.items.energy < 2 ? 30 : 0;
      if (def.kind === 'throw') return b.items.frag < 2 ? 25 : 0;
      return 0;
    },

    findLoot(b, br, radius) {
      let best = null, bestScore = 0;
      const r2 = radius * radius;
      for (let i = 0; i < br.loot.length; i++) {
        const l = br.loot[i];
        if (!l.alive) continue;
        const d2 = U.dist2(l.x, l.y, b.x, b.y);
        if (d2 > r2) continue;
        const want = this.wants(b, l);
        if (!want) continue;
        const score = want - Math.sqrt(d2) * 1.5;
        if (score > bestScore) { bestScore = score; best = l; }
      }
      return best;
    },

    /* ---------------- 移動 ---------------- */
    stepTo(b, tx, ty, spd, dt, br) {
      const a = Math.atan2(ty - b.y, tx - b.x);
      const before = b.x + b.y;
      br.moveWithCollision(b, Math.cos(a) * spd * dt, Math.sin(a) * spd * dt, b.def.radius);
      b.moving = true;
      if (Math.abs(b.x + b.y - before) < 0.0005) {
        b.bot.stuckT += dt;
        // 壁に沿ってずらして回り込む
        const s = b.bot.strafe;
        br.moveWithCollision(b, Math.cos(a + s * 1.4) * spd * dt * 1.3,
          Math.sin(a + s * 1.4) * spd * dt * 1.3, b.def.radius);
        if (b.bot.stuckT > 0.9) { b.bot.strafe *= -1; b.bot.stuckT = 0; }
      } else b.bot.stuckT = 0;
    },

    faceTo(b, tx, ty, dt, turn) {
      const a = Math.atan2(ty - b.y, tx - b.x);
      b.ang = U.approachAngle(b.ang, a, (turn || 4) * dt);
    },

    /** 脅威から見て遮蔽になる地点を探す */
    findCover(b, threat, br) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * U.TAU, r = U.rand(2.5, 7);
        const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r;
        if (br.solidAt(x, y)) continue;
        if (br.los(x, y, threat.x, threat.y)) continue;      // 撃たれない位置
        if (!br.los(b.x, b.y, x, y)) continue;               // そこまで行ける
        return { x, y };
      }
      return null;
    },

    /* ---------------- 射撃 ---------------- */
    tryShoot(b, target, br, dt) {
      const w = b.weapons[b.wIdx];
      if (!w) return;
      if (w.mag <= 0) { br.tryReload(b); return; }
      if (b.reloading || b.switchT > 0 || b.useT > 0) return;
      const d = U.dist(b.x, b.y, target.x, target.y);
      if (d > w.def.range * 1.4) return;

      // 反応時間。見つけてすぐには撃たない
      if (b.bot.reactT > 0) { b.bot.reactT -= dt; return; }
      if (b.fireCd > 0) return;

      // 命中判定: 距離・性格・武器精度・移動状態から確率を出す
      const base = 0.86 / b.bot.p.aimErr * b.bot.skill;
      const rangeK = U.clamp(1 - (d / (w.def.range * 1.15)) * 0.75, 0.12, 1);
      const spreadK = U.clamp(1 - w.def.spread * 0.06, 0.4, 1);
      const moveK = target.moving ? 0.78 : 1;
      let chance = U.clamp(base * rangeK * spreadK * moveK, 0.04, 0.82);

      const shots = w.def.fireMode === 'burst' ? (w.def.burstCount || 3) : 1;
      if (w.def.fireMode === 'burst') { b.burstLeft = shots; b.burstT = 0; }
      br.fire(b);

      const pellets = w.def.pellets || 1;
      let hits = 0;
      for (let i = 0; i < pellets; i++) if (Math.random() < chance) hits++;
      if (hits > 0) {
        const head = Math.random() < 0.12 * b.bot.skill;
        const dmg = w.def.damage * hits * U.clamp(1 - Math.max(0, d - w.def.range) / (w.def.range || 1), w.def.falloff, 1);
        br.damage(target, dmg, b, head, w.def.headMul);
        b.hits++;
        if (target.isPlayer) br.emit('player_shot_by', b, dmg);
      }
      // 視覚用の弾道
      br.addTracer(0, 0, target.x + U.rand(-0.4, 0.4), target.y + U.rand(-0.4, 0.4), 0.6, w.def.color);
      b.bot.fireHold = U.rand(0.08, 0.3);
    },

    /* ---------------- 更新 ---------------- */
    update(b, br, dtRaw) {
      const st = b.bot;

      // --- LOD: プレイヤーから遠いBotは更新頻度を落とす ---
      const dp = U.dist(b.x, b.y, br.player.x, br.player.y);
      st.interval = dp < 26 ? 0 : (dp < 55 ? 1 / 20 : 1 / 6);
      st.acc += dtRaw;
      if (st.acc < st.interval) return;
      const dt = Math.max(dtRaw, st.acc);
      st.acc = 0;
      st.stateT += dt;
      if (st.seenT > 0) st.seenT -= dt;
      if (st.coverT > 0) st.coverT -= dt;

      b.moving = false;
      if (b.state === 'drop') { this.setState(b, 'LANDING'); return; }

      const spd = 3.0 * (b.speedBuff > 0 ? 1.25 : 1) * (st.state === 'COMBAT' ? 0.85 : 1);

      /* --- 知覚: 最も脅威の高い相手を探す --- */
      let target = null, bestD = 1e9;
      for (let i = 0; i < br.combatants.length; i++) {
        const o = br.combatants[i];
        if (o === b || !o.alive || o.state !== 'ground') continue;
        const d = U.dist(b.x, b.y, o.x, o.y);
        if (d > bestD) continue;
        if (this.canSee(b, o, br)) { target = o; bestD = d; }
      }
      if (target) {
        if (st.target !== target) st.reactT = st.p.react * U.rand(0.8, 1.3);
        st.target = target;
        st.lastSeenX = target.x; st.lastSeenY = target.y; st.seenT = 5;
      } else if (st.seenT <= 0) st.target = null;

      /* --- Zone: 圏外 or 縮小中なら移動を最優先 --- */
      const z = br.zone;
      const dz = U.dist(b.x, b.y, z.cx, z.cy);
      const outside = dz > z.r * 0.88;
      const urgent = dz > z.r || (z.shrinking && dz > z.r * 0.7);

      /* --- 回復判断 --- */
      const hpR = b.hp / b.maxHp;
      if (hpR < 0.55 && (b.items.bandage > 0 || b.items.medkit > 0) &&
        (!target || bestD > 22) && b.useT <= 0 && !urgent) {
        this.setState(b, 'HEALING');
        br.useItem(b, b.items.medkit > 0 && hpR < 0.4 ? 'medkit' : 'bandage');
      }

      /* --- ステート決定 --- */
      const unarmed = !b.weapons[0] && !b.weapons[1];
      if (b.useT > 0) this.setState(b, 'HEALING');
      else if (b.reloading) this.setState(b, 'RELOADING');
      // 丸腰は戦えない。武装した敵が至近にいるときだけ逃げ、それ以外は武器を探しに行く。
      // 逃げ続けても武器は手に入らないので、数秒で切り上げて拾いに向かわせる。
      else if (unarmed) {
        const threat = !!(target && (target.weapons[0] || target.weapons[1]));
        const flee = threat && bestD < 11 && !(st.state === 'RETREATING' && st.stateT > 3.5);
        this.setState(b, flee ? 'RETREATING' : 'LOOTING');
      }
      else if (target && hpR < st.p.flee) this.setState(b, 'RETREATING');
      else if (target && st.coverT > 0) this.setState(b, 'TAKING_COVER');
      else if (target) this.setState(b, 'COMBAT');
      else if (urgent) this.setState(b, 'MOVING_TO_ZONE');
      else if (st.seenT > 0) this.setState(b, 'SEARCHING');
      else if (br.aliveCount <= 4) this.setState(b, 'ENDGAME');
      else this.setState(b, 'LOOTING');

      /* --- 行動 --- */
      switch (st.state) {
        case 'HEALING':
        case 'RELOADING': {
          // 動きながらは回復しない。撃たれていたら遮蔽へ
          if (target && bestD < 18 && !st.coverT) {
            const cov = this.findCover(b, target, br);
            if (cov) { st.coverX = cov.x; st.coverY = cov.y; st.coverT = 2.5; }
          }
          if (st.coverT > 0) this.stepTo(b, st.coverX, st.coverY, spd, dt, br);
          if (target) this.faceTo(b, target.x, target.y, dt, 3);
          break;
        }

        case 'COMBAT': {
          this.faceTo(b, target.x, target.y, dt, 5.5);
          const want = b.weapons[b.wIdx] ? b.weapons[b.wIdx].def.range * 0.55 : 6;
          // 武器を持っていなければ拾いに戻る
          if (!b.weapons[b.wIdx]) { this.setState(b, 'LOOTING'); break; }
          if (b.weapons[b.wIdx].mag <= 0) { br.tryReload(b); }
          if (bestD > want * 1.35 && Math.random() < st.p.pushChance) {
            this.stepTo(b, target.x, target.y, spd, dt, br);
          } else if (bestD < want * 0.55) {
            this.stepTo(b, b.x * 2 - target.x, b.y * 2 - target.y, spd * 0.8, dt, br);
          } else {
            // 横に動きながら撃つ
            st.strafeT -= dt;
            if (st.strafeT <= 0) { st.strafeT = U.rand(0.6, 1.4); st.strafe *= -1; }
            const a = Math.atan2(target.y - b.y, target.x - b.x) + Math.PI / 2 * st.strafe;
            br.moveWithCollision(b, Math.cos(a) * spd * 0.5 * dt, Math.sin(a) * spd * 0.5 * dt, b.def.radius);
            b.moving = true;
          }
          this.tryShoot(b, target, br, dt);
          // 被弾が続くなら遮蔽へ
          if (b.hurtT > 0 && Math.random() < 0.02 && st.p.pushChance < 0.8) {
            const cov = this.findCover(b, target, br);
            if (cov) { st.coverX = cov.x; st.coverY = cov.y; st.coverT = 2.2; }
          }
          break;
        }

        case 'TAKING_COVER': {
          this.stepTo(b, st.coverX, st.coverY, spd, dt, br);
          if (target) this.faceTo(b, target.x, target.y, dt, 4);
          if (U.dist2(b.x, b.y, st.coverX, st.coverY) < 0.6) {
            if (b.weapons[b.wIdx] && b.weapons[b.wIdx].mag <= 0) br.tryReload(b);
            if (target && this.canSee(b, target, br)) this.tryShoot(b, target, br, dt);
          }
          break;
        }

        case 'RETREATING': {
          let ax = b.x * 2 - (target ? target.x : b.x + 1);
          let ay = b.y * 2 - (target ? target.y : b.y);
          // 丸腰のまま逃げ続けても勝ち目が無いので、
          // 敵から遠ざかる方向にある武器を目指して逃げる
          if (unarmed) {
            let bw = null, bs = -1e9;
            for (let i = 0; i < br.loot.length; i++) {
              const l = br.loot[i];
              if (!l.alive || l.kind !== 'weapon') continue;
              const d = U.dist(l.x, l.y, b.x, b.y);
              if (d > 45) continue;
              // 敵に近づく方向の武器は数えない
              const away = target ? U.dist(l.x, l.y, target.x, target.y) - bestD : 20;
              if (away < 4) continue;
              const sc = away * 1.2 - d;
              if (sc > bs) { bs = sc; bw = l; }
            }
            if (bw) { ax = bw.x; ay = bw.y; }
          }
          // Zoneの外へは逃げない
          const nz = U.dist(ax, ay, z.cx, z.cy);
          if (nz > z.r * 0.9) this.stepTo(b, z.cx, z.cy, spd, dt, br);
          else this.stepTo(b, ax, ay, spd * 1.05, dt, br);
          if (target) this.faceTo(b, target.x, target.y, dt, 3);
          const lr = br.lootNear(b, 1.8);
          if (lr && this.wants(b, lr)) br.pickup(b, lr);
          if (b.weapons[b.wIdx] && b.hp / b.maxHp > st.p.flee + 0.2) this.setState(b, 'COMBAT');
          break;
        }

        case 'MOVING_TO_ZONE': {
          const a = Math.atan2(z.cy - b.y, z.cx - b.x);
          const tx = z.cx - Math.cos(a) * z.r * 0.55;
          const ty = z.cy - Math.sin(a) * z.r * 0.55;
          this.faceTo(b, tx, ty, dt, 4);
          this.stepTo(b, tx, ty, spd * 1.1, dt, br);
          // 移動中も足元のLootは拾う
          const l = br.lootNear(b, 1.7);
          if (l && this.wants(b, l)) br.pickup(b, l);
          break;
        }

        case 'SEARCHING': {
          this.faceTo(b, st.lastSeenX, st.lastSeenY, dt, 3.5);
          this.stepTo(b, st.lastSeenX, st.lastSeenY, spd * 0.85, dt, br);
          if (U.dist2(b.x, b.y, st.lastSeenX, st.lastSeenY) < 2) st.seenT = 0;
          break;
        }

        case 'ENDGAME': {
          // 終盤は安全地帯の中心付近で敵を待つ
          const tx = z.cx + Math.cos(st.strafeT) * z.r * 0.4;
          const ty = z.cy + Math.sin(st.strafeT) * z.r * 0.4;
          st.strafeT += dt * 0.3;
          this.stepTo(b, tx, ty, spd * 0.7, dt, br);
          this.faceTo(b, tx, ty, dt, 2);
          break;
        }

        default: {   // LOOTING / EXPLORING
          // 足元だけでなく、目標にしたLootは少し離れていても手を伸ばす
          const near = br.lootNear(b, 2.2);
          if (near && this.wants(b, near)) { br.pickup(b, near); break; }
          if (st.goal && st.goal.alive && U.dist2(b.x, b.y, st.goal.x, st.goal.y) < 6.25 &&
            this.wants(b, st.goal)) {
            br.pickup(b, st.goal); st.goal = null; break;
          }
          if (!st.goal || !st.goal.alive || st.stateT > 12) {
            st.goal = this.findLoot(b, br, unarmed ? 60 : 34);
            st.stateT = 0;
            if (!st.goal) {
              // 拾うものが無ければ安全地帯の内側をうろつく
              const a = Math.random() * U.TAU, r = Math.sqrt(Math.random()) * z.r * 0.8;
              st.goalX = z.cx + Math.cos(a) * r; st.goalY = z.cy + Math.sin(a) * r;
            }
          }
          const gx = st.goal ? st.goal.x : st.goalX;
          const gy = st.goal ? st.goal.y : st.goalY;
          this.faceTo(b, gx, gy, dt, 3.5);
          this.stepTo(b, gx, gy, spd * 0.9, dt, br);
          if (b.weapons[b.wIdx] && b.weapons[b.wIdx].mag < b.weapons[b.wIdx].magMax) br.tryReload(b);
          break;
        }
      }
    }
  };

  g.BRBot = BRBot;
})(window);
