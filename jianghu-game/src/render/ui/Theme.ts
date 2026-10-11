/**
 * 视觉主题：全游戏共用的颜色与文字样式。
 *
 * 为什么单独抽一个文件？
 *   如果每个场景都自己写 `color: '#8c6b2f'`，以后你想换主色调，
 *   就得把几十个文件翻一遍。集中在这里，**改一个地方全游戏生效**。
 *
 * 配色取自水墨江湖：宣纸底 + 墨黑 + 鎏金 + 朱砂红。
 */
import Phaser from 'phaser';

export const THEME = {
  /** 宣纸底色（数字形式，给图形用） */
  paper: 0xefe9da,
  paperHex: '#efe9da',
  /** 更浅的纸色（用于分区面板） */
  paperLight: 0xf7f4ec,
  paperLightHex: '#f7f4ec',
  /** 墨黑 */
  ink: 0x1f1f1f,
  inkHex: '#1f1f1f',
  /** 鎏金（标题、强调） */
  gold: 0x8c6b2f,
  goldHex: '#8c6b2f',
  /** 朱砂红（危险、命中、敌方） */
  red: 0xa62b1f,
  redHex: '#a62b1f',
  /** 青碧（我方、友军） */
  jade: 0x2f5d4a,
  jadeHex: '#2f5d4a',
  /** 灰（次要文字） */
  dimHex: '#6b6b6b',
  /** 描边色 */
  line: 0xd8d0bb,
} as const;

/** 中文字体栈：Mac / Windows / 移动端都能落到合适的中文字体 */
export const FONT = '"PingFang SC", "Microsoft YaHei", "Heiti SC", system-ui, sans-serif';

/* ────────────────────────────── 文字样式 ────────────────────────────── */

export function titleStyle(size = 34): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: THEME.goldHex, fontStyle: 'bold' };
}

export function bodyStyle(size = 14): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: THEME.inkHex };
}

export function dimStyle(size = 12): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: THEME.dimHex };
}

/* ────────────────────────────── 按钮 ────────────────────────────── */

/**
 * 造一个水墨风按钮（矩形 + 文字 + 悬停/按下反馈）。
 *
 * @param scene  所属场景
 * @param x,y    按钮中心位置
 * @param label  按钮文字
 * @param w,h    按钮尺寸
 * @param onClick 点击回调（由调用方决定点完干什么）
 */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  w = 220,
  h = 52,
): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, w, h, THEME.paperLight).setStrokeStyle(2, THEME.gold, 0.9);
  const txt = scene.add
    .text(0, 0, label, {
      fontFamily: FONT,
      fontSize: '19px',
      color: THEME.inkHex,
    })
    .setOrigin(0.5)
    .setResolution(2);

  const box = scene.add.container(x, y, [bg, txt]);
  box.setSize(w, h);
  // 让整个容器可交互（矩形区域），并把手型光标打开
  box.setInteractive(
    new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
    Phaser.Geom.Rectangle.Contains,
  );
  box.input!.cursor = 'pointer';

  // 悬停 / 按下 / 移出的视觉反馈：让玩家知道"这个能点"
  box.on('pointerover', () => bg.setFillStyle(THEME.gold, 0.18));
  box.on('pointerout', () => bg.setFillStyle(THEME.paperLight, 1));
  box.on('pointerdown', () => box.setScale(0.97));
  box.on('pointerup', () => {
    box.setScale(1);
    onClick();
  });

  return box;
}
