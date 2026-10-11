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

const VIEW_W = 960;
const VIEW_H = 540;
const CELL_W = 92;
const CELL_H = 104;
const HP_BAR_W = 88;
const HP_BAR_H = 6;

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
  dead: boolean;
  hpBar: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private seed = 'demo';

  private log!: BattleLog;
  private units = new Map<string, UnitView>();
  /** 回放游标：下一条要播的事件下标 */
  private cursor = 0;
  /** 当前事件的剩余演出时间（毫秒） */
  private timer = 0;
  private finished = false;

  private roundText!: Phaser.GameObjects.Text;
  private tipText!: Phaser.GameObjects.Text;

  constructor() {
    super('battle');
  }

  init(data: { seed?: string }): void {
    this.seed = data.seed ?? `battle-${Date.now()}`;
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
      seed: this.seed,
    });

    this.add.text(24, 18, '战斗 · 九宫格对阵', titleStyle(18)).setResolution(2);
    this.add.text(24, 44, `种子 ${this.seed}`, dimStyle(11)).setResolution(2);

    this.roundText = this.add
      .text(VIEW_W / 2, 26, '', bodyStyle(15))
      .setOrigin(0.5, 0)
      .setResolution(2);

    this.tipText = this.add
      .text(VIEW_W / 2, VIEW_H - 78, '自动战斗中…', bodyStyle(13))
      .setOrigin(0.5)
      .setResolution(2);

    this.drawGrid();
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2 + 10, 1, 380, THEME.gold, 0.28);
    this.buildUnits();

    createButton(this, VIEW_W / 2 - 100, VIEW_H - 36, '重新战斗', () => this.rematch(), 160, 40);
    createButton(this, VIEW_W / 2 + 100, VIEW_H - 36, '返回菜单', () => this.scene.start('menu'), 160, 40);
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
      const hpText = this.add
        .text(p.x, p.y - 74, `${u.hpMax}`, dimStyle(10))
        .setOrigin(0.5)
        .setResolution(2);
      const nameText = this.add
        .text(p.x, p.y + 58, u.name, dimStyle(11))
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
        dead: false,
        hpBar,
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

      case 'roundStart':
        this.roundText.setText(`第 ${ev.round} 回合`);
        this.timer = 180;
        break;

      case 'act': {
        const actor = this.units.get(ev.actorId);
        this.tipText.setText(`${ev.actorName} · ${ev.skillName}`);
        if (actor) {
          // 攻击动作播到"命中"那一刻，由 CharacterView 的 onHit 回调触发受击，
          // 所以这里不需要硬编码任何时间
          actor.char.play(`${actor.group}_atk_a`);
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
