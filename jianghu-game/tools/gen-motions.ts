/**
 * 动作库程序化生成器（草稿生成）
 *
 *   生成全部缺省动作：      node tools/gen-motions.ts
 *   强制覆盖全部（含已有）：node tools/gen-motions.ts --force
 *
 * ─────────────────────────────────────────────────────────────────────
 * 为什么要写生成器，而不是一个个手写 62 个 JSON？
 *
 *   手写 = 体力活，且新增一个武器类型时要重做一遍。
 *   生成器 = 两个维度相乘：
 *
 *     ① 动作原型（15 个）：待机/起势/快招/重击/横扫/起手/受击/闪避/倒地
 *                          + 打坐/气劲 + 疾冲/腾挪/消失/落地
 *     ② 组特征（8 组）  ：刀/剑/拳掌/暗器/奇门/长兵/内功/身法
 *
 *   同一个原型套上不同组特征，就得到不同的动作。
 *   以后新增武器类型（例如"鞭"），只需加一组特征参数，动作自动全出。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 动作总数（为什么是 62 而不是文档写的 56）：
 *
 *   6 个武器组 × 9 个原型 = 54
 *   + 内功组 4 个（idle / meditate / cast / aura）
 *   + 身法组 4 个（dash / leap / vanish / land）
 *   = 62
 *
 *   文档《动画复用方案 v1.0》§4.3 写的是"武器组 8 个原型 = 56 个"，
 *   但代码里 MotionArchetype 已经包含了 sweep（横扫），且枪组有 4 门功法
 *   （杨家枪法 / 梨花枪 / 五虎断门枪 / 岳家枪）实际使用 sweep。
 *   若只生成 56 个，这 4 门功法将没有动作可播 —— 所以按 62 个生成。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 安全规则：
 *   ① 默认**不覆盖已存在的文件**（保护手工精调过的动作，例如 dao_atk_a）。
 *   ② 每个生成的动作都必须通过 validateClip 校验，不通过就不写盘。
 *   ③ 生成的是**草稿**：结构、时序、事件齐全，幅度与手感可后续细调。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleClip } from '../src/core/anim/clip.ts';
import { validateClip } from '../src/core/anim/validate.ts';
import { getRig } from '../src/data/rigs.ts';
import type {
  AnchorKey,
  AnchorName,
  AnimEvent,
  Keyframe,
  MotionArchetype,
  MotionClip,
  MotionGroup,
  SlotName,
  Track,
} from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MOTION_DIR = join(ROOT, 'src', 'data', 'motions');

/* ══════════════════════════════════════════════════════════════════
 * 一、组特征（8 组）
 *
 * 这 8 组参数决定了"同样的动作原型，不同武器做出来是什么样"。
 * 想调某一类武器的整体手感，改这里一个数字即可影响它全部 9 个动作。
 * ══════════════════════════════════════════════════════════════════ */

interface GroupProfile {
  /** 中文名（写进注释与报告，便于你核对） */
  label: string;
  /** 该组动作是否驱动 weapon 部件（武器是否跟着手动） */
  hasWeapon: boolean;
  /** 主打击挂点名（攻击类动作必须有其一） */
  strike: AnchorName;
  /** 主打击挂点挂在哪个 slot 上 */
  strikeSlot: SlotName;
  /** 挂点相对该 slot 的偏移 [x, y]（+y 向下） */
  strikeOffset: [number, number];
  /** 挥动幅度倍率：越大动作越夸张（1.0 = 基准） */
  arc: number;
  /** 躯干转动倍率：影响腰部发力感 */
  bodyTurn: number;
  /** 腿部参与度：0 = 站桩不动腿，1 = 正常，>1 = 大跨步 */
  legDrive: number;
  /** 攻击距离倍率：影响命中点前伸多远 */
  reach: number;
  /** 速度倍率：>1 更快（时长按比例缩短） */
  tempo: number;
  /** 默认音效模板 id（写进事件，后续可由功法覆盖） */
  sfx: string;
  /** 默认特效模板 id（写进事件，后续可由功法覆盖） */
  vfx: string;
}

const PROFILES: Record<MotionGroup, GroupProfile> = {
  dao: {
    label: '刀',
    hasWeapon: true,
    strike: 'weaponTip',
    strikeSlot: 'weapon',
    strikeOffset: [0, 52],
    arc: 1.0,
    bodyTurn: 1.0,
    legDrive: 0.8,
    reach: 1.0,
    tempo: 1.0,
    sfx: 'swing_light',
    vfx: 'slash_arc',
  },
  jian: {
    label: '剑',
    hasWeapon: true,
    strike: 'weaponTip',
    strikeSlot: 'weapon',
    strikeOffset: [0, 54],
    arc: 0.78, // 剑走轻灵：弧线更小
    bodyTurn: 0.85,
    legDrive: 0.75,
    reach: 1.1, // 但刺得更远
    tempo: 1.1,
    sfx: 'swing_light',
    vfx: 'thrust_multi',
  },
  quan: {
    label: '拳掌',
    hasWeapon: false, // 空手（拳套不算独立部件）
    strike: 'palm',
    strikeSlot: 'handR',
    strikeOffset: [0, 10],
    arc: 0.9,
    bodyTurn: 0.9,
    legDrive: 0.9,
    reach: 0.75,
    tempo: 1.15,
    sfx: 'palm',
    vfx: 'palm_wave',
  },
  anqi: {
    label: '暗器',
    hasWeapon: true, // 手上的飞刀/针，走 weapon 部件
    strike: 'throwPoint',
    strikeSlot: 'handR',
    strikeOffset: [0, 8],
    arc: 0.95,
    bodyTurn: 0.6, // 投掷主要靠手臂，腰转得少
    legDrive: 0.5,
    reach: 0.7,
    tempo: 1.3, // 快
    sfx: 'throw',
    vfx: 'missile_thin',
  },
  qimen: {
    label: '奇门',
    hasWeapon: true,
    strike: 'palm',
    strikeSlot: 'handR',
    strikeOffset: [0, 10],
    arc: 0.82,
    bodyTurn: 1.05, // 点穴/画符：手腕与腰的转动更明显
    legDrive: 0.65,
    reach: 0.85,
    tempo: 1.0,
    sfx: 'rune',
    vfx: 'qimen_rune',
  },
  qiang: {
    label: '长兵（枪）',
    hasWeapon: true,
    strike: 'weaponTip',
    strikeSlot: 'weapon',
    strikeOffset: [0, 58], // 枪比刀长
    arc: 0.62, // 长兵弧线小
    bodyTurn: 0.9,
    legDrive: 0.85,
    reach: 1.35, // 但够得远
    tempo: 0.95,
    sfx: 'thrust',
    vfx: 'thrust_pierce',
  },
  neigong: {
    label: '内功',
    hasWeapon: false,
    strike: 'palm',
    strikeSlot: 'handR',
    strikeOffset: [0, 8],
    arc: 0.38, // 内功幅度极小
    bodyTurn: 0.35,
    legDrive: 0.15, // 基本站桩
    reach: 0.6,
    tempo: 0.85, // 慢
    sfx: 'aura',
    vfx: 'aura_body',
  },
  shenfa: {
    label: '身法',
    hasWeapon: false,
    strike: 'footPoint',
    strikeSlot: 'pelvis',
    strikeOffset: [0, 62],
    arc: 0.5,
    bodyTurn: 0.5,
    legDrive: 1.25, // 腿是主角
    reach: 0.8,
    tempo: 1.4, // 最快
    sfx: 'dash',
    vfx: 'afterimage',
  },
};

/* ══════════════════════════════════════════════════════════════════
 * 二、构造小工具
 * ══════════════════════════════════════════════════════════════════ */

/** 造一条轨道（一个 slot 只能有一条轨道，否则校验器会报重复） */
const track = (slot: SlotName, keys: Keyframe[]): Track => ({ slot, keys });

/** 造一组挂点关键帧；入参为 [时间, x, y, 角度?] */
const anchorsOf = (
  slot: SlotName,
  specs: [number, number, number, number?][],
): AnchorKey[] => specs.map(([t, x, y, angle]) => ({ t, slot, x, y, angle: angle ?? 0 }));

/** 造一个动作事件（表现用，不参与数值计算） */
const ev = (t: number, type: AnimEvent['type'], id?: string): AnimEvent =>
  id === undefined ? { t, type } : { t, type, id };

/** 数值夹取，防止时长超出校验器的 [200, 2000] 区间 */
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 保留 4 位小数，避免 JSON 里出现 0.30000000000000004 这种脏数据 */
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/** 把关键帧里的数值统一收敛精度 */
const tidy = (keys: Keyframe[]): Keyframe[] =>
  keys.map((k) => {
    const o: Keyframe = { t: r4(k.t) };
    if (k.dx !== undefined) o.dx = r4(k.dx);
    if (k.dy !== undefined) o.dy = r4(k.dy);
    if (k.rot !== undefined) o.rot = r4(k.rot);
    if (k.sx !== undefined) o.sx = r4(k.sx);
    if (k.sy !== undefined) o.sy = r4(k.sy);
    if (k.ease !== undefined) o.ease = k.ease;
    return o;
  });

/* ══════════════════════════════════════════════════════════════════
 * 三、通用部件片段
 *
 * 这些是"所有动作都会用到"的部件摇摆，抽出来避免每个原型重复写。
 * ══════════════════════════════════════════════════════════════════ */

/** 披风迟滞跟随：比躯干晚一点，才有布料感 */
const cloak = (amount: number): Track =>
  track('cloak', tidy([
    { t: 0, rot: 0 },
    { t: 0.32, rot: -0.18 * amount, ease: 'sineOut' },
    { t: 0.62, rot: 0.22 * amount, ease: 'quadIn' },
    { t: 1, rot: 0 },
  ]));

/** 双腿站姿微调（攻击时的重心转移） */
const legs = (p: GroupProfile, amount: number): Track[] => [
  track('thighR', tidy([
    { t: 0, rot: 0 },
    { t: 0.3, rot: -0.12 * amount * p.legDrive, ease: 'sineOut' },
    { t: 0.5, rot: 0.14 * amount * p.legDrive, ease: 'quadIn' },
    { t: 1, rot: 0 },
  ])),
  track('thighL', tidy([
    { t: 0, rot: 0 },
    { t: 0.3, rot: 0.1 * amount * p.legDrive, ease: 'sineOut' },
    { t: 0.5, rot: -0.1 * amount * p.legDrive, ease: 'quadIn' },
    { t: 1, rot: 0 },
  ])),
];

/** 身体中心挂点（环形气劲 / 护体光用） */
const bodyCenterAnchor = (): Partial<Record<AnchorName, AnchorKey[]>> => ({
  bodyCenter: anchorsOf('torso', [[0, 0, -22]]),
});

/** 脚底挂点（位移残影 / 落地墨点用） */
const footPointAnchor = (): Partial<Record<AnchorName, AnchorKey[]>> => ({
  footPoint: anchorsOf('pelvis', [[0, 0, 62]]),
});

/** 主打击挂点（按组特征决定挂在武器尖端 / 掌心 / 掷出点） */
const strikeAnchor = (p: GroupProfile): Partial<Record<AnchorName, AnchorKey[]>> => {
  const [ox, oy] = p.strikeOffset;
  return {
    [p.strike]: anchorsOf(p.strikeSlot, [
      [0, ox, oy],
      [0.3, ox, oy],
      [0.5, ox, oy],
      [1, ox, oy],
    ]),
  };
};

/** 命中落点挂点（离身体多远由 reach 决定） */
const hitPointAnchor = (p: GroupProfile): Partial<Record<AnchorName, AnchorKey[]>> => ({
  hitPoint: anchorsOf('pelvis', [
    [0, r4(30 * p.reach), -20, 0],
    [0.45, r4(72 * p.reach), -26, -0.35],
    [1, r4(40 * p.reach), -22, -0.1],
  ]),
});

/* ══════════════════════════════════════════════════════════════════
 * 四、动作原型（15 个）
 *
 * 每个原型描述"这个动作大致怎么动"，用倍率引用组特征。
 * 想调某类动作的手感（例如所有快招都更狠），改这里。
 * ══════════════════════════════════════════════════════════════════ */

interface ArchetypeSpec {
  id: MotionArchetype;
  label: string;
  /** 基准时长 ms（实际时长 = 基准 / 组速度倍率） */
  duration: number;
  loop: boolean;
  /** 打断优先级：倒地 9 > 受击 5 > 功法 3 > 普攻 2 > 待机 0 */
  priority: number;
  /** 是否攻击类（攻击类必须有打击挂点，否则校验失败） */
  strike: boolean;
  events: (p: GroupProfile) => AnimEvent[];
  pose: (p: GroupProfile) => {
    tracks: Track[];
    anchors: Partial<Record<AnchorName, AnchorKey[]>>;
  };
}

const ARCHETYPES: Record<string, ArchetypeSpec> = {
  /* ───────────────────────────── 待机（循环） ───────────────────────────── */
  idle: {
    id: 'idle',
    label: '待机',
    duration: 1600,
    loop: true,
    priority: 0,
    strike: false,
    events: () => [],
    pose: (p) => ({
      tracks: [
        // 呼吸起伏：骨盆极轻微上下
        track('pelvis', tidy([
          { t: 0, dy: 0 },
          { t: 0.5, dy: 1.2 },
          { t: 1, dy: 0 },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.5, rot: 0.022 * p.bodyTurn },
          { t: 1, rot: 0 },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: -0.016 * p.bodyTurn },
          { t: 1, rot: 0 },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.5, rot: r4(0.06 - 0.05 * p.arc) },
          { t: 1, rot: 0.06 },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.08 },
          { t: 0.5, rot: -0.12 },
          { t: 1, rot: -0.08 },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.5, rot: r4(-0.06 + 0.045 * p.arc) },
          { t: 1, rot: -0.06 },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.5, rot: 0.12 },
          { t: 1, rot: 0.08 },
        ])),
        track('cloak', tidy([
          { t: 0, rot: 0 },
          { t: 0.6, rot: 0.035 },
          { t: 1, rot: 0 },
        ])),
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.5, rot: 0.05 },
                { t: 1, rot: 0.02 },
              ])),
            ]
          : []),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 起势（单次） ───────────────────────────── */
  ready: {
    id: 'ready',
    label: '起势',
    duration: 600,
    loop: false,
    priority: 1,
    strike: false,
    events: (p) => [ev(0.08, 'sfx', 'swing_light'), ev(0.5, 'vfx', p.vfx), ev(0.8, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 重心下沉 → 保持 → 起身（两端归零，接 idle 不跳帧）
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.4, dy: 4, dx: -1, ease: 'sineOut' },
          { t: 0.75, dy: 4, dx: -1 },
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: -0.1 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.75, rot: -0.1 * p.bodyTurn },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: -0.06 },
          { t: 0.75, rot: -0.06 },
          { t: 1, rot: 0 },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.4, rot: r4(0.06 - 0.62 * p.arc), ease: 'sineOut' },
          { t: 0.75, rot: r4(0.06 - 0.62 * p.arc) },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.08 },
          { t: 0.4, rot: r4(-0.72 * p.arc), ease: 'sineOut' },
          { t: 0.75, rot: r4(-0.72 * p.arc) },
          { t: 1, rot: -0.08 },
        ])),
        track('handR', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: -0.12 },
          { t: 1, rot: 0 },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.4, rot: r4(-0.34 * p.arc) },
          { t: 0.75, rot: r4(-0.34 * p.arc) },
          { t: 1, rot: -0.06 },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.4, rot: r4(-0.5 * p.arc) },
          { t: 0.75, rot: r4(-0.5 * p.arc) },
          { t: 1, rot: 0.08 },
        ])),
        // 腿微屈
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(-0.12 * p.legDrive) },
          { t: 0.75, rot: r4(-0.12 * p.legDrive) },
          { t: 1, rot: 0 },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.1 * p.legDrive) },
          { t: 0.75, rot: r4(0.1 * p.legDrive) },
          { t: 1, rot: 0 },
        ])),
        track('shinR', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.18 * p.legDrive) },
          { t: 1, rot: 0 },
        ])),
        track('shinL', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.15 * p.legDrive) },
          { t: 1, rot: 0 },
        ])),
        cloak(0.5),
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.4, rot: r4(-0.3 * p.arc) },
                { t: 0.75, rot: r4(-0.3 * p.arc) },
                { t: 1, rot: 0.02 },
              ])),
            ]
          : []),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p) },
    }),
  },

  /* ───────────────────────────── 快招（单次） ───────────────────────────── */
  atk_a: {
    id: 'atk_a',
    label: '快招',
    duration: 520,
    loop: false,
    priority: 2,
    strike: true,
    events: (p) => [
      ev(0.06, 'sfx', p.sfx),
      ev(0.32, 'vfx', p.vfx),
      ev(0.45, 'hit'),
      ev(0.55, 'shake', '1'),
      ev(0.85, 'vfxStop'),
    ],
    pose: (p) => ({
      tracks: [
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.3, dy: -2, dx: -3, ease: 'sineOut' },
          { t: 0.5, dy: 2, dx: 6, ease: 'quadIn' },
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: -0.16 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.5, rot: 0.26 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: -0.12 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.55, rot: 0.1 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        // 主攻手臂：举 → 劈（负角度 = 向前上方举，详见 docs/rig-spec.md §6）
        track('upperArmR', tidy([
          { t: 0, rot: 0.05 },
          { t: 0.3, rot: r4(0.05 - 2.1 * p.arc), ease: 'sineOut' },
          { t: 0.5, rot: r4(0.05 - 0.67 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.05, ease: 'sineOut' },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.05 },
          { t: 0.3, rot: r4(-0.37 * p.arc), ease: 'sineOut' },
          { t: 0.5, rot: r4(0.23 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.05, ease: 'sineOut' },
        ])),
        track('handR', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(-0.22 * p.arc), ease: 'sineOut' },
          { t: 0.5, rot: r4(0.16 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        // 副手：反向摆动配重
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.3, rot: r4(0.88 * p.arc), ease: 'sineOut' },
          { t: 0.5, rot: r4(-0.34 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.3, rot: r4(-0.32 * p.arc), ease: 'sineOut' },
          { t: 0.5, rot: r4(0.12 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.08, ease: 'sineOut' },
        ])),
        ...legs(p, 1),
        cloak(1),
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.3, rot: r4(-0.18 * p.arc), ease: 'sineOut' },
                { t: 0.5, rot: r4(0.26 * p.arc), ease: 'quadIn' },
                { t: 1, rot: 0.02, ease: 'sineOut' },
              ])),
            ]
          : []),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p), ...hitPointAnchor(p) },
    }),
  },

  /* ───────────────────────────── 重击（单次） ───────────────────────────── */
  atk_b: {
    id: 'atk_b',
    label: '重击',
    duration: 780,
    loop: false,
    priority: 2,
    strike: true,
    events: (p) => [
      ev(0.08, 'sfx', p.sfx),
      ev(0.42, 'vfx', p.vfx),
      ev(0.62, 'hit'),
      ev(0.72, 'shake', '2'), // 重击震屏更狠
      ev(0.92, 'vfxStop'),
    ],
    pose: (p) => ({
      tracks: [
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.42, dy: -5, dx: -6, ease: 'sineOut' }, // 蓄力后坐
          { t: 0.62, dy: 4, dx: 11, ease: 'quadIn' }, // 前压
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.42, rot: -0.26 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.62, rot: 0.36 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.42, rot: -0.18 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.66, rot: 0.14 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.42, rot: r4(0.06 - 2.5 * p.arc), ease: 'sineOut' }, // 举更高
          { t: 0.62, rot: r4(0.06 - 0.5 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.42, rot: r4(-0.5 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(0.3 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('handR', tidy([
          { t: 0, rot: 0 },
          { t: 0.42, rot: r4(-0.28 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(0.2 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.42, rot: r4(1.05 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(-0.42 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.42, rot: r4(-0.42 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(0.18 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.08, ease: 'sineOut' },
        ])),
        ...legs(p, 1.5),
        cloak(1.4),
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.42, rot: r4(-0.24 * p.arc), ease: 'sineOut' },
                { t: 0.62, rot: r4(0.34 * p.arc), ease: 'quadIn' },
                { t: 1, rot: 0.02, ease: 'sineOut' },
              ])),
            ]
          : []),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p), ...hitPointAnchor(p) },
    }),
  },

  /* ───────────────────────────── 横扫（单次） ───────────────────────────── */
  sweep: {
    id: 'sweep',
    label: '横扫',
    duration: 700,
    loop: false,
    priority: 2,
    strike: true,
    events: (p) => [
      ev(0.1, 'sfx', 'sweep'),
      ev(0.4, 'vfx', 'sweep_row'),
      ev(0.58, 'hit'),
      ev(0.68, 'shake', '1'),
      ev(0.9, 'vfxStop'),
    ],
    pose: (p) => ({
      tracks: [
        // 横扫的核心：整个身体绕腰旋转，所以 pelvis 也参与转动
        track('pelvis', tidy([
          { t: 0, rot: 0, dx: 0 },
          { t: 0.28, rot: -0.16 * p.bodyTurn, dx: -5, ease: 'sineOut' },
          { t: 0.58, rot: 0.3 * p.bodyTurn, dx: 8, ease: 'quadIn' },
          { t: 1, rot: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.28, rot: -0.34 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.58, rot: 0.48 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.28, rot: -0.2 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.62, rot: 0.16 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        // 手臂走横弧：从身后绕到身前
        track('upperArmR', tidy([
          { t: 0, rot: 0.05 },
          { t: 0.28, rot: r4(0.05 - 0.9 * p.arc), ease: 'sineOut' },
          { t: 0.58, rot: r4(0.05 + 1.15 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.05, ease: 'sineOut' },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.28, rot: r4(-0.55 * p.arc), ease: 'sineOut' },
          { t: 0.58, rot: r4(-0.15 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('handR', tidy([
          { t: 0, rot: 0 },
          { t: 0.28, rot: r4(-0.3 * p.arc), ease: 'sineOut' },
          { t: 0.58, rot: r4(0.25 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.28, rot: r4(0.5 * p.arc), ease: 'sineOut' },
          { t: 0.58, rot: r4(-0.6 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.28, rot: r4(-0.25 * p.arc), ease: 'sineOut' },
          { t: 0.58, rot: r4(0.2 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.08, ease: 'sineOut' },
        ])),
        ...legs(p, 1.2),
        cloak(1.3),
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.28, rot: r4(-0.3 * p.arc), ease: 'sineOut' },
                { t: 0.58, rot: r4(0.32 * p.arc), ease: 'quadIn' },
                { t: 1, rot: 0.02, ease: 'sineOut' },
              ])),
            ]
          : []),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p), ...hitPointAnchor(p) },
    }),
  },

  /* ───────────────────────────── 功法起手（单次） ───────────────────────────── */
  cast: {
    id: 'cast',
    label: '功法起手',
    duration: 900,
    loop: false,
    priority: 3,
    strike: true,
    events: (p) => [
      ev(0.1, 'sfx', p.sfx),
      ev(0.45, 'vfx', p.vfx),
      ev(0.62, 'hit'),
      ev(0.72, 'shake', '1'),
      ev(0.92, 'vfxStop'),
    ],
    pose: (p) => ({
      tracks: [
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.35, dy: 3, dx: -5, ease: 'sineOut' }, // 蓄力：收
          { t: 0.62, dy: -2, dx: 8, ease: 'quadIn' }, // 释放：放
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.35, rot: -0.14 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.62, rot: 0.2 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.35, rot: -0.1 * p.bodyTurn, ease: 'sineOut' },
          { t: 0.62, rot: 0.08 * p.bodyTurn, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        // 蓄力时手臂收在身侧，释放时向前推出
        track('upperArmR', tidy([
          { t: 0, rot: 0.05 },
          { t: 0.35, rot: r4(0.05 - 1.15 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(0.05 - 1.5 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.05, ease: 'sineOut' },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.35, rot: r4(-0.85 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(-0.1 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('handR', tidy([
          { t: 0, rot: 0 },
          { t: 0.35, rot: r4(-0.25 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(0.3 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.35, rot: r4(0.5 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(-0.75 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: 0.08 },
          { t: 0.35, rot: r4(-0.6 * p.arc), ease: 'sineOut' },
          { t: 0.62, rot: r4(-0.05 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.08, ease: 'sineOut' },
        ])),
        // 双臂外展（内功/气劲感）
        ...(p.hasWeapon
          ? [
              track('weapon', tidy([
                { t: 0, rot: 0.02 },
                { t: 0.35, rot: r4(-0.35 * p.arc), ease: 'sineOut' },
                { t: 0.62, rot: r4(0.1 * p.arc), ease: 'quadIn' },
                { t: 1, rot: 0.02, ease: 'sineOut' },
              ])),
            ]
          : []),
        ...legs(p, 0.9),
        cloak(1.2),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p), ...hitPointAnchor(p) },
    }),
  },

  /* ───────────────────────────── 受击（单次） ───────────────────────────── */
  hit: {
    id: 'hit',
    label: '受击',
    duration: 320,
    loop: false,
    priority: 5,
    strike: false,
    events: () => [ev(0.05, 'sfx', 'impact'), ev(0.12, 'shake', '1')],
    pose: (p) => ({
      tracks: [
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.22, dy: 3, dx: -5, ease: 'quadIn' }, // 被推得后退
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.22, rot: 0.3, ease: 'quadIn' }, // 上身后仰
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.22, rot: 0.34, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.22, rot: r4(0.06 + 0.4 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.22, rot: r4(-0.06 - 0.35 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.22, rot: r4(0.14 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0 },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.22, rot: r4(-0.1 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0 },
        ])),
        track('cloak', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: -0.24, ease: 'quadIn' },
          { t: 1, rot: 0 },
        ])),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 闪避（单次） ───────────────────────────── */
  dodge: {
    id: 'dodge',
    label: '闪避',
    duration: 450,
    loop: false,
    priority: 4,
    strike: false,
    events: () => [ev(0.06, 'sfx', 'dash'), ev(0.2, 'vfx', 'afterimage'), ev(0.7, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 向侧后方撤步 + 压低重心
        track('pelvis', tidy([
          { t: 0, dx: 0, dy: 0 },
          { t: 0.3, dx: r4(-16 * p.arc), dy: 6, ease: 'sineOut' },
          { t: 0.7, dx: r4(-14 * p.arc), dy: 5 },
          { t: 1, dx: 0, dy: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(-0.28 * p.bodyTurn), ease: 'sineOut' },
          { t: 0.7, rot: r4(-0.24 * p.bodyTurn) },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: -0.12, ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.3, rot: r4(0.06 - 0.55 * p.arc), ease: 'sineOut' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.3, rot: r4(-0.06 - 0.45 * p.arc), ease: 'sineOut' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        // 腿部大动作（跳开）
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(-0.45 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(0.35 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinR', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(0.5 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinL', tidy([
          { t: 0, rot: 0 },
          { t: 0.3, rot: r4(0.42 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        cloak(1.5),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 倒地（单次） ───────────────────────────── */
  down: {
    id: 'down',
    label: '倒地',
    duration: 900,
    loop: false,
    priority: 9, // 最高优先级：倒地不能被普通动作打断
    strike: false,
    events: () => [ev(0.1, 'sfx', 'impact'), ev(0.55, 'shake', '2')],
    pose: (p) => ({
      tracks: [
        // 先踉跄，再倒下，最后保持不动
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0, rot: 0 },
          { t: 0.25, dy: 4, dx: -8, rot: 0.12, ease: 'sineOut' },
          { t: 0.7, dy: 34, dx: -14, rot: 0.5, ease: 'quadIn' }, // 沉到地面
          { t: 1, dy: 36, dx: -15, rot: 0.52 },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.25, rot: 0.22, ease: 'sineOut' },
          { t: 0.7, rot: 1.15, ease: 'quadIn' }, // 上半身躺倒
          { t: 1, rot: 1.18 },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.25, rot: 0.3, ease: 'sineOut' },
          { t: 0.75, rot: 0.42, ease: 'quadIn' },
          { t: 1, rot: 0.44 },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.3, rot: r4(0.06 - 1.1 * p.arc), ease: 'sineOut' },
          { t: 0.8, rot: r4(0.06 - 0.2 * p.arc), ease: 'quadIn' },
          { t: 1, rot: r4(0.06 - 0.18 * p.arc) },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.3, rot: r4(-0.06 + 0.9 * p.arc), ease: 'sineOut' },
          { t: 0.8, rot: r4(-0.06 + 0.25 * p.arc), ease: 'quadIn' },
          { t: 1, rot: r4(-0.06 + 0.23 * p.arc) },
        ])),
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.5 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: r4(0.55 * p.legDrive) },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.35 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: r4(0.4 * p.legDrive) },
        ])),
        track('shinR', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.6 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: r4(0.62 * p.legDrive) },
        ])),
        track('shinL', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.5 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: r4(0.52 * p.legDrive) },
        ])),
        cloak(1.8),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 打坐运气（循环） ───────────────────────────── */
  meditate: {
    id: 'meditate',
    label: '打坐运气',
    duration: 2000,
    loop: true,
    priority: 0,
    strike: false,
    events: () => [],
    pose: (p) => ({
      tracks: [
        // 极缓慢的呼吸，几乎看不出动 —— 但绝不能完全静止，否则像卡住
        track('pelvis', tidy([
          { t: 0, dy: 0 },
          { t: 0.5, dy: 1.6 },
          { t: 1, dy: 0 },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.5, rot: r4(0.03 * p.bodyTurn) },
          { t: 1, rot: 0 },
        ])),
        track('head', tidy([
          { t: 0, rot: 0.12 },
          { t: 0.5, rot: 0.1 },
          { t: 1, rot: 0.12 },
        ])),
        // 双手收于身前（内功打坐）
        track('upperArmR', tidy([
          { t: 0, rot: r4(-0.35 * p.arc) },
          { t: 0.5, rot: r4(-0.4 * p.arc) },
          { t: 1, rot: r4(-0.35 * p.arc) },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: r4(-1.1 * p.arc) },
          { t: 0.5, rot: r4(-1.15 * p.arc) },
          { t: 1, rot: r4(-1.1 * p.arc) },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: r4(0.35 * p.arc) },
          { t: 0.5, rot: r4(0.4 * p.arc) },
          { t: 1, rot: r4(0.35 * p.arc) },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: r4(1.1 * p.arc) },
          { t: 0.5, rot: r4(1.15 * p.arc) },
          { t: 1, rot: r4(1.1 * p.arc) },
        ])),
        track('cloak', tidy([
          { t: 0, rot: 0 },
          { t: 0.65, rot: 0.02 },
          { t: 1, rot: 0 },
        ])),
      ],
      anchors: { ...bodyCenterAnchor() },
    }),
  },

  /* ───────────────────────────── 持续气劲（循环） ───────────────────────────── */
  aura: {
    id: 'aura',
    label: '持续气劲',
    duration: 1800,
    loop: true,
    priority: 0,
    strike: false,
    events: () => [ev(0.5, 'vfx', 'aura_ring')],
    pose: (p) => ({
      tracks: [
        // 微微起伏 + 双臂外展，表现"气在体内流转"
        track('pelvis', tidy([
          { t: 0, dy: 0 },
          { t: 0.5, dy: -1.4 },
          { t: 1, dy: 0 },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.5, rot: r4(-0.04 * p.bodyTurn) },
          { t: 1, rot: 0 },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.5, rot: 0.03 },
          { t: 1, rot: 0 },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: r4(-0.5 * p.arc) },
          { t: 0.5, rot: r4(-0.62 * p.arc) },
          { t: 1, rot: r4(-0.5 * p.arc) },
        ])),
        track('forearmR', tidy([
          { t: 0, rot: r4(-0.7 * p.arc) },
          { t: 0.5, rot: r4(-0.8 * p.arc) },
          { t: 1, rot: r4(-0.7 * p.arc) },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: r4(0.5 * p.arc) },
          { t: 0.5, rot: r4(0.62 * p.arc) },
          { t: 1, rot: r4(0.5 * p.arc) },
        ])),
        track('forearmL', tidy([
          { t: 0, rot: r4(0.7 * p.arc) },
          { t: 0.5, rot: r4(0.8 * p.arc) },
          { t: 1, rot: r4(0.7 * p.arc) },
        ])),
        track('cloak', tidy([
          { t: 0, rot: r4(0.04) },
          { t: 0.5, rot: r4(0.09) },
          { t: 1, rot: r4(0.04) },
        ])),
      ],
      anchors: { ...bodyCenterAnchor(), ...strikeAnchor(p) },
    }),
  },

  /* ───────────────────────────── 疾冲（单次） ───────────────────────────── */
  dash: {
    id: 'dash',
    label: '疾冲',
    duration: 400,
    loop: false,
    priority: 4,
    strike: false,
    events: () => [ev(0.05, 'sfx', 'dash'), ev(0.15, 'vfx', 'afterimage'), ev(0.75, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 向前冲刺：身体前倾 + 位移
        track('pelvis', tidy([
          { t: 0, dx: 0, dy: 0, rot: 0 },
          { t: 0.45, dx: r4(22 * p.arc), dy: -3, rot: 0.1, ease: 'quadIn' },
          { t: 1, dx: 0, dy: 0, rot: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(-0.3 * p.bodyTurn), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(-0.14 * p.bodyTurn), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.45, rot: r4(0.06 + 0.5 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.45, rot: r4(-0.06 - 0.5 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        // 蹬腿
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.7 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(-0.55 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinR', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.4 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinL', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.65 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('cloak', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(-0.42), ease: 'quadIn' }, // 披风被甩到身后
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 腾挪（单次） ───────────────────────────── */
  leap: {
    id: 'leap',
    label: '腾挪',
    duration: 700,
    loop: false,
    priority: 4,
    strike: false,
    events: () => [ev(0.06, 'sfx', 'dash'), ev(0.25, 'vfx', 'afterimage'), ev(0.85, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 起跳 → 滞空（dy 为负 = 向上） → 落地缓冲
        track('pelvis', tidy([
          { t: 0, dy: 0, dx: 0 },
          { t: 0.15, dy: 8, dx: -2, ease: 'sineOut' }, // 下蹲蓄力
          { t: 0.45, dy: -26, dx: 12, ease: 'sineOut' }, // 腾空最高点
          { t: 0.75, dy: -6, dx: 20, ease: 'quadIn' },
          { t: 0.88, dy: 9, dx: 22, ease: 'quadIn' }, // 落地缓冲
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.15, rot: r4(0.12 * p.bodyTurn) },
          { t: 0.45, rot: r4(-0.2 * p.bodyTurn), ease: 'sineOut' },
          { t: 0.88, rot: r4(0.16 * p.bodyTurn), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: -0.1, ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.15, rot: r4(0.06 + 0.35 * p.arc) },
          { t: 0.45, rot: r4(0.06 - 0.7 * p.arc), ease: 'sineOut' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.15, rot: r4(-0.06 - 0.35 * p.arc) },
          { t: 0.45, rot: r4(-0.06 - 0.7 * p.arc), ease: 'sineOut' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        // 收腿 → 展腿 → 落地屈膝
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.15, rot: r4(0.5 * p.legDrive) },
          { t: 0.45, rot: r4(-0.75 * p.legDrive), ease: 'sineOut' },
          { t: 0.88, rot: r4(0.6 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.15, rot: r4(0.42 * p.legDrive) },
          { t: 0.45, rot: r4(-0.45 * p.legDrive), ease: 'sineOut' },
          { t: 0.88, rot: r4(0.48 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinR', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.9 * p.legDrive), ease: 'sineOut' },
          { t: 0.88, rot: r4(0.5 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinL', tidy([
          { t: 0, rot: 0 },
          { t: 0.45, rot: r4(0.7 * p.legDrive), ease: 'sineOut' },
          { t: 0.88, rot: r4(0.45 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        cloak(2.2), // 腾空时披风甩得最厉害
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 残影消失（单次） ───────────────────────────── */
  vanish: {
    id: 'vanish',
    label: '残影消失',
    duration: 500,
    loop: false,
    priority: 5,
    strike: false,
    events: () => [ev(0.05, 'sfx', 'dash'), ev(0.18, 'vfx', 'afterimage'), ev(0.6, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 后撤 + 转身 + 缩小（表现"淡出"）
        track('pelvis', tidy([
          { t: 0, dx: 0, dy: 0, sx: 1, sy: 1 },
          { t: 0.4, dx: r4(-20 * p.arc), dy: 2, sx: 0.94, sy: 0.94, ease: 'sineOut' },
          { t: 0.8, dx: r4(-26 * p.arc), dy: 1, sx: 0.86, sy: 0.86, ease: 'sineOut' },
          { t: 1, dx: 0, dy: 0, sx: 1, sy: 1, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(-0.4 * p.bodyTurn), ease: 'sineOut' },
          { t: 0.8, rot: r4(-0.5 * p.bodyTurn) },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(-0.22 * p.bodyTurn), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: 0.06 },
          { t: 0.4, rot: r4(0.06 - 0.9 * p.arc), ease: 'sineOut' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.4, rot: r4(-0.06 - 0.8 * p.arc), ease: 'sineOut' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('thighR', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(-0.4 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('thighL', tidy([
          { t: 0, rot: 0 },
          { t: 0.4, rot: r4(0.3 * p.legDrive), ease: 'sineOut' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        cloak(1.6),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },

  /* ───────────────────────────── 落地（单次） ───────────────────────────── */
  land: {
    id: 'land',
    label: '落地',
    duration: 400,
    loop: false,
    priority: 1,
    strike: false,
    events: () => [ev(0.04, 'sfx', 'dash'), ev(0.12, 'vfx', 'ink_splash'), ev(0.6, 'vfxStop')],
    pose: (p) => ({
      tracks: [
        // 落地冲击 → 屈膝缓冲 → 起身
        track('pelvis', tidy([
          { t: 0, dy: -6, dx: 0 },
          { t: 0.25, dy: 11, dx: 0, ease: 'quadIn' }, // 最深的下蹲
          { t: 0.7, dy: 4, dx: 0, ease: 'sineOut' },
          { t: 1, dy: 0, dx: 0, ease: 'sineOut' },
        ])),
        track('torso', tidy([
          { t: 0, rot: r4(-0.12 * p.bodyTurn) },
          { t: 0.25, rot: r4(0.2 * p.bodyTurn), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('head', tidy([
          { t: 0, rot: -0.06 },
          { t: 0.25, rot: 0.12, ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('upperArmR', tidy([
          { t: 0, rot: r4(0.06 - 0.4 * p.arc) },
          { t: 0.25, rot: r4(0.06 + 0.45 * p.arc), ease: 'quadIn' },
          { t: 1, rot: 0.06, ease: 'sineOut' },
        ])),
        track('upperArmL', tidy([
          { t: 0, rot: r4(-0.06 - 0.4 * p.arc) },
          { t: 0.25, rot: r4(-0.06 - 0.45 * p.arc), ease: 'quadIn' },
          { t: 1, rot: -0.06, ease: 'sineOut' },
        ])),
        track('thighR', tidy([
          { t: 0, rot: r4(-0.3 * p.legDrive) },
          { t: 0.25, rot: r4(0.85 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('thighL', tidy([
          { t: 0, rot: r4(-0.3 * p.legDrive) },
          { t: 0.25, rot: r4(0.8 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinR', tidy([
          { t: 0, rot: r4(0.4 * p.legDrive) },
          { t: 0.25, rot: r4(0.9 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        track('shinL', tidy([
          { t: 0, rot: r4(0.4 * p.legDrive) },
          { t: 0.25, rot: r4(0.85 * p.legDrive), ease: 'quadIn' },
          { t: 1, rot: 0, ease: 'sineOut' },
        ])),
        cloak(1.4),
      ],
      anchors: { ...bodyCenterAnchor(), ...footPointAnchor() },
    }),
  },
};

/* ══════════════════════════════════════════════════════════════════
 * 五、任务清单：哪几组 × 哪几个原型
 * ══════════════════════════════════════════════════════════════════ */

/** 6 个武器组：每组 9 个原型 */
const WEAPON_GROUPS: MotionGroup[] = ['dao', 'jian', 'quan', 'anqi', 'qimen', 'qiang'];
const WEAPON_ARCHETYPE_IDS: MotionArchetype[] = [
  'idle', 'ready', 'atk_a', 'atk_b', 'sweep', 'cast', 'hit', 'dodge', 'down',
];

/** 内功组 4 个 */
const NEIGONG_ARCHETYPE_IDS: MotionArchetype[] = ['idle', 'meditate', 'cast', 'aura'];

/** 身法组 4 个 */
const SHENFA_ARCHETYPE_IDS: MotionArchetype[] = ['dash', 'leap', 'vanish', 'land'];

/** 一个待生成的任务 */
interface Job {
  group: MotionGroup;
  spec: ArchetypeSpec;
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (const g of WEAPON_GROUPS) {
    for (const a of WEAPON_ARCHETYPE_IDS) jobs.push({ group: g, spec: ARCHETYPES[a]! });
  }
  for (const a of NEIGONG_ARCHETYPE_IDS) jobs.push({ group: 'neigong', spec: ARCHETYPES[a]! });
  for (const a of SHENFA_ARCHETYPE_IDS) jobs.push({ group: 'shenfa', spec: ARCHETYPES[a]! });
  return jobs;
}

/* ══════════════════════════════════════════════════════════════════
 * 六、由「组特征 + 原型」组装出一个完整动作
 * ══════════════════════════════════════════════════════════════════ */

function buildClip(group: MotionGroup, spec: ArchetypeSpec): MotionClip {
  const p = PROFILES[group];
  const { tracks, anchors } = spec.pose(p);

  // 时长 = 基准 / 组速度；夹到校验器允许的 [200, 2000]
  const duration = Math.round(clamp(spec.duration / p.tempo, 200, 2000));

  // 攻击类动作必须有打击挂点，否则运行时会"特效无处安放"
  if (spec.strike && Object.keys(anchors).length === 0) {
    throw new Error(`${group}_${spec.id} 是攻击类动作，但没有生成打击挂点`);
  }

  return {
    id: `${group}_${spec.id}`, // 命名规则：组_原型，例如 dao_atk_a
    group,
    duration,
    loop: spec.loop,
    priority: spec.priority,
    anchors,
    events: spec.events(p).map((e) => ({ ...e, t: r4(e.t) })),
    tracks,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 七、主流程：生成 → 校验 → 写盘 → 打印报告
 * ══════════════════════════════════════════════════════════════════ */

function main(): void {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry');

  if (!existsSync(MOTION_DIR)) mkdirSync(MOTION_DIR, { recursive: true });

  const existing = new Set(
    readdirSync(MOTION_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
  );

  const jobs = buildJobs();
  const rig = getRig('male_adult');

  let written = 0;
  let skipped = 0;
  const failed: string[] = [];

  console.log('=== 动作库生成报告 ===');
  console.log(`任务总数: ${jobs.length}（6 武器组 × 9 + 内功 4 + 身法 4）`);
  console.log(`已有动作: ${existing.size} 个${force ? '（--force：将被覆盖）' : '（默认保护，不覆盖）'}`);
  console.log('');
  console.log(
    '『动作 id'.padEnd(20) +
      '时长'.padStart(7) +
      '循环'.padStart(6) +
      '优先级'.padStart(8) +
      '轨道'.padStart(6) +
      '挂点'.padStart(6) +
      '事件'.padStart(6) +
      '  打击挂点轨迹  校验',
  );

  for (const { group, spec } of jobs) {
    let clip: MotionClip;
    try {
      clip = buildClip(group, spec);
    } catch (e) {
      failed.push(`${group}_${spec.id}: ${(e as Error).message}`);
      continue;
    }

    // ① 校验：不通过就不写盘（宁可少一个动作，也不写坏数据）
    const issues = validateClip(clip);
    const errs = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');

    // ② 量化自检：攻击类动作的打击点必须真的在动，否则等于没挥
    let travel = 0;
    if (spec.strike) {
      const times = [0, 0.25, 0.5, 0.75, 1].map((u) => clip.duration * u);
      const pts = times
        .map((t) => sampleClip(clip, rig, t).anchors[PROFILES[group].strike])
        .filter(Boolean) as { x: number; y: number }[];
      for (let i = 1; i < pts.length; i++) {
        travel += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      }
    }

    const tag = errs.length === 0 ? '✓通过' : `✗${errs.map((e) => e.code).join(',')}`;
    console.log(
      ` ${clip.id.padEnd(18)}` +
        `${String(clip.duration).padStart(6)}ms` +
        `${(clip.loop ? '循环' : '单次').padStart(6)}` +
        `${String(clip.priority).padStart(8)}` +
        `${String(clip.tracks.length).padStart(6)}` +
        `${String(Object.keys(clip.anchors).length).padStart(6)}` +
        `${String(clip.events.length).padStart(6)}` +
        `${spec.strike ? travel.toFixed(0).padStart(12) + 'px' : '           —'}` +
        `  ${tag}` +
        (warns.length > 0 ? ` (warn:${warns.map((w) => w.code).join(',')})` : ''),
    );

    if (errs.length > 0) {
      for (const e of errs) console.log(`      [${e.code}] ${e.message}`);
      failed.push(clip.id);
      continue;
    }

    if (existing.has(clip.id) && !force) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      writeFileSync(join(MOTION_DIR, `${clip.id}.json`), JSON.stringify(clip, null, 2) + '\n', 'utf8');
    }
    written++;
  }

  console.log('');
  console.log(`写入 ${written} 个 / 跳过（已存在）${skipped} 个 / 失败 ${failed.length} 个`);
  if (dryRun) console.log('（--dry：仅试算，未写盘）');
  if (failed.length > 0) {
    console.error('\n失败清单：');
    for (const f of failed) console.error('  · ' + f);
    process.exitCode = 1;
  }
}

main();
