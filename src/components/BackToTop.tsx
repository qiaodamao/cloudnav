import { useState, useEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

// 返回顶部按钮：滚动超过一屏后显示，点击平滑滚动到顶部
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const findScrollContainer = () => {
      // 主滚动容器是 MainContent 的 <main className="flex-1 overflow-y-auto">
      const main = document.querySelector('main.flex-1.overflow-y-auto');
      scrollRef.current = main as HTMLElement | null;
      return main;
    };

    const handler = () => {
      const el = scrollRef.current || findScrollContainer();
      if (el) {
        setVisible(el.scrollTop > 300);
      }
    };

    findScrollContainer();
    handler();

    // 监听找到的滚动容器
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', handler, { passive: true });
    }

    // 兜底：延迟重新查找（防止 DOM 未渲染完成）
    const timer = setTimeout(() => {
      if (!scrollRef.current) {
        const found = findScrollContainer();
        if (found) {
          found.addEventListener('scroll', handler, { passive: true });
          handler();
        }
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      const target = scrollRef.current;
      if (target) {
        target.removeEventListener('scroll', handler);
      }
    };
  }, []);

  const scrollToTop = () => {
    const el = scrollRef.current || document.querySelector('main.flex-1.overflow-y-auto');
    if (el) {
      (el as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!visible) return null;

  return (
    <button
      onClick={scrollToTop}
      className="fixed bottom-6 right-6 z-40 w-11 h-11 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 shadow-lg hover:shadow-xl hover:scale-110 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200 cursor-pointer"
      title="返回顶部"
      aria-label="返回顶部"
    >
      <ArrowUp size={20} />
    </button>
  );
}
