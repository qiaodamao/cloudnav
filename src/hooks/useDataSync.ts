import { useCallback, useRef } from 'react';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS } from '../../types';
import { STORAGE_KEYS, API_ENDPOINTS } from '../constants';
import { useLinksContext } from '../contexts/LinksContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { configManager } from '../utils/configManager';
import { useAuthContext } from '../contexts/AuthContext';
import { setKnownLinkIds } from '../utils/cloudSync';

/**
 * 数据同步 Hook：管理 localStorage ↔ KV 的加载和同步
 */
export function useDataSync() {
  const { links = [], initLinks, setLinksAndSync } = useLinksContext();
  const { categories = [], initCategories } = useCategoriesContext();
  const { initConfig } = useConfigContext();
  const { authToken, markAuthExpired } = useAuthContext();
  const initialized = useRef(false);

  // 从 localStorage 加载
  const loadFromLocal = useCallback((): { links: LinkItem[]; categories: Category[] } => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        let cats: Category[] = parsed.categories || DEFAULT_CATEGORIES;

        // 确保 common 分类存在且排第一
        if (!cats.some((c: Category) => c.id === 'common')) {
          cats = [{ id: 'common', name: '常用推荐', icon: 'Star' }, ...cats];
        } else {
          const idx = cats.findIndex((c: Category) => c.id === 'common');
          if (idx > 0) {
            const common = cats[idx];
            cats = [common, ...cats.slice(0, idx), ...cats.slice(idx + 1)];
          }
        }

        // 修复无效 categoryId
        const validIds = new Set(cats.map((c: Category) => c.id));
        let lnks: LinkItem[] = (parsed.links || INITIAL_LINKS).map((l: LinkItem) =>
          validIds.has(l.categoryId) ? l : { ...l, categoryId: 'common' }
        );

        return { links: lnks, categories: cats };
      }
    } catch (e) {
      console.error('Load from local failed:', e);
    }
    return { links: INITIAL_LINKS, categories: DEFAULT_CATEGORIES };
  }, []);

  // 从 KV 加载链接和分类
  const loadFromCloud = useCallback(async (): Promise<{ links: LinkItem[]; categories: Category[] } | null> => {
    try {
      // 登录用户带 token 可加载完整数据（含分类密码供管理），访客自动脱敏
      const headers: Record<string, string> = {};
      if (authToken) headers['x-auth-password'] = authToken;
      const res = await fetch(`${API_ENDPOINTS.STORAGE}?getConfig=true&_=${Date.now()}`, {
        cache: 'no-store',
        headers,
      });
      if (res.status === 401) {
        // token 过期：标记过期并回退本地数据，
        // 防止脱敏/不完整数据覆盖本地（分类密码丢失风险）
        markAuthExpired();
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      if (data.links?.length > 0 || data.categories?.length > 0) {
        return { links: data.links || [], categories: data.categories || [] };
      }
      return null;
    } catch (e) {
      console.error('Load from cloud failed:', e);
      return null;
    }
  }, [authToken, markAuthExpired]);

  // 从 KV 加载各个配置
  const loadConfigsFromCloud = useCallback(async () => {
    const configKeys = ['search', 'website', 'ai', 'weather', 'icon', 'webdav'];
    const configMap: Record<string, any> = {};

    await Promise.all(configKeys.map(async (key) => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['x-auth-password'] = authToken;
        const res = await fetch(`${API_ENDPOINTS.STORAGE}?getConfig=${key}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            configMap[key] = data;
          }
        }
      } catch (e) {
        console.error(`Load config ${key} failed:`, e);
      }
    }));

    // WebDAV 配置写回 localStorage，避免刷新后丢失（BackupModal 直接读取本地配置）
    if (configMap.webdav) {
      configManager.updateWebDavConfig(configMap.webdav);
    }

    // 更新 ConfigContext
    if (Object.keys(configMap).length > 0) {
      initConfig(configMap);
    }
  }, [initConfig, authToken]);

  // 初始化数据
  const initData = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;

    // 1. 先从本地加载（快速展示）
    const local = loadFromLocal();
    initLinks(local.links);
    initCategories(local.categories);

    // 2. 并行从云端获取最新数据
    const [cloud] = await Promise.all([
      loadFromCloud(),
      loadConfigsFromCloud(),
    ]);

    if (cloud) {
      // 云端有数据，用云端数据覆盖
      let cats = cloud.categories || [];
      if (cats.length > 0 && !cats.some((c: Category) => c.id === 'common')) {
        cats = [{ id: 'common', name: '常用推荐', icon: 'Star' }, ...cats];
      }
      initLinks(cloud.links || []);
      initCategories(cats);
      // 记录链接 ID 快照：后续全量同步时据此识别其他端（扩展等）新增的链接
      setKnownLinkIds((cloud.links || []).map((l: LinkItem) => l.id));
      // 更新 localStorage 缓存
      localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_KEY, JSON.stringify({
        links: cloud.links || [],
        categories: cats,
      }));
    }
  }, [loadFromLocal, loadFromCloud, loadConfigsFromCloud, initLinks, initCategories]);

  // 同步到云端
  const syncToCloud = useCallback(async () => {
    if (!links.length && !categories.length) return;
    setLinksAndSync(links, categories);
  }, [links, categories, setLinksAndSync]);

  return { initData, loadFromLocal, loadFromCloud, syncToCloud };
}
