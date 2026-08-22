// WebDAV 代理接口
// 支持 EdgeOne Pages / Cloudflare Workers

import { getCorsHeaders, jsonResponse, verifyAuth, getKV } from './_kvAdapter.js';

// 带超时控制的 fetch，避免目标服务器不可达时长时间挂起
const fetchWithTimeout = async (url, options, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e && (e.name === 'AbortError' || /aborted/i.test(String(e)));
    if (isAbort) {
      const err = new Error(`请求超时（${timeoutMs / 1000}s），目标服务器未响应`);
      err.isTimeout = true;
      throw err;
    }
    // 网络层错误（DNS 解析失败、连接被重置等），包装成可读信息
    const msg = String(e?.message || e);
    const wrapped = new Error(/Failed to fetch|NetworkError|ECONNRESET|ENOTFOUND|ETIMEDOUT/.test(msg)
      ? `无法连接到目标服务器（网络层错误：${msg}）`
      : msg);
    wrapped.isNetwork = true;
    throw wrapped;
  }
};

// 根据域名给出针对性的连接建议（用于错误提示）
const getConnectionHint = (url) => {
  try {
    const host = new URL(url).hostname;
    if (/infini-cloud\.net|teracloud\.jp/.test(host)) {
      return 'InfiniCloud 服务器在日本，中国大陆访问可能受限。后端代理（EdgeOne/Cloudflare）通常可直连；若仍失败，请在 InfiniCloud 网页端确认已开启"外部应用连接"并使用应用密码（非登录密码）。';
    }
    if (/jianguoyun\.com/.test(host)) {
      return '坚果云需使用应用密码（非登录密码），且 WebDAV 地址为 https://dav.jianguoyun.com/dav/';
    }
    return '';
  } catch (e) { return ''; }
};

// 清洗错误详情：网关返回的 HTML 错误页（如 EdgeOne 504/502 页面）对用户无意义，替换为可读说明
const cleanErrorDetail = (status, rawDetail, hint) => {
  // 502/503/504 通常是网关/代理层错误（EdgeOne 无法连接到目标 WebDAV 服务器）
  if ([502, 503, 504].includes(status)) {
    const gatewayMsg = `网关错误 ${status}：后端代理无法连接到 WebDAV 服务器（可能是目标服务器不可达或被墙）。`;
    return hint ? `${gatewayMsg}\n建议：${hint}` : gatewayMsg;
  }
  // detail 里是 HTML 错误页（doctype/html 标签），直接丢弃，只保留 hint
  if (rawDetail && /<(!doctype|html|head|body)/i.test(rawDetail)) {
    return hint ? `服务器返回了无法解析的 HTML 错误页。\n建议：${hint}` : '服务器返回了无法解析的 HTML 错误页。';
  }
  // 普通文本错误，保留并追加 hint
  if (rawDetail && hint) {
    return `${rawDetail.slice(0, 500)}\n建议：${hint}`;
  }
  return hint ? `建议：${hint}` : (rawDetail || '').slice(0, 500);
};

// 北京时间日期串（YYYYMMDD），用于备份文件名
const getBeijingDateStr = () => {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
};

// 列出备份目录下的文件名（PROPFIND Depth:1），失败返回 null
const listWebDavFiles = async (storageBaseUrl, authHeader) => {
  const res = await fetchWithTimeout(storageBaseUrl, {
    method: 'PROPFIND',
    headers: {
      'Authorization': authHeader,
      'User-Agent': 'CloudNav/1.0',
      'Depth': '1',
      'Content-Type': 'application/xml',
    },
    body: '<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
  }, 15000);
  if (!(res.ok || res.status === 207)) return null;
  const xml = await res.text();
  // 解析所有 <D:href>（或无命名空间 <href>）取文件名
  const hrefs = [...xml.matchAll(/<(?:[A-Za-z][\w-]*:)?href>([^<]+)<\/(?:[A-Za-z][\w-]*:)?href>/gi)].map(m => m[1]);
  const names = hrefs.map(h => {
    let p = h;
    try { p = decodeURIComponent(h); } catch (e) { /* 保留原样 */ }
    return p.split('/').filter(Boolean).pop() || '';
  });
  return [...new Set(names)];
};

// 备份轮转：按文件名中的日期（YYYYMMDD）排序，json/html 各最多保留 maxKeep 份，超出删除最旧的
// 旧版固定文件名（cloudnav_backup.json / cloudnav_bookmarks.html）视为最旧，凑满 5 份后一并清理
const rotateBackups = async (storageBaseUrl, authHeader, maxKeep = 5) => {
  try {
    const names = await listWebDavFiles(storageBaseUrl, authHeader);
    if (!names || names.length === 0) return;

    const del = (name) => fetchWithTimeout(storageBaseUrl + name, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader, 'User-Agent': 'CloudNav/1.0' },
    }, 15000).catch(() => {});

    // 单类文件的轮转：带日期的 + 可选的旧版固定名，按日期倒序，超出 maxKeep 的删除
    const rotateOne = (pattern, legacyName) => {
      const all = names
        .filter(n => pattern.test(n))
        .map(n => ({ name: n, date: (n.match(/(\d{8})/) || [])[1] || '' }));
      if (names.includes(legacyName)) all.push({ name: legacyName, date: '00000000' });
      all.sort((a, b) => b.date.localeCompare(a.date));
      return all.slice(maxKeep).map(x => x.name);
    };

    const toDelete = [
      ...rotateOne(/^cloudnav_backup_\d{8}\.json$/, 'cloudnav_backup.json'),
      ...rotateOne(/^cloudnav_bookmarks_\d{8}\.html$/, 'cloudnav_bookmarks.html'),
    ];
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(del));
    }
  } catch (e) {
    // 轮转失败不影响备份本身
    console.warn('Backup rotation failed:', e);
  }
};

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  try {
    const body = await request.json();
    const { operation, config, payload } = body;

    // 认证检查（WebDAV 代理涉及用户凭据，必须登录后调用，防止被用作开放代理/SSRF）
    const providedPassword = request.headers.get('x-auth-password');
    let kv;
    try { kv = getKV(env); } catch (e) { kv = null; }
    const isAuthenticated = await verifyAuth({ providedPassword, serverPassword: env.PASSWORD, kv });
    if (!isAuthenticated) {
      return jsonResponse({ error: '需要登录' }, 401, corsHeaders);
    }

    if (!config || !config.url || !config.username || !config.password) {
      return jsonResponse({ error: 'Missing configuration' }, 400, corsHeaders);
    }

    let baseUrl = config.url.trim();
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    const hint = getConnectionHint(baseUrl);

    // 坚果云根目录 /dav/ 不允许直接写文件，会返回 404 ObjectNotFound
    // 检测到根目录配置时，自动使用 cloudnav 子目录存放备份
    let storageBaseUrl = baseUrl;
    try {
      const u = new URL(baseUrl);
      const p = u.pathname.toLowerCase();
      const isJianguoyunRoot = /jianguoyun\.com/.test(baseUrl) && (p === '/dav/' || p === '/dav');
      if (isJianguoyunRoot) {
        storageBaseUrl = baseUrl + 'cloudnav/';
      }
    } catch (e) { /* URL 解析失败，保持原样 */ }

    const filename = 'cloudnav_backup.json';
    const fileUrl = storageBaseUrl + filename;

    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    let headers = {
      'Authorization': authHeader,
      'User-Agent': 'CloudNav/1.0',
    };
    let requestBody = undefined;

    if (operation === 'check') {
      // 测试连接用用户配置的根目录
      fetchUrl = baseUrl;
      method = 'PROPFIND';
      headers['Depth'] = '0';
    } else if (operation === 'upload') {
      // 确保存储目录存在（MKCOL 创建目录，已存在返回 405，忽略）
      try {
        await fetchWithTimeout(storageBaseUrl, {
          method: 'MKCOL',
          headers: { 'Authorization': authHeader, 'User-Agent': 'CloudNav/1.0' }
        }, 15000);
      } catch (e) {
        // 忽略 MKCOL 错误，继续尝试 PUT
      }

      // 自定义文件名（用于恢复前自动备份，固定文件名，不参与轮转）
      // 主备份使用带日期的文件名（cloudnav_backup_YYYYMMDD.json），同一天多次备份覆盖当天文件
      const customFilename = payload && payload._filename;
      const dateStr = getBeijingDateStr();
      const targetFilename = customFilename || `cloudnav_backup_${dateStr}.json`;
      const targetFileUrl = storageBaseUrl + targetFilename;
      const htmlTargetUrl = storageBaseUrl + `cloudnav_bookmarks_${dateStr}.html`;

      // 1. 上传 JSON 备份（上传大文件给足超时时间）
      let jsonPutRes;
      try {
        jsonPutRes = await fetchWithTimeout(targetFileUrl, {
          method: 'PUT',
          headers: { 'Authorization': authHeader, 'User-Agent': 'CloudNav/1.0', 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, 60000);
      } catch (e) {
        return jsonResponse({
          success: false,
          error: e.isTimeout ? '上传超时' : '上传失败',
          detail: cleanErrorDetail(null, e.message, hint),
          targetUrl: targetFileUrl,
          htmlUploaded: false,
          htmlError: ''
        }, 200, corsHeaders);
      }
      const jsonSuccess = jsonPutRes.ok || jsonPutRes.status === 207;

      // 2. 上传 HTML 书签文件（仅主备份，且提供了 bookmarkHtml 时才上传）
      let htmlSuccess = true;
      let htmlErr = '';
      if (!customFilename && payload && payload.bookmarkHtml) {
        try {
          const htmlRes = await fetchWithTimeout(htmlTargetUrl, {
            method: 'PUT',
            headers: {
              'Authorization': authHeader,
              'User-Agent': 'CloudNav/1.0',
              'Content-Type': 'text/html; charset=UTF-8'
            },
            body: payload.bookmarkHtml
          }, 60000);
          htmlSuccess = htmlRes.ok || htmlRes.status === 207;
          if (!htmlSuccess) htmlErr = `HTML ${htmlRes.status}`;
        } catch (e) {
          htmlSuccess = false;
          htmlErr = e.isTimeout ? 'HTML 上传超时' : String(e.message || e);
        }
      }

      if (!jsonSuccess) {
        const errText = await jsonPutRes.text().catch(() => '');
        return jsonResponse({
          success: false,
          status: jsonPutRes.status,
          error: `WebDAV returned ${jsonPutRes.status}`,
          detail: cleanErrorDetail(jsonPutRes.status, errText, hint),
          targetUrl: targetFileUrl,
          htmlUploaded: htmlSuccess,
          htmlError: htmlErr
        }, 200, corsHeaders);
      }

      // 3. 备份轮转：json/html 各按日期最多保留 5 份，超出删除最旧的（旧版固定文件名一并清理）
      if (!customFilename) {
        await rotateBackups(storageBaseUrl, authHeader, 5);
      }

      return jsonResponse({
        success: true,
        status: jsonPutRes.status,
        htmlUploaded: htmlSuccess,
        htmlError: htmlErr
      }, 200, corsHeaders);
    } else if (operation === 'download') {
      // 优先恢复最新的带日期备份（cloudnav_backup_YYYYMMDD.json），没有时回退旧版固定文件名
      fetchUrl = fileUrl;
      try {
        const names = await listWebDavFiles(storageBaseUrl, authHeader);
        if (names && names.length > 0) {
          const dated = names
            .filter(n => /^cloudnav_backup_\d{8}\.json$/.test(n))
            .sort((a, b) => (b.match(/(\d{8})/) || [])[1].localeCompare((a.match(/(\d{8})/) || [])[1]));
          if (dated.length > 0) {
            fetchUrl = storageBaseUrl + dated[0];
          }
        }
      } catch (e) { /* 列目录失败，回退旧版文件名 */ }
      method = 'GET';
    } else {
      return jsonResponse({ error: 'Invalid operation' }, 400, corsHeaders);
    }

    let response;
    try {
      response = await fetchWithTimeout(fetchUrl, { method, headers, body: requestBody }, 30000);
    } catch (e) {
      return jsonResponse({
        success: false,
        error: e.isTimeout ? '连接超时' : '连接失败',
        detail: cleanErrorDetail(null, e.message, hint),
        targetUrl: fetchUrl
      }, 200, corsHeaders);
    }

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders);
        }
        const errText = await response.text().catch(() => '');
        return jsonResponse({ error: `WebDAV Error: ${response.status}`, detail: cleanErrorDetail(response.status, errText, hint) }, response.status, corsHeaders);
      }
      const data = await response.json();
      return jsonResponse(data, 200, corsHeaders);
    }

    // check / upload
    const success = response.ok || response.status === 207;
    if (!success) {
      const errText = await response.text().catch(() => '');
      return jsonResponse({
        success: false,
        status: response.status,
        error: `WebDAV returned ${response.status}`,
        detail: cleanErrorDetail(response.status, errText, hint),
        targetUrl: operation === 'upload' ? fileUrl : baseUrl
      }, 200, corsHeaders);
    }
    return jsonResponse({ success: true, status: response.status }, 200, corsHeaders);

  } catch (err) {
    console.error('WebDAV API error:', err);
    return jsonResponse({ error: err.message }, 500, corsHeaders);
  }
}
