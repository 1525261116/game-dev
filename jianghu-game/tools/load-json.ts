/**
 * 工程通用：以 Node 直接读取 JSON（避免浏览器/打包器的 import 断言差异）。
 * 仅工具与测试使用，不进入游戏运行时代码。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 读取目录下全部 .json */
export function loadJsonDir<T>(dir: string): Record<string, T> {
  if (!existsSync(dir)) return {};
  const out: Record<string, T> = {};
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    out[basename(f, '.json')] = loadJson<T>(join(dir, f));
  }
  return out;
}
