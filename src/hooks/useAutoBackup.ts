import { useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useLinksContext } from '../contexts/LinksContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { uploadBackup, fetchIconsAsBase64 } from '../../services/webDavService';
import { generateBookmarkHtml } from '../../services/exportService';

// 上次成功备份的时间（localStorage，跨会话判断当天是否已备份）
const TIME_KEY = 'cloudnav_last_auto_backup_time';

// 检查间隔：60 秒
const CHECK_INTERVAL_MS = 60 * 1000;
// 失败冷却：失败后 30 分钟内不重试，避免反复请求异常的 WebDAV 服务
const FAIL_COOLDOWN_MS = 30 * 60 * 1000;

// 北京时间日期串（YYYY-MM-DD），与后端备份文件命名（YYYYMMDD）时区一致
const getBeijingDateStr = () => {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

// 上次备份时间对应的北京时间日期串
const getLastBackupDate = (): string => {
  const lastTime = localStorage.getItem(TIME_KEY);
  if (!lastTime) return '';
  const ts = new Date(lastTime).getTime();
  if (Number.isNaN(ts)) return '';
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

/**
 * 自动备份到 WebDAV（每日一次）
 * 条件：管理员已登录 + WebDAV 已启用 + autoBackup 开启
 * 触发：当天尚未成功备份过（页面保持打开时定时检查，跨天首次检查时上传）
 * 重试：备份失败后进入 30 分钟冷却，之后自动重试直到当天成功
 */
export function useAutoBackup() {
  const { authToken } = useAuthContext();
  const { links = [] } = useLinksContext();
  const { categories = [] } = useCategoriesContext();
  const { webdav, search: searchConfig, ai: aiConfig } = useConfigContext();

  const isBackingUp = useRef(false);
  const lastFailAt = useRef(0);
  // 用 ref 持有最新数据，避免定时器闭包拿到旧值
  const dataRef = useRef({ links, categories, searchConfig, aiConfig, webdav });
  dataRef.current = { links, categories, searchConfig, aiConfig, webdav };

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
          // 记录备份时间，当天不再重复上传
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
      const { webdav, links } = dataRef.current;
      // 前置条件：登录 + WebDAV 启用 + 自动备份开启 + 有数据
      if (!authToken || !webdav?.enabled || !webdav?.autoBackup || !webdav?.url || links.length === 0) return;
      // 失败冷却期内不重试
      if (Date.now() - lastFailAt.current < FAIL_COOLDOWN_MS) return;
      // 当天已成功备份过，跳过
      if (getLastBackupDate() === getBeijingDateStr()) return;
      runAutoBackup();
    };

    // 页面加载后延迟 30 秒执行首次检查（避开启动时的密集请求）
    const initialTimer = setTimeout(check, 30 * 1000);
    // 定时检查（跨天后自动触发当天首次备份）
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
    // 仅在开关状态变化时重建定时器（数据通过 ref 获取最新值）
  }, [authToken, webdav?.enabled, webdav?.autoBackup, webdav?.url]);
}
