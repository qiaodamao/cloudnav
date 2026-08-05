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

export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text=' },
  { id: 'baidu', name: 'Baidu', url: 'https://www.baidu.com/s?wd=' },
  { id: 'so', name: '360 搜索', url: 'https://www.so.com/s?q=' },
] as const;
