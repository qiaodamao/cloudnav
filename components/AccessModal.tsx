import React, { useState } from 'react';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';

interface AccessModalProps {
  isOpen: boolean;
  onLogin: (password: string) => Promise<boolean>;
}

// 访问密码弹窗（全局访问控制，与管理员密码独立）
// 不可关闭：必须输入正确访问密码才能进入站点
const AccessModal: React.FC<AccessModalProps> = ({ isOpen, onLogin }) => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleLogin = async () => {
    if (!password || isLoading) return;
    setIsLoading(true);
    setError('');

    try {
      const success = await onLogin(password);
      if (success) {
        setPassword('');
      } else {
        setError('访问密码错误');
      }
    } catch (e) {
      setError('请求失败，请检查网络');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400">
              <Lock size={32} />
            </div>
            <h2 className="text-xl font-bold dark:text-white">访问验证</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">
              此站点已开启访问保护，请输入访问密码以继续浏览
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-center tracking-widest"
                placeholder="访问密码"
                autoFocus
              />
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center font-medium">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoading || !password}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : <>进入站点 <ArrowRight size={18} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccessModal;
