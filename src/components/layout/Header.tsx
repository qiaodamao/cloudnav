import React from 'react';
import { Search, X, Plus, Moon, Sun, Menu, Settings, Upload, CheckSquare, LogOut, Lock, GripVertical, Edit3, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useConfigContext } from '../../contexts/ConfigContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { useLinksContext } from '../../contexts/LinksContext';
import WeatherDisplay from '../../../components/WeatherDisplay';
import { useState, useRef, useEffect } from 'react';
import { SEARCH_ENGINES, getSearchEngineLogo } from '../../constants';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isInternal: boolean;
  onSearch: (q: string) => void;
  onAddLink: () => void;
  onOpenSettings: () => void;
  onOpenCatManager: () => void;
  onOpenBackup: () => void;
  onOpenImport: () => void;
  onOpenAuth: () => void;
  onToggleSidebar: () => void;
  isBatchEditMode: boolean;
  onToggleBatchEditMode: () => void;
  isMobileSearchOpen: boolean;
  onToggleMobileSearch: () => void;
  isDragSortMode: boolean;
  onToggleDragSortMode: () => void;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  visitorEngineId?: string;
  onVisitorEngineChange?: (id: string) => void;
}

// Search Engine Options Component
function SearchEngineOptions({
  onSelect,
  onClose,
  currentEngine,
  customEngineIcon,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
  currentEngine: string;
  customEngineIcon?: string;
}) {
  const { search } = useConfigContext();
  const hasCustom = !!search?.customEngineUrl;

  // 第一项固定为"站内搜索"，后面是各搜索引擎
  const allEngines = [
    { id: '', name: '站内搜索' },
    ...SEARCH_ENGINES,
    ...(hasCustom ? [{ id: 'custom', name: '自定义' }] : [])
  ];

  return (
    <div
      className="absolute top-full left-0 mt-1 py-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-32 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
      onMouseLeave={onClose}
    >
      {allEngines.map((eng) => {
        // 站内搜索高亮条件：currentEngine 为空
        // 搜索引擎高亮条件：currentEngine === eng.id
        const isActive = eng.id === '' ? !currentEngine : currentEngine === eng.id;
        return (
          <button
            key={eng.id || 'internal'}
            onClick={() => {
              onSelect(eng.id);
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
              isActive ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <RenderEngineLogo
              engine={eng.id || 'internal'}
              customIcon={customEngineIcon}
              className="w-3.5 h-3.5"
            />
            <span>{eng.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// Helper to render search engine logo
function RenderEngineLogo({
  engine,
  customIcon,
  className = ""
}: {
  engine: string;
  customIcon?: string;
  className?: string;
}) {
  // 站内搜索显示 Search 图标
  if (engine === 'internal' || engine === '') {
    return <Search className={`${className} text-slate-500`} style={{ width: '16px', height: '16px' }} />;
  }

  // 自定义搜索引擎
  if (engine === 'custom' && customIcon) {
    const combinedClass = `${className} transition-all grayscale-0 opacity-100`;
    if (customIcon.trim().startsWith('<svg')) {
      return (
        <div
          className={combinedClass}
          dangerouslySetInnerHTML={{ __html: customIcon }}
          style={{ width: '16px', height: '16px' }}
        />
      );
    }
    return (
      <img
        src={customIcon}
        alt="custom"
        className={combinedClass}
        style={{ width: '16px', height: '16px', objectFit: 'contain' }}
      />
    );
  }

  // 从配置动态读取 Logo 组件
  const LogoComponent = getSearchEngineLogo(engine);
  if (LogoComponent) {
    const combinedClass = `${className} transition-all grayscale-0 opacity-100`;
    return <LogoComponent className={combinedClass} style={{ width: '16px', height: '16px' }} />;
  }

  return <span className="text-xs">🌐</span>;
}

export function Header({
  searchQuery, onSearchChange, isInternal, onSearch, onAddLink, onOpenSettings,
  onOpenCatManager, onOpenBackup,
  onOpenImport, onOpenAuth, onToggleSidebar, isBatchEditMode, onToggleBatchEditMode,
  isMobileSearchOpen, onToggleMobileSearch,
  isDragSortMode, onToggleDragSortMode,
  isEditMode, onToggleEditMode,
  visitorEngineId, onVisitorEngineChange,
}: HeaderProps) {
  const { ai, darkMode, setDarkMode, viewMode, setViewMode, weather, search } = useConfigContext();
  const { authToken, logout } = useAuthContext();
  const { syncStatus } = useLinksContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const dropdownTimer = useRef<NodeJS.Timeout | null>(null);

  const engine = visitorEngineId || search?.defaultEngine || 'google';
  const engineName = SEARCH_ENGINES.find(e => e.id === engine)?.name || '搜索引擎';

  const handleMouseEnter = () => {
    if (dropdownTimer.current) clearTimeout(dropdownTimer.current);
    setShowDropdown(true);
  };

  const handleMouseLeave = () => {
    dropdownTimer.current = setTimeout(() => setShowDropdown(false), 300);
  };

  // 每次登录状态改变（登录或退出）时，重置工具栏为折叠状态
  useEffect(() => {
    setIsToolsExpanded(false);
  }, [authToken]);

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-800/95 md:bg-white/80 md:dark:bg-slate-800/50 md:backdrop-blur-md">
      <div className="relative flex items-center justify-between px-4 lg:px-8 h-16">
        {/* Left: Menu + Logo */}
        <div className="flex items-center gap-3">
          <button onClick={onToggleSidebar} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <Menu size={24} />
          </button>
        </div>

        {/* Mobile Search Bar - Expands to fill space */}
        {isMobileSearchOpen && (
          <div className="flex-1 flex items-center gap-2 md:hidden ml-2">
            <div className="relative flex-1">
              <div
                className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center h-full"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                  title="选择搜索引擎"
                >
                  <RenderEngineLogo
                    engine={visitorEngineId || ''}
                    customIcon={search?.customEngineIcon}
                  />
                </button>
                {showDropdown && onVisitorEngineChange && (
                  <SearchEngineOptions
                    onSelect={onVisitorEngineChange}
                    onClose={() => setShowDropdown(false)}
                    currentEngine={visitorEngineId || ''}
                    customEngineIcon={search?.customEngineIcon}
                  />
                )}
              </div>
              <input
                id="search-input"
                type="text"
                value={searchQuery}
                autoFocus
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSearch(searchQuery)}
                placeholder={isInternal ? "搜索站内链接" : `使用 ${engineName} 搜索互联网`}
                className="w-full pl-9 pr-4 py-2 h-[36px] rounded-full bg-[#f1f5f9] dark:bg-slate-700 border-none text-xs focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-slate-400 outline-none transition-all leading-none"
                style={{ fontSize: '16px' }}
                inputMode="search"
                enterKeyHint="search"
              />
            </div>
            <button onClick={onToggleMobileSearch} className="p-1 text-slate-500 text-xs whitespace-nowrap">
              取消
            </button>
          </div>
        )}

        {/* Middle: Spacer */}
        <div className={`${isMobileSearchOpen ? 'hidden md:flex' : 'flex-1'}`} />

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Search Container */}
          <div className="hidden md:flex items-center gap-2 w-[180px] lg:w-[240px] xl:w-[320px] shrink-0">
            {/* Search */}
            <div className="min-w-0 flex-1">
              <HeaderSearch
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                isInternal={isInternal}
                onSearch={onSearch}
                visitorEngineId={visitorEngineId}
                onVisitorEngineChange={onVisitorEngineChange}
              />
            </div>
          </div>

          {/* Mobile search toggle */}
          {!isMobileSearchOpen && (
            <button onClick={onToggleMobileSearch} className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Search size={18} />
            </button>
          )}

          {/* Weather display */}
          <div className="shrink-0 hidden md:block">
            <WeatherDisplay config={weather} />
          </div>

          {/* Removed sync status indicators */}

          {/* View mode toggle + Theme toggle - 移动端: 深浅模式在前，PC端: 简约/详情在前 */}
          <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} items-center gap-2 flex-row-reverse md:flex-row`}>
            {/* View mode toggle */}
            <div
              className="flex items-center bg-[#f1f5f9] dark:bg-slate-700 rounded-full h-[36px] shrink-0 border border-slate-300/50 p-0.5"
              style={darkMode ? { border: 'none' } : {}}
            >
              <button
                onClick={() => setViewMode('compact')}
                className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-full min-w-[40px] leading-none cursor-pointer ${
                  viewMode === 'compact'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/50'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                style={darkMode && viewMode === 'compact' ? { border: 'none' } : {}}
                title="简约版视图"
              >简约</button>
              <button
                onClick={() => setViewMode('detailed')}
                className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-full min-w-[40px] leading-none cursor-pointer ${
                  viewMode === 'detailed'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/50'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                style={darkMode && viewMode === 'detailed' ? { border: 'none' } : {}}
                title="详情版视图"
              >详情</button>
            </div>

            {/* Theme toggle */}
            <button onClick={() => setDarkMode(!darkMode)} className="flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {/* Removed sync status indicator block */}

          {authToken ? (
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} items-center gap-1`}>
              {/* Add link - Always visible as primary action */}
              <button onClick={onAddLink} className="flex items-center justify-center p-2 rounded-full text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 h-[36px] min-w-[36px] cursor-pointer" title="添加链接">
                <Plus size={20} />
              </button>

              <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1" />

              {/* Collapsible Tools Area */}
              <div 
                className={`flex items-center gap-1 transition-all duration-500 ease-in-out overflow-hidden ${
                  isToolsExpanded ? 'max-w-[400px] opacity-100' : 'max-w-0 opacity-0'
                }`}
              >
                <div className="flex items-center gap-1 pr-1">
                  {/* Settings */}
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer"
                    title="系统设置"
                  >
                    <Settings size={18} />
                  </button>

                  {/* Manage Categories */}
                  <button
                    onClick={onOpenCatManager}
                    className="flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer"
                    title="分类管理"
                  >
                    <Layers size={18} />
                  </button>

                  {/* Backup/Restore */}
                  <button
                    onClick={onOpenBackup}
                    className="flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer"
                    title="备份恢复"
                  >
                    <Upload size={18} />
                  </button>

                  {/* Drag sort toggle */}
                  <button
                    onClick={onToggleDragSortMode}
                    className={`flex items-center justify-center p-2 rounded-full h-[36px] min-w-[36px] cursor-pointer transition-colors ${
                      isDragSortMode
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                    title={isDragSortMode ? '退出拖动排序' : '拖动排序'}
                  >
                    <GripVertical size={18} />
                  </button>

                  {/* Edit mode toggle */}
                  <button
                    onClick={onToggleEditMode}
                    className={`flex items-center justify-center p-2 rounded-full h-[36px] min-w-[36px] cursor-pointer transition-colors ${
                      isEditMode
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                    title={isEditMode ? '退出编辑卡片' : '编辑卡片'}
                  >
                    <Edit3 size={18} />
                  </button>

                  {/* Batch edit */}
                  <button onClick={onToggleBatchEditMode} className={`flex items-center justify-center p-2 rounded-full h-[36px] min-w-[36px] cursor-pointer ${isBatchEditMode ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`} title="批量编辑">
                    <CheckSquare size={18} />
                  </button>

                  {/* Logout */}
                  <button onClick={logout} className="flex items-center justify-center p-2 rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 h-[36px] min-w-[36px] cursor-pointer" title="退出登录">
                    <LogOut size={18} />
                  </button>
                </div>
              </div>

              {/* Toggle Button */}
              <button 
                onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                className={`flex items-center justify-center p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all ${isToolsExpanded ? 'rotate-180' : 'rotate-0'}`}
                title={isToolsExpanded ? "折叠工具栏" : "展开工具栏"}
              >
                <ChevronLeft size={20} />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
              title="登录"
            >
              <Lock size={14} />
              <span>登录</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// Sub-component for the expandable desktop search
function HeaderSearch({
  searchQuery, onSearchChange, isInternal, onSearch,
  visitorEngineId, onVisitorEngineChange
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isInternal: boolean;
  onSearch: (q: string) => void;
  visitorEngineId?: string;
  onVisitorEngineChange?: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search } = useConfigContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownTimer = useRef<NodeJS.Timeout | null>(null);

  const handleClear = () => {
    onSearchChange('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const engine = visitorEngineId || search?.defaultEngine || 'google';
  const engineName = SEARCH_ENGINES.find(e => e.id === engine)?.name || '搜索引擎';

  const handleMouseEnter = () => {
    if (dropdownTimer.current) clearTimeout(dropdownTimer.current);
    setShowDropdown(true);
  };

  const handleMouseLeave = () => {
    dropdownTimer.current = setTimeout(() => setShowDropdown(false), 300);
  };

  return (
    <div className="flex items-center justify-end w-full h-full">
      <div className="flex items-center rounded-full h-9 w-full px-3 bg-[#f1f5f9] dark:bg-slate-700">
        <div
          className="relative flex items-center h-full mr-2 shrink-0"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <button
            className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
            title="选择搜索引擎"
          >
            <RenderEngineLogo
              engine={visitorEngineId || ''}
              customIcon={search?.customEngineIcon}
            />
          </button>
          {showDropdown && onVisitorEngineChange && (
            <SearchEngineOptions
              onSelect={onVisitorEngineChange}
              onClose={() => setShowDropdown(false)}
              currentEngine={visitorEngineId || ''}
              customEngineIcon={search?.customEngineIcon}
            />
          )}
        </div>

        <input
          ref={inputRef}
          id="search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch(searchQuery);
            if (e.key === 'Escape') handleClear();
          }}
          placeholder={isInternal ? "搜索站内链接" : `使用 ${engineName} 搜索互联网`}
          className="bg-transparent border-none text-xs focus:ring-0 dark:text-white placeholder-slate-400 outline-none h-full flex-1 min-w-0"
        />

        {searchQuery ? (
          <button
            onClick={handleClear}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 shrink-0"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
