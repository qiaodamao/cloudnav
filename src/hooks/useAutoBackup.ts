import { useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useLinksContext } from '../contexts/LinksContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { uploadBackup, fetchIconsAsBase64 } from '../../services/webDavService';
import { generateBookmarkHtml } from '../../services/exportService';

// 上次成功备份的数据签名与时间（localStorage，跨会话去重：同一份数据不重复上传）
const SIG_KEY = 'cloudnav_last_backup_sig';
const TIME_KEY = 'cloudnav_last_auto_backup_time';

// 检查间隔：60 秒
const CHECK_INTERVAL_MS = 60 * 1000;
// 数据稳定窗口：最后一次数据变更后至少等 60 秒再备份（避免连续编辑时频繁上传）
const STABLE_WINDOW_MS = 60 * 1000;
// 失败冷却：失败后 30 分钟内不重试，避免反复请求异常的 WebDAV 服务
const FAIL_COOLDOWN_MS = 30 * 60 * 1000;

// 轻量字符串哈希（djb2），用于生成数据指纹
const hash = (str: string): string => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};

// 数据签名：链接 + 分类内容指纹，任一变化签名即变化
const computeSig = (links: any[], categories: any[]): string =>
  `${links.length}:${hash(JSON.stringify(links))}|${categories.length}:${hash(JSON.stringify(categories))}`;

/**
 * 自动备份到 WebDAV（数据变化触发）
 * 条件：管理员已登录 + WebDAV 已启用 + autoBackup 开启
 * 触发：数据与上次成功备份时不一致，且已稳定 60 秒（一天可多次上传）
 * 去重：备份成功后记录数据签名，同一份数据不重复上传
 */
export function useAutoBackup() {
  const { authToken } = useAuthContext();
  const { links = [] } = useLinksContext();
  const { categories = [] } = useCategoriesContext();
  const { webdav, search: searchConfig, ai: aiConfig } = useConfigContext();

  const isBackingUp = useRef(false);
  const lastFailAt = useRef(0);
  const lastChangeAt = useRef(Date.now());
  // 用 ref 持有最新数据，避免定时器闭包拿到旧值
  const dataRef = useRef({ links, categories, searchConfig, aiConfig, webdav });
  dataRef.current = { links, categories, searchConfig, aiConfig, webdav };

  // 记录数据最近一次变化时间（用于稳定窗口判断）
  useEffect(() => {
    lastChangeAt.current = Date.now();
  }, [links, categories]);

  useEffect(() => {
    const runAutoBackup = async () => {
      if (isBackingUp.current) return;
      isBackingUp.current = true;
      try {
        const { links, categories, searchConfig, aiConfig, webdav } = dataRef.current;
        // 1. 打包本地图标
        const uploadedIcons = await fetchIconsAsBase64(links);
        // 2. 生成书签 HTML
        const bookmarkHtml = generateBookmarkHtml(links, categories);
        // 3. 上传备份（JSON + HTML，云端按日期保留最近 5 份）
        const result = await uploadBackup(webdav, {
          links,
          categories,
          searchConfig,
          aiConfig,
          uploadedIcons,
          bookmarkHtml,
        });
        if (result.success) {
          // 记录本次备份的数据签名和时间，同一份数据不再重复上传
          localStorage.setItem(SIG_KEY, computeSig(links, categories));
          localStorage.setItem(TIME_KEY, new Date().toISOString());
          console.log('[AutoBackup] 自动备份完成');
        } else {
          lastFailAt.current = Date.now();
          console.error('[AutoBackup] 自动备份失败:', result.error, result.detail);
        }
      } catch (e) {
        lastFailAt.current = Date.now();
        console.error('[AutoBackup] 自动备份异常:', e);
      } finally {
        isBackingUp.current = false;
      }
    };

    const check = () => {
      const { webdav, links, categories } = dataRef.current;
      // 前置条件：登录 + WebDAV 启用 + 自动备份开启 + 有数据
      if (!authToken || !webdav?.enabled || !webdav?.autoBackup || !webdav?.url || links.length === 0) return;
      // 失败冷却期内不重试
      if (Date.now() - lastFailAt.current < FAIL_COOLDOWN_MS) return;
      // 数据与上次成功备份时一致，跳过
      if (computeSig(links, categories) === localStorage.getItem(SIG_KEY)) return;
      // 数据仍在变化中（最近 60 秒内有改动），等稳定后再备份
      if (Date.now() - lastChangeAt.current < STABLE_WINDOW_MS) return;
      runAutoBackup();
    };

    // 页面加载后延迟 30 秒执行首次检查（避开启动时的密集请求）
    const initialTimer = setTimeout(check, 30 * 1000);
    // 定时检查
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
    // 仅在开关状态变化时重建定时器（数据通过 ref 获取最新值）
  }, [authToken, webdav?.enabled, webdav?.autoBackup, webdav?.url]);
}
