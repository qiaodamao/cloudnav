import React, { createContext, useContext, useReducer, useCallback, useEffect, startTransition } from 'react';
import {
  AppConfig, AIConfig, WebsiteConfig, WebDavConfig,
  SearchConfig, IconConfig, WeatherConfig,
} from '../../types';
import { STORAGE_KEYS, DEFAULT_ICON_CONFIG } from '../constants';
import { configManager } from '../utils/configManager';

// --- Types ---
interface ConfigState {
  ai: AIConfig;
  website: WebsiteConfig;
  webdav: WebDavConfig;
  search: SearchConfig;
  icon: IconConfig;
  weather: WeatherConfig;
  viewMode: 'compact' | 'detailed';
  showPinnedWebsites: boolean;
  darkMode: boolean;
}

type ConfigAction =
  | { type: 'SET_AI'; payload: AIConfig }
  | { type: 'SET_WEBSITE'; payload: WebsiteConfig }
  | { type: 'SET_WEBDAV'; payload: WebDavConfig }
  | { type: 'SET_SEARCH'; payload: SearchConfig }
  | { type: 'SET_ICON'; payload: IconConfig }
  | { type: 'SET_WEATHER'; payload: WeatherConfig }
  | { type: 'SET_VIEW_MODE'; payload: 'compact' | 'detailed' }
  | { type: 'SET_SHOW_PINNED'; payload: boolean }
  | { type: 'SET_DARK_MODE'; payload: boolean }
  | { type: 'LOAD_CONFIG'; payload: Partial<ConfigState> };

interface ConfigContextValue extends ConfigState {
  initConfig: (config: Partial<ConfigState>) => void;
  setAI: (config: AIConfig) => void;
  setWebsite: (config: WebsiteConfig) => void;
  setWebDav: (config: WebDavConfig) => void;
  setSearch: (config: SearchConfig) => void;
  setIcon: (config: IconConfig) => void;
  setWeather: (config: WeatherConfig) => void;
  setViewMode: (mode: 'compact' | 'detailed') => void;
  setShowPinned: (show: boolean) => void;
  setDarkMode: (dark: boolean) => void;
  syncConfigToKV: (authToken: string) => Promise<boolean>;
  loadConfigFromKV: (authToken: string) => Promise<void>;
}

// --- Defaults ---
const defaultAI: AIConfig = {
  provider: 'google',
  apiKey: '',
  baseUrl: '',
  model: 'gemini-3.1-flash-lite',
};

const defaultWebsite: WebsiteConfig = {
  passwordExpiry: { value: 1, unit: 'week' },
};

const defaultWebDav: WebDavConfig = {
  url: '', username: '', password: '', enabled: false,
};

const defaultSearch: SearchConfig = {
  mode: 'internal',
  externalSources: [],
  selectedSource: null,
  defaultEngine: 'google',
};

const defaultWeather: WeatherConfig = {
  enabled: true, provider: 'jinrishici',
  unit: 'celsius',
};

// --- Reducer ---
function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case 'SET_AI': return { ...state, ai: action.payload };
    case 'SET_WEBSITE': return { ...state, website: action.payload };
    case 'SET_WEBDAV': return { ...state, webdav: action.payload };
    case 'SET_SEARCH': return { ...state, search: action.payload };
    case 'SET_ICON': return { ...state, icon: action.payload };
    case 'SET_WEATHER': return { ...state, weather: action.payload };
    case 'SET_VIEW_MODE': return { ...state, viewMode: action.payload };
    case 'SET_SHOW_PINNED': return { ...state, showPinnedWebsites: action.payload };
    case 'SET_DARK_MODE': return { ...state, darkMode: action.payload };
    case 'LOAD_CONFIG': return { ...state, ...action.payload };
    default: return state;
  }
}

// --- Context ---
const ConfigContext = createContext<ConfigContextValue | null>(null);

// --- Provider ---
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  // 从 localStorage 初始化
  const savedTheme = localStorage.getItem('cloudnav_theme_preference');
  const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const savedViewMode = localStorage.getItem('cloudnav_view_mode_preference');

  const [state, dispatch] = useReducer(configReducer, {
    ai: configManager.getAIConfig() || defaultAI,
    website: configManager.getWebsiteConfig() || defaultWebsite,
    webdav: configManager.getWebDavConfig() || defaultWebDav,
    search: configManager.getSearchConfig() || defaultSearch,
    icon: configManager.getIconConfig() || DEFAULT_ICON_CONFIG,
    weather: configManager.getWeatherConfig() || defaultWeather,
    viewMode: (savedViewMode === 'detailed' || savedViewMode === 'compact')
      ? savedViewMode
      : (configManager.getViewMode()?.defaultMode || 'detailed'),
    showPinnedWebsites: configManager.getUIConfig()?.showPinnedWebsites ?? true,
    darkMode: savedTheme ? savedTheme === 'dark' : systemPrefersDark,
  });

  // 初始化时应用主题
  useEffect(() => {
    const isDark = state.darkMode;
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-theme');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setAI = useCallback((config: AIConfig) => {
    dispatch({ type: 'SET_AI', payload: config });
    configManager.updateAIConfig(config);
  }, []);

  const setWebsite = useCallback((config: WebsiteConfig) => {
    dispatch({ type: 'SET_WEBSITE', payload: config });
    configManager.updateWebsiteConfig(config);
  }, []);

  const setWebDav = useCallback((config: WebDavConfig) => {
    dispatch({ type: 'SET_WEBDAV', payload: config });
    configManager.updateWebDavConfig(config);
  }, []);

  const setSearch = useCallback((config: SearchConfig) => {
    dispatch({ type: 'SET_SEARCH', payload: config });
    configManager.updateSearchConfig(config);
  }, []);

  const setIcon = useCallback((config: IconConfig) => {
    dispatch({ type: 'SET_ICON', payload: config });
    configManager.updateIconConfig(config);
  }, []);

  const setWeather = useCallback((config: WeatherConfig) => {
    dispatch({ type: 'SET_WEATHER', payload: config });
    configManager.updateWeatherConfig(config);
  }, []);

  const setViewMode = useCallback((mode: 'compact' | 'detailed') => {
    // startTransition 让重渲染降为过渡态，不阻塞 paint，切换更跟手
    startTransition(() => dispatch({ type: 'SET_VIEW_MODE', payload: mode }));
    localStorage.setItem('cloudnav_view_mode_preference', mode);
    configManager.updateViewMode(mode);
  }, []);

  const setShowPinned = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_PINNED', payload: show });
    configManager.updateUIConfig({ showPinnedWebsites: show });
  }, []);

  const setDarkMode = useCallback((dark: boolean) => {
    // 切换瞬间临时禁用所有 transition，避免颜色过渡造成"延迟感"
    const docEl = document.documentElement;
    docEl.classList.add('theme-transitioning');
    // startTransition 让重渲染不阻塞 paint；dark class 在下方同步添加，视觉即时
    startTransition(() => dispatch({ type: 'SET_DARK_MODE', payload: dark }));
    localStorage.setItem('cloudnav_theme_preference', dark ? 'dark' : 'light');
    if (dark) {
      docEl.classList.add('dark');
      docEl.setAttribute('data-theme', 'dark');
    } else {
      docEl.classList.remove('dark');
      docEl.removeAttribute('data-theme');
    }
    // 双 rAF：第一帧让浏览器应用新样式，第二帧移除禁用类
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        docEl.classList.remove('theme-transitioning');
      });
    });
  }, []);

  const syncConfigToKV = useCallback(async (authToken: string) => {
    return configManager.syncToKV(authToken);
  }, []);

  const loadConfigFromKV = useCallback(async (authToken: string) => {
    await configManager.syncFromKV(authToken);
    const config = configManager.getConfig();
    dispatch({ type: 'LOAD_CONFIG', payload: {
      ai: config.ai || defaultAI,
      website: config.website || defaultWebsite,
      webdav: config.webdav || defaultWebDav,
      search: config.search || defaultSearch,
      icon: config.icon || DEFAULT_ICON_CONFIG,
      weather: config.weather || defaultWeather,
    }});
  }, []);

  const initConfig = useCallback((config: Partial<ConfigState>) => {
    // 只合并非空配置，避免空对象覆盖默认值
    const filtered = Object.fromEntries(
      Object.entries(config).filter(([_, v]) => v && typeof v === 'object' && Object.keys(v).length > 0)
    );
    if (Object.keys(filtered).length > 0) {
      dispatch({ type: 'LOAD_CONFIG', payload: filtered });
    }
  }, []);

  return (
    <ConfigContext.Provider value={{
      ...state,
      initConfig,
      setAI, setWebsite, setWebDav, setSearch, setIcon,
      setWeather, setViewMode, setShowPinned, setDarkMode,
      syncConfigToKV, loadConfigFromKV,
    }}>
      {children}
    </ConfigContext.Provider>
  );
}

// --- Hook ---
export function useConfigContext() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigContext must be used within ConfigProvider');
  return ctx;
}
