/**
 * 生图工具（art generator）—— 调火山方舟 Ark 的 Seedream 出角色部件原图
 *
 *   export ARK_API_KEY=ark-xxxxxxxx        # 密钥只从环境变量读，绝不写进仓库
 *   pnpm art:gen --dry                     # 只打印将要发送的提示语（不花钱）
 *   pnpm art:gen                           # 生成缺失的图
 *   pnpm art:gen --only=torso,head         # 只生成指定部件
 *   pnpm art:gen --force                   # 连已存在的也重生成
 *   pnpm art:gen --size=1024x2048          # 覆盖出图尺寸
 *
 * ══════════════════════════════════════════════════════════════════
 * 它在管线里的位置：
 *   ① 本工具：提示语 → **原始图**（assets/chars/<角色>/raw/<slot>.png）
 *   ② 用户确认原始图
 *   ③ `pnpm skin:fit assets/chars/<角色>/raw --char=<角色>` → 抠底/裁边/对位 → parts/
 *   ④ `pnpm skin:gen` → 校验 + skin.json → 刷新浏览器
 *
 * 为什么原始图不直接放 parts/？
 *   因为 AI 出图尺寸随机、带背景、关节位置不对 —— 必须先经 ③ 对位。
 *   raw/ 是"待对位"的中转目录，已在 .gitignore 里排除（过程产物，不进仓库）。
 * ══════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const ASSETS = join(GAME_ROOT, 'assets');
const PROMPTS_FILE = join(GAME_ROOT, 'data', 'art-prompts.json');

const API_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/* ══════════════════ 提示语配置 ══════════════════ */

export interface PromptConfig {
  charId: string;
  name?: string;
  body: string;
  /** 武器组：写进 skin.json，决定用哪一套共享武器贴图（不填则跟随所在单位的武器组） */
  weaponGroup?: string;
  model: string;
  /** 默认出图尺寸（WxH 或 1K/2K 预设；实测面积上限 4,624,220 px，2048×2048 已接近上限） */
  size: string;
  /**
   * 参考图（图生图）：本地文件路径或 http(s) URL。
   *
   * 实测收益：① 同一套衣服的各个部件不再各画各的（风格/配色一致）
   *          ② 画面更干净（"纯白背景"拦不住的背景墨点飞溅也消失了）
   *          ③ 细节更好（织物纹理、褶皱体积感）
   * 本地文件会转成 base64 data URI 直接发（已验证该模型接受 data URI，无需公网 URL）。
   */
  reference?: string;
  /** 随机种子（可复现；不填则每次不同） */
  seed?: number;
  /**
   * 按部件覆盖出图尺寸。
   *
   * ⚠️ 这条是实测逼出来的：**画布比例会决定模型怎么摆部件**。
   *   给 2496×1664（横）它就把袖子画成横的；给 1584×2816（竖）才画成竖的。
   *   而 cutout 管线要求四肢"像平铺在桌面上"、主轴竖直 —— 所以四肢必须给竖构图。
   */
  sizes?: Record<string, string>;
  /** true 会带上平台的"AI 生成"水印 —— 部件贴图必须为 false */
  watermark?: boolean;
  stylePrefix: string;
  styleSuffix: string;
  /** slot（或任意名字）→ 该图的描述；组合成 prefix + [描述] + suffix */
  parts: Record<string, string>;
  /** 非部件素材（全身立绘等），存到 raw/_extras/ */
  extras?: Record<string, string>;
}

/**
 * 把风格前后缀与单件描述组装成最终提示语。
 *
 * ⚠️ `extras`（全身立绘等）走 `verbatim`：它们的描述本身已是完整提示语，
 * 套上"不要出现完整人物"这类**部件专用**后缀会自相矛盾。
 */
export function composePrompt(cfg: PromptConfig, subject: string, verbatim = false): string {
  return verbatim ? subject : `${cfg.stylePrefix}${subject}${cfg.styleSuffix}`;
}

/* ══════════════════ API ══════════════════ */

interface ArkResult {
  ok: boolean;
  url?: string;
  /** 失败时的可读原因 */
  reason?: string;
  /** 需要用户去控制台处理时的动作提示 */
  action?: string;
  code?: string;
}

/** 把 Ark 的错误码翻译成"人该做什么" */
function explainError(code: string, message: string): { reason: string; action?: string } {
  if (code === 'SetLimitExceeded') {
    return {
      reason: message,
      action:
        '账号的「安全体验模式」额度已用尽，模型服务被暂停。请到火山方舟控制台 → 模型开通/管理页，' +
        '关闭「安全体验模式」或开通按量付费，然后重跑本命令。',
    };
  }
  if (code === 'AuthenticationError' || code === 'Unauthorized') {
    return { reason: message, action: 'ARK_API_KEY 无效或已过期，请重新生成密钥。' };
  }
  if (code === 'InvalidEndpointOrModel.NotFound') {
    return { reason: message, action: '模型 id 不对或账号未开通该模型；用 --model= 指定已开通的模型。' };
  }
  if (code === 'InvalidParameter') {
    return { reason: message, action: '参数不合法（常见是 size 取值不被该模型支持），试试 --size=2K。' };
  }
  return { reason: message };
}

async function callArk(apiKey: string, body: Record<string, unknown>): Promise<ArkResult> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    return { ok: false, reason: `网络请求失败：${(e as Error).message}` };
  }

  const text = await res.text();
  let json: { data?: { url?: string; b64_json?: string }[]; error?: { code?: string; message?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` };
  }

  if (!res.ok || json.error) {
    const code = json.error?.code ?? `HTTP_${res.status}`;
    const { reason, action } = explainError(code, json.error?.message ?? text.slice(0, 200));
    return { ok: false, code, reason, ...(action ? { action } : {}) };
  }

  const first = json.data?.[0];
  if (!first?.url) {
    return { ok: false, reason: `响应里没有图片 URL：${text.slice(0, 200)}` };
  }
  return { ok: true, url: first.url };
}

/**
 * 下载并**统一转成 PNG**（Ark 返回的 URL 是临时的，必须立刻落盘）。
 *
 * ⚠️ 实测：Seedream 返回的是 **JPEG**（2048×2048），即便我们要的是 .png 文件名。
 *    JPEG 没有透明通道、且有压缩噪点，直接改名会让下游的抠底与锐利边缘变差，
 *    所以这里立刻用 sharp 转成真 PNG。
 */
async function download(url: string, outPath: string): Promise<{ bytes: number; from: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(buf).metadata();
  const png = await sharp(buf).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(outPath, png);
  return { bytes: png.length, from: `${meta.format?.toUpperCase() ?? '?'} ${meta.width}×${meta.height}` };
}

/* ══════════════════ 审图用的接触表 ══════════════════ */

/**
 * 把生成结果拼成一张接触表，方便一眼确认。
 * 用 sharp 直接拼（不依赖任何图像工具），每格带文件名标签。
 */
async function contactSheet(rawDir: string, outPath: string): Promise<number> {
  const files = readdirSync(rawDir)
    .filter((f) => extname(f).toLowerCase() === '.png' && !f.startsWith('_'))
    .sort();
  if (files.length === 0) return 0;

  const COLS = 4;
  const CELL = 320;
  const PAD = 18;
  const rows = Math.ceil(files.length / COLS);
  const W = COLS * CELL + (COLS + 1) * PAD;
  const H = rows * (CELL + 22) + (rows + 1) * PAD;

  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const thumb = await sharp(join(rawDir, file))
      .resize(CELL, CELL, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();
    const meta = await sharp(thumb).metadata();
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CELL + PAD) + Math.round((CELL - (meta.width ?? CELL)) / 2);
    const y = PAD + row * (CELL + 22 + PAD);
    composites.push({ input: thumb, left: x, top: y });

    const slot = file.replace(/\.png$/, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="20">
      <text x="0" y="14" font-family="Menlo, monospace" font-size="13" fill="#1c1c20">${slot}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: PAD + col * (CELL + PAD), top: y + CELL + 2 });
  }

  const canvas = sharp({
    create: { width: W, height: H, channels: 4, background: { r: 244, g: 241, b: 233, alpha: 1 } },
  });
  await canvas.composite(composites).png({ compressionLevel: 9 }).toFile(outPath);
  return files.length;
}

/* ══════════════════ CLI ══════════════════ */

interface Cli {
  dry: boolean;
  force: boolean;
  only: string[] | null;
  char: string | null;
  /** 覆盖原始图输出目录（用于 A/B 对比两版提示语，互不覆盖） */
  out: string | null;
  /** 覆盖参考图（传 none 可关掉配置里的参考图） */
  ref: string | null;
  model: string | null;
  size: string | null;
  delayMs: number;
}

function parseCli(argv: string[]): Cli {
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return {
    dry: argv.includes('--dry'),
    force: argv.includes('--force'),
    only: flag('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    char: flag('char') ?? null,
    out: flag('out') ?? null,
    ref: flag('ref') ?? null,
    model: flag('model') ?? null,
    size: flag('size') ?? null,
    delayMs: Number(flag('delay') ?? 1200),
  };
}

/**
 * 把参考图变成 API 能吃的形式：
 *   · http(s) URL → 原样传
 *   · 本地文件    → 读出来转 base64 data URI（实测该模型接受）
 */
export function toImageRef(ref: string): { value: string; note: string } {
  if (/^https?:\/\//.test(ref)) return { value: ref, note: 'URL' };
  const abs = resolvePath(ref);
  if (!existsSync(abs)) throw new Error(`参考图不存在：${ref}`);
  const ext = abs.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const b64 = readFileSync(abs).toString('base64');
  const kb = Math.round(statSync(abs).size / 1024);
  return { value: `data:${mime};base64,${b64}`, note: `本地文件 ${kb}KB → base64` };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  if (!existsSync(PROMPTS_FILE)) {
    console.error(`找不到提示语配置：${PROMPTS_FILE}`);
    process.exitCode = 1;
    return;
  }
  const cfg = JSON.parse(readFileSync(PROMPTS_FILE, 'utf8')) as PromptConfig;
  const charId = cli.char ?? cfg.charId;
  const model = cli.model ?? cfg.model;
  const defaultSize = cli.size ?? cfg.size;
  const refSpec = cli.ref === 'none' ? undefined : (cli.ref ?? cfg.reference);
  const ref = refSpec ? toImageRef(refSpec) : null;

  const rawDir = cli.out
    ? join(GAME_ROOT, cli.out)
    : join(ASSETS, 'chars', charId, 'raw');
  const extrasDir = join(rawDir, '_extras');

  // 组装任务清单：parts 进 raw/，extras 进 raw/_extras/
  const jobs: { name: string; prompt: string; size: string; outPath: string }[] = [];
  for (const [slot, subject] of Object.entries(cfg.parts)) {
    if (cli.only && !cli.only.includes(slot)) continue;
    jobs.push({
      name: slot,
      prompt: composePrompt(cfg, subject),
      size: cfg.sizes?.[slot] ?? defaultSize,
      outPath: join(rawDir, `${slot}.png`),
    });
  }
  for (const [name, subject] of Object.entries(cfg.extras ?? {})) {
    if (cli.only && !cli.only.includes(name)) continue;
    jobs.push({
      name,
      prompt: composePrompt(cfg, subject, true),
      size: cfg.sizes?.[name] ?? defaultSize,
      outPath: join(extrasDir, `${name}.png`),
    });
  }

  console.log('=== 生图（火山方舟 · Seedream）===');
  const usedSizes = new Set(jobs.map((j) => j.size));
  console.log(
    `角色 ${charId}　体型 ${cfg.body}　模型 ${model}　尺寸 ${[...usedSizes].join(' / ')}　水印 ${cfg.watermark === true ? '开（部件贴图建议关）' : '关'}`,
  );
  console.log(`输出目录 ${rawDir.replace(`${GAME_ROOT}/`, '')}/`);
  if (ref) console.log(`参考图：${ref.note}${refSpec && /^https?:/.test(refSpec) ? `（${refSpec.slice(0, 60)}…）` : ''}`);
  console.log(`任务 ${jobs.length} 张${cli.only ? `（--only=${cli.only.join(',')}）` : ''}`);

  if (cli.dry) {
    console.log('');
    console.log('── --dry：以下是将要发送的请求（不调用 API、不花钱）──');
    for (const j of jobs) {
      console.log('');
      console.log(`【${j.name}】${j.size} → ${j.outPath.replace(`${GAME_ROOT}/`, '')}`);
      console.log(j.prompt);
    }
    console.log('');
    console.log(`共 ${jobs.length} 条。去掉 --dry 即开始生成。`);
    return;
  }

  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    console.error('');
    console.error('缺少环境变量 ARK_API_KEY。用法：');
    console.error('  export ARK_API_KEY=ark-xxxx        # 密钥只从环境变量读，不要写进文件');
    console.error('  pnpm art:gen');
    process.exitCode = 1;
    return;
  }

  mkdirSync(rawDir, { recursive: true });
  mkdirSync(extrasDir, { recursive: true });

  let ok = 0;
  let failed = 0;
  const actions = new Set<string>();

  for (const job of jobs) {
    if (!cli.force && existsSync(job.outPath)) {
      console.log(`  · ${job.name}：已存在，跳过（--force 可重生成）`);
      continue;
    }
    process.stdout.write(`  · ${job.name} … `);
    const t0 = Date.now();
    const r = await callArk(apiKey, {
      model,
      prompt: job.prompt,
      response_format: 'url',
      size: job.size,
      stream: false,
      watermark: cfg.watermark === true,
      ...(ref ? { image: ref.value } : {}),
      ...(cfg.seed !== undefined ? { seed: cfg.seed } : {}),
    });

    if (!r.ok) {
      failed++;
      console.log(`✗ ${r.code ?? '失败'}`);
      console.log(`      ${r.reason}`);
      if (r.action) {
        console.log(`      → ${r.action}`);
        actions.add(r.action);
      }
      // 配额类错误连续出现时没必要继续打 —— 直接收工，省得刷一屏
      if (r.code === 'SetLimitExceeded') {
        console.log('');
        console.log('配额已暂停，后续任务跳过。处理完账号设置后重跑本命令即可（已生成的不会重复扣费）。');
        break;
      }
      continue;
    }

    try {
      const dl = await download(r.url!, job.outPath);
      ok++;
      console.log(`✓ ${(dl.bytes / 1024).toFixed(0)} KB　${dl.from} → PNG　${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      failed++;
      console.log(`✗ 下载失败：${(e as Error).message}`);
    }
    await new Promise((r2) => setTimeout(r2, cli.delayMs));
  }

  console.log('');
  console.log(`完成：成功 ${ok} 张，失败 ${failed} 张。`);

  if (ok > 0) {
    const sheet = join(rawDir, '_contact-sheet.png');
    const n = await contactSheet(rawDir, sheet);
    console.log(`已生成审图接触表（${n} 张）：${sheet.replace(`${GAME_ROOT}/`, '')}`);
    // 顺手写一份"试穿用"的皮肤声明（已存在则不动）
    const skinPath = join(ASSETS, 'chars', charId, 'skin.json');
    if (cli.out) {
      console.log('（--out 模式：不改动 skin.json）');
    } else if (!existsSync(skinPath)) {
      mkdirSync(dirname(skinPath), { recursive: true });
      writeFileSync(
        skinPath,
        `${JSON.stringify(
          {
            id: charId,
            name: cfg.name ?? charId,
            body: cfg.body,
            art: 'base_male',
            ...(cfg.weaponGroup ? { weaponGroup: cfg.weaponGroup } : {}),
            palette: {},
            parts: {},
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      console.log(`已写试穿声明：${skinPath.replace(`${GAME_ROOT}/`, '')}（未画的部件继承底图 base_male）`);
    }
    console.log('');
    console.log('下一步（你确认原图后）：');
    console.log(`  1) pnpm skin:fit assets/chars/${charId}/raw --char=${charId} --body=${cfg.body}`);
    console.log('  2) pnpm skin:gen');
    console.log('  3) 刷新浏览器');
  }

  if (actions.size > 0) {
    console.log('');
    console.log('需要你处理：');
    for (const a of actions) console.log(`  ! ${a}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
