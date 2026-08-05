// 跨平台 KV 适配层
// 支持 EdgeOne Pages (全局变量) / Cloudflare Workers (env 绑定)

/**
 * 获取 KV 实例，自动检测运行平台
 * @param {object} env - 函数 context.env
 * @returns {object} KV 实例
 */
export function getKV(env) {
  // Cloudflare Workers: KV 在 env 上
  if (env?.CLOUDNAV_KV && typeof env.CLOUDNAV_KV.get === 'function') {
    return env.CLOUDNAV_KV;
  }
  // EdgeOne Pages: KV 作为全局变量注入
  if (typeof CLOUDNAV_KV !== 'undefined' && typeof CLOUDNAV_KV.get === 'function') {
    return CLOUDNAV_KV;
  }
  throw new Error('KV binding "CLOUDNAV_KV" not found. Please check your deployment configuration.');
}

/**
 * 获取 CORS 头，支持配置化
 * @param {object} env - 函数 context.env
 * @returns {object} CORS headers
 */
export function getCorsHeaders(env) {
  const origin = env?.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * 认证检查：验证密码或 Token
 * @param {object} params
 * @param {string} params.providedPassword - 客户端提供的密码或 Token
 * @param {string} params.serverPassword - 环境变量中的密码
 * @param {object} params.kv - KV 实例
 * @returns {Promise<boolean>}
 */
export async function verifyAuth({ providedPassword, serverPassword, kv }) {
  if (!providedPassword) return false;

  // 直接匹配密码
  if (serverPassword && providedPassword === serverPassword) {
    return true;
  }

  // 查 KV 中的 Token
  try {
    const tokenVal = await kv.get(`auth_token:${providedPassword}`);
    return tokenVal === 'valid';
  } catch {
    return false;
  }
}

/**
 * 验证访问令牌（访问密码登录后生成的 token，存于 cookie）
 * 与管理员密码体系独立，用于全局访问控制
 * @param {object} env - 函数 context.env
 * @param {string} token - cookie 中的访问令牌
 * @returns {Promise<boolean>}
 */
export async function verifyAccessToken(env, token) {
  if (!token) return false;
  try {
    const kv = getKV(env);
    const val = await kv.get(`access_token:${token}`);
    return val === 'valid';
  } catch {
    return false;
  }
}

/**
 * 生成安全随机 Token（32 字节 hex = 64 字符）
 * @returns {string}
 */
export function generateSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 从 Cookie 字符串中解析指定字段的值
 * @param {string} cookieStr - request.headers.get('cookie')
 * @param {string} name - cookie 字段名
 * @returns {string|null}
 */
export function parseCookie(cookieStr, name) {
  if (!cookieStr) return null;
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * 创建标准 JSON 响应
 * @param {any} data - 响应数据
 * @param {number} status - HTTP 状态码
 * @param {object} extraHeaders - 额外响应头
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
