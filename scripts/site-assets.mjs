// Renders the site's share image and the Instagram images from the real
// screenshots and demo GIF in assets/. Not part of the plugin build.
//
//   node scripts/site-assets.mjs        (needs Playwright + Chromium and ffmpeg)
//
// Outputs: site/media/og-image.png, site/social/*.png, site/social/reel-demo.mp4
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(import.meta.dirname, '..');
const asset = (p) => pathToFileURL(join(root, 'assets', p)).href;
const birdPath = readFileSync(join(root, 'assets/bird.svg'), 'utf8').match(/d="([^"]+)"/)[1];
const bird = (size, color) => `<svg width="${size}" height="${size}" viewBox="0 0 256 256"><path fill="${color}" d="${birdPath}"/></svg>`;
const SITE = 'pilafdob.github.io/owla-butler';

const base = `
  *{box-sizing:border-box;margin:0}
  body{font-family:Inter,system-ui,sans-serif;color:#1c1830;background:#f6f3ff;overflow:hidden;-webkit-font-smoothing:antialiased}
  .bg{position:absolute;inset:0;background:radial-gradient(900px 600px at 90% -5%,#e3d9ff,transparent 70%),radial-gradient(700px 500px at -10% 105%,#ece6ff,transparent 70%),#f8f6ff}
  .brand{display:flex;align-items:center;gap:16px;font-weight:700}
  .mark{display:grid;place-items:center;border-radius:22%;background:#ede7ff}
  .shot{display:block;border-radius:20px;border:1px solid #ddd6f3;box-shadow:0 2px 4px rgba(28,24,48,.06),0 30px 60px -20px rgba(60,40,140,.35);background:#fff}
  .pill{display:inline-block;padding:10px 20px;border-radius:999px;background:#6d4ed8;color:#fff;font-weight:600}
  h1{letter-spacing:-.035em;line-height:1.04}
  p.sub{color:#4d4866;line-height:1.38}
`;

const post = ({ title, sub, shot, focus = 'center', zoom = 1, tag }) => `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  body{width:1080px;height:1350px;position:relative}
  .in{position:absolute;inset:0;padding:84px 72px 64px;display:flex;flex-direction:column}
  .tag{font-size:28px;font-weight:600;color:#6d4ed8;margin-bottom:22px}
  h1{font-size:92px;margin-bottom:26px}
  p.sub{font-size:36px;max-width:900px}
  .shotwrap{margin-top:auto;margin-bottom:44px;height:620px;border-radius:22px;overflow:hidden;border:1px solid #ddd6f3;box-shadow:0 30px 60px -20px rgba(60,40,140,.35);background:#fff}
  .shotwrap{background:#fff url('${asset('screenshots/' + shot)}') no-repeat;background-size:${zoom * 100}% auto;background-position:${focus}}
  .foot{display:flex;justify-content:space-between;align-items:center;font-size:28px}
  .foot .url{color:#4d4866}
</style></head><body><div class="bg"></div><div class="in">
  <div class="tag">${tag}</div>
  <h1>${title}</h1>
  <p class="sub">${sub}</p>
  <div class="shotwrap" role="img"></div>
  <div class="foot"><div class="brand"><span class="mark" style="width:60px;height:60px">${bird(36, '#6d4ed8')}</span>OWLA Butler for Obsidian</div><span class="url">${SITE}</span></div>
</div></body></html>`;

const posts = [
  { file: 'post-1-review-every-edit.png', tag: 'Free Obsidian plugin', title: 'Review every edit.', sub: 'Changes the assistant proposes are highlighted in your note and wait for Accept or Decline.', shot: '02-review.png', focus: '0% 45%', zoom: 1.3 },
  { file: 'post-2-uses-the-ai-you-have.png', tag: 'Codex · OpenCode · Claude Code · Hermes Agent', title: 'Uses the AI you already have.', sub: 'Runs on the CLI you are already signed in to. No extra API key, no OWLA account.', shot: '05-providers.png', focus: '50% 18%', zoom: 1.3 },
  { file: 'post-3-your-vault-stays-yours.png', tag: 'Privacy by design', title: 'Your vault stays yours.', sub: 'No background index, no whole-vault upload, no telemetry. Only what a message needs goes to your provider.', shot: '04-vault-search.png', focus: '100% 32%', zoom: 2.4 },
  { file: 'post-4-chat-with-your-note.png', tag: 'AI assistant sidebar', title: 'Chat with the note you have open.', sub: 'Ask about it, attach images and PDFs, and search the rest of your vault with sources.', shot: '01-chat.png', focus: '100% 22%', zoom: 2.4 },
];

const story = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  body{width:1080px;height:1920px;position:relative}
  .in{position:absolute;inset:0;padding:200px 72px 180px;display:flex;flex-direction:column;align-items:center;text-align:center}
  h1{font-size:108px;margin:44px 0 28px}
  p.sub{font-size:40px;max-width:900px}
  .shot{width:1000px;margin-top:80px}
  .meta{margin-top:auto;font-size:34px;color:#4d4866}
  .meta .pill{font-size:34px;margin-bottom:26px}
</style></head><body><div class="bg"></div><div class="in">
  <div class="brand" style="font-size:44px"><span class="mark" style="width:92px;height:92px">${bird(56, '#6d4ed8')}</span>OWLA Butler</div>
  <h1>An AI assistant that asks before it writes.</h1>
  <p class="sub">For Obsidian. Runs on Codex, OpenCode, Claude Code or Hermes Agent.</p>
  <img class="shot" src="${asset('screenshots/02-review.png')}">
  <div class="meta"><div class="pill">${SITE}</div><div>Free · MIT · macOS and Windows</div></div>
</div></body></html>`;

// Reel background: the demo video is overlaid by ffmpeg in the empty band (y 620..1287).
const reelBg = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  body{width:1080px;height:1920px;position:relative}
  .in{position:absolute;inset:0;padding:190px 64px 170px;display:flex;flex-direction:column;align-items:center;text-align:center}
  h1{font-size:96px;margin:40px 0 0}
  .hole{position:absolute;left:0;top:620px;width:1080px;height:720px;background:#fff;box-shadow:0 30px 60px -20px rgba(60,40,140,.35)}
  .steps{position:absolute;top:1400px;left:0;right:0;font-size:40px;color:#4d4866;line-height:1.6}
  .meta{margin-top:auto;font-size:34px;color:#4d4866}
  .meta .pill{font-size:34px;margin-bottom:24px}
</style></head><body><div class="bg"></div><div class="hole"></div><div class="in">
  <div class="brand" style="font-size:42px"><span class="mark" style="width:86px;height:86px">${bird(52, '#6d4ed8')}</span>OWLA Butler</div>
  <h1>Review every edit.</h1>
  <div class="steps">Ask for a change → see it in your note → Accept</div>
  <div class="meta"><div class="pill">${SITE}</div><div>Free Obsidian plugin · macOS and Windows</div></div>
</div></body></html>`;

const og = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  body{width:1200px;height:630px;position:relative}
  .in{position:absolute;inset:0;display:grid;grid-template-columns:520px 1fr;gap:20px;padding:64px 0 64px 64px;align-items:center}
  h1{font-size:58px;margin:30px 0 20px}
  p.sub{font-size:24px}
  .shotwrap{height:500px;border-radius:18px 0 0 18px;overflow:hidden;border:1px solid #ddd6f3;border-right:0;box-shadow:0 30px 60px -20px rgba(60,40,140,.35);background:#fff}
  .shotwrap img{height:100%;width:auto;max-width:none}
</style></head><body><div class="bg"></div><div class="in">
  <div><div class="brand" style="font-size:30px"><span class="mark" style="width:60px;height:60px">${bird(36, '#6d4ed8')}</span>OWLA Butler</div>
  <h1>AI assistant for Obsidian that asks before it writes.</h1>
  <p class="sub">Runs on the Codex, OpenCode, Claude Code or Hermes Agent CLI you already have.</p></div>
  <div class="shotwrap"><img src="${asset('screenshots/02-review.png')}"></div>
</div></body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'owla-site-'));
const browser = await chromium.launch();
async function render(html, width, height, out) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const file = join(tmp, 'page.html');
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  await page.close();
  console.log('wrote', out.replace(root + '/', ''));
}
try {
  await render(og, 1200, 630, join(root, 'site/media/og-image.png'));
  for (const p of posts) await render(post(p), 1080, 1350, join(root, 'site/social', p.file));
  await render(story, 1080, 1920, join(root, 'site/social/story-review-every-edit.png'));
  const bg = join(tmp, 'reel-bg.png');
  await render(reelBg, 1080, 1920, bg);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', bg, '-i', join(root, 'assets/demo.gif'),
    '-filter_complex', '[1:v]scale=1080:720:flags=lanczos,fps=30[d];[0:v][d]overlay=0:620:shortest=1,format=yuv420p[v]',
    '-map', '[v]', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an',
    join(root, 'site/social/reel-demo.mp4')]);
  console.log('wrote site/social/reel-demo.mp4');
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
