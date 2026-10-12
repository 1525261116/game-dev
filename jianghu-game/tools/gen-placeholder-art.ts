/**
 * 占位美术生成器（placeholder art）
 *
 *   node tools/gen-placeholder-art.ts            # 只在缺图时生成（不动你画好的图）
 *   node tools/gen-placeholder-art.ts --force    # 强制覆盖（会覆盖！默认不覆盖）
 *   node tools/gen-placeholder-art.ts --only=chars
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个工具？
 *   骨架与贴图规范早就冻结了，但**贴图管线一行都没写**：assets/ 目录不存在，
 *   RigView 只会画色块，于是"换贴图"这件事在代码上无处可落。
 *
 *   本工具用程序生成一套**尺寸、枢轴、命名全部合规**的占位贴图，
 *   作用有三个：
 *     ① 管线端到端可验证：跑一次就能在游戏里看到 6 个角色长得不一样
 *     ② 给美术一份"照着替换"的模板：把同名的 PNG 换成手绘的即可，代码零改动
 *     ③ 把规范变成可执行的断言：生成物必然通过 `pnpm skin:gen` 的校验
 *
 *   ⚠️ 默认**不覆盖**已有文件 —— 你画的图不会被这个工具冲掉。
 *      要重新生成占位图才加 `--force`。
 * ══════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { RIGS } from '../src/data/rigs.ts';
import { ART_SCALE, WEAPON_GROUPS, WEAPON_QUALITY_SUFFIX } from '../src/core/anim/skin.ts';
import type { RigDef, SlotName } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const ASSETS = join(GAME_ROOT, 'assets');

/* ══════════════════ 基础形状（SVG path） ══════════════════ */

const INK = '#1c1c20';

/** 圆角矩形 */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${x + rr} ${y} H ${x + w - rr} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr} V ${y + h - rr}
          A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h} H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}
          V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`;
}

/** 上宽下窄（或反之）的梯形+圆角，用于躯干 */
function taper(cx: number, topY: number, botY: number, topW: number, botW: number, r = 4): string {
  const tw = topW / 2;
  const bw = botW / 2;
  return `M ${cx - tw + r} ${topY} H ${cx + tw - r} Q ${cx + tw} ${topY} ${cx + tw - 1} ${topY + r}
          L ${cx + bw} ${botY - r} Q ${cx + bw} ${botY} ${cx + bw - r} ${botY}
          H ${cx - bw + r} Q ${cx - bw} ${botY} ${cx - bw} ${botY - r}
          L ${cx - tw + 1} ${topY + r} Q ${cx - tw} ${topY} ${cx - tw + r} ${topY} Z`;
}

/** 胶囊（沿 y 轴的圆柱），用于四肢 */
function capsule(cx: number, y: number, h: number, w: number): string {
  const r = w / 2;
  return `M ${cx - r} ${y + r} A ${r} ${r} 0 0 1 ${cx + r} ${y + r} V ${y + h - r}
          A ${r} ${r} 0 0 1 ${cx - r} ${y + h - r} Z`;
}

/** 椭圆 */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
}

/* ══════════════════ 部件形状表 ══════════════════ */

/**
 * 每个 slot 的"剪影"。
 * 这里的形状**不追求好看**，只追求两件事：
 *   ① 尺寸/枢轴与骨架严丝合缝（所以能直接用真动作跑）
 *   ② 剪影可区分（一眼能看出是躯干/手臂/腿/头/武器）
 */
function slotPath(slot: SlotName, w: number, h: number): string {
  switch (slot) {
    case 'torso':
      // 枢轴在底（腰），向上延伸：肩宽 > 腰宽
      return taper(w / 2, h * 0.04, h, w * 0.94, w * 0.66, 5);
    case 'pelvis':
      return roundRect(0.5, h * 0.15, w - 1, h * 0.7, 4);
    case 'head':
      return ellipse(w / 2, h * 0.52, w * 0.44, h * 0.44);
    case 'cloak':
      return taper(w / 2, 0, h * 0.98, w * 0.5, w, 6);
    case 'upperArmL':
    case 'upperArmR':
    case 'forearmL':
    case 'forearmR':
      return capsule(w / 2, 0, h, w * 0.92);
    case 'thighL':
    case 'thighR':
      return capsule(w / 2, 0, h, w * 0.9);
    case 'shinL':
    case 'shinR':
      return capsule(w / 2, 0, h, w * 0.86);
    case 'handL':
      return ellipse(w / 2, h * 0.5, w * 0.4, h * 0.4);
    case 'handR':
      return ellipse(w / 2, h * 0.5, w * 0.42, h * 0.42);
    case 'footL':
    case 'footR':
      // 枢轴在 25% 处：鞋跟在后、鞋尖朝右
      return roundRect(w * 0.02, h * 0.18, w * 0.96, h * 0.64, h * 0.24);
    case 'weapon':
      return roundRect(w * 0.34, h * 0.02, w * 0.34, h * 0.96, 2);
    default:
      return roundRect(0, 0, w, h, 4);
  }
}

/** 生成单张部件贴图（中性色 + 墨边，便于用 palette 换色） */
function partSvg(slot: SlotName, w: number, h: number): string {
  const silhouette = slotPath(slot, w, h);
  const halo = slotPath(slot, w * 0.96, h * 0.98);
  const stroke = slot === 'weapon' ? 2 : 3;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0" stop-color="#f2efe8"/>
      <stop offset="0.55" stop-color="#dcd7cd"/>
      <stop offset="1" stop-color="#c3bdb2"/>
    </linearGradient>
  </defs>
  <g transform="translate(${w * 0.02} ${h * 0.01})">
    <path d="${halo}" fill="${INK}" opacity="0.26"/>
  </g>
  <path d="${silhouette}" fill="url(#g)" stroke="${INK}" stroke-opacity="0.72" stroke-width="${stroke}" stroke-linejoin="round"/>
</svg>`;
}

/* ══════════════════ 武器贴图（按组 × 品质共享） ══════════════════ */

function weaponSvg(group: string, quality: string, w: number, h: number): string {
  const tier = { fan: 0, li: 1, bao: 2, shen: 3, chuan: 4 }[quality] ?? 0;
  const blade = ['#cfd4da', '#d6dbe1', '#dde3ea', '#e6ecf3', '#f0f5fb'][tier]!;
  const guard = '#8a8578';
  const grip = '#4a4238';

  // 每种武器组一个可区分的剪影
  const shapes: Record<string, string> = {
    dao: `<path d="M ${w * 0.5} ${h * 0.1} L ${w * 0.72} ${h * 0.34} L ${w * 0.56} ${h * 0.86} L ${w * 0.44} ${h * 0.86} L ${w * 0.36} ${h * 0.34} Z" fill="${blade}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2" stroke-linejoin="round"/>`,
    jian: `<path d="M ${w * 0.5} ${h * 0.03} L ${w * 0.66} ${h * 0.3} L ${w * 0.56} ${h * 0.9} L ${w * 0.44} ${h * 0.9} L ${w * 0.34} ${h * 0.3} Z" fill="${blade}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2" stroke-linejoin="round"/>`,
    qiang: `<path d="M ${w * 0.5} ${h * 0.02} L ${w * 0.66} ${h * 0.2} L ${w * 0.55} ${h * 0.3} L ${w * 0.45} ${h * 0.3} L ${w * 0.34} ${h * 0.2} Z" fill="${blade}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2"/><rect x="${w * 0.44}" y="${h * 0.28}" width="${w * 0.12}" height="${h * 0.68}" fill="${grip}"/>`,
    anqi: `<path d="M ${w * 0.5} ${h * 0.16} L ${w * 0.78} ${h * 0.5} L ${w * 0.5} ${h * 0.84} L ${w * 0.22} ${h * 0.5} Z" fill="${blade}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2" stroke-linejoin="round"/>`,
    qimen: `<rect x="${w * 0.42}" y="${h * 0.14}" width="${w * 0.16}" height="${h * 0.74}" fill="${grip}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2"/><circle cx="${w * 0.5}" cy="${h * 0.1}" r="${w * 0.22}" fill="${blade}" stroke="${INK}" stroke-opacity="0.6" stroke-width="2"/>`,
  };

  const ornament =
    tier >= 2
      ? `<circle cx="${w * 0.5}" cy="${h * 0.34}" r="${1.5 + tier}" fill="#e8b23c" opacity="0.9"/>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="${w * 0.3}" y="${h * 0.82}" width="${w * 0.4}" height="${h * 0.14}" rx="2" fill="${grip}"/>
  <rect x="${w * 0.16}" y="${h * 0.3}" width="${w * 0.68}" height="${h * 0.045}" rx="2" fill="${guard}"/>
  ${shapes[group] ?? shapes.jian}
  ${ornament}
</svg>`;
}

/* ══════════════════ 战斗背景（3 层） ══════════════════ */

/** 山峦剪影层：用几条不同高度的墨笔叠出远近 */
function mountainBand(yBase: number, amp: number, count: number, color: string, opacity: number, seed: number): string {
  let d = `M -20 ${yBase}`;
  for (let i = 0; i < count; i++) {
    const x0 = -20 + (i * 1060) / count;
    const peakX = x0 + 1060 / count / 2;
    const peakY = yBase - amp * (0.5 + ((Math.sin(seed + i * 2.3) + 1) / 2) * 0.9);
    const x1 = x0 + 1060 / count;
    d += ` Q ${peakX - 40} ${peakY + amp * 0.35} ${peakX} ${peakY} Q ${peakX + 50} ${peakY + amp * 0.4} ${x1} ${yBase}`;
  }
  d += ` L 1060 ${yBase + 400} L -20 ${yBase + 400} Z`;
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

/**
 * 战斗背景三层。
 *
 * 坐标仍然按 **960×540 的设计空间**写（改动最小、构图不变），
 * 但导出的位图是 **1280×720**：靠 `viewBox` 让矢量几何等比放大 ——
 * 背景是矢量画的，放大不损失任何清晰度（这也是当初用 SVG 生成的原因之一）。
 * 分辨率口径见 `src/render/ui/layout.ts`。
 */
function backgroundSvgs(): Record<'far' | 'mid' | 'ground', string> {
  const W = 960;   // 设计空间（坐标用）
  const H = 540;
  const OW = 1280; // 导出尺寸（与游戏逻辑分辨率一致）
  const OH = 720;
  const SVGTAG = `<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}" viewBox="0 0 ${W} ${H}">`;

  const far = `${SVGTAG}
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9e3d3"/>
      <stop offset="0.55" stop-color="#efe9da"/>
      <stop offset="1" stop-color="#e3dccb"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.72" cy="0.24" r="0.36">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#sun)"/>
  ${mountainBand(330, 150, 4, '#a9b3b8', 0.5, 0.7)}
  ${mountainBand(360, 110, 5, '#9aa5ab', 0.42, 2.1)}
  <ellipse cx="300" cy="352" rx="360" ry="26" fill="#ffffff" opacity="0.45"/>
  <ellipse cx="720" cy="380" rx="300" ry="20" fill="#ffffff" opacity="0.35"/>
</svg>`;

  const mid = `${SVGTAG}
  ${mountainBand(400, 130, 6, '#6f7a80', 0.5, 4.4)}
  ${mountainBand(430, 90, 7, '#5b666c', 0.42, 7.9)}
  <g opacity="0.55" fill="#3f484d">
    <path d="M 120 300 L 150 258 L 180 300 Z"/>
    <rect x="142" y="300" width="16" height="30"/>
    <path d="M 96 300 L 150 240 L 204 300 Z" opacity="0.7"/>
    <rect x="112" y="330" width="76" height="6"/>
  </g>
  <ellipse cx="520" cy="424" rx="420" ry="24" fill="#ffffff" opacity="0.4"/>
</svg>`;

  const ground = `${SVGTAG}
  <defs>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cfc7b4"/>
      <stop offset="0.25" stop-color="#c4bba6"/>
      <stop offset="1" stop-color="#b3a992"/>
    </linearGradient>
  </defs>
  <rect y="392" width="${W}" height="${H - 392}" fill="url(#soil)"/>
  ${[0, 1, 2, 3, 4, 5, 6]
    .map((i) => {
      const y = 404 + i * 20;
      return `<path d="M ${18 + i * 6} ${y} C ${240} ${y - 5}, ${640} ${y + 6}, ${940 - i * 6} ${y - 2}"
                stroke="#8a8168" stroke-opacity="${0.16 - i * 0.015}" stroke-width="${3 - i * 0.25}" fill="none"/>`;
    })
    .join('\n  ')}
  ${[40, 150, 300, 470, 620, 760, 900]
    .map((x, i) => `<g opacity="${0.22 - (i % 3) * 0.05}"><path d="M ${x} 392 q -4 -22 2 -34" stroke="#6b7b5f" stroke-width="3" fill="none"/><path d="M ${x + 5} 392 q 8 -18 2 -30" stroke="#6b7b5f" stroke-width="2" fill="none"/></g>`)
    .join('\n  ')}
  <ellipse cx="480" cy="470" rx="520" ry="70" fill="#7d745f" opacity="0.12"/>
  <rect width="${W}" height="${H}" fill="#efe9da" opacity="0.06"/>
</svg>`;

  return { far, mid, ground };
}

/* ══════════════════ 角色皮肤配置（art + palette 复用） ══════════════════ */

/**
 * 三套"底图"：**每个体型一套，不是每个角色一套**（rig-spec §3）。
 *
 * 这条约束是校验器逼出来的：贴图画布必须等于该体型骨架盒的 2×，
 * 所以 `female_adult` 的角色**不能**复用 `male_adult` 的图（画布差几像素就报错）。
 * 正确做法是给每个体型准备一套底图，角色之间靠 `palette` 换色区分。
 */
const ART_SETS: { art: string; body: string; name: string }[] = [
  { art: 'base_male', body: 'male_adult', name: '底图·成年男' },
  { art: 'base_female', body: 'female_adult', name: '底图·成年女' },
  { art: 'base_burly', body: 'burly', name: '底图·魁梧' },
];

/**
 * 6 个演示角色。
 *
 * 关键设计：**只有三套真实贴图**（每个体型一套），
 * 6 个角色靠 `art` 复用 + `palette` 换色 —— 这正是 rig-spec §8
 * 「1 个弟子 = 10 分钟」的落地方式。
 */
/**
 * 一套"行头" → 逐 slot 换色表。
 *
 * 为什么要按整套定义而不是零散写几个 slot？
 *   占位贴图是**中性色**的，没被 palette 覆盖的部件会以中性灰显示 ——
 *   所以漏一个 slot（比如 pelvis、footL/R）在画面上就是"白色的屁股/白鞋"。
 *   这里一次性铺满全部部件，新增角色只需换 6 个颜色。
 */
interface Outfit {
  /** 袍子主色（躯干 + 右臂） */
  main: string;
  /** 袍子暗面（左臂，远侧手臂） */
  mainDark: string;
  /** 裤色 / 裤暗面 */
  pants: string;
  pantsDark: string;
  /** 肤色（头 + 双手） */
  skin: string;
  /** 鞋色 */
  boots: string;
  /** 披风（可选） */
  cloak?: string;
}

function paletteOf(o: Outfit): Record<string, string> {
  const p: Record<string, string> = {
    torso: o.main,
    upperArmR: o.main,
    forearmR: o.main,
    handR: o.skin,
    upperArmL: o.mainDark,
    forearmL: o.mainDark,
    handL: o.skin,
    pelvis: o.pantsDark,
    thighR: o.pants,
    shinR: o.pants,
    footR: o.boots,
    thighL: o.pantsDark,
    shinL: o.pantsDark,
    footL: o.boots,
    head: o.skin,
  };
  if (o.cloak) p.cloak = o.cloak;
  return p;
}

const DEMO_CHARS: { id: string; name: string; body: string; art: string; palette: Record<string, string>; weaponGroup?: string }[] = [
  {
    id: 'ren_dao',
    name: '刀客',
    body: 'burly',
    art: 'base_burly',
    palette: paletteOf({ main: '#8c3b34', mainDark: '#7b332d', pants: '#3a3f4a', pantsDark: '#32363f', skin: '#e8d9c5', boots: '#2b2f36', cloak: '#2f4f4a' }),
    weaponGroup: 'dao',
  },
  {
    id: 'ren_jian',
    name: '剑客',
    body: 'male_adult',
    art: 'base_male',
    palette: paletteOf({ main: '#2f5d4a', mainDark: '#27503f', pants: '#2b3138', pantsDark: '#242a30', skin: '#e8d9c5', boots: '#1f2429', cloak: '#3c5f7a' }),
    weaponGroup: 'jian',
  },
  {
    id: 'ren_quan',
    name: '拳师',
    body: 'male_adult',
    art: 'base_male',
    palette: paletteOf({ main: '#a8863f', mainDark: '#967636', pants: '#4a4436', pantsDark: '#3f3a2e', skin: '#e8d9c5', boots: '#332f26' }),
  },
  {
    id: 'ren_qiang',
    name: '枪手',
    body: 'male_adult',
    art: 'base_male',
    palette: paletteOf({ main: '#5d4a33', mainDark: '#4f3f2c', pants: '#42403a', pantsDark: '#38362f', skin: '#e0d0b8', boots: '#2e2c27', cloak: '#6b5a3f' }),
    weaponGroup: 'qiang',
  },
  {
    id: 'ren_anqi',
    name: '暗器手',
    body: 'female_adult',
    art: 'base_female',
    palette: paletteOf({ main: '#3d3a4d', mainDark: '#332f42', pants: '#2d2a38', pantsDark: '#26232f', skin: '#eadfcb', boots: '#1e1c26', cloak: '#4a4258' }),
    weaponGroup: 'anqi',
  },
  {
    id: 'ren_qimen',
    name: '奇门客',
    body: 'male_adult',
    art: 'base_male',
    palette: paletteOf({ main: '#5a3f63', mainDark: '#4d3556', pants: '#3b3346', pantsDark: '#332c3d', skin: '#e8d9c5', boots: '#26212e', cloak: '#3f4f5e' }),
    weaponGroup: 'qimen',
  },
];

/* ══════════════════ 生成 ══════════════════ */

const force = process.argv.includes('--force');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

let created = 0;
let skipped = 0;

async function writePng(path: string, svg: string): Promise<void> {
  if (!force && existsSync(path)) {
    skipped++;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path);
  created++;
  console.log(`  + ${path.replace(`${GAME_ROOT}/`, '')}`);
}

async function genChars(): Promise<void> {
  for (const set of ART_SETS) {
    const rig: RigDef = RIGS[set.body]!;
    console.log(`\n── 部件贴图：${set.art}（体型 ${set.body}，@${ART_SCALE}×）`);
    for (const bone of rig.bones) {
      const w = Math.round(bone.w * ART_SCALE);
      const h = Math.round(bone.h * ART_SCALE);
      await writePng(join(ASSETS, 'chars', set.art, 'parts', `${bone.slot}.png`), partSvg(bone.slot, w, h));
    }
    // 底图自己也要一份 skin.json 存根，声明 body —— 否则 gen-skin 会按默认体型校验而误报
    const stubPath = join(ASSETS, 'chars', set.art, 'skin.json');
    if (force || !existsSync(stubPath)) {
      mkdirSync(dirname(stubPath), { recursive: true });
      writeFileSync(
        stubPath,
        `${JSON.stringify({ id: set.art, name: set.name, body: set.body, parts: {} }, null, 2)}\n`,
        'utf8',
      );
      created++;
      console.log(`  + assets/chars/${set.art}/skin.json（body=${set.body}）`);
    }
  }

  console.log('\n── 角色皮肤（复用两套贴图 + 换色）');
  for (const c of DEMO_CHARS) {
    const path = join(ASSETS, 'chars', c.id, 'skin.json');
    if (!force && existsSync(path)) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    // 只写"人维护"的字段；parts 由 pnpm skin:gen 填
    const authoring = {
      id: c.id,
      name: c.name,
      body: c.body,
      art: c.art,
      palette: c.palette,
      ...(c.weaponGroup ? { weaponGroup: c.weaponGroup } : {}),
      parts: {},
    };
    writeFileSync(path, `${JSON.stringify(authoring, null, 2)}\n`, 'utf8');
    created++;
    console.log(`  + assets/chars/${c.id}/skin.json（art=${c.art}）`);
  }
}

async function genWeapons(): Promise<void> {
  const rig = RIGS['male_adult']!;
  const bone = rig.bones.find((b) => b.slot === 'weapon')!;
  const w = Math.round(bone.w * ART_SCALE);
  const h = Math.round(bone.h * ART_SCALE);
  console.log(`\n── 武器贴图（${WEAPON_GROUPS.length} 组 × 5 品质 = ${WEAPON_GROUPS.length * 5} 张，${w}×${h}）`);
  for (const g of WEAPON_GROUPS) {
    for (const [q, suffix] of Object.entries(WEAPON_QUALITY_SUFFIX)) {
      await writePng(join(ASSETS, 'weapons', g, `${g}_${suffix}.png`), weaponSvg(g, q, w, h));
    }
  }
}

async function genBackgrounds(): Promise<void> {
  console.log('\n── 战斗背景（3 层：远山 / 中景 / 地面）');
  const svgs = backgroundSvgs();
  for (const [name, svg] of Object.entries(svgs)) {
    await writePng(join(ASSETS, 'bg', 'battle', `${name}.png`), svg);
  }
}

async function main(): Promise<void> {
  console.log('=== 占位美术生成 ===');
  console.log(`输出目录：${ASSETS.replace(`${GAME_ROOT}/`, '')}/`);
  console.log(force ? '模式：--force（会覆盖已有文件）' : '模式：仅在缺图时生成（不覆盖你画好的图）');

  if (!only || only === 'chars') await genChars();
  if (!only || only === 'weapons') await genWeapons();
  if (!only || only === 'bg') await genBackgrounds();

  console.log('');
  console.log(`完成：新建 ${created} 个文件，跳过 ${skipped} 个已存在的文件。`);
  console.log('');
  console.log('下一步：');
  console.log('  1) node tools/gen-skin.ts        生成/校验 skin.json');
  console.log('  2) pnpm dev                      刷新浏览器看效果');
  console.log('  3) 用你画的 PNG 覆盖 assets/chars/<角色>/parts/<slot>.png（文件名不要改）');
}

void main();
