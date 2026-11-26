// 可视化验收脚本：用本机 Chrome（puppeteer-core）打开游戏，按场景截图并收集控制台错误。
// 用法：node scripts/shot.mjs [url] [scenario]
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const scenario = process.argv[3] ?? 'basic';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

mkdirSync('.screenshots', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(1500);

const shot = async (name) => {
  await sleep(120);
  await page.screenshot({ path: `.screenshots/${name}.png` });
  console.log('saved', name);
};
/** 暂停主循环后逐帧推进逻辑，便于精确截取某一帧 */
const stepTo = async (fn, arg) => {
  await page.evaluate(fn, arg);
  // 丢弃开场播报事件、清掉播报文字，镜头直接就位
  await page.evaluate(() => {
    const app = window.__webtekken;
    app.game?.drainEvents();
    app.hud.announce = null;
    app.view.cam.snap();
  });
  await sleep(250);
};
const boxes = async (on) => {
  await page.evaluate((v) => {
    window.__webtekken.practice.hitboxes = v;
  }, on);
  await sleep(80);
};

if (scenario === 'basic') {
  await shot('01-title');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot('02-main');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot('03-select');
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(2600);
  await shot('04-cpu-intro');
  await sleep(2500);
  await shot('05-cpu-fight');
  // 玩家出几招
  for (const k of ['KeyU', 'KeyU', 'KeyI', 'KeyJ', 'KeyK']) {
    await page.keyboard.down('KeyD');
    await sleep(250);
    await page.keyboard.up('KeyD');
    await page.keyboard.press(k);
    await sleep(350);
  }
  await shot('06-cpu-exchange');
  await page.keyboard.press('Escape');
  await sleep(300);
  await shot('07-pause');
} else if (scenario === 'poses') {
  // 练习模式下逐个招式截图，检查动作与判定框是否对齐
  const p1 = process.argv[4] ?? 'heishi';
  const p2 = process.argv[5] ?? 'golem';
  await page.evaluate(([a, b]) => {
    const app = window.__webtekken;
    app.audio.unlock();
    app.startMatch({ mode: 'practice', p1: a, p2: b, difficulty: 'normal', dummy: 'stand' });
    app.practice.hitboxes = true;
  }, [p1, p2]);
  await sleep(1200);
  const moves = (process.argv[6] ?? 'lp,rk,df_rp,d_rk,qcf_lp,throw').split(',');
  for (const id of moves) {
    await stepTo(
      ([mid]) => {
        const app = window.__webtekken;
        const g = app.game;
        app.paused = true;
        g.startRound(g.round);
        for (let i = 0; i < 40; i++) g.step();
        const f = g.fighters[0];
        const o = g.fighters[1];
        f.pos.set(-0.55, 0, 0);
        o.pos.set(0.55, 0, 0);
        const m = f.def.moves[mid];
        if (!m) return;
        if (m.requiresWeapon) f.weaponDrawn = true;
        f.startMove(m, -1);
        if (m.throw) {
          f.pos.set(-0.42, 0, 0);
          o.pos.set(0.42, 0, 0);
        }
        // 停在第一个判定帧之前一帧：此时攻击盒已可见、动作接近完全伸展
        const target = Math.max(1, Math.min(m.total, m.startup - 1 + (m.throw ? 30 : 0)));
        for (let i = 0; i < target; i++) g.step();
        g.hitstop = 0;
        g.drainEvents();
      },
      [id],
    );
    await boxes(false);
    await shot(`pose-${p1}-${id}`);
    await boxes(true);
    await shot(`pose-${p1}-${id}-box`);
  }
} else if (scenario === 'states') {
  const p1 = process.argv[4] ?? 'heishi';
  await page.evaluate(([a]) => {
    const app = window.__webtekken;
    app.startMatch({ mode: 'practice', p1: a, p2: 'heishi', difficulty: 'normal', dummy: 'stand' });
    app.practice.frames = false;
  }, [p1]);
  await sleep(1200);
  const states = ['idle', 'crouch', 'block', 'hitHigh', 'hitMid', 'juggle', 'grounded', 'victory', 'walk', 'getup'];
  for (const s of states) {
    await stepTo(
      ([st]) => {
        const app = window.__webtekken;
        const g = app.game;
        app.paused = true;
        g.startRound(g.round);
        for (let i = 0; i < 40; i++) g.step();
        const f = g.fighters[0];
        f.pos.set(-1.0, 0, 0);
        g.fighters[1].pos.set(1.0, 0, 0);
        const sm = f.sm;
        if (st === 'crouch') sm.change('crouch', { noTap: true });
        if (st === 'block') sm.change('block', { stun: 10 });
        if (st === 'hitHigh') sm.change('hit', { stun: 20, zone: 'high', crouch: false });
        if (st === 'hitMid') sm.change('hit', { stun: 20, zone: 'mid', crouch: false });
        if (st === 'juggle') {
          f.startJuggle(0.09, -1, 0, 0.004, 'launch');
          for (let i = 0; i < 12; i++) g.step();
        }
        if (st === 'grounded') sm.change('grounded');
        if (st === 'victory') sm.change('victory');
        if (st === 'walk') sm.change('walkF');
        if (st === 'getup') sm.change('getup');
        g.controllers[0].read = () => ({ up: false, down: st === 'crouch', left: false, right: false, LP: false, RP: false, LK: false, RK: false });
        for (let i = 0; i < (st === 'getup' ? 18 : st === 'walk' ? 12 : 6); i++) {
          if (st === 'block') f.stun = 10;
          if (st.startsWith('hit')) f.stun = 18;
          g.step();
        }
        g.drainEvents();
      },
      [s],
    );
    await shot(`state-${p1}-${s}`);
  }
}

if (scenario === 'flow') {
  // VS 模式：P1 / P2 键盘各自出招 → 强制 KO → 回合切换 → 结算
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.press('Enter'); // 对战模式
  await sleep(300);
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyU'); // P1 选 GOLEM
  await sleep(200);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Numpad7'); // P2 选 RINA
  await sleep(4200);
  const info = await page.evaluate(() => {
    const app = window.__webtekken;
    const r = app.renderer.info.render;
    return {
      chars: app.game.fighters.map((f) => f.def.id),
      tris: app.view.fighters.map((v) => v.model.triangles),
      calls: r.calls,
      triangles: r.triangles,
      phase: app.game.phase,
    };
  });
  console.log('match info', JSON.stringify(info));
  // P1 前冲 + 出拳，P2 下段
  await page.keyboard.down('KeyD');
  await sleep(500);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyU');
  await page.keyboard.down('ArrowDown');
  await page.keyboard.press('Numpad4');
  await page.keyboard.up('ArrowDown');
  await sleep(600);
  const st = await page.evaluate(() => window.__webtekken.game.fighters.map((f) => `${f.def.id}:${f.state}:${f.hp}:${f.lastMove?.id ?? '-'}`));
  console.log('after inputs', st.join(' | '));
  await shot('10-vs-fight');
  for (let r = 0; r < 2; r++) {
    await page.evaluate(() => {
      const g = window.__webtekken.game;
      const [a, b] = g.fighters;
      const mx = (a.pos.x + b.pos.x) / 2;
      const mz = (a.pos.z + b.pos.z) / 2;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      a.pos.set(mx - (dx / d) * 0.55, 0, mz - (dz / d) * 0.55);
      b.pos.set(mx + (dx / d) * 0.55, 0, mz + (dz / d) * 0.55);
      b.hp = 1;
      b.noGuard = true;
    });
    await page.keyboard.press('KeyK');
    await sleep(900);
    if (r === 0) await shot('11-ko');
    await sleep(3600);
    if (r === 0) await shot('12-round-end');
    await sleep(2500);
    const ph = await page.evaluate(() => {
      const g = window.__webtekken.game;
      return `${g.phase} round=${g.round} wins=${g.wins.join(':')} hp2=${g.fighters[1].hp}`;
    });
    console.log('round', r, ph);
    if (ph.includes('matchEnd')) break;
    await sleep(2500);
  }
  await sleep(800);
  await shot('13-result');
}

if (scenario === 'screens') {
  await page.keyboard.press('Enter');
  await sleep(300);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(400);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  await shot('20-movelist-rina');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot('21-help');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.evaluate(() => {
    const app = window.__webtekken;
    app.settings.hd = true;
    app.applySettings();
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot('22-settings');
  await page.evaluate(() => {
    const app = window.__webtekken;
    app.settings.hd = false;
    app.applySettings();
  });
}

if (scenario === 'fx') {
  await page.evaluate(() => {
    const app = window.__webtekken;
    app.startMatch({ mode: 'practice', p1: 'heishi', p2: 'rina', difficulty: 'normal', dummy: 'stand' });
    app.practice.frames = false;
  });
  await sleep(1000);
  // 逐帧推进并实时渲染：每推进 1 帧等待一次渲染，保证特效按真实节奏播放
  const play = async (frames, setupFn, arg) => {
    if (setupFn) await page.evaluate(setupFn, arg);
    for (let i = 0; i < frames; i++) {
      await page.evaluate(() => {
        const app = window.__webtekken;
        app.paused = true;
        app.game.step();
      });
      await sleep(16);
    }
  };
  await play(1, () => {
    const app = window.__webtekken;
    const g = app.game;
    app.paused = true;
    g.startRound(g.round);
    for (let i = 0; i < 40; i++) g.step();
    g.drainEvents();
    g.fighters[0].pos.set(-0.5, 0, 0);
    g.fighters[1].pos.set(0.5, 0, 0);
    g.fighters[1].noGuard = true;
    g.fighters[0].startMove(g.fighters[0].def.moves.df_rp, -1);
  });
  await play(17);
  await shot('30-fx-launch-hit');
  await play(16);
  await page.evaluate(() => {
    const g = window.__webtekken.game;
    g.fighters[0].startMove(g.fighters[0].def.moves.lp, -1);
  });
  await play(12);
  await shot('31-fx-juggle');
  await play(60);
  // 飞行道具
  await play(1, () => {
    const g = window.__webtekken.game;
    g.startRound(g.round);
    for (let i = 0; i < 40; i++) g.step();
    g.drainEvents();
    g.fighters[0].pos.set(-2.2, 0, 0);
    g.fighters[1].pos.set(2.2, 0, 0);
    g.fighters[1].noGuard = true;
    g.fighters[0].startMove(g.fighters[0].def.moves.qcf_lp, -1);
  });
  await play(32);
  await shot('32-fx-projectile');
}

if (scenario === 'hd') {
  // 主菜单切换画面模式：PS1 → 高清 → 对战 → 切回 PS1，并验证设置持久化
  const state = () =>
    page.evaluate(() => {
      const app = window.__webtekken;
      const c = app.renderer.domElement;
      return { hd: app.settings.hd, aa: app.renderer.getContextAttributes().antialias, buffer: `${c.width}x${c.height}`, canvases: document.querySelectorAll('#gl').length };
    });
  await page.keyboard.press('Enter');
  await sleep(400);
  console.log('ps1', JSON.stringify(await state()));
  await shot('40-main-ps1');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(600);
  console.log('after toggle', JSON.stringify(await state()));
  await shot('41-main-hd');
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(1200);
  console.log('after reload', JSON.stringify(await state()));
  await page.evaluate(() => {
    const app = window.__webtekken;
    app.audio.unlock();
    app.startMatch({ mode: 'cpu', p1: 'rina', p2: 'golem', difficulty: 'normal', dummy: 'stand' });
  });
  await sleep(5200);
  await shot('42-fight-hd');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.evaluate(() => window.__webtekken.toMenu());
  await sleep(300);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await sleep(600);
  console.log('back to ps1', JSON.stringify(await state()));
  await shot('43-main-ps1-again');
}

console.log('--- console ---');
console.log(logs.filter((l) => !l.includes('[vite]') && !l.includes('Download the React')).join('\n') || '(no messages)');
await browser.close();
