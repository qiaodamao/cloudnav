import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS, API_ENDPOINTS } from '../constants';

// --- Types ---
interface AuthState {
  // 访问密码（全局访问控制，与管理员密码独立）
  requiresAccess: boolean | null;
  isAccessVerified: boolean;
  isCheckingAccess: boolean;
  // 管理员密码（管理操作鉴权）
  authToken: string | null;
  requiresAuth: boolean | null;
  isCheckingAuth: boolean;
  capabilities: { upload: boolean };
  // token 是否已过期（401 触发，用于自动打开重新登录弹窗）
  authExpired: boolean;
}

type AuthAction =
  | { type: 'SET_REQUIRES_ACCESS'; payload: boolean }
  | { type: 'SET_ACCESS_VERIFIED'; payload: boolean }
  | { type: 'SET_CHECKING_ACCESS'; payload: boolean }
  | { type: 'SET_TOKEN'; payload: string | null }
  | { type: 'SET_REQUIRES_AUTH'; payload: boolean }
  | { type: 'SET_CHECKING'; payload: boolean }
  | { type: 'SET_CAPABILITIES'; payload: { upload: boolean } }
  | { type: 'SET_AUTH_EXPIRED'; payload: boolean }
  | { type: 'LOGOUT' };

interface AuthContextValue extends AuthState {
  // 访问密码
  checkAccess: () => Promise<boolean>;
  accessLogin: (password: string) => Promise<boolean>;
  // 管理员密码
  login: (password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  // 标记 token 过期（由数据同步层在 401 时调用）
  markAuthExpired: () => void;
}

// --- Reducer ---
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_REQUIRES_ACCESS':
      return { ...state, requiresAccess: action.payload };
    case 'SET_ACCESS_VERIFIED':
      return { ...state, isAccessVerified: action.payload };
    case 'SET_CHECKING_ACCESS':
      return { ...state, isCheckingAccess: action.payload };
    case 'SET_TOKEN':
      return { ...state, authToken: action.payload };
    case 'SET_REQUIRES_AUTH':
      return { ...state, requiresAuth: action.payload };
    case 'SET_CHECKING':
      return { ...state, isCheckingAuth: action.payload };
    case 'SET_CAPABILITIES':
      return { ...state, capabilities: action.payload };
    case 'SET_AUTH_EXPIRED':
      return { ...state, authExpired: action.payload };
    case 'LOGOUT':
      return { ...state, authToken: null };
    default:
      return state;
  }
}

// --- Context ---
const AuthContext = createContext<AuthContextValue | null>(null);

// --- Provider ---
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    requiresAccess: null,
    isAccessVerified: false,
    isCheckingAccess: true,
    authToken: localStorage.getItem(STORAGE_KEYS.AUTH_KEY),
    requiresAuth: null,
    isCheckingAuth: true,
    capabilities: { upload: true },
    authExpired: false,
  });

  // 防止重复弹窗的 ref（多个并发请求同时 401 时只弹一次）
  const authExpiredRef = useRef(false);

  // 访问密码探测：返回是否已验证（true 表示可以继续后续流程）
  const checkAccess = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'SET_CHECKING_ACCESS', payload: true });
    try {
      const res = await fetch(API_ENDPOINTS.ACCESS);
      const data = await res.json();
      dispatch({ type: 'SET_REQUIRES_ACCESS', payload: data.requiresAccess });
      dispatch({ type: 'SET_ACCESS_VERIFIED', payload: data.verified });
      return data.verified;
    } catch (e) {
      console.error('Check access failed:', e);
      dispatch({ type: 'SET_REQUIRES_ACCESS', payload: false });
      dispatch({ type: 'SET_ACCESS_VERIFIED', payload: true });
      return true;
    } finally {
      dispatch({ type: 'SET_CHECKING_ACCESS', payload: false });
    }
  }, []);

  // 管理员密码探测
  const checkAuth = useCallback(async () => {
    dispatch({ type: 'SET_CHECKING', payload: true });
    try {
      const res = await fetch(`${API_ENDPOINTS.STORAGE}?checkAuth=true`);
      const data = await res.json();
      dispatch({ type: 'SET_REQUIRES_AUTH', payload: data.requiresAuth });
      if (data.capabilities) {
        dispatch({ type: 'SET_CAPABILITIES', payload: data.capabilities });
      }
    } catch (e) {
      console.error('Check auth failed:', e);
      dispatch({ type: 'SET_REQUIRES_AUTH', payload: false });
    } finally {
      dispatch({ type: 'SET_CHECKING', payload: false });
    }
  }, []);

  // 访问密码登录：成功后自动触发管理员密码探测
  const accessLogin = useCallback(async (password: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(API_ENDPOINTS.ACCESS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.error('Access login failed:', res.status);
        return false;
      }

      const data = await res.json();
      if (data.success) {
        // cookie 由后端 Set-Cookie 设置，前端仅更新状态
        dispatch({ type: 'SET_ACCESS_VERIFIED', payload: true });
        // 访问密码验证成功后，探测管理员密码需求
        checkAuth();
        return true;
      }
      return false;
    } catch (e) {
      if (e.name === 'AbortError') {
        console.error('Access login timeout');
      } else {
        console.error('Access login error:', e);
      }
      return false;
    }
  }, [checkAuth]);

  // 管理员密码登录
  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(API_ENDPOINTS.AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Login failed:', res.status, errData);
        return false;
      }

      const data = await res.json();
      if (data.success && data.token) {
        authExpiredRef.current = false;
        localStorage.setItem(STORAGE_KEYS.AUTH_KEY, data.token);
        dispatch({ type: 'SET_TOKEN', payload: data.token });
        dispatch({ type: 'SET_AUTH_EXPIRED', payload: false });
        return true;
      }

      console.error('Login response missing token:', data);
      return false;
    } catch (e) {
      if (e.name === 'AbortError') {
        console.error('Login timeout');
      } else {
        console.error('Login error:', e);
      }
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    authExpiredRef.current = false;
    localStorage.removeItem(STORAGE_KEYS.AUTH_KEY);
    dispatch({ type: 'SET_AUTH_EXPIRED', payload: false });
    dispatch({ type: 'LOGOUT' });
  }, []);

  // token 过期标记：由 LinksContext/CategoriesContext 在同步遇到 401 时调用
  // 弹窗提示用户并清除本地 stale token，AppLayout 监听 authExpired 自动打开登录弹窗
  const markAuthExpired = useCallback(() => {
    if (authExpiredRef.current) return; // 已标记过，避免重复弹窗
    authExpiredRef.current = true;
    dispatch({ type: 'SET_AUTH_EXPIRED', payload: true });
    localStorage.removeItem(STORAGE_KEYS.AUTH_KEY);
    dispatch({ type: 'LOGOUT' });
    alert('登录状态已过期，请重新登录后再操作。重新登录后将自动刷新页面以同步数据。');
  }, []);

  // 初始化：先检查访问密码，通过后再检查管理员密码需求
  useEffect(() => {
    (async () => {
      const verified = await checkAccess();
      if (verified) {
        await checkAuth();
      }
    })();
  }, [checkAccess, checkAuth]);

  return (
    <AuthContext.Provider value={{ ...state, checkAccess, accessLogin, login, logout, checkAuth, markAuthExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

// --- Hook ---
export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
