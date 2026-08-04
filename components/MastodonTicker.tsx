import React, { useState, useEffect, useRef } from 'react';
import { TickerConfig } from '../types';

const MastodonIcon = ({ size, className }: { size: number; className?: string }) => (
  <svg width={size} height={size * 1.053} viewBox="0 0 75 79" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M521.02 250.025V289.955C520.7 291.215 520.21 292.455 520.1 293.735C516.93 329.135 507.04 362.585 489.42 393.405C449.41 463.405 389.8 506.455 310.45 521.715C302.18 523.305 293.79 524.285 285.46 525.555H245.53C239.98 524.785 234.41 524.075 228.87 523.245C177.9 515.535 132.59 495.195 94.72 460.185C28.39 398.835 1.06004 322.555 12.55 233.115C19.13 181.825 40.7 136.605 75.83 98.6348C134.75 34.9548 208.11 7.53483 294.25 15.9048C342.5 20.5848 385.88 38.8848 423.79 69.1648C474.06 109.315 505.35 161.145 517.1 224.535C518.67 232.985 519.72 241.525 521.01 250.015L521.02 250.025ZM145.83 269.515C145.83 298.955 145.79 328.405 145.84 357.845C145.88 383.385 166.29 403.845 191.74 403.895C210.87 403.935 229.99 403.895 249.12 403.895C283.05 403.895 316.98 403.945 350.91 403.875C371.04 403.835 385.47 389.145 385.15 369.045C384.98 358.695 380.74 350.105 373.07 343.185C348.87 321.345 324.66 299.525 300.5 277.645C294.3 272.035 294.44 267.535 300.56 261.835C323.93 240.085 347.25 218.275 370.63 196.535C382.54 185.455 386.24 171.205 380.7 157.235C375.26 143.545 363.46 136.065 347.24 136.065C295.68 136.065 244.12 136.065 192.56 136.065C165.87 136.065 145.84 156.045 145.83 182.655C145.82 211.605 145.83 240.545 145.83 269.495V269.515Z" fill="black"/>
    <defs>
      <linearGradient id="paint0_linear_mastodon" x1="37.0692" y1="0" x2="37.0692" y2="79" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6364FF"/>
        <stop offset="1" stop-color="#563ACC"/>
      </linearGradient>
    </defs>
  </svg>
);

interface TickerItem {
  id: string;
  content: string;
  url: string;
}

interface TickerProps {
  config?: TickerConfig;
}

const MastodonTicker: React.FC<TickerProps> = ({ config }) => {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const currentIndexRef = useRef(0);

  const defaultItems: TickerItem[] = [
    { id: 'default-1', content: '机会总是垂青于有准备的人！', url: '' },
    { id: 'default-2', content: 'Chance favors the prepared mind!', url: '' },
  ];

  useEffect(() => {
    if (!config || !config.enabled) {
      return;
    }

    const fetchItems = async () => {
      try {
        let fetchedItems: TickerItem[] = [];

        if (config.source === 'mastodon' && config.mastodonInstance && config.mastodonUsername) {
          fetchedItems = await fetchMastodon(config);
        } else if (config.source === 'memos' && config.memosHost) {
          fetchedItems = await fetchMemos(config);
        } else if (config.source === 'custom' && config.customItems) {
          fetchedItems = config.customItems
            .filter(item => item.trim())
            .map((item, i) => ({ 
              id: `custom-${i}`, 
              content: processTickerContent(item), 
              url: '' 
            }));
        } else {
          fetchedItems = defaultItems;
        }

        setItems(fetchedItems);
        setLoading(false);
      } catch (err) {
        console.error('Ticker fetch error:', err);
        setError(`无法获取动态`);
        setLoading(false);
      }
    };

    fetchItems();
    const interval = setInterval(fetchItems, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [config]);

  // 向上滚动
  useEffect(() => {
    if (items.length <= 1 || isPaused) return;

    const scroll = () => {
      if (contentRef.current) {
        currentIndexRef.current++;
        const index = currentIndexRef.current;
        
        contentRef.current.style.transition = 'transform 0.5s ease-in-out';
        contentRef.current.style.transform = `translateY(${-index * 36}px)`;

        // 当到达最后一条（第一条的克隆）时
        if (index === items.length) {
          setTimeout(() => {
            if (contentRef.current) {
              contentRef.current.style.transition = 'none';
              contentRef.current.style.transform = 'translateY(0)';
              currentIndexRef.current = 0;
            }
          }, 500); // 等待过渡动画完成
        }
      }
    };

    intervalRef.current = setInterval(scroll, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [items.length, isPaused]);

  if (!config || !config.enabled) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-full h-9 w-9 md:w-auto md:px-3 text-slate-500 dark:text-slate-400 leading-none">
        <MastodonIcon size={12} />
        <span className="hidden md:inline ml-2">加载中...</span>
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-200 dark:bg-slate-700 rounded-full text-xs text-slate-500 dark:text-slate-400 h-9 leading-none">
        <MastodonIcon size={12} />
        <span className="hidden md:inline">{error || '暂无动态'}</span>
      </div>
    );
  }

  return (
    <div 
      className="flex items-center bg-slate-200 dark:bg-slate-700 rounded-full h-9 leading-none transition-all duration-300 ease-in-out overflow-hidden w-full px-3 gap-2"
    >
      <MastodonIcon size={14} className="text-blue-500 shrink-0" />
      
      <div
        className="relative overflow-hidden h-9 flex-1 opacity-100"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div ref={contentRef} className="flex flex-col items-start">
          {items.map((item) => (
            <div key={item.id} className="shrink-0 h-9 flex items-center justify-center min-w-0">
              <div
                className="cursor-pointer hover:text-blue-500 transition-colors flex items-center gap-1 w-full min-w-0"
                onClick={() => item.url && window.open(item.url, '_blank')}
                title={item.content.replace(/<[^>]*>/g, '')}
              >
                <span 
                  className="text-xs text-slate-700 dark:text-slate-300 truncate w-full"
                  dangerouslySetInnerHTML={{ __html: item.content }}
                />
              </div>
            </div>
          ))}
          <div className="shrink-0 h-9 flex items-center min-w-0">
            <div
              className="cursor-pointer hover:text-blue-500 transition-colors flex items-center gap-1 w-full min-w-0"
              onClick={() => items[0]?.url && window.open(items[0].url, '_blank')}
              title={items[0]?.content.replace(/<[^>]*>/g, '')}
            >
              <span 
                className="text-xs text-slate-700 dark:text-slate-300 truncate w-full"
                dangerouslySetInnerHTML={{ __html: items[0]?.content || '' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 格式化 Ticker 内容，支持特殊表情替换
function processTickerContent(text: string): string {
  if (!text) return '';
  return text
    .replace(/:star_solid:/g, '🌕')
    .replace(/:star_half:/g, '<span style="transform: scaleX(-1); display: inline-block;">🌓</span>')
    .replace(/:star_empty:/g, '🌑');
}

// Mastodon 数据获取
async function fetchMastodon(config: any): Promise<TickerItem[]> {
  let instance = config.mastodonInstance;
  let username = config.mastodonUsername;

  if (username?.startsWith('@')) {
    const parts = username.split('@').filter(Boolean);
    if (parts.length === 2) {
      username = parts[0];
      instance = parts[1];
    }
  }

  const lookupRes = await fetch(`https://${instance}/api/v1/accounts/lookup?acct=${username}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'CloudNav/1.0' }
  });
  if (!lookupRes.ok) throw new Error('Account lookup failed');

  const account = await lookupRes.json();
  const params = new URLSearchParams({
    limit: (config.mastodonLimit || 10).toString(),
    exclude_replies: String(config.mastodonExcludeReplies !== false),
    exclude_reblogs: String(config.mastodonExcludeReblogs !== false),
  });

  const res = await fetch(`https://${instance}/api/v1/accounts/${account.id}/statuses?${params}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'CloudNav/1.0' }
  });
  if (!res.ok) throw new Error('Statuses fetch failed');

  const data = await res.json();
  return data
    .map((s: any) => {
      const content = s.content
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      
      return {
        id: s.id,
        content: processTickerContent(content.substring(0, 120)),
        url: s.url,
      };
    })
    .filter((s: TickerItem) => s.content.length > 0);
}

// Memos 数据获取
async function fetchMemos(config: any): Promise<TickerItem[]> {
  const host = config.memosHost?.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (config.memosToken) {
    headers['Authorization'] = `Bearer ${config.memosToken}`;
  }

  // 构建 filter 参数，creator 格式：users/xxx
  let filter = '';
  const celFilters = [];
  
  if (config.memosCreator) {
    celFilters.push(`creator == "users/${config.memosCreator}"`);
  }
  
  // 添加 visibility 过滤，默认为 PUBLIC
  const visibility = config.memosVisibility || 'PUBLIC';
  celFilters.push(`visibility == "${visibility}"`);

  if (celFilters.length > 0) {
    filter = `&filter=${encodeURIComponent(celFilters.join(' && '))}`;
  }

  const res = await fetch(`${host}/api/v1/memos?pageSize=${config.memosLimit || 10}${filter}`, { headers });
  if (!res.ok) throw new Error('Memos fetch failed');

  const data = await res.json();
  const memos = data.memos || data || [];

  return memos.map((m: any) => {
    const content = (m.content || m.plainText || '').trim();
    return {
      id: m.uid || m.name || String(m.id),
      content: processTickerContent(content.substring(0, 120)),
      url: m.url || `${host}/${m.name || m.uid}`,
    };
  }).filter((m: TickerItem) => m.content.length > 0);
}

export default MastodonTicker;
