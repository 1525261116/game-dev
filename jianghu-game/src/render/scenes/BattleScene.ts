/**
 * 战斗场景（BattleScene）：**回放** core 层算好的战斗日志。
 *
 * ══════════════════════════════════════════════════════════════════
 * 这个文件刻意不包含任何数值计算。
 *   它做四件事：① 铺背景 ② 摆角色 ③ 按事件顺序演出 ④ 维护头顶信息（血/内力/状态）
 *
 * 数值全部来自 core/battle/simulate.ts 算好的结果，这里只是"放录像"。
 * 所以：
 *   · 同一场战斗可以换任何速度回放，结果不会变
 *   · 表现出错不会污染数值，数值出错也不会被画面掩盖
 * ══════════════════════════════════════════════════════════════════
 *
 * 美术资源是**可选**的：`assets/bg/battle/` 下的三张背景 与 `assets/chars/<角色>/skin.json`
 * 在就画贴图，不在就回退成"宣纸底 + 色块角色"。这样美术可以分批交付，
 * 程序与美术互不阻塞（铁律：表现层可降级，数值层不许降级）。
 */
import Phaser from 'phaser';
import { simulateBattle } from '../../core/battle/simulate.ts';
import { DEFAULT_BATTLE } from '../../data/battle-presets.ts';
import { STATUS_BY_ID } from '../../data/status.ts';
import { getMotion } from '../anim/MotionLib.ts';
import { CharacterView } from '../anim/CharacterView.ts';
import { THEME, bodyStyle, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';
import { BUTTON_H, BUTTON_W, BUTTON_Y, FIELD, HUD_H, VIEW_H, VIEW_W, slotPosition } from '../ui/layout.ts';
import type { BattleEvent, BattleLog } from '../../core/battle/simulate.ts';
import type { MotionGroup } from '../../core/anim/types.ts';
import type { SlotIndex } from '../../core/battle/types.ts';
import type { CombatIntent } from '../../core/battle/targeting.ts';
import type { StatusId } from '../../core/battle/types.ts';

const HP_BAR_W = FIELD.hpBarW;
const HP_BAR_H = FIELD.hpBarH;
const INNER_BAR_H = FIELD.innerBarH;

/** 角色缩放与信息栈偏移全部来自 layout.ts（纵向预算的推导写在那里） */
const CHAR_SCALE = FIELD.charScale;
const STATUS_Y = FIELD.statusY;
const HP_BAR_Y = FIELD.hpBarY;
const INNER_BAR_Y = FIELD.innerBarY;
const INFO_Y = FIELD.infoY;
/** 脚下投影 */
const SHADOW_Y = FIELD.shadowY;
/** 内力条颜色：充足=靛蓝，见底=灰（一眼看出下一手会不会退化成普攻） */
const INNER_COLOR = 0x4a6fd4;
const INNER_COLOR_LOW = 0xb9b3a4;

/** 背景三层（远山 / 中景 / 地面），缺图时自动跳过 */
const BG_LAYERS = ['bg/battle/far.png', 'bg/battle/mid.png', 'bg/battle/ground.png'] as const;

/** 状态图标：按类别上色（与《状态效果系统.md》的 UI 约定一致） */
const STATUS_COLOR: Record<string, number> = {
  control: 0x7b4fa8,
  debuff: 0xa62b1f,
  buff: 0x2f5d4a,
};

/** 场景内一个角色的全部可视元素 */
interface UnitView {
  id: string;
  name: string;
  side: 'ally' | 'enemy';
  group: MotionGroup;
  char: CharacterView;
  x: number;
  y: number;
  hpMax: number;
  hp: number;
  innerMax: number;
  inner: number;
  dead: boolean;
  hpBar: Phaser.GameObjects.Rectangle;
  innerBar: Phaser.GameObjects.Rectangle;
  /** 一行信息：`名字 当前血量`（无底框，用描边保证压在背景上也读得清） */
  infoText: Phaser.GameObjects.Text;
  /** 头顶状态图标（最多 4 个，超出折叠成 +N） */
  statusIcons: Phaser.GameObjects.Container;
  /** 当前生效的状态（id → 剩余回合），回放过程中维护 */
  statuses: { id: StatusId; rounds: number }[];
}

export class BattleScene extends Phaser.Scene {
  private seed = 'demo';
  /**
   * 战斗倾向（玩家唯一的间接控制手段，GDD 02 §2.1.1-5）。
   * 设计推荐默认「优先连招」——它会追求起势/收势匹配，打出 +30%/+60% 的连招。
   */
  private intent: CombatIntent = 'combo';

  private log!: BattleLog;
  private units = new Map<string, UnitView>();
  /** 回放游标：下一条要播的事件下标 */
  private cursor = 0;
  /** 当前事件的剩余演出时间（毫秒） */
  private timer = 0;
  private finished = false;

  private roundText!: Phaser.GameObjects.Text;
  private tipText!: Phaser.GameObjects.Text;
  /** 双方阵法提示（开局公布，让玩家一眼看到阵有没有生效） */
  private allyFormationText!: Phaser.GameObjects.Text;
  private enemyFormationText!: Phaser.GameObjects.Text;

  constructor() {
    super('battle');
  }

  init(data: { seed?: string; intent?: CombatIntent }): void {
    this.seed = data.seed ?? `battle-${Date.now()}`;
    if (data.intent) this.intent = data.intent;
  }

  create(): void {
    this.units.clear();
    this.cursor = 0;
    this.timer = 400; // 开局留一点缓冲，让玩家看清阵型
    this.finished = false;

    // ① 先把整场战斗算完 —— 注意这一行之后，本场景再无任何数值运算
    this.log = simulateBattle({
      allies: DEFAULT_BATTLE.allies,
      enemies: DEFAULT_BATTLE.enemies,
      allyIntent: this.intent,
      enemyIntent: 'output', // 敌方 AI 默认点残血（GDD 02 §6.5.7）
      seed: this.seed,
    });

    // ② 画面（顺序 = 图层顺序，从远到近）
    this.drawBackground();
    this.drawFieldMarks();
    this.drawHud();
    this.buildUnits();

    this.timer = 400;
  }

  /* ══════════════════════ 背景与场地 ══════════════════════ */

  /**
   * 贴图背景三层。缺图时什么都不画 —— 底色是宣纸色，
   * 所以"没有背景"看起来依然是一个干净的水墨空间，而不是黑屏。
   */
  private drawBackground(): void {
    BG_LAYERS.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      this.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(VIEW_W, VIEW_H).setDepth(-20 + i);
    });
  }

  /**
   * 场地标记：**不再画九宫格方框**（有背景后再画格子很出戏），
   * 改为每个站位一个软投影 + 一条极淡的中线墨痕，既能读出"两阵对峙"，
   * 又不会把画面切碎。
   */
  private drawFieldMarks(): void {
    // 中线：左右对峙的视觉锚点
    this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2 + 20, 2, 400, THEME.ink, 0.1)
      .setDepth(-15);

    for (let slot = 0 as SlotIndex; slot < 9; slot = (slot + 1) as SlotIndex) {
      for (const side of ['ally', 'enemy'] as const) {
        const p = slotPosition(slot, side);
        // 站位环（参考视频的做法：深色椭圆环，而不是方格）——
        // 既暗示九宫格的存在，又不把画面切碎
        this.add
          .ellipse(p.x, p.y + SHADOW_Y - 2, FIELD.ringW, FIELD.ringH)
          .setStrokeStyle(1.5, THEME.ink, 0.16)
          .setDepth(-14);
      }
    }
  }

  /** 顶部 HUD：一条半透明墨色横幅，把标题 / 回合 / 阵法信息收成一组 */
  private drawHud(): void {
    // 横幅只占 HUD_H 高：第一行的"状态图标 + 血条 + 内力条 + 姓名"从 y=75 开始
    this.add.rectangle(VIEW_W / 2, HUD_H / 2, VIEW_W, HUD_H, THEME.ink, 0.1).setDepth(-5);

    this.add.text(24, 14, '战斗 · 九宫格对阵', titleStyle(18)).setResolution(2).setDepth(2);

    // 回合徽标：底 + 文字（比裸文字更容易一眼定位）
    this.add.rectangle(VIEW_W / 2, 26, 124, 28, THEME.ink, 0.72).setStrokeStyle(1, THEME.gold, 0.7).setDepth(1);
    this.roundText = this.add
      .text(VIEW_W / 2, 26, '第 1 回合', { ...bodyStyle(15), color: '#f2ecdf' })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(2);

    this.add
      .text(VIEW_W / 2, 48, `种子 ${this.seed}　倾向 ${this.intent === 'combo' ? '优先连招' : '优先输出'}`, {
        ...dimStyle(10),
        color: '#5d564a',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(2);

    this.tipText = this.add
      .text(VIEW_W / 2, VIEW_H - 78, '自动战斗中…', { ...bodyStyle(13), color: '#3a342b' })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(2)
      .setStroke('#efe9da', 4);

    // 阵法提示（我方靠左、敌方靠右，开局即公布）
    this.allyFormationText = this.add
      .text(24, 60, '', { ...dimStyle(11), color: '#4a443a' })
      .setLineSpacing(3)
      .setResolution(2)
      .setDepth(2);
    this.enemyFormationText = this.add
      .text(VIEW_W - 24, 60, '', { ...dimStyle(11), color: '#4a443a' })
      .setOrigin(1, 0)
      .setAlign('right')
      .setLineSpacing(3)
      .setResolution(2)
      .setDepth(2);

    // 底部按钮：收窄，别把画面占满
    createButton(
      this,
      VIEW_W / 2 - 200,
      BUTTON_Y,
      `倾向：${this.intent === 'combo' ? '优先连招' : '优先输出'}`,
      () => this.toggleIntent(),
      BUTTON_W,
      BUTTON_H,
    ).setDepth(3);
    createButton(this, VIEW_W / 2, BUTTON_Y, '重新战斗', () => this.rematch(), BUTTON_W - 20, BUTTON_H).setDepth(3);
    createButton(this, VIEW_W / 2 + 200, BUTTON_Y, '返回菜单', () => this.scene.start('menu'), BUTTON_W - 20, BUTTON_H).setDepth(3);
  }

  /** 战前倾向切换：立刻用同一套阵容 + 新倾向重打一场（设计：倾向是玩家唯一的间接控制手段） */
  private toggleIntent(): void {
    this.scene.restart({ seed: this.seed, intent: this.intent === 'combo' ? 'output' : 'combo' });
  }

  /* ══════════════════════ 角色 ══════════════════════ */

  /** 依据战斗日志的 battleStart 事件创建角色（位置、皮肤、血条全部来自日志/配置表） */
  private buildUnits(): void {
    const start = this.log.events.find((e) => e.type === 'battleStart');
    if (!start || start.type !== 'battleStart') return;

    // 单位表里的 charId 与武器组 → 表现层皮肤（core 不关心贴图，只传 id）
    const byId = new Map([...DEFAULT_BATTLE.allies, ...DEFAULT_BATTLE.enemies].map((u) => [u.id, u]));

    for (const u of start.units) {
      const cfg = byId.get(u.id);
      const p = slotPosition(u.slot, u.side);
      const char = new CharacterView(this, p.x, p.y, u.side === 'ally' ? 1 : -1, {
        ...(cfg?.charId ? { skinId: cfg.charId } : {}),
        weaponGroup: cfg?.group ?? u.group,
        weaponQuality: cfg?.skills[0]?.quality ?? 'fan',
      });
      char.setScale(CHAR_SCALE);
      char.play(`${u.group}_idle`);

      // 脚下软投影：让角色"站在地上"，而不是浮在背景上
      this.add.ellipse(p.x, p.y + SHADOW_Y, FIELD.ringW - 10, FIELD.ringH - 8, THEME.ink, 0.16).setDepth(1);

      // 血条：深色底槽（浅色背景上必须可见）+ 填充（左对齐）
      this.add.rectangle(p.x, p.y + HP_BAR_Y, HP_BAR_W + 2, HP_BAR_H + 2, THEME.ink, 0.55);
      const hpBar = this.add
        .rectangle(p.x - HP_BAR_W / 2, p.y + HP_BAR_Y, HP_BAR_W, HP_BAR_H, THEME.jade)
        .setOrigin(0, 0.5);
      // 内力条：比血条细，放在血条下方（内力是唯一的节奏资源，必须看得见）
      this.add.rectangle(p.x, p.y + INNER_BAR_Y, HP_BAR_W + 2, INNER_BAR_H + 2, THEME.ink, 0.4);
      const innerBar = this.add
        .rectangle(p.x - HP_BAR_W / 2, p.y + INNER_BAR_Y, HP_BAR_W, INNER_BAR_H, INNER_COLOR)
        .setOrigin(0, 0.5);

      // 一行信息：名字 + 当前血量。用描边代替底框 —— 不会和相邻站位"打架"
      const infoText = this.add
        .text(p.x, p.y + INFO_Y, `${u.name} ${u.hpMax}`, { ...dimStyle(11), color: '#2f2a22' })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(2)
        .setStroke('#efe9da', 4);

      const statusIcons = this.add.container(p.x, p.y + STATUS_Y).setDepth(3);

      this.units.set(u.id, {
        id: u.id,
        name: u.name,
        side: u.side,
        group: u.group,
        char,
        x: p.x,
        y: p.y,
        hpMax: u.hpMax,
        hp: u.hpMax,
        innerMax: u.innerMax,
        inner: u.innerMax,
        dead: false,
        hpBar,
        innerBar,
        infoText,
        statusIcons,
        statuses: [],
      });
    }
  }

  /* ══════════════════════ 回放状态机 ══════════════════════ */

  override update(_time: number, delta: number): void {
    // 角色动画始终推进
    for (const u of this.units.values()) u.char.update(delta);

    if (this.finished) return;

    this.timer -= delta;
    if (this.timer > 0) return;
    this.step();
  }

  /** 播下一条事件 */
  private step(): void {
    if (this.cursor >= this.log.events.length) {
      this.finished = true;
      return;
    }
    const ev = this.log.events[this.cursor++]!;
    this.perform(ev);
  }

  /**
   * 演出单条事件。
   * 每个分支末尾都会设置 timer —— 它决定"这条事件占用多少毫秒"，
   * 也就是整场战斗的演出节奏。想整体加快，调这里即可。
   */
  private perform(ev: BattleEvent): void {
    switch (ev.type) {
      case 'battleStart':
        this.timer = 0;
        break;

      case 'formation': {
        // 阵法有三种结果，画面要把差别说清楚，否则玩家不知道"为什么没加成"
        const note =
          ev.result === 'ok' ? '' : ev.result === 'partial' ? '（站位接近，加成减半）' : '（站位不符，未生效）';
        const color =
          ev.result === 'fail' ? THEME.dimHex : ev.side === 'ally' ? THEME.jadeHex : THEME.redHex;
        const text =
          `阵法：${ev.formationName} ${ev.level} 级${note}` +
          (ev.description ? `\n${ev.description}` : '');
        if (ev.side === 'ally') this.allyFormationText.setText(text).setColor(color);
        else this.enemyFormationText.setText(text).setColor(color);
        this.timer = 320;
        break;
      }

      case 'roundStart':
        this.roundText.setText(`第 ${ev.round} 回合`);
        this.timer = 180;
        break;

      case 'act': {
        const actor = this.units.get(ev.actorId);
        // 内力条与"内力 −cost"必须能看见，否则玩家不知道为什么会突然改普攻
        if (actor) {
          actor.inner = ev.innerAfter;
          this.refreshInner(actor);
        }
        const tag = ev.basic ? '（内力不足·普攻）' : '';
        this.tipText.setText(`${ev.actorName} · ${ev.skillName}${tag}`);
        if (actor) {
          // 攻击动作播到"命中"那一刻，由 CharacterView 的 onHit 回调触发受击，
          // 所以这里不需要硬编码任何时间
          actor.char.play(`${actor.group}_atk_a`);
          if (ev.comboStage >= 2) {
            this.floatText(
              actor.x,
              actor.y - 128,
              ev.comboStage === 3 ? '三连！' : '连招 ×2',
              THEME.goldHex,
              ev.comboStage === 3 ? 24 : 18,
            );
          } else if (ev.basic) {
            this.floatText(actor.x, actor.y - 128, '普攻', THEME.dimHex, 15);
          }
        }
        // 占据攻击动作约 60% 的时长，之后接伤害事件（看起来才像"打中了"）
        const clip = getMotion(`${actor?.group ?? 'dao'}_atk_a`);
        this.timer = Math.round((clip?.duration ?? 500) * 0.6);
        break;
      }

      case 'damage': {
        const target = this.units.get(ev.targetId);
        if (target) {
          target.hp = ev.hpAfter;
          target.char.play(`${target.group}_hit`);
          this.refreshHp(target);
          this.cameras.main.shake(ev.crit ? 130 : 80, ev.crit ? 0.006 : 0.003);
          this.floatText(
            target.x,
            target.y - 100,
            ev.crit ? `暴击 ${ev.value}` : `${ev.value}`,
            ev.crit ? THEME.redHex : '#2b2620',
            ev.crit ? 26 : 21,
          );
        }
        this.timer = 320;
        break;
      }

      case 'miss': {
        const target = this.units.get(ev.targetId);
        if (target) {
          this.floatText(target.x, target.y - 100, '闪避', THEME.dimHex, 18);
        }
        this.timer = 220;
        break;
      }

      case 'statusApplied': {
        const target = this.units.get(ev.targetId);
        if (target) {
          this.floatText(target.x, target.y - 116, `【${statusName(ev.statusId)}】`, THEME.goldHex, 15);
          const existing = target.statuses.find((s) => s.id === ev.statusId);
          if (existing) existing.rounds = Math.max(existing.rounds, ev.rounds);
          else target.statuses.push({ id: ev.statusId, rounds: ev.rounds });
          this.renderStatusIcons(target);
        }
        this.timer = 180;
        break;
      }

      case 'statusExpired': {
        const target = this.units.get(ev.targetId);
        if (target) {
          target.statuses = target.statuses.filter((s) => s.id !== ev.statusId);
          this.renderStatusIcons(target);
        }
        this.timer = 60;
        break;
      }

      case 'dot': {
        const target = this.units.get(ev.targetId);
        if (target) {
          target.hp = ev.hpAfter;
          this.refreshHp(target);
          this.floatText(target.x, target.y - 100, `-${ev.value}`, THEME.redHex, 17);
        }
        this.timer = 200;
        break;
      }

      case 'heal': {
        // 回春：持续回复（曾经被错算成每回合扣 1 点血，现在是治疗）
        const u = this.units.get(ev.targetId);
        if (u) {
          u.hp = ev.hpAfter;
          this.refreshHp(u);
          this.floatText(u.x, u.y - 100, `+${ev.value}`, THEME.jadeHex, 17);
        }
        this.timer = 200;
        break;
      }

      case 'reflect': {
        // 天罡北斗阵的反震：伤害弹回攻击者
        const u = this.units.get(ev.targetId);
        if (u) {
          u.hp = ev.hpAfter;
          this.refreshHp(u);
          this.floatText(u.x, u.y - 100, `反弹 ${ev.value}`, THEME.goldHex, 18);
        }
        this.timer = 240;
        break;
      }

      case 'immune': {
        // 守境阵「首次受制可免」
        const u = this.units.get(ev.targetId);
        if (u) this.floatText(u.x, u.y - 116, '免疫', THEME.goldHex, 18);
        this.timer = 220;
        break;
      }

      case 'skip': {
        const actor = this.units.get(ev.actorId);
        if (actor) this.floatText(actor.x, actor.y - 116, `被${ev.reason}`, THEME.goldHex, 15);
        this.timer = 260;
        break;
      }

      case 'death': {
        const u = this.units.get(ev.unitId);
        if (u) {
          u.dead = true;
          u.hp = 0;
          u.char.play(`${u.group}_down`);
          u.char.setAlpha(0.7);
          u.hpBar.width = 0;
          u.infoText.setText(`${u.name} 0`).setAlpha(0.45);
          // 阵亡后状态一律清空（尸体不该还挂着中毒图标）
          u.statuses = [];
          this.renderStatusIcons(u);
        }
        this.timer = 380;
        break;
      }

      case 'battleEnd': {
        const text =
          ev.winner === 'ally' ? '胜！' : ev.winner === 'enemy' ? '败' : '未分胜负';
        this.tipText.setText(
          `${text}　共 ${ev.rounds} 回合　我方存活 ${ev.allyAlive} / 敌方存活 ${ev.enemyAlive}`,
        );
        this.floatText(VIEW_W / 2, VIEW_H / 2 - 40, text, ev.winner === 'ally' ? THEME.goldHex : THEME.redHex, 44);
        this.finished = true;
        this.timer = 0;
        break;
      }

      default:
        this.timer = 0;
    }
  }

  /* ══════════════════════ 视觉更新 ══════════════════════ */

  /** 刷新血条与信息行（按剩余比例变色，低血更醒目） */
  private refreshHp(u: UnitView): void {
    const ratio = Math.max(0, Math.min(1, u.hp / u.hpMax));
    u.hpBar.width = HP_BAR_W * ratio;
    const color = ratio > 0.5 ? THEME.jade : ratio > 0.22 ? THEME.gold : THEME.red;
    u.hpBar.setFillStyle(color);
    u.infoText.setText(`${u.name} ${u.hp}`);
    if (ratio <= 0.22) u.infoText.setColor(THEME.redHex);
  }

  /** 刷新内力条（内力见底时变灰，提示"下一手只能普攻"） */
  private refreshInner(u: UnitView): void {
    const ratio = Math.max(0, Math.min(1, u.innerMax > 0 ? u.inner / u.innerMax : 0));
    u.innerBar.width = HP_BAR_W * ratio;
    u.innerBar.setFillStyle(ratio > 0.15 ? INNER_COLOR : INNER_COLOR_LOW);
  }

  /**
   * 重绘头顶状态图标：最多 4 个彩色小方块 + 首字，超出折叠成「+N」。
   * 为什么必须有它？战斗里有 22 种状态、还可能叠层 ——
   * 不给玩家读数，他只能靠飘字回忆，等于把策略信息藏起来了。
   */
  private renderStatusIcons(u: UnitView): void {
    u.statusIcons.removeAll(true);
    if (u.dead || u.statuses.length === 0) return;

    const shown = u.statuses.slice(0, 4);
    const size = 15;
    const gap = 2;
    const totalW = shown.length * size + (shown.length - 1) * gap;
    shown.forEach((s, i) => {
      const def = STATUS_BY_ID[s.id];
      const color = STATUS_COLOR[def?.kind ?? 'debuff'] ?? 0x555555;
      const x = -totalW / 2 + i * (size + gap) + size / 2;
      const box = this.add.rectangle(x, 0, size, size, color, 0.92).setStrokeStyle(1, 0xefe9da, 0.5);
      const label = this.add
        .text(x, 0, (def?.name ?? s.id).slice(0, 1), {
          ...dimStyle(10),
          color: '#f7f4ec',
        })
        .setOrigin(0.5)
        .setResolution(2);
      u.statusIcons.add(box);
      u.statusIcons.add(label);
    });

    if (u.statuses.length > shown.length) {
      const more = this.add
        .text(totalW / 2 + 8, 0, `+${u.statuses.length - shown.length}`, {
          ...dimStyle(10),
          color: '#f7f4ec',
        })
        .setOrigin(0, 0.5)
        .setResolution(2);
      u.statusIcons.add(more);
    }
  }

  /** 飘字：向上飘并淡出（带浅色描边，保证压在背景纹理上也读得清） */
  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        fontSize: `${size}px`,
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5)
      .setStroke('#f2eee4', 4);
    this.tweens.add({
      targets: t,
      y: y - 42,
      alpha: 0,
      duration: 760,
      ease: 'sineOut',
      onComplete: () => t.destroy(),
    });
  }

  /** 换一个种子重新打一场（同一套阵容，结果会不同） */
  private rematch(): void {
    this.scene.restart({ seed: `battle-${Math.floor(Math.random() * 1e9)}` });
  }
}

/** 状态 id → 中文名（用于飘字与状态图标） */
function statusName(id: string): string {
  return STATUS_BY_ID[id as StatusId]?.name ?? id;
}
