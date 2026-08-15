// 全局访问密码 API
// GET: 探测是否需要访问密码及当前验证状态
// POST: 验证访问密码并设置 cookie
// 与管理员密码（PASSWORD）独立，使用 ACCESS_PASSWORD 环境变量

import { getKV, getCorsHeaders, jsonResponse, verifyAccessToken, generateSecureToken, parseCookie } from './_kvAdapter.js';

const ACCESS_COOKIE_NAME = 'cloudnav_access_token';
const ACCESS_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // GET: 探测是否需要访问密码及当前 cookie 验证状态
  if (request.method === 'GET') {
    const requiresAccess = !!env.ACCESS_PASSWORD;

    if (!requiresAccess) {
      return jsonResponse({ requiresAccess: false, verified: true }, 200, corsHeaders);
    }

    const cookie = request.headers.get('cookie') || '';
    const accessToken = parseCookie(cookie, ACCESS_COOKIE_NAME);
    const verified = await verifyAccessToken(env, accessToken);

    return jsonResponse({ requiresAccess: true, verified }, 200, corsHeaders);
  }

  // POST: 验证访问密码
  if (request.method === 'POST') {
    try {
      if (!env.ACCESS_PASSWORD) {
        return jsonResponse({ error: '服务器未配置访问密码' }, 500, corsHeaders);
      }

      const { password } = await request.json();

      // 登录失败限流：同一 IP 5 次失败后锁定 5 分钟
      // 优先 EdgeOne 注入的 EO-Connecting-IP（不可伪造），回退 X-Real-IP / X-Forwarded-For
      const ip = request.headers.get('EO-Connecting-IP')
        || request.headers.get('X-Real-IP')
        || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        || 'unknown';
      const failKey = `accessfail:${ip}`;
      let kv;
      try { kv = getKV(env); } catch (e) { kv = null; }
      let failCount = 0;
      try { failCount = parseInt(await kv?.get(failKey) || '0', 10); } catch (e) {}
      if (failCount >= 5) {
        return jsonResponse({ error: '尝试过于频繁，请稍后再试' }, 429, corsHeaders);
      }

      if (password !== env.ACCESS_PASSWORD) {
        try { if (kv) await kv.put(failKey, String(failCount + 1), { expirationTtl: 300 }); } catch (e) {}
        return jsonResponse({ error: '访问密码错误' }, 401, corsHeaders);
      }

      try { if (kv) await kv.delete(failKey); } catch (e) {}

      // 生成访问令牌并存入 KV
      const token = generateSecureToken();
      await kv.put(`access_token:${token}`, 'valid', { expirationTtl: ACCESS_TOKEN_TTL });

      // 设置 HttpOnly cookie，7 天过期
      const headers = {
        ...corsHeaders,
        'Set-Cookie': `${ACCESS_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_TOKEN_TTL}`,
      };

      return jsonResponse({ success: true, message: '访问验证成功' }, 200, headers);
    } catch (err) {
      console.error('Access API error:', err);
      return jsonResponse({ error: '访问验证失败' }, 500, corsHeaders);
    }
  }

  return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
}
