import React from 'react';
import {
  GoogleLogo,
  BingLogo,
  BaiduLogo,
  DuckDuckGoLogo,
  YandexLogo,
  QihooLogo,
} from '../components/icons/SearchLogos';

// 搜索引擎配置类型
export interface SearchEngineConfig {
  id: string;
  name: string;
  url: string;
  logo: React.FC<React.SVGProps<SVGSVGElement>>;
}

/**
 * 搜索引擎配置列表
 * 添加新引擎只需在此数组中添加一项，并在 SearchLogos.tsx 中实现 Logo 组件
 */
export const SEARCH_ENGINES: SearchEngineConfig[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', logo: GoogleLogo },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', logo: DuckDuckGoLogo },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', logo: BingLogo },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text=', logo: YandexLogo },
  { id: 'baidu', name: 'Baidu', url: 'https://www.baidu.com/s?wd=', logo: BaiduLogo },
  { id: 'so', name: '360 搜索', url: 'https://www.so.com/s?q=', logo: QihooLogo },
];

// 通过 id 获取搜索引擎配置
export function getSearchEngine(id: string): SearchEngineConfig | undefined {
  return SEARCH_ENGINES.find(e => e.id === id);
}

// 通过 id 获取搜索引擎 Logo 组件
export function getSearchEngineLogo(id: string): React.FC<React.SVGProps<SVGSVGElement>> | undefined {
  return getSearchEngine(id)?.logo;
}
