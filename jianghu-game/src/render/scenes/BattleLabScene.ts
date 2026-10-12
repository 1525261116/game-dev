/**
 * 战斗验证台（BattleLabScene）—— 给项目主人自己验证数值用的工具场景。
 *
 * 它不是给玩家看的，而是回答你这些问题的：
 *   · 这一场到底发生了什么？（逐条战斗日志）
 *   · 这个阵法到底有没有生效？（切换阵法即时对比）
 *   · 数值平衡不合理吗？（100 场批量模拟 + 回合分布）
 *   · 结果可信吗？（改种子重放，同种子必然同结果）
 *
 * 布局：
 *   左上 战斗回放　　右下 控制与统计　　底部 实时日志
 *
 * 与 BattleScene 的关系：
 *   BattleScene 是"给玩家看的一场战斗"；本场景是"给你看的显微镜"。
 *   两者都只回放 core 算好的日志，都不参与任何数值计算。
 */
import Phaser from 'phaser';
import { simulateBattle, simulateMany } from '../../core/battle/simulate.ts';
import { DEFAULT_BATTLE } from '../../data/battle-presets.ts';
import { FORMATIONS } from '../../data/formations.ts';
import { CharacterView } from '../anim/CharacterView.ts';
import { THEME, bodyStyle, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';
import type { BattleEvent, BattleLog } from '../../core/battle/simulate.ts';
import type { MotionGroup } from '../../core/anim/types.ts';
import type { SlotIndex } from '../../core/battle/types.ts';
import type { CombatIntent } from '../../core/battle/targeting.ts';

const VIEW_W = 960;
const VIEW_H = 540;

/** 回放区（左侧） */
const FIELD = { x0: 16, x1: 566, y0: 76, y1: 432 };
/** 日志区（底部） */
const LOG_TOP = 444;
/** 面板区（右侧） */
const PANEL_X = 580;

/** 回放速度档位 */
const SPEEDS = [0.5, 1, 2, 4, 99] as const;
const SPEED_LABEL = ['0.5×', '1×', '2×', '4×', '瞬间'] as const;

/** 紧凑九宫格站位 → 屏幕坐标（比 BattleScene 更小，为了塞下日志与面板） */
function labSlotPosition(slot: SlotIndex, side: 'ally' | 'enemy'): { x: number; y: number } {
  const row = Math.floor(slot / 3); // 0 前排 / 1 中排 / 2 后排
  const col = slot % 3; // 0 上 / 1 中 / 2 下
  const depthX = [268, 200, 132][row]!;
  const y = FIELD.y0 + 54 + col * 104;
  return side === 'ally' ? { x: depthX, y } : { x: 566 - depthX, y };
}

interface LabUnit {
  id: string;
  name: string;
  side: 'ally' | 'enemy';
  group: MotionGroup;
  char: CharacterView;
  x: number;
  y: number;
  hpMax: number;
  hp: number;
  hpBar: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
}

export class BattleLabScene extends Phaser.Scene {
  /** 当前种子（可通过"换种子"按钮改变） */
  private seed = 'lab-1';
  /** 速度档位下标 */
  private speedIdx = 1;
  /** 我方阵法下标；-1 表示不使用阵法 */
  private allyFmIdx = -1;
  /** 敌方阵法下标 */
  private enemyFmIdx = -1;

  private log!: BattleLog;
  private units = new Map<string, LabUnit>();
  private cursor = 0;
  private timer = 0;
  private finished = false;

  /** 日志行（只保留最近若干行，避免文本无限增长拖慢渲染） */
  private lines: string[] = [];
  private logText!: Phaser.GameObjects.Text;
  private statText!: Phaser.GameObjects.Text;
  private seedText!: Phaser.GameObjects.Text;
  private fmText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  /** 战斗倾向：决定"放哪门功法"与"打谁"（GDD 02 §2.1.1-5） */
  private intent: CombatIntent = 'combo';

  constructor() {
    super('battle-lab');
  }

  init(data: { seed?: string; allyFmIdx?: number; enemyFmIdx?: number; speedIdx?: number; intent?: CombatIntent }): void {
    if (data.seed !== undefined) this.seed = data.seed;
    if (data.allyFmIdx !== undefined) this.allyFmIdx = data.allyFmIdx;
    if (data.enemyFmIdx !== undefined) this.enemyFmIdx = data.enemyFmIdx;
    if (data.speedIdx !== undefined) this.speedIdx = data.speedIdx;
    if (data.intent !== undefined) this.intent = data.intent;
  }

  /** 当前选中的阵法（null = 不使用） */
  private allyFormation() {
    const f = this.allyFmIdx >= 0 ? FORMATIONS[this.allyFmIdx] : undefined;
    return f ? { id: f.id, level: 5 } : undefined;
  }

  private enemyFormation() {
    const f = this.enemyFmIdx >= 0 ? FORMATIONS[this.enemyFmIdx] : undefined;
    return f ? { id: f.id, level: 5 } : undefined;
  }

  create(): void {
    this.units.clear();
    this.cursor = 0;
    this.timer = 0;
    this.finished = false;
    this.lines = [];

    const af = this.allyFormation();
    const ef = this.enemyFormation();

    // ① 算完一整场（本场景同样不做任何数值计算）
    this.log = simulateBattle({
      allies: DEFAULT_BATTLE.allies,
      enemies: DEFAULT_BATTLE.enemies,
      allyIntent: this.intent,
      enemyIntent: this.intent,
      ...(af ? { allyFormation: af } : {}),
      ...(ef ? { enemyFormation: ef } : {}),
      seed: this.seed,
    });

    this.buildStaticUi();
    this.buildUnits();
    this.refreshInfo();
    this.renderLog();
    // 开局先跑一次批量统计，让你一眼看到整体平衡
    this.runBatch();
  }

  /* ══════════════════════ 界面 ══════════════════════ */

  private buildStaticUi(): void {
    this.add.text(16, 14, '战斗验证台', titleStyle(18)).setResolution(2);
    this.add
      .text(16, 40, '重放 · 日志 · 批量统计 · 阵法对比（本页是给你验证数值用的，不是玩家界面）', dimStyle(11))
      .setResolution(2);

    // 回放区边框
    this.add
      .rectangle((FIELD.x0 + FIELD.x1) / 2, (FIELD.y0 + FIELD.y1) / 2, FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0, THEME.paperLight, 0.25)
      .setStrokeStyle(1, THEME.line, 0.8);

    this.roundText = this.add
      .text((FIELD.x0 + FIELD.x1) / 2, FIELD.y0 + 8, '', bodyStyle(12))
      .setOrigin(0.5, 0)
      .setResolution(2);

    // 右侧面板
    this.add
      .rectangle(PANEL_X + 182, (FIELD.y0 + FIELD.y1 + 90) / 2, 364, FIELD.y1 - FIELD.y0 + 90, THEME.paperLight, 0.25)
      .setStrokeStyle(1, THEME.line, 0.8);

    this.seedText = this.add.text(PANEL_X + 10, FIELD.y0 + 10, '', bodyStyle(12)).setLineSpacing(4).setResolution(2);
    this.fmText = this.add.text(PANEL_X + 10, FIELD.y0 + 76, '', dimStyle(11)).setLineSpacing(4).setResolution(2);
    this.speedText = this.add.text(PANEL_X + 10, FIELD.y0 + 148, '', dimStyle(11)).setResolution(2);

    // 控制按钮
    let by = FIELD.y0 + 176;
    createButton(this, PANEL_X + 90, by, '换种子重放', () => this.restart({ seed: `lab-${Math.floor(Math.random() * 1e9)}` }), 168, 30);
    by += 38;
    createButton(this, PANEL_X + 50, by, '回放速度', () => this.restart({ speedIdx: (this.speedIdx + 1) % SPEEDS.length }), 96, 30);
    createButton(
      this,
      PANEL_X + 152,
      by,
      this.intent === 'combo' ? '倾向·连招' : '倾向·输出',
      () => this.toggleIntent(),
      96,
      30,
    );
    by += 38;
    createButton(this, PANEL_X + 90, by, '我方阵法 ▸', () => this.restart({ allyFmIdx: nextFormationIdx(this.allyFmIdx) }), 168, 30);
    by += 38;
    createButton(this, PANEL_X + 90, by, '敌方阵法 ▸', () => this.restart({ enemyFmIdx: nextFormationIdx(this.enemyFmIdx) }), 168, 30);
    by += 38;
    createButton(this, PANEL_X + 90, by, '重跑 100 场统计', () => this.runBatch(), 168, 30);

    this.statText = this.add
      .text(PANEL_X + 10, by + 26, '', dimStyle(11))
      .setLineSpacing(4)
      .setResolution(2);

    // 底部日志
    this.add.text(16, LOG_TOP - 2, '战斗日志（逐条回放）', dimStyle(11)).setResolution(2);
    this.logText = this.add
      .text(16, LOG_TOP + 16, '', {
        fontFamily: '"SF Mono", Menlo, Consolas, monospace',
        fontSize: '11px',
        color: THEME.inkHex,
      })
      .setLineSpacing(3)
      .setResolution(2);

    createButton(this, VIEW_W - 66, 26, '返回', () => this.scene.start('menu'), 104, 32);
  }

  private buildUnits(): void {
    const start = this.log.events.find((e) => e.type === 'battleStart');
    if (!start || start.type !== 'battleStart') return;

    for (const u of start.units) {
      const p = labSlotPosition(u.slot, u.side);
      const char = new CharacterView(this, p.x, p.y, u.side === 'ally' ? 1 : -1);
      char.setScale(0.32);
      char.play(`${u.group}_idle`);

      this.add.rectangle(p.x, p.y - 34, 62, 5, 0x000000, 0.18);
      const hpBar = this.add.rectangle(p.x - 31, p.y - 34, 62, 5, THEME.jade).setOrigin(0, 0.5);
      const hpText = this.add
        .text(p.x, p.y - 46, `${u.hpMax}`, dimStyle(9))
        .setOrigin(0.5)
        .setResolution(2);
      this.add
        .text(p.x, p.y + 32, u.name, dimStyle(9))
        .setOrigin(0.5)
        .setResolution(2);

      this.units.set(u.id, {
        id: u.id, name: u.name, side: u.side, group: u.group,
        char, x: p.x, y: p.y, hpMax: u.hpMax, hp: u.hpMax, hpBar, hpText,
      });
    }
  }

  /** 刷新种子 / 阵法 / 速度三块信息 */
  private refreshInfo(): void {
    const fmt = (idx: number): string =>
      idx < 0 ? '无' : `${FORMATIONS[idx]!.name} 5 级`;

    this.seedText.setText([
      `种子：${this.seed}`,
      `预计回合：${this.log.rounds}`,
      `结果：${this.log.winner === 'ally' ? '我方胜' : this.log.winner === 'enemy' ? '敌方胜' : '平局'}`,
      `连招 ${this.log.stats.comboStage2}　三连 ${this.log.stats.comboStage3}　普攻 ${this.log.stats.basicAttacks}`,
    ]);
    this.fmText.setText([`我方阵法：${fmt(this.allyFmIdx)}`, `敌方阵法：${fmt(this.enemyFmIdx)}`]);
    this.speedText.setText(
      `回放速度：${SPEED_LABEL[this.speedIdx]}　倾向：${this.intent === 'combo' ? '优先连招' : '优先输出'}`,
    );
  }

  private restart(patch: {
    seed?: string;
    allyFmIdx?: number;
    enemyFmIdx?: number;
    speedIdx?: number;
    intent?: CombatIntent;
  }): void {
    this.scene.restart({
      seed: patch.seed ?? this.seed,
      allyFmIdx: patch.allyFmIdx ?? this.allyFmIdx,
      enemyFmIdx: patch.enemyFmIdx ?? this.enemyFmIdx,
      speedIdx: patch.speedIdx ?? this.speedIdx,
      intent: patch.intent ?? this.intent,
    });
  }

  /** 切换战斗倾向（同一套阵容、同一个种子，对比召唤/输出两种打法） */
  private toggleIntent(): void {
    this.restart({ intent: this.intent === 'combo' ? 'output' : 'combo' });
  }

  /* ══════════════════════ 批量统计 ══════════════════════ */

  private runBatch(): void {
    const af = this.allyFormation();
    const ef = this.enemyFormation();
    const s = simulateMany(
      {
        allies: DEFAULT_BATTLE.allies,
        enemies: DEFAULT_BATTLE.enemies,
        allyIntent: this.intent,
        enemyIntent: this.intent,
        ...(af ? { allyFormation: af } : {}),
        ...(ef ? { enemyFormation: ef } : {}),
      },
      100,
    );

    // 回合分布压成一行（原来逐回合竖排会被挤出画面，看不到直方图）
    const rounds = Object.keys(s.roundHistogram).map(Number).sort((a, b) => a - b);
    const bars = rounds.map((r) => `${r}回合×${s.roundHistogram[r]}`).join('　');

    this.statText.setText([
      '── 100 场模拟 ──',
      `胜率 ${(s.allyWinRate * 100).toFixed(1)}%　平均 ${s.avgRounds.toFixed(2)} 回合`,
      `输出 我 ${s.avgAllyDamage.toFixed(0)} / 敌 ${s.avgEnemyDamage.toFixed(0)}`,
      `连招 ${s.avgComboStage2.toFixed(1)}　三连 ${s.avgComboStage3.toFixed(1)}　普攻 ${s.avgBasicAttacks.toFixed(1)}`,
      `反弹 ${s.avgReflectDamage.toFixed(1)}　分布 ${bars}`,
    ]);
  }

  /* ══════════════════════ 回放 ══════════════════════ */

  override update(_time: number, delta: number): void {
    for (const u of this.units.values()) u.char.update(delta);
    if (this.finished) return;

    const speed = SPEEDS[this.speedIdx]!;
    this.timer -= delta * speed;
    // 一步最多播若干条，避免"瞬间"模式下一帧卡死
    let guard = 0;
    while (this.timer <= 0 && !this.finished && guard++ < 200) this.step();
    if (this.finished) this.renderLog();
  }

  private step(): void {
    if (this.cursor >= this.log.events.length) {
      this.finished = true;
      return;
    }
    const ev = this.log.events[this.cursor++]!;
    this.perform(ev);
    if (this.cursor % 4 === 0 || this.finished) this.renderLog();
  }

  private perform(ev: BattleEvent): void {
    switch (ev.type) {
      case 'battleStart':
        this.timer = 0;
        break;

      case 'formation': {
        const note = ev.result === 'ok' ? '生效' : ev.result === 'partial' ? '减半' : '未生效';
        this.pushLog(`【阵法】${ev.side === 'ally' ? '我' : '敌'} ${ev.formationName} → ${note}${ev.description ? '｜' + ev.description : ''}`);
        this.timer = 240;
        break;
      }

      case 'roundStart':
        this.roundText.setText(`第 ${ev.round} 回合`);
        this.pushLog(`── 第 ${ev.round} 回合 ──`);
        this.timer = 140;
        break;

      case 'act': {
        const actor = this.units.get(ev.actorId);
        if (actor) actor.char.play(`${actor.group}_atk_a`);
        const combo =
          ev.comboStage === 3 ? ' 三连+60%' : ev.comboStage === 2 ? ' 连招+30%' : '';
        const basic = ev.basic ? '（内力不足·普攻）' : ` 内力-${ev.cost}→${ev.innerAfter}`;
        this.pushLog(
          `${ev.actorName} 施展「${ev.skillName}」[${ev.range}] → ${ev.targetIds.length} 目标${basic}${combo}`,
        );
        this.timer = 200;
        break;
      }

      case 'damage': {
        const t = this.units.get(ev.targetId);
        if (t) {
          t.hp = ev.hpAfter;
          t.char.play(`${t.group}_hit`);
          this.refreshHp(t);
        }
        this.pushLog(`　└ ${t?.name ?? ev.targetId} ${ev.crit ? '暴击 ' : ''}受 ${ev.value} 点（余 ${ev.hpAfter}）`);
        this.timer = 200;
        break;
      }

      case 'miss': {
        const t = this.units.get(ev.targetId);
        this.pushLog(`　└ ${t?.name ?? ev.targetId} 闪避`);
        this.timer = 140;
        break;
      }

      case 'reflect': {
        const t = this.units.get(ev.targetId);
        if (t) {
          t.hp = ev.hpAfter;
          this.refreshHp(t);
        }
        this.pushLog(`　└【反震】${t?.name ?? ev.targetId} 受 ${ev.value} 点`);
        this.timer = 160;
        break;
      }

      case 'statusApplied':
        this.pushLog(`　└ 附加状态 ${ev.statusId}（${ev.rounds} 回合）`);
        this.timer = 120;
        break;

      case 'immune':
        this.pushLog(`　└【免疫】${this.units.get(ev.targetId)?.name ?? ev.targetId} 免除了 ${ev.statusId}`);
        this.timer = 140;
        break;

      case 'skip':
        this.pushLog(`${this.units.get(ev.actorId)?.name ?? ev.actorId} 被${ev.reason}，跳过`);
        this.timer = 180;
        break;

      case 'dot': {
        const t = this.units.get(ev.targetId);
        if (t) {
          t.hp = ev.hpAfter;
          this.refreshHp(t);
        }
        this.pushLog(`　└ ${t?.name ?? ev.targetId} 持续伤害 ${ev.value}（${ev.statusId}）`);
        this.timer = 140;
        break;
      }

      case 'heal': {
        const t = this.units.get(ev.targetId);
        if (t) {
          t.hp = ev.hpAfter;
          this.refreshHp(t);
        }
        this.pushLog(`　└ ${t?.name ?? ev.targetId} 回复 ${ev.value}（${ev.statusId}）`);
        this.timer = 140;
        break;
      }

      case 'death': {
        const u = this.units.get(ev.unitId);
        if (u) {
          u.hp = 0;
          u.char.play(`${u.group}_down`);
          u.hpBar.width = 0;
          u.hpText.setText('0');
        }
        this.pushLog(`☠ ${ev.unitName} 阵亡`);
        this.timer = 300;
        break;
      }

      case 'battleEnd': {
        const text = ev.winner === 'ally' ? '我方胜' : ev.winner === 'enemy' ? '敌方胜' : '平局';
        this.pushLog(`══ ${text}｜共 ${ev.rounds} 回合｜我存活 ${ev.allyAlive}／敌存活 ${ev.enemyAlive} ══`);
        this.finished = true;
        this.timer = 0;
        break;
      }

      default:
        this.timer = 0;
    }
  }

  private refreshHp(u: LabUnit): void {
    const ratio = Math.max(0, Math.min(1, u.hp / u.hpMax));
    u.hpBar.width = 62 * ratio;
    u.hpBar.setFillStyle(ratio > 0.5 ? THEME.jade : ratio > 0.22 ? THEME.gold : THEME.red);
    u.hpText.setText(`${u.hp}`);
  }

  /** 追加一行日志（只保留最后 7 行，够看又不会拖慢渲染） */
  private pushLog(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 7) this.lines.shift();
  }

  private renderLog(): void {
    this.logText.setText(this.lines.join('\n'));
  }
}

/** 循环切换阵法下标：-1（无）→ 0 → 1 … → 最后一个 → 回到 -1 */
function nextFormationIdx(cur: number): number {
  const next = cur + 1;
  return next >= FORMATIONS.length ? -1 : next;
}
