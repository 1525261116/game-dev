/**
 * 皮肤（skin）契约 —— 纯逻辑，禁止依赖 Phaser
 *
 * 这是「美术贴图」与「代码」之间唯一的接口。它回答四个问题：
 *   ① 一个角色需要哪些贴图文件、放在哪、叫什么名字
 *   ② 每张贴图的画布尺寸与枢轴必须是多少（画错了在导入期就报错，而不是上游戏才发现穿模）
 *   ③ 怎么用「一套图 + 换色」造出多个角色（弟子/精英怪，见 docs/rig-spec.md §8）
 *   ④ 武器的图从哪来（按「武器组 × 品质」共享，30 张覆盖全游戏）
 *
 * 目录约定（**文件目录就是数据库**，不需要在代码里登记资源）：
 *
 *   assets/chars/<charId>/parts/<slot>.png      17 张部件贴图（cloak / weapon 可选）
 *   assets/chars/<charId>/skin.json            由 `pnpm skin:gen` 自动生成，勿手改
 *   assets/weapons/<group>/<group>_<quality>.png  武器贴图，全角色共享
 *
 * 为什么坚持"文件名严格等于 slot 名"？
 *   因为这样 `tools/gen-skin.ts` 才能自动生成 skin.json、自动校验缺件，
 *   新增角色不需要有人记得改一处代码。名字写错 = 导入期报错，不会静默漏件。
 */
import { SLOT_NAMES } from './types.ts';
import type { RigDef, SlotName } from './types.ts';

/* ══════════════════════ 常量 ══════════════════════ */

/**
 * 贴图按 2× 作画、游戏内按 1× 显示（见 docs/rig-spec.md §4）。
 * 好处：中低端手机缩放时依然清晰，且将来出高分辨率素材只需换倍率。
 */
export const ART_SCALE = 2;

/**
 * `cloak`（披风/飘带）与 `weapon`（武器）是**可选**部件：
 *   · 拳掌/内功类角色本来就没有武器
 *   · 不是每个角色都要飘带
 * 其余 15 个部件缺一个都算导入失败。
 */
export const OPTIONAL_SKIN_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>(['cloak', 'weapon']);

/** 品质 → 武器贴图后缀（与 docs/rig-spec.md §5 的命名一致） */
export const WEAPON_QUALITY_SUFFIX: Record<string, string> = {
  fan: 'fan',
  liang: 'li',
  shang: 'bao',
  ji: 'shen',
  jue: 'chuan',
};

/** 需要武器的武器组（内功/身法/拳掌不画武器贴图） */
export const WEAPON_GROUPS = ['dao', 'jian', 'qiang', 'anqi', 'qimen'] as const;
export type WeaponGroup = (typeof WEAPON_GROUPS)[number];

/* ══════════════════════ 类型 ══════════════════════ */

/** 单个部件的贴图信息（file 相对 assets/ 目录） */
export interface SkinPart {
  /** 例：chars/base_male/parts/torso.png */
  file: string;
  /** 画布宽（@2×），必须等于骨架绘制盒宽 × 2 */
  w: number;
  /** 画布高（@2×） */
  h: number;
  /** 枢轴（归一化 0~1），必须与骨架一致，否则一摆就穿模 */
  pivot: [number, number];
}

export interface SkinDef {
  id: string;
  /** 显示名（战报/调试用） */
  name?: string;
  /** 体型 id，必须是 src/data/rigs.ts 里已存在的**
   * （新增角色只能"选体型 + 换贴图"，不允许改骨长 —— 铁律） */
  body: string;
  /**
   * 复用另一套贴图（填对方 charId）。
   * 设计意图：弟子 / 精英怪复用同一套部件图、只换 palette，
   * 成本从「1~2 人日」降到「10 分钟」（rig-spec §8）。
   */
  art?: string;
  /** 逐 slot 换色（#rrggbb）。对"中性色贴图"效果最好，全彩贴图会做乘法着色 */
  palette?: Partial<Record<SlotName, string>>;
  /** 武器组：有值时优先用 assets/weapons/<组>/<组>_<品质>.png */
  weaponGroup?: WeaponGroup;
  /** 实际使用的部件（gen-skin 生成时会跟着 art 一起解析成真实路径） */
  parts: Partial<Record<SlotName, SkinPart>>;
}

/** 皮肤校验结果（与动作校验器同一形状，便于共用打印/CI） */
export interface SkinIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

/* ══════════════════════ 期望值（唯一真相来自骨架） ══════════════════════ */

/** 某体型下、某个 slot 应有的画布尺寸（@2×）；该体型没有这个部件时返回 null */
export function expectedSkinSize(rig: RigDef, slot: SlotName): { w: number; h: number } | null {
  const bone = rig.bones.find((b) => b.slot === slot);
  if (!bone) return null;
  return { w: Math.round(bone.w * ART_SCALE), h: Math.round(bone.h * ART_SCALE) };
}

/** 某个 slot 应有的枢轴（归一化）；不存在时返回 null */
export function expectedSkinPivot(rig: RigDef, slot: SlotName): [number, number] | null {
  const bone = rig.bones.find((b) => b.slot === slot);
  if (!bone) return null;
  return [bone.pivot?.x ?? 0.5, bone.pivot?.y ?? 0.5];
}

/** 该体型下必需的部件清单（除去 cloak / weapon 两个可选件） */
export function requiredSkinSlots(rig: RigDef): SlotName[] {
  return rig.bones
    .map((b) => b.slot)
    .filter((s) => !OPTIONAL_SKIN_SLOTS.has(s));
}

/** 武器贴图路径（按「武器组 × 品质」共享） */
export function weaponSkinFile(group: string, quality: string): string | null {
  const suffix = WEAPON_QUALITY_SUFFIX[quality];
  if (!suffix) return null;
  if (!(WEAPON_GROUPS as readonly string[]).includes(group)) return null;
  return `weapons/${group}/${group}_${suffix}.png`;
}

/* ══════════════════════ 校验 ══════════════════════ */

/**
 * 校验一份皮肤是否"画对了"。
 *
 * @param files 可选：assets/ 下真实存在的文件集合（相对路径）。
 *              传了就能顺带查"文件缺失"，不传则只查元数据一致性。
 *
 * 报错一律精确到 slot，因为美术改图时最想看的就是"哪一张错了"。
 */
export function validateSkin(
  skin: SkinDef,
  rig: RigDef,
  files?: ReadonlySet<string>,
): SkinIssue[] {
  const issues: SkinIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warn', code, message });

  if (!skin.id) err('NO_ID', '皮肤缺少 id');
  if (!skin.body) err('NO_BODY', '皮肤缺少 body（体型 id）');
  if (skin.body !== rig.id) {
    err('BODY_MISMATCH', `皮肤声明体型 ${skin.body}，但校验用的是 ${rig.id}`);
  }

  const rigSlots = new Set(rig.bones.map((b) => b.slot));

  // ① 未注册的 slot（铁律：不允许新增 slot）
  for (const slot of Object.keys(skin.parts)) {
    if (!SLOT_NAMES.includes(slot as SlotName)) {
      err('UNKNOWN_SLOT', `贴图槽「${slot}」不在注册表里 —— 新增角色只允许新增贴图，不允许新增 slot`);
    } else if (!rigSlots.has(slot as SlotName)) {
      err('SLOT_NOT_IN_RIG', `体型 ${rig.id} 没有「${slot}」这个部件`);
    }
  }

  // ② 必需部件是否齐全
  for (const slot of requiredSkinSlots(rig)) {
    if (!skin.parts[slot]) {
      err('MISSING_PART', `缺少必需部件「${slot}」——文件名必须严格等于 slot 名`);
    }
  }

  // ③ 逐部件核对尺寸 / 枢轴 / 文件是否存在
  for (const [key, part] of Object.entries(skin.parts)) {
    const slot = key as SlotName;
    if (!part) continue;
    const expectSize = expectedSkinSize(rig, slot);
    const expectPivot = expectedSkinPivot(rig, slot);

    if (expectSize) {
      if (part.w !== expectSize.w || part.h !== expectSize.h) {
        err(
          'BAD_SIZE',
          `「${slot}」画布应为 ${expectSize.w}×${expectSize.h}（${rig.id} @${ART_SCALE}×），实际 ${part.w}×${part.h}`,
        );
      }
    }
    if (expectPivot) {
      const [ex, ey] = expectPivot;
      const [ax, ay] = part.pivot;
      if (Math.abs(ex - ax) > 1e-6 || Math.abs(ey - ay) > 1e-6) {
        err(
          'BAD_PIVOT',
          `「${slot}」枢轴应为 ${ex},${ey}（关节旋转中心），实际 ${ax},${ay} —— 枢轴错位会一摆就穿模`,
        );
      }
    }
    if (!part.file) {
      err('NO_FILE', `「${slot}」缺少 file 字段`);
    } else if (files && !files.has(part.file)) {
      err('FILE_MISSING', `「${slot}」指向的文件不存在：assets/${part.file}`);
    }
  }

  // ④ 有武器组却没有声明武器部件 → 提醒（不是错误：可能故意空手）
  if (skin.weaponGroup && !skin.parts.weapon) {
    warn('NO_WEAPON_PART', `声明了武器组 ${skin.weaponGroup}，但没有 weapon 部件 —— 将只画手臂`);
  }

  return issues;
}

/** 只保留 error 级（导入期用：有 error 就不写盘） */
export function skinErrors(issues: readonly SkinIssue[]): SkinIssue[] {
  return issues.filter((i) => i.level === 'error');
}

/** 把校验问题打印成人能读的文本 */
export function formatSkinIssues(skinId: string, issues: readonly SkinIssue[]): string {
  if (issues.length === 0) return `✓ ${skinId}：通过`;
  return issues
    .map((i) => `${i.level === 'error' ? '✗' : '!'} ${skinId} [${i.code}] ${i.message}`)
    .join('\n');
}
