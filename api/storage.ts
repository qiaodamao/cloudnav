// Vercel 存储接口
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKV, getCorsHeaders, verifyAuth } from './_kvHelper.js';

const CONFIG_SECTIONS = ['ai', 'website', 'weather', 'search', 'icon', 'view', 'ui', 'webdav'];

const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
  LINKS_CONFIG_KEY: 'links_config',
};

async function readConfigSection(kv: any, section: string) {
  const sectionStr = await kv.get(`config:${section}`);
  if (sectionStr) return typeof sectionStr === 'string' ? JSON.parse(sectionStr) : sectionStr;
  const configStr = await kv.get('config');
  const config = configStr ? (typeof configStr === 'string' ? JSON.parse(configStr) : configStr) : {};
  return config[section] || null;
}

async function mergeAllConfigSections(kv: any) {
  const merged: Record<string, any> = {};
  let hasAnyIndividual = false;
  const results = await Promise.all(CONFIG_SECTIONS.map(async (s) => {
    const v = await kv.get(`config:${s}`);
    if (v) { hasAnyIndividual = true; return [s, typeof v === 'string' ? JSON.parse(v) : v]; }
    return null;
  }));
  for (const r of results) {
    if (r) merged[r[0]] = r[1];
  }
  if (hasAnyIndividual) {
    const configStr = await kv.get('config');
    if (configStr) {
      const legacy = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
      for (const s of CONFIG_SECTIONS) {
        if (!merged[s] && legacy[s]) merged[s] = legacy[s];
      }
    }
    return merged;
  }
  const configStr = await kv.get('config');
  return configStr ? (typeof configStr === 'string' ? JSON.parse(configStr) : configStr) : {};
}

// 生成分类链接 key
function categoryLinksKey(categoryId: string) {
  return `links:${categoryId}`;
}

// 读取所有分类链接
async function readAllCategoryLinks(kv: any) {
  // 1. 获取所有分类
  const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
  const categories = categoriesStr ? (typeof categoriesStr === 'string' ? JSON.parse(categoriesStr) : categoriesStr) : [];

  if (categories.length === 0) {
    // 如果没有分类配置，尝试读取旧版全量链接
    const legacyData = await kv.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
    return legacyData ? (typeof legacyData === 'string' ? JSON.parse(legacyData) : legacyData) : [];
  }

  // 2. 并行读取每个分类的链接
  const linkPromises = categories.map(async (cat: any) => {
    const data = await kv.get(categoryLinksKey(cat.id));
    return data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
  });

  const linkArrays = await Promise.all(linkPromises);
  const allLinks = linkArrays.flat();

  // 3. 兼容性检查：如果拆分存储没数据，但旧版全量存储有数据，则返回旧版数据
  if (allLinks.length === 0) {
    const legacyData = await kv.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
    return legacyData ? (typeof legacyData === 'string' ? JSON.parse(legacyData) : legacyData) : [];
  }

  return allLinks;
}

// 保存链接到对应的分类 key
async function saveCategoryLinks(kv: any, links: any[]) {
  // 按 categoryId 分组
  const grouped: Record<string, any[]> = {};
  for (const link of links) {
    const catId = link.categoryId || 'common';
    if (!grouped[catId]) grouped[catId] = [];
    grouped[catId].push(link);
  }

  // 并行写入每个分类
  const writes = Object.entries(grouped).map(([catId, catLinks]) =>
    kv.set(categoryLinksKey(catId), JSON.stringify(catLinks))
  );

  await Promise.all(writes);
  
  // 写入后清除旧版全量存储（可选，为了安全起见这里暂时不删，或者只写一个标记）
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);
  res.setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', corsHeaders['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', corsHeaders['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const kv = getKV();

    // ==================== GET ====================
    if (req.method === 'GET') {
      const { checkAuth, getConfig, key, readOnly } = req.query;

      if (checkAuth === 'true') {
        return res.status(200).json({
          hasPassword: !!process.env.PASSWORD,
          requiresAuth: !!process.env.PASSWORD,
          readOnlyAccess: true,
          capabilities: { upload: false },
        });
      }

      if (CONFIG_SECTIONS.includes(getConfig as string)) {
        // 敏感配置段（含明文密钥）需认证，防止未授权读取
        const SENSITIVE_SECTIONS = ['webdav'];
        if (SENSITIVE_SECTIONS.includes(getConfig as string)) {
          const providedPassword = req.headers['x-auth-password'] as string;
          const isAuthenticated = await verifyAuth(providedPassword);
          if (!isAuthenticated) {
            return res.status(401).json({ error: '该配置需要登录' });
          }
        }
        const sectionVal = await readConfigSection(kv, getConfig as string);
        const defaults: Record<string, any> = {
          website: { passwordExpiry: { value: 1, unit: 'week' } },
        };
        return res.status(200).json(sectionVal || defaults[getConfig as string] || {});
      }

      if (getConfig === 'favicon') {
        const domain = req.query.domain as string;
        if (!domain) return res.status(400).json({ error: 'Domain required' });
        const cachedIcon = await kv.get(`favicon:${domain}`);
        return res.status(200).json({ icon: cachedIcon || null, cached: !!cachedIcon });
      }

      if (getConfig === 'categories') {
        const data = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
        const providedPassword = req.headers['x-auth-password'] as string;
        const isAuthenticated = await verifyAuth(providedPassword);
        const result = isAuthenticated ? categories : categories.map(({ password, ...rest }: any) => rest);
        return res.status(200).json(result);
      }

      if (getConfig === 'links') {
        const categoryId = req.query.category as string;
        if (categoryId) {
          const data = await kv.get(categoryLinksKey(categoryId));
          return res.status(200).json(data ? (typeof data === 'string' ? JSON.parse(data) : data) : []);
        }
        const links = await readAllCategoryLinks(kv);
        return res.status(200).json(links);
      }

      if (key) {
        const providedPassword = req.headers['x-auth-password'] as string;
        const isAuthenticated = await verifyAuth(providedPassword);
        if (!isAuthenticated) {
          return res.status(401).json({ error: '该操作需要登录' });
        }
        if (key === STORAGE_KEYS.CONFIG_KEY) {
          const merged = await mergeAllConfigSections(kv);
          return res.status(200).json({ key, value: JSON.stringify(merged) });
        }
        const value = await kv.get(key as string);
        return res.status(200).json({ key, value });
      }

      if (getConfig === 'true') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = categoriesData ? (typeof categoriesData === 'string' ? JSON.parse(categoriesData) : categoriesData) : [];
        const providedPassword = req.headers['x-auth-password'] as string;
        const isAuthenticated = await verifyAuth(providedPassword);
        const sanitizedCategories = isAuthenticated
          ? categories
          : categories.map(({ password, ...rest }: any) => rest);

        const links = await readAllCategoryLinks(kv);

        return res.status(200).json({
          links,
          categories: sanitizedCategories,
        });
      }

      return res.status(200).json({ links: [], categories: [] });
    }

    // ==================== POST ====================
    if (req.method === 'POST') {
      const body = req.body;

      // 分类密码校验（访客可调，不需管理员认证；避免密码明文下发前端）
      if (body.verifyCategoryPassword) {
        const { categoryId, password } = body;
        if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });
        const catsStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = catsStr ? (typeof catsStr === 'string' ? JSON.parse(catsStr) : catsStr) : [];
        const cat = categories.find((c: any) => c.id === categoryId);
        if (!cat || !cat.password) return res.status(200).json({ valid: false });
        return res.status(200).json({ valid: cat.password === password });
      }

      const providedPassword = req.headers['x-auth-password'] as string;
      const isAuthenticated = await verifyAuth(providedPassword);

      if (!isAuthenticated) {
        return res.status(401).json({ error: '管理操作需要密码验证' });
      }

      // favicon 缓存写入（需认证，防止未授权污染缓存）
      if (body.saveConfig === 'favicon') {
        const { domain, icon } = body;
        if (!domain || !icon) return res.status(400).json({ error: 'Domain and icon required' });
        await kv.set(`favicon:${domain}`, icon, { ex: 30 * 24 * 60 * 60 });
        return res.status(200).json({ success: true });
      }

      if (body.authOnly) {
        await kv.set('last_auth_time', Date.now().toString());
        return res.status(200).json({ success: true });
      }

      if (CONFIG_SECTIONS.includes(body.saveConfig)) {
        await kv.set(`config:${body.saveConfig}`, JSON.stringify(body.config));
        return res.status(200).json({ success: true });
      }

      if (body.saveConfig === 'categories') {
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return res.status(200).json({ success: true });
      }

      if (body.saveConfig === 'links') {
        if (body.categoryId) {
          await kv.set(categoryLinksKey(body.categoryId), JSON.stringify(body.links));
        } else {
          await saveCategoryLinks(kv, body.links);
        }
        return res.status(200).json({ success: true });
      }

      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await kv.set('config', body.value);
        return res.status(200).json({ success: true });
      }

      if (body.links && body.categories) {
        await saveCategoryLinks(kv, body.links);
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return res.status(200).json({ success: true });
      } else if (body.links) {
        await saveCategoryLinks(kv, body.links);
        return res.status(200).json({ success: true });
      } else if (body.categories) {
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid data format' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (err: any) {
    console.error('Storage API error:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}

