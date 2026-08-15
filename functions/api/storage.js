// 统一存储接口
// 支持 EdgeOne Pages / Cloudflare Workers
// 支持按分类拆分链接存储

import { getKV, getCorsHeaders, verifyAuth, jsonResponse } from './_kvAdapter.js';

const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
};

const CONFIG_SECTIONS = ['ai', 'website', 'weather', 'search', 'icon', 'view', 'ui', 'webdav'];

async function readConfigSection(kv, section) {
  const sectionStr = await kv.get(`config:${section}`);
  if (sectionStr) return JSON.parse(sectionStr);
  const configStr = await kv.get('config');
  const config = configStr ? JSON.parse(configStr) : {};
  return config[section] || null;
}

async function mergeAllConfigSections(kv) {
  const merged = {};
  let hasAnyIndividual = false;
  const results = await Promise.all(CONFIG_SECTIONS.map(async (s) => {
    const v = await kv.get(`config:${s}`);
    if (v) { hasAnyIndividual = true; return [s, JSON.parse(v)]; }
    return null;
  }));
  for (const r of results) {
    if (r) merged[r[0]] = r[1];
  }
  if (hasAnyIndividual) {
    const configStr = await kv.get('config');
    if (configStr) {
      const legacy = JSON.parse(configStr);
      for (const s of CONFIG_SECTIONS) {
        if (!merged[s] && legacy[s]) merged[s] = legacy[s];
      }
    }
    return merged;
  }
  const configStr = await kv.get('config');
  return configStr ? JSON.parse(configStr) : {};
}

// 生成分类链接 key
function categoryLinksKey(categoryId) {
  return `links:${categoryId}`;
}

// 读取所有分类链接
async function readAllCategoryLinks(kv) {
  // 1. 获取所有分类
  const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
  const categories = categoriesStr ? JSON.parse(categoriesStr) : [];

  if (categories.length === 0) return [];

  // 2. 并行读取每个分类的链接
  const linkPromises = categories.map(async (cat) => {
    const data = await kv.get(categoryLinksKey(cat.id));
    return data ? JSON.parse(data) : [];
  });

  const linkArrays = await Promise.all(linkPromises);

  // 3. 合并所有链接
  return linkArrays.flat();
}

// 保存链接到对应的分类 key
// categories 可选：传入后会为每个分类写入（包括空分类），避免残留旧数据
async function saveCategoryLinks(kv, links, categories) {
  // 按 categoryId 分组
  const grouped = {};
  for (const link of links) {
    const catId = link.categoryId || 'common';
    if (!grouped[catId]) grouped[catId] = [];
    grouped[catId].push(link);
  }

  // 确定要写入的所有分类 key（包括空分类，覆盖旧数据）
  const catIds = new Set(Object.keys(grouped));
  if (categories && Array.isArray(categories)) {
    for (const cat of categories) {
      catIds.add(cat.id);
    }
  }

  // 并行写入每个分类（空分类写入 [] 以覆盖旧数据）
  const writes = [];
  for (const catId of catIds) {
    const catLinks = grouped[catId] || [];
    writes.push(kv.put(categoryLinksKey(catId), JSON.stringify(catLinks)));
  }

  await Promise.all(writes);
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const kv = getKV(env);

    // ==================== GET ====================
    if (request.method === 'GET') {
      const checkAuth = url.searchParams.get('checkAuth');
      const getConfig = url.searchParams.get('getConfig');
      const key = url.searchParams.get('key');
      const readOnly = url.searchParams.get('readOnly');
      const category = url.searchParams.get('category');

      // 检查认证需求
      if (checkAuth === 'true') {
        return jsonResponse({
          hasPassword: !!env.PASSWORD,
          requiresAuth: !!env.PASSWORD,
          readOnlyAccess: true,
          capabilities: { upload: true },
        }, 200, corsHeaders);
      }

      // 获取子配置（优先读独立 key，fallback 到旧 config 的子字段）
      if (CONFIG_SECTIONS.includes(getConfig)) {
        // 敏感配置段（含明文密钥）需认证，防止未授权读取
        const SENSITIVE_SECTIONS = ['webdav'];
        if (SENSITIVE_SECTIONS.includes(getConfig)) {
          const providedPassword = request.headers.get('x-auth-password');
          const isAuthenticated = await verifyAuth({ providedPassword, serverPassword: env.PASSWORD, kv });
          if (!isAuthenticated) {
            return jsonResponse({ error: '该配置需要登录' }, 401, corsHeaders);
          }
        }
        const sectionVal = await readConfigSection(kv, getConfig);
        const defaults = {
          website: { passwordExpiry: { value: 1, unit: 'week' } },
        };
        return jsonResponse(sectionVal || defaults[getConfig] || {}, 200, corsHeaders);
      }

      // 获取 Favicon 缓存
      if (getConfig === 'favicon') {
        const domain = url.searchParams.get('domain');
        if (!domain) {
          return jsonResponse({ error: 'Domain parameter is required' }, 400, corsHeaders);
        }
        const cachedIcon = await kv.get(`favicon:${domain}`);
        return jsonResponse({ icon: cachedIcon || null, cached: !!cachedIcon }, 200, corsHeaders);
      }

      // 获取分类（未认证脱敏 password，认证后返回完整，用于管理编辑）
      if (getConfig === 'categories') {
        const data = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = data ? JSON.parse(data) : [];
        const providedPassword = request.headers.get('x-auth-password');
        const isAuthenticated = await verifyAuth({ providedPassword, serverPassword: env.PASSWORD, kv });
        const result = isAuthenticated ? categories : categories.map(({ password, ...rest }) => rest);
        return jsonResponse(result, 200, corsHeaders);
      }

      // 获取链接
      if (getConfig === 'links') {
        // 按分类读取
        if (category) {
          const data = await kv.get(categoryLinksKey(category));
          return new Response(data || '[]', {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // 读取所有分类链接
        const links = await readAllCategoryLinks(kv);

        return jsonResponse(links, 200, corsHeaders);
      }

      // 按 Key 读取（需认证，防止泄露 last_token 等敏感 KV）
      if (key) {
        const providedPassword = request.headers.get('x-auth-password');
        const isAuthenticated = await verifyAuth({ providedPassword, serverPassword: env.PASSWORD, kv });
        if (!isAuthenticated) {
          return jsonResponse({ error: '该操作需要登录' }, 401, corsHeaders);
        }
        if (key === STORAGE_KEYS.CONFIG_KEY) {
          const merged = await mergeAllConfigSections(kv);
          return jsonResponse({ key, value: JSON.stringify(merged) }, 200, corsHeaders);
        }
        const value = await kv.get(key);
        return jsonResponse({ key, value }, 200, corsHeaders);
      }

      // 获取全部数据（未认证脱敏 password，认证后返回完整）
      if (getConfig === 'true') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = categoriesData ? JSON.parse(categoriesData) : [];

        const providedPassword = request.headers.get('x-auth-password');
        const isAuthenticated = await verifyAuth({ providedPassword, serverPassword: env.PASSWORD, kv });
        const sanitizedCategories = isAuthenticated
          ? categories
          : categories.map(({ password, ...rest }) => rest);

        // 读取所有分类链接
        const links = await readAllCategoryLinks(kv);

        return jsonResponse({
          links,
          categories: sanitizedCategories,
        }, 200, corsHeaders);
      }

      return jsonResponse({ links: [], categories: [] }, 200, corsHeaders);
    }

    // ==================== POST ====================
    if (request.method === 'POST') {
      const body = await request.json();

      // 分类密码校验（访客可调，不需管理员认证；用于解锁受密码保护的分类）
      // 避免将分类密码明文下发到前端
      if (body.verifyCategoryPassword) {
        const { categoryId, password } = body;
        if (!categoryId) {
          return jsonResponse({ error: 'categoryId is required' }, 400, corsHeaders);
        }
        const catsStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = catsStr ? JSON.parse(catsStr) : [];
        const cat = categories.find((c) => c.id === categoryId);
        if (!cat || !cat.password) {
          return jsonResponse({ valid: false }, 200, corsHeaders);
        }
        return jsonResponse({ valid: cat.password === password }, 200, corsHeaders);
      }

      // 认证检查
      const providedPassword = request.headers.get('x-auth-password');
      const isAuthenticated = await verifyAuth({
        providedPassword,
        serverPassword: env.PASSWORD,
        kv,
      });

      if (!isAuthenticated) {
        return jsonResponse({ error: '管理操作需要密码验证' }, 401, corsHeaders);
      }

      // favicon 缓存写入（需认证，防止未授权污染缓存）
      if (body.saveConfig === 'favicon') {
        const { domain, icon } = body;
        if (!domain || !icon) {
          return jsonResponse({ error: 'Domain and icon are required' }, 400, corsHeaders);
        }
        await kv.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 仅验证密码
      if (body.authOnly) {
        await kv.put('last_auth_time', Date.now().toString());
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 保存子配置（写入独立 KV key，避免读取全量 config）
      if (CONFIG_SECTIONS.includes(body.saveConfig)) {
        await kv.put(`config:${body.saveConfig}`, JSON.stringify(body.config));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 保存分类
      if (body.saveConfig === 'categories') {
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 保存链接（按分类拆分存储）
      if (body.saveConfig === 'links') {
        // 如果指定了分类，只保存该分类的链接
        if (body.categoryId) {
          await kv.put(categoryLinksKey(body.categoryId), JSON.stringify(body.links));
        } else {
          // 保存所有链接（按 categoryId 拆分）
          await saveCategoryLinks(kv, body.links);
        }
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 同步统一配置
      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await kv.put('config', body.value);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 写入任意 key（用于设置等独立 KV 项）
      if (body.key && body.value && body.key !== STORAGE_KEYS.CONFIG_KEY) {
        await kv.put(body.key, body.value);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 同时保存链接和分类
      if (body.links && body.categories) {
        await saveCategoryLinks(kv, body.links, body.categories);
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      } else if (body.links) {
        await saveCategoryLinks(kv, body.links);
        return jsonResponse({ success: true }, 200, corsHeaders);
      } else if (body.categories) {
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      return jsonResponse({ error: 'Invalid data format' }, 400, corsHeaders);
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);

  } catch (err) {
    console.error('Storage API error:', err);
    return jsonResponse({ error: '服务器内部错误' }, 500, corsHeaders);
  }
}
