/**
 * 骨架预览生成器（无需任何依赖即可运行）
 *
 *   node tools/preview/make-preview.ts
 *
 * 产出：preview/rig-preview.html
 *   - 上半部分：全部动作的「接触表」（每动作 5 帧并排），用于无头截图验收
 *   - 下半部分：可实时播放的动画（浏览器打开即可看动起来的效果）
 *   - 同时向 stdout 打印校验数据（动作幅度、挂点轨迹、事件时刻）
 *
 * 这是「占位色块验证」环节：美术贴图尚未介入，先用色块确认骨骼与动作数据正确。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleClip } from '../../src/core/anim/clip.ts';
import { getRig, RIGS, BODY_TYPE_IDS } from '../../src/data/rigs.ts';
import { validateClip } from '../../src/core/anim/validate.ts';
import { loadJsonDir } from '../load-json.ts';
import type { MotionClip, SolvedPose } from '../../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MOTION_DIR = join(ROOT, 'src', 'data', 'motions');
const OUT_DIR = join(ROOT, 'preview');

const RIG_ID = 'male_adult';
const LIVE_FRAMES = 40; // 实时播放用的采样帧数

const clips = loadJsonDir<MotionClip>(MOTION_DIR);
const clipList = Object.values(clips);
const rig = getRig(RIG_ID);

/** 采样一个 clip 的 N 帧 */
function sampleFrames(clip: MotionClip, n: number): { t: number; pose: SolvedPose }[] {
  const out: { t: number; pose: SolvedPose }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (clip.duration * i) / (n - 1);
    out.push({ t, pose: sampleClip(clip, rig, t) });
  }
  return out;
}

const bundle = clipList.map((clip) => {
  const live = sampleFrames(clip, LIVE_FRAMES);
  // 接触表取 5 帧
  const idx = [0, 0.25, 0.5, 0.75, 1].map((u) => Math.round(u * (LIVE_FRAMES - 1)));
  return {
    id: clip.id,
    group: clip.group,
    duration: clip.duration,
    loop: clip.loop,
    priority: clip.priority,
    contactIndices: idx,
    frames: live.map((f) => ({
      t: Math.round(f.t),
      bones: f.pose.bones.map((b) => ({
        s: b.slot,
        x: +b.wx.toFixed(2),
        y: +b.wy.toFixed(2),
        r: +b.wrot.toFixed(4),
        sx: +b.wsx.toFixed(3),
        sy: +b.wsy.toFixed(3),
        w: b.w,
        h: b.h,
        px: b.pivot?.x ?? 0.5,
        py: b.pivot?.y ?? 0.5,
        c: b.color,
        ink: b.ink !== false,
      })),
      anchors: Object.fromEntries(
        Object.entries(f.pose.anchors).map(([k, v]) => [k, { x: +v!.x.toFixed(2), y: +v!.y.toFixed(2) }]),
      ),
    })),
  };
});

/* --------------------------------------------------- 校验数据（stdout 证据） */

console.log('=== 骨架预览生成报告 ===');
console.log(`体型: ${BODY_TYPE_IDS.map((id) => `${id}(${RIGS[id]!.height}px)`).join(' / ')}`);
console.log(`使用体型: ${RIG_ID} 身高 ${rig.height}px, 骨骼数 ${rig.bones.length}, slot 数 ${new Set(rig.bones.map((b) => b.slot)).size}`);
console.log('');
for (const clip of clipList) {
  const issues = validateClip(clip);
  const errs = issues.filter((i) => i.level === 'error');
  const tips = [0, 0.25, 0.5, 0.75, 1].map((u) => sampleClip(clip, rig, clip.duration * u).anchors.weaponTip);
  const valid = tips.filter(Boolean) as { x: number; y: number }[];
  let travel = 0;
  for (let i = 1; i < valid.length; i++) {
    travel += Math.hypot(valid[i]!.x - valid[i - 1]!.x, valid[i]!.y - valid[i - 1]!.y);
  }
  const hitEv = clip.events.find((e) => e.type === 'hit');
  console.log(
    `· ${clip.id.padEnd(12)} ${String(clip.duration).padStart(4)}ms ${clip.loop ? '循环' : '单次'} ` +
      `优先级${clip.priority} 轨道${clip.tracks.length} 挂点${Object.keys(clip.anchors).length} ` +
      `武器尖端轨迹${travel.toFixed(0)}px ` +
      (hitEv ? `命中点${(hitEv.t * clip.duration).toFixed(0)}ms ` : '') +
      `校验:${errs.length === 0 ? '通过' : errs.map((e) => e.code).join(',')}`,
  );
}
console.log('');

/* --------------------------------------------------- 生成 HTML */

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>江湖从心 · 骨架预览（占位色块）</title>
<style>
  :root { --ink:#1f1f1f; --paper:#f4f1e8; --gold:#8c6b2f; --red:#a62b1f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:14px 20px 6px; }
  h1 { font-size:18px; margin:0 0 4px; color:var(--gold); letter-spacing:1px; }
  .sub { font-size:12px; color:#6b6b6b; }
  .wrap { padding:0 20px 24px; }
  canvas { display:block; background:#efe9da; border:1px solid #d8d0bb; border-radius:4px; }
  .live { margin-top:16px; display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
  .ctl { font-size:12px; line-height:2; }
  select,button { font:inherit; font-size:12px; padding:2px 8px; }
  .legend { font-size:11px; color:#6b6b6b; margin-top:8px; }
</style>
</head>
<body>
<header>
  <h1>江湖从心 · 骨架与动作预览（占位色块 · 方案 C）</h1>
  <div class="sub">骨架：${RIG_ID}（${rig.height}px，${rig.bones.length} 骨骼）｜动作 ${clipList.length} 个｜生成器：tools/preview/make-preview.ts</div>
</header>
<div class="wrap">
  <canvas id="sheet"></canvas>
  <div class="legend">上图：每个动作取 5 帧的「接触表」。深色描边 = 剪纸/皮影墨迹边。小圆点 = 打击挂点（weaponTip / hitPoint）。</div>

  <div class="live">
    <canvas id="live" width="360" height="300"></canvas>
    <div class="ctl">
      <div>动作：<select id="sel"></select></div>
      <div>速度：<select id="spd">
        <option value="0.15">0.15×</option>
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
      </select></div>
      <div><button id="play">暂停</button> <button id="step">单帧 +</button></div>
      <div id="hud" style="color:#6b6b6b"></div>
    </div>
  </div>
</div>
<script>
const DATA = ${JSON.stringify(bundle)};

function drawBone(ctx, b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.r);
  ctx.scale(b.sx, b.sy);
  const x = -b.px * b.w;
  const y = -b.py * b.h;
  ctx.fillStyle = b.c;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, b.w, b.h, Math.min(6, b.w * 0.25));
  else ctx.rect(x, y, b.w, b.h);
  ctx.fill();
  if (b.ink) { ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(24,24,28,0.72)'; ctx.stroke(); }
  ctx.restore();
}

function drawPose(ctx, frame, opts) {
  // 地面
  ctx.save();
  ctx.strokeStyle = 'rgba(90,80,60,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-140, 70); ctx.lineTo(160, 70); ctx.stroke();
  ctx.restore();

  const order = ['cloak','thighL','shinL','footL','thighR','shinR','footR',
                 'upperArmL','forearmL','handL','pelvis','torso',
                 'upperArmR','forearmR','handR','head','weapon'];
  const map = Object.fromEntries(frame.bones.map(b => [b.s, b]));
  for (const s of order) { const b = map[s]; if (b) drawBone(ctx, b); }

  if (!opts || !opts.hideAnchors) {
    for (const [name, a] of Object.entries(frame.anchors)) {
      const strike = name === 'weaponTip' || name === 'palm' || name === 'throwPoint' || name === 'hitPoint';
      ctx.save();
      ctx.beginPath();
      ctx.arc(a.x, a.y, strike ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = strike ? '#a62b1f' : 'rgba(140,107,47,0.55)';
      ctx.fill();
      if (strike) {
        ctx.strokeStyle = 'rgba(166,43,31,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------- 接触表 ---------- */
const COLS = 5, PW = 200, PH = 214, HEAD = 34;
const sheet = document.getElementById('sheet');
sheet.width = COLS * PW + 2;
sheet.height = HEAD + DATA.length * PH + 8;
const sctx = sheet.getContext('2d');
sctx.fillStyle = '#efe9da';
sctx.fillRect(0, 0, sheet.width, sheet.height);
sctx.font = '13px "PingFang SC",sans-serif';
sctx.fillStyle = '#8c6b2f';
sctx.fillText('动作接触表（每动作 5 帧）', 10, 21);

DATA.forEach((clip, row) => {
  const top = HEAD + row * PH;
  sctx.save();
  sctx.strokeStyle = 'rgba(140,107,47,0.18)';
  sctx.beginPath(); sctx.moveTo(0, top); sctx.lineTo(sheet.width, top); sctx.stroke();
  sctx.restore();
  clip.contactIndices.forEach((fi, col) => {
    const ox = col * PW + 4;
    const frame = clip.frames[fi];
    sctx.save();
    sctx.beginPath(); sctx.rect(ox, top + 2, PW - 8, PH - 8); sctx.clip();
    sctx.translate(ox + PW * 0.42, top + PH * 0.66);
    sctx.scale(0.86, 0.86);
    drawPose(sctx, frame);
    sctx.restore();
    sctx.font = '10px monospace';
    sctx.fillStyle = '#7a7466';
    sctx.fillText(\`t=\${frame.t}ms\`, ox + 8, top + 14);
  });
  sctx.font = '12px "PingFang SC",sans-serif';
  sctx.fillStyle = '#3b3b3b';
  sctx.fillText(\`\${clip.id}  ·  \${clip.duration}ms  ·  \${clip.loop ? '循环' : '单次'}  ·  \${clip.group}\`, 10, top + PH - 4);
});

/* ---------- 实时播放 ---------- */
const live = document.getElementById('live');
const lctx = live.getContext('2d');
const sel = document.getElementById('sel');
DATA.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c.id; sel.appendChild(o); });
let cur = 0, idx = 0, playing = true, speed = 1, last = 0;

function drawLive() {
  const clip = DATA[cur];
  const f = clip.frames[idx];
  lctx.clearRect(0, 0, live.width, live.height);
  lctx.fillStyle = '#efe9da'; lctx.fillRect(0, 0, live.width, live.height);
  lctx.save();
  lctx.translate(live.width * 0.44, live.height * 0.72);
  lctx.scale(1.35, 1.35);
  drawPose(lctx, f);
  lctx.restore();
  lctx.font = '11px monospace'; lctx.fillStyle = '#6b6b6b';
  lctx.fillText(\`\${clip.id}  \${f.t}/\${clip.duration}ms  frame \${idx + 1}/\${clip.frames.length}\`, 8, 14);
  document.getElementById('hud').textContent = \`\${clip.frames.length} 帧 · 速度 \${speed}×\`;
}

function loop(ts) {
  if (playing && last) {
    const dt = (ts - last) * speed;
    const clip = DATA[cur];
    const per = clip.duration / (clip.frames.length - 1);
    idx += dt / per;
    if (idx >= clip.frames.length - 1) {
      if (clip.loop) idx = idx % (clip.frames.length - 1);
      else { idx = clip.frames.length - 1; playing = false; document.getElementById('play').textContent = '播放'; }
    }
    drawLive();
  }
  last = ts;
  requestAnimationFrame(loop);
}
sel.onchange = () => { cur = +sel.value; idx = 0; playing = true; document.getElementById('play').textContent = '暂停'; drawLive(); };
document.getElementById('spd').onchange = (e) => { speed = +e.target.value; drawLive(); };
document.getElementById('play').onclick = (e) => { playing = !playing; e.target.textContent = playing ? '暂停' : '播放'; if (playing && idx >= DATA[cur].frames.length - 1) idx = 0; };
document.getElementById('step').onclick = () => { playing = false; document.getElementById('play').textContent = '播放'; idx = Math.min(idx + 1, DATA[cur].frames.length - 1); drawLive(); };
drawLive();
requestAnimationFrame(loop);
document.title = 'READY ' + DATA.length;
</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, 'rig-preview.html');
writeFileSync(outPath, html, 'utf8');
console.log(`[ok] ${outPath}  (${(html.length / 1024).toFixed(1)} KB)`);
