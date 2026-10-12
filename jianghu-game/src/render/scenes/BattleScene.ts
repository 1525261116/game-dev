/**
 * 战斗场景（BattleScene）：**回放** core 层算好的战斗日志。
 *
 * ══════════════════════════════════════════════════════════════════
 * 这个文件刻意不包含任何数值计算。
 *   它做三件事：① 拿到 BattleLog ② 按事件顺序演出 ③ 更新血条与飘字
 *
 * 数值全部来自 core/battle/simulate.ts 算好的结果，这里只是"放录像"。
 * 所以：
 *   · 同一场战斗可以换任何速度回放，结果不会变
 *   · 表现出错不会污染数值，数值出错也不会被画面掩盖
 * ══════════════════════════════════════════════════════════════════
 */
import Phaser from 'phaser';
import { simulateBattle } from '../../core/battle/simulate.ts';
import { DEFAULT_BATTLE } from '../../data/battle-presets.ts';
import { getMotion } from '../anim/MotionLib.ts';
import { CharacterView } from '../anim/CharacterView.ts';
import { THEME, bodyStyle, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';
import type { BattleEvent, BattleLog } from '../../core/battle/simulate.ts';
import type { MotionGroup } from '../../core/anim/types.ts';
import type { SlotIndex } from '../../core/battle/types.ts';
import type { CombatIntent } from '../../core/battle/targeting.ts';

const VIEW_W = 960;
const VIEW_H = 540;
const CELL_W = 92;
const CELL_H = 104;
const HP_BAR_W = 88;
const HP_BAR_H = 6;
const INNER_BAR_H = 3;
/** 内力条颜色：充足=靛蓝，见底=灰（一眼看出下一手会不会退化成普攻） */
const INNER_COLOR = 0x4a6fd4;
const INNER_COLOR_LOW = 0xb9b3a4;

/** 九宫格站位 → 屏幕坐标（与布阵逻辑一致） */
function slotPosition(slot: SlotIndex, side: 'ally' | 'enemy'): { x: number; y: number } {
  const row = Math.floor(slot / 3); // 0 前排 / 1 中排 / 2 后排
  const col = slot % 3; // 0 上 / 1 中 / 2 下
  const depthX = [352, 258, 164][row]!;
  const y = 158 + col * 116;
  return side === 'ally' ? { x: depthX, y } : { x: VIEW_W - depthX, y };
}

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
  hpText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
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

    this.add.text(24, 18, '战斗 · 九宫格对阵', titleStyle(18)).setResolution(2);
    this.add.text(24, 44, `种子 ${this.seed}`, dimStyle(11)).setResolution(2);
    this.add
      .text(24, 60, `倾向 ${this.intent === 'combo' ? '优先连招' : '优先输出'}`, dimStyle(11))
      .setResolution(2);

    this.roundText = this.add
      .text(VIEW_W / 2, 26, '', bodyStyle(15))
      .setOrigin(0.5, 0)
      .setResolution(2);

    this.tipText = this.add
      .text(VIEW_W / 2, VIEW_H - 78, '自动战斗中…', bodyStyle(13))
      .setOrigin(0.5)
      .setResolution(2);

    // 阵法提示（我方靠左、敌方靠右，开局即公布）
    this.allyFormationText = this.add.text(24, 72, '', dimStyle(11)).setLineSpacing(3).setResolution(2);
    this.enemyFormationText = this.add
      .text(VIEW_W - 24, 72, '', dimStyle(11))
      .setOrigin(1, 0)
      .setAlign('right')
      .setLineSpacing(3)
      .setResolution(2);

    this.drawGrid();
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2 + 10, 1, 380, THEME.gold, 0.28);
    this.buildUnits();

    createButton(this, VIEW_W / 2 - 190, VIEW_H - 36, `倾向：${this.intent === 'combo' ? '优先连招' : '优先输出'}`, () => this.toggleIntent(), 170, 40);
    createButton(this, VIEW_W / 2, VIEW_H - 36, '重新战斗', () => this.rematch(), 160, 40);
    createButton(this, VIEW_W / 2 + 190, VIEW_H - 36, '返回菜单', () => this.scene.start('menu'), 160, 40);
  }

  /** 战前倾向切换：立刻用同一套阵容 + 新倾向重打一场（设计：倾向是玩家唯一的间接控制手段） */
  private toggleIntent(): void {
    this.scene.restart({ seed: this.seed, intent: this.intent === 'combo' ? 'output' : 'combo' });
  }

  /** 画九宫格站位框（双方各 9 格） */
  private drawGrid(): void {
    for (let slot = 0 as SlotIndex; slot < 9; slot = (slot + 1) as SlotIndex) {
      for (const side of ['ally', 'enemy'] as const) {
        const p = slotPosition(slot, side);
        this.add
          .rectangle(p.x, p.y, CELL_W, CELL_H, THEME.paperLight, 0.35)
          .setStrokeStyle(1, THEME.line, 0.9);
      }
    }
  }

  /** 依据战斗日志的 battleStart 事件创建角色（位置、朝向、血条全部来自日志） */
  private buildUnits(): void {
    const start = this.log.events.find((e) => e.type === 'battleStart');
    if (!start || start.type !== 'battleStart') return;

    for (const u of start.units) {
      const p = slotPosition(u.slot, u.side);
      const char = new CharacterView(this, p.x, p.y, u.side === 'ally' ? 1 : -1);
      char.setScale(0.55);
      char.play(`${u.group}_idle`);

      // 血条：底槽 + 填充（左对齐）
      this.add.rectangle(p.x, p.y - 62, HP_BAR_W, HP_BAR_H, 0x000000, 0.18);
      const hpBar = this.add
        .rectangle(p.x - HP_BAR_W / 2, p.y - 62, HP_BAR_W, HP_BAR_H, THEME.jade)
        .setOrigin(0, 0.5);
      // 内力条：比血条细，放在血条下方（内力是唯一的节奏资源，必须看得见）
      this.add.rectangle(p.x, p.y - 54, HP_BAR_W, INNER_BAR_H, 0x000000, 0.14);
      const innerBar = this.add
        .rectangle(p.x - HP_BAR_W / 2, p.y - 54, HP_BAR_W, INNER_BAR_H, INNER_COLOR)
        .setOrigin(0, 0.5);
      const hpText = this.add
        .text(p.x, p.y - 74, `${u.hpMax}`, dimStyle(10))
        .setOrigin(0.5)
        .setResolution(2);
      const nameText = this.add
        .text(p.x, p.y + 58, `${u.name}`, dimStyle(11))
        .setOrigin(0.5)
        .setResolution(2);

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
        hpText,
        nameText,
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
              actor.y - 118,
              ev.comboStage === 3 ? '三连！' : '连招 ×2',
              THEME.goldHex,
              ev.comboStage === 3 ? 24 : 18,
            );
          } else if (ev.basic) {
            this.floatText(actor.x, actor.y - 118, '普攻', THEME.dimHex, 15);
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
            target.y - 78,
            ev.crit ? `暴击 ${ev.value}` : `${ev.value}`,
            ev.crit ? THEME.redHex : THEME.inkHex,
            ev.crit ? 26 : 21,
          );
        }
        this.timer = 320;
        break;
      }

      case 'miss': {
        const target = this.units.get(ev.targetId);
        if (target) {
          this.floatText(target.x, target.y - 78, '闪避', THEME.dimHex, 18);
        }
        this.timer = 220;
        break;
      }

      case 'statusApplied': {
        const target = this.units.get(ev.targetId);
        if (target) {
          this.floatText(target.x, target.y - 100, `【${statusName(ev.statusId)}】`, THEME.goldHex, 15);
        }
        this.timer = 180;
        break;
      }

      case 'dot': {
        const target = this.units.get(ev.targetId);
        if (target) {
          target.hp = ev.hpAfter;
          this.refreshHp(target);
          this.floatText(target.x, target.y - 78, `-${ev.value}`, THEME.jadeHex, 17);
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
          this.floatText(u.x, u.y - 78, `+${ev.value}`, THEME.jadeHex, 17);
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
          this.floatText(u.x, u.y - 78, `反弹 ${ev.value}`, THEME.goldHex, 18);
        }
        this.timer = 240;
        break;
      }

      case 'immune': {
        // 守境阵「首次受制可免」
        const u = this.units.get(ev.targetId);
        if (u) this.floatText(u.x, u.y - 100, '免疫', THEME.goldHex, 18);
        this.timer = 220;
        break;
      }

      case 'skip': {
        const actor = this.units.get(ev.actorId);
        if (actor) this.floatText(actor.x, actor.y - 78, `被${ev.reason}`, THEME.goldHex, 15);
        this.timer = 260;
        break;
      }

      case 'death': {
        const u = this.units.get(ev.unitId);
        if (u) {
          u.dead = true;
          u.hp = 0;
          u.char.play(`${u.group}_down`);
          u.hpBar.width = 0;
          u.hpText.setText('0');
          u.nameText.setAlpha(0.4);
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

  /** 刷新血条（按剩余比例变色，低血更醒目） */
  private refreshHp(u: UnitView): void {
    const ratio = Math.max(0, Math.min(1, u.hp / u.hpMax));
    u.hpBar.width = HP_BAR_W * ratio;
    u.hpBar.setFillStyle(ratio > 0.5 ? THEME.jade : ratio > 0.22 ? THEME.gold : THEME.red);
    u.hpText.setText(`${u.hp}`);
  }

  /** 刷新内力条（内力见底时变暗，提示"下一手只能普攻"） */
  private refreshInner(u: UnitView): void {
    const ratio = Math.max(0, Math.min(1, u.innerMax > 0 ? u.inner / u.innerMax : 0));
    u.innerBar.width = HP_BAR_W * ratio;
    u.innerBar.setFillStyle(ratio > 0.15 ? INNER_COLOR : INNER_COLOR_LOW);
  }

  /** 飘字：向上飘并淡出（对象池级别的开销，用完即销毁） */
  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        fontSize: `${size}px`,
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setResolution(2);
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

/** 状态 id → 中文名（用于飘字显示） */
function statusName(id: string): string {
  const map: Record<string, string> = {
    stun: '眩晕',
    seal: '封穴',
    root: '定身',
    knockback: '击退',
    defDown: '破防',
    atkDown: '虚弱',
    spdDown: '迟滞',
    poison: '中毒',
    bleed: '流血',
    burn: '灼烧',
    shield: '护盾',
    regen: '回复',
    ironWall: '铁壁',
  };
  return map[id] ?? id;
}
