// 应用常量定义

export const STORAGE_KEYS = {
  LOCAL_STORAGE_KEY: 'cloudnav_data_cache',
  AUTH_KEY: 'cloudnav_auth_token',
  CONFIG_KEY: 'config', // 统一配置
  CATEGORIES_CONFIG_KEY: 'cate_config',
  // 本地存储专用（用户个人偏好）
  VIEW_MODE_KEY: 'cloudnav_view_mode',
} as const

export const API_ENDPOINTS = {
  STORAGE: '/api/storage',
  LINK: '/api/link',
  WEBDAV: '/api/webdav',
  AUTH: '/api/auth',
  ACCESS: '/api/access',
} as const

export const DEFAULT_ICON_CONFIG = {
  source: 'google' as const,
  cacheEnabled: true,
  faviconextractor: {
    enabled: true,
  },
  google: {
    enabled: true,
  },
  customapi: {
    enabled: false,
    url: '',
    headers: {},
  },
  customurl: {
    enabled: false,
    url: '',
  },
} as const

// 搜索引擎配置已移至 searchEngines.tsx，便于添加新引擎（含 Logo 组件）
export { SEARCH_ENGINES, getSearchEngine, getSearchEngineLogo } from './searchEngines';
export type { SearchEngineConfig } from './searchEngines';
