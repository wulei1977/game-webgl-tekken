// 导出程序化生成的美术贴图为 PNG（仅供预览 / 交给美术替换时参考尺寸与配色，游戏运行时不读取这些文件）
// 用法：先 npm run dev，再 node scripts/export-art.mjs [url]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = 'docs/art-preview';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle0' });
const files = await page.evaluate(async () => {
  const ca = await import('/src/render/CharacterArt.ts');
  const tf = await import('/src/render/TextureFactory.ts');
  const res = {};
  for (const id of ['heishi', 'golem', 'rina']) {
    for (const alt of [false, true]) {
      res[`character-${id}${alt ? '-alt' : ''}-atlas-256`] = ca.characterAtlas(id, alt).canvas.toDataURL();
    }
    res[`portrait-${id}-64`] = ca.portraitCanvas(id, false, 64).toDataURL();
  }
  const h = tf.hex;
  const tex = {
    'stage-concrete-256': tf.concreteTexture(),
    'stage-ring-floor-256': tf.ringFloorTexture(),
    'stage-emblem-128': tf.emblemTexture(),
    'stage-boundary-stripe-64x16': tf.stripeTexture(),
    'stage-fence-64': tf.fenceTexture(),
    'stage-metal-64': tf.metalTexture(),
    'stage-crowd-256x128': tf.crowdTexture(21),
    'stage-skyline-512x256': tf.skylineTexture(),
    'stage-pillar-64x128': tf.pillarTexture(),
    'stage-banner-256x48': tf.bannerTexture('WEB TEKKEN', 0x8a1a1e, ['#ffe08a', '#e08a1c']),
    'fx-hit-spark-64': tf.sparkTexture(h(0xffffff), h(0xffb020)),
    'fx-counter-spark-64': tf.sparkTexture(h(0xffffe0), h(0xff3020)),
    'fx-block-spark-64': tf.sparkTexture(h(0xffffff), h(0x40a0ff)),
    'fx-flash-64': tf.flashTexture(h(0xffffff), h(0xffc040)),
    'fx-ring-128': tf.ringTexture(h(0xffffff)),
    'fx-victory-ring-128': tf.ringTexture(h(0xffd040), 0.12),
    'fx-dust-64': tf.dustTexture(),
    'fx-trail-64x16': tf.trailTexture(h(0xff8a2a)),
    'projectile-shockwave-128': tf.orbTexture('shockwave'),
    'projectile-shock-128': tf.orbTexture('shock'),
    'projectile-flash-128': tf.orbTexture('flash'),
    'projectile-cannon-128': tf.orbTexture('cannon'),
  };
  for (const [k, t] of Object.entries(tex)) res[k] = t.image.toDataURL();
  return res;
});
for (const [name, data] of Object.entries(files)) {
  writeFileSync(`${out}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
console.log(`exported ${Object.keys(files).length} textures to ${out}/`);
await browser.close();
