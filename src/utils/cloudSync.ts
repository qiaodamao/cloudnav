// 云端同步工具：写入串行化 + 已知链接 ID 快照
// 1. 串行化：同一时刻只有一个写请求在途，防止并发 POST 乱序到达 KV，
//    旧请求后到覆盖新数据（快速连续删除/编辑时书签"复活"的根源）
// 2. knownIds 快照：记录上次成功同步时的链接 ID 集合，服务端据此识别
//    其他端（如浏览器扩展）直接写入云端的新链接，全量覆盖时自动保留

const KNOWN_IDS_KEY = 'cloudnav_known_link_ids';

let chain: Promise<unknown> = Promise.resolve();

/**
 * 云端写入串行化队列：后续写入排队等待前一个完成，保证到达顺序
 */
export function enqueueCloudWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // 队列本身不因单次失败而中断
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 读取上次成功同步时的链接 ID 快照
 */
export function getKnownLinkIds(): string[] {
  try {
    const raw = localStorage.getItem(KNOWN_IDS_KEY);
    const ids = raw ? JSON.parse(raw) : null;
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

/**
 * 更新链接 ID 快照（每次成功同步/加载云端数据后调用）
 */
export function setKnownLinkIds(ids: string[]): void {
  try {
    localStorage.setItem(KNOWN_IDS_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}
