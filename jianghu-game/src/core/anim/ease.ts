/**
 * 缓动函数：只保留 5 种，统一手感。
 * 纯函数 + 确定性（不使用 Math.random）。
 */
import type { EaseKind } from './types.ts';

export function ease(kind: EaseKind, t: number): number {
  // 边界必须精确返回 0/1：避免浮点漂移（例如 backOut 在 t=0 会算出 -1.1e-16），
  // 否则循环动作的首尾一致性校验、确定性回放都会被误判。
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x = t;
  switch (kind) {
    case 'linear':
      return x;
    case 'sineIn':
      return 1 - Math.cos((x * Math.PI) / 2);
    case 'sineOut':
      return Math.sin((x * Math.PI) / 2);
    case 'quadIn':
      return x * x;
    case 'backOut': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    default: {
      // 穷尽性检查：新增 EaseKind 时此处分派会编译失败
      const never: never = kind;
      return never;
    }
  }
}
