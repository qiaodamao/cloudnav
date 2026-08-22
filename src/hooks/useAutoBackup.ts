import { useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useLinksContext } from '../contexts/LinksContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { uploadBackup, fetchIconsAsBase64 } from '../../services/webDavService';
import { generateBookmarkHtml } from '../../services/exportService';

// 上次自动备份日期的 localStorage key（每台设备每天只备份一次）
const LAST_AUTO_BACKUP_KEY = 'cloudnav_last_auto_backup_date';

// 检查间隔：30 分钟（处理长时间停留的页面跨天后触发）
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

const getTodayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * 每日自动备份到 WebDAV
 * 条件：管理员已登录 + WebDAV 已启用 + autoBackup 开启
 * 触发：页面加载时检查 + 每 30 分钟定时检查，每天首次满足条件时执行
 */
export function useAutoBackup() {
  const { authToken } = useAuthContext();
  const { links = [] } = useLinksContext();
  const { categories = [] } = useCategoriesContext();
  const { webdav, search: searchConfig, ai: aiConfig } = useConfigContext();
  const isBackingUp = useRef(false);
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
        // 3. 上传备份（JSON + HTML）
        const result = await uploadBackup(webdav, {
          links,
          categories,
          searchConfig,
          aiConfig,
          uploadedIcons,
          bookmarkHtml,
        });
        if (result.success) {
          localStorage.setItem(LAST_AUTO_BACKUP_KEY, getTodayStr());
          console.log('[AutoBackup] 每日自动备份完成');
        } else {
          console.error('[AutoBackup] 自动备份失败:', result.error, result.detail);
        }
      } catch (e) {
        console.error('[AutoBackup] 自动备份异常:', e);
      } finally {
        isBackingUp.current = false;
      }
    };

    const check = () => {
      const { webdav, links } = dataRef.current;
      // 前置条件：登录 + WebDAV 启用 + 自动备份开启 + 有数据
      if (!authToken || !webdav?.enabled || !webdav?.autoBackup || !webdav?.url || links.length === 0) return;
      // 今天已备份过则跳过
      if (localStorage.getItem(LAST_AUTO_BACKUP_KEY) === getTodayStr()) return;
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
