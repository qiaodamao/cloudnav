// Vercel 认证接口
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKV, getCorsHeaders, generateSecureToken, calcExpiryTtl } from './_kvHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const kv = getKV();
    const { password } = req.body;

    if (!process.env.PASSWORD) {
      console.error('Environment variable PASSWORD is not set');
      return res.status(500).json({ error: '服务器未配置管理员密码' });
    }

    // 登录失败限流：同 IP 5 次失败锁定 5 分钟，防止暴力破解
    const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || 'unknown';
    const failKey = `authfail:${ip}`;
    let failCount = 0;
    try { failCount = parseInt((await kv.get(failKey) as string) || '0', 10); } catch (e) {}
    if (failCount >= 5) {
      return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
    }

    if (password !== process.env.PASSWORD) {
      try { await kv.set(failKey, String(failCount + 1), { ex: 300 }); } catch (e) {}
      return res.status(401).json({ error: '密码错误' });
    }

    // 成功：清除失败计数
    try { await kv.del(failKey); } catch (e) {}

    // 清理旧 Token
    try {
      const oldToken = await kv.get('last_token');
      if (oldToken) {
        await kv.del(`auth_token:${oldToken}`);
      }
    } catch (e) {
      console.warn('Failed to clean old token:', e);
    }

    const token = generateSecureToken();

    let expirationTtl = 24 * 60 * 60;
    try {
      const configData = await kv.get('config');
      if (configData) {
        const config = typeof configData === 'string' ? JSON.parse(configData) : configData;
        const expiry = config.website?.passwordExpiry;
        if (expiry) {
          expirationTtl = calcExpiryTtl(expiry) || 24 * 60 * 60;
        }
      }
    } catch (e) {
      console.warn('Failed to read expiry config:', e);
    }

    await kv.set('last_auth_time', Date.now().toString());
    if (expirationTtl) {
      await kv.set(`auth_token:${token}`, 'valid', { ex: expirationTtl });
      await kv.set('last_token', token, { ex: expirationTtl });
    } else {
      await kv.set(`auth_token:${token}`, 'valid');
      await kv.set('last_token', token);
    }

    return res.status(200).json({ success: true, token, message: '认证成功' });

  } catch (err: any) {
    console.error('Auth API error:', err);
    return res.status(500).json({ error: '认证请求失败' });
  }
}

