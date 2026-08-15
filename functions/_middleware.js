// 全局中间件：访问密码保护
// 拦截 /api/* 请求，校验 cookie 中的访问令牌
// 与管理员密码（PASSWORD）独立，使用 ACCESS_PASSWORD 环境变量
// 未配置 ACCESS_PASSWORD 时完全放行，不影响现有行为

import { getCorsHeaders, verifyAccessToken, parseCookie } from './api/_kvAdapter.js';

const ACCESS_COOKIE_NAME = 'cloudnav_access_token';

export async function onRequest(context) {
  const { request, env, next } = context;

  // 未配置访问密码，直接放行
  if (!env.ACCESS_PASSWORD) {
    return await next();
  }

  // 放行 OPTIONS 预检（不带 cookie，无法校验）
  if (request.method === 'OPTIONS') {
    return await next();
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // 放行访问密码登录端点（避免死循环）
  if (path === '/api/access') {
    return await next();
  }

  // 检查 cookie 中的访问令牌
  const cookie = request.headers.get('cookie') || '';
  const accessToken = parseCookie(cookie, ACCESS_COOKIE_NAME);
  const isValid = await verifyAccessToken(env, accessToken);

  if (isValid) {
    return await next();
  }

  // 未登录：API 返回 401，前端据此显示访问密码弹窗
  const corsHeaders = getCorsHeaders(env, request);
  return new Response(
    JSON.stringify({ error: '需要访问密码', requiresAccess: true }),
    { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}
