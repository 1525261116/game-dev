/**
 * 可播种随机数生成器（架构铁律 5：禁止 Math.random()）
 *
 * 为什么必须"可播种"？
 *   ① 战斗中出了 bug（比如某个伤害算错），能用同一个种子精确复现那一场
 *   ② 玩家反馈"这关过不去"，你能拿到他的种子重现同一场战斗
 *   ③ 战斗表现可以随时重播 / 加速 / 跳过，而结果完全一致
 *
 * 用的是 mulberry32 算法：代码短、速度快、随机质量足够游戏使用。
 */

export interface Rng {
  /** 取一个 [0, 1) 之间的随机小数 */
  next(): number;
  /** 取一个 [min, max] 闭区间内的随机整数 */
  int(min: number, max: number): number;
  /** 以概率 p 返回 true（p = 0.3 表示 30% 概率命中） */
  chance(p: number): boolean;
  /** 随机取数组中的一个元素 */
  pick<T>(arr: readonly T[]): T;
  /** 返回打乱后的新数组（不修改原数组） */
  shuffle<T>(arr: readonly T[]): T[];
}

/**
 * 把任意种子（数字或字符串）转成 32 位无符号整数。
 * 用 FNV-1a 哈希：让 "battle-001" 这种字符串也能当种子用。
 */
function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let s = hashSeed(seed);

  /** mulberry32 核心：每次调用推进内部状态并返回 [0,1) */
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`Rng.int 参数错误：min=${min} > max=${max}`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const chance = (p: number): boolean => next() < p;

  const pick = <T,>(arr: readonly T[]): T => {
    if (arr.length === 0) throw new Error('Rng.pick 不能用于空数组');
    return arr[int(0, arr.length - 1)]!;
  };

  const shuffle = <T,>(arr: readonly T[]): T[] => {
    const out = [...arr];
    // Fisher–Yates 洗牌：从后往前，每次与前面（含自己）的随机位置交换
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  return { next, int, chance, pick, shuffle };
}
