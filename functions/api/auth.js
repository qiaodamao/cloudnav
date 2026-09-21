// 认证接口
// 支持 EdgeOne Pages / Cloudflare Workers
// 多会话并存：最多保留 MAX_SESSIONS 个有效 token，超出时踢掉最旧的

import { getKV, getCorsHeaders, jsonResponse } from './_kvAdapter.js';

const MAX_SESSIONS = 5; // 管理员会话上限
const SESSION_LIST_KEY = 'auth_tokens'; // 会话列表（JSON 数组，按创建顺序旧→新）

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // DELETE: 登出，删除服务端 token 使会话立即失效
  if (request.method === 'DELETE') {
    try {
      const kv = getKV(env);
      const token = request.headers.get('x-auth-password') || '';
      if (!token) {
        return jsonResponse({ error: '缺少认证信息' }, 401, corsHeaders);
      }

      const tokenVal = await kv.get(`auth_token:${token}`);
      if (tokenVal === 'valid') {
        await kv.delete(`auth_token:${token}`);
        await removeFromSessionList(kv, token);
      }

      return jsonResponse({ success: true, message: '已登出' }, 200, corsHeaders);
    } catch (err) {
      console.error('Auth logout error:', err);
      return jsonResponse({ error: '登出失败' }, 500, corsHeaders);
    }
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  try {
    const kv = getKV(env);
    const { password } = await request.json();

    if (!env.PASSWORD) {
      return jsonResponse({ error: '服务器未配置管理员密码' }, 500, corsHeaders);
    }

    // 登录失败限流：同一 IP 5 次失败后锁定 5 分钟
    // 优先 EdgeOne 注入的 EO-Connecting-IP（不可伪造），回退 X-Real-IP / X-Forwarded-For
    const ip = request.headers.get('EO-Connecting-IP')
      || request.headers.get('X-Real-IP')
      || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || 'unknown';
    const failKey = `authfail:${ip}`;
    let failCount = 0;
    try { failCount = parseInt(await kv.get(failKey) || '0', 10); } catch (e) {}
    if (failCount >= 5) {
      return jsonResponse({ error: '尝试过于频繁，请稍后再试' }, 429, corsHeaders);
    }

    if (password !== env.PASSWORD) {
      try { await kv.put(failKey, String(failCount + 1), { expirationTtl: 300 }); } catch (e) {}
      return jsonResponse({ error: '密码错误' }, 401, corsHeaders);
    }

    // 成功：清除失败计数
    try { await kv.delete(failKey); } catch (e) {}

    // 旧单会话机制迁移：清理 last_token 指向的旧 token（一次性）
    try {
      const legacyToken = await kv.get('last_token');
      if (legacyToken) {
        await kv.delete(`auth_token:${legacyToken}`);
        await kv.delete('last_token');
      }
    } catch (e) {
      console.warn('Failed to clean legacy token:', e);
    }

    // 读取会话列表，过滤已自然过期的 token
    const sessionList = await readValidSessionList(kv);

    // 超出会话上限时，踢掉最旧的会话
    while (sessionList.length >= MAX_SESSIONS) {
      const oldest = sessionList.shift();
      try { await kv.delete(`auth_token:${oldest}`); } catch (e) {}
    }

    // 生成安全随机 Token
    const token = generateSecureToken();
    sessionList.push(token);

    // 读取密码过期配置
    // 先读分片 config:website（新存储方式），没有再 fallback 到旧 config（整体存储）
    let expirationTtl = 24 * 60 * 60; // 默认 1 天
    try {
      let websiteConfig = null;
      const sectionStr = await kv.get('config:website');
      if (sectionStr) {
        websiteConfig = JSON.parse(sectionStr);
      } else {
        const configStr = await kv.get('config');
        if (configStr) {
          websiteConfig = JSON.parse(configStr).website;
        }
      }
      const expiry = websiteConfig?.passwordExpiry;
      if (expiry) {
        expirationTtl = calcExpiryTtl(expiry);
      }
    } catch (e) {
      console.warn('Failed to read expiry config:', e);
    }

    // 记录认证时间
    await kv.put('last_auth_time', Date.now().toString());

    // 存储新 Token
    const kvOptions = expirationTtl ? { expirationTtl } : {};
    await kv.put(`auth_token:${token}`, 'valid', kvOptions);

    // 保存会话列表（新 token 已在列表末尾）
    await saveSessionList(kv, sessionList);

    return jsonResponse({
      success: true,
      token,
      message: '认证成功',
    }, 200, corsHeaders);

  } catch (err) {
    console.error('Auth API error:', err);
    return jsonResponse({ error: '认证请求失败' }, 500, corsHeaders);
  }
}

/**
 * 生成安全随机 Token（32 字节 hex = 64 字符）
 */
function generateSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 读取会话列表，过滤已自然过期的 token
 * 单个 token 查询失败时保守保留，避免误踢有效会话
 */
async function readValidSessionList(kv) {
  try {
    const listStr = await kv.get(SESSION_LIST_KEY);
    if (!listStr) return [];
    const list = JSON.parse(listStr);
    if (!Array.isArray(list)) return [];

    const valid = [];
    for (const t of list) {
      try {
        if ((await kv.get(`auth_token:${t}`)) === 'valid') {
          valid.push(t);
        }
      } catch (e) {
        valid.push(t);
      }
    }
    return valid;
  } catch (e) {
    console.warn('Failed to read session list:', e);
    return [];
  }
}

/**
 * 保存会话列表，空列表时删除 key
 */
async function saveSessionList(kv, list) {
  try {
    if (list.length) {
      await kv.put(SESSION_LIST_KEY, JSON.stringify(list));
    } else {
      await kv.delete(SESSION_LIST_KEY);
    }
  } catch (e) {
    console.warn('Failed to save session list:', e);
  }
}

/**
 * 从会话列表中移除指定 token
 */
async function removeFromSessionList(kv, token) {
  try {
    const listStr = await kv.get(SESSION_LIST_KEY);
    if (!listStr) return;
    const list = JSON.parse(listStr);
    if (!Array.isArray(list)) return;

    const next = list.filter(t => t !== token);
    if (next.length !== list.length) {
      await saveSessionList(kv, next);
    }
  } catch (e) {
    console.warn('Failed to update session list:', e);
  }
}

/**
 * 计算 Token 过期时间（秒）
 */
function calcExpiryTtl(expiry) {
  const { value = 1, unit = 'week' } = expiry;
  const multipliers = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  if (unit === 'permanent') return null;
  return (multipliers[unit] || 604800) * value;
}
