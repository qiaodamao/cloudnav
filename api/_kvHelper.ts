// Vercel KV 辅助函数
import { kv } from '@vercel/kv';

export function getKV() {
  return kv;
}

export function getCorsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
    'Access-Control-Max-Age': '86400',
  };
}

export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');
}

export function calcExpiryTtl(expiry: { value: number; unit: string }): number | null {
  const { value = 1, unit = 'week' } = expiry;
  const multipliers: Record<string, number> = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  if (unit === 'permanent') return null;
  return (multipliers[unit] || 604800) * value;
}

export async function verifyAuth(providedPassword: string): Promise<boolean> {
  if (!providedPassword) return false;

  if (process.env.PASSWORD && providedPassword === process.env.PASSWORD) {
    return true;
  }

  try {
    const tokenVal = await kv.get(`auth_token:${providedPassword}`);
    return tokenVal === 'valid';
  } catch {
    return false;
  }
}
