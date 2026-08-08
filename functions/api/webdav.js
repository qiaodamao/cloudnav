// WebDAV 代理接口
// 支持 EdgeOne Pages / Cloudflare Workers

import { getCorsHeaders, jsonResponse } from './_kvAdapter.js';

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

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  try {
    const body = await request.json();
    const { operation, config, payload } = body;

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
    const htmlFilename = 'cloudnav_bookmarks.html';
    const htmlFileUrl = storageBaseUrl + htmlFilename;

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

      // 支持自定义文件名（用于恢复前自动备份，不影响主备份文件）
      const customFilename = payload && payload._filename;
      const targetFilename = customFilename || filename;
      const targetFileUrl = storageBaseUrl + targetFilename;

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
          detail: e.message + (hint ? `\n建议：${hint}` : ''),
          targetUrl: targetFileUrl,
          htmlUploaded: false,
          htmlError: ''
        }, 200, corsHeaders);
      }
      const jsonSuccess = jsonPutRes.ok || jsonPutRes.status === 207;

      // 2. 上传 HTML 书签文件（仅主备份文件，且提供了 bookmarkHtml 时才上传）
      let htmlSuccess = true;
      let htmlErr = '';
      if (!customFilename && payload && payload.bookmarkHtml) {
        try {
          const htmlRes = await fetchWithTimeout(htmlFileUrl, {
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
          detail: errText.slice(0, 500) + (hint ? `\n建议：${hint}` : ''),
          targetUrl: targetFileUrl,
          htmlUploaded: htmlSuccess,
          htmlError: htmlErr
        }, 200, corsHeaders);
      }
      return jsonResponse({
        success: true,
        status: jsonPutRes.status,
        htmlUploaded: htmlSuccess,
        htmlError: htmlErr
      }, 200, corsHeaders);
    } else if (operation === 'download') {
      fetchUrl = fileUrl;
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
        detail: e.message + (hint ? `\n建议：${hint}` : ''),
        targetUrl: fetchUrl
      }, 200, corsHeaders);
    }

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders);
        }
        const errText = await response.text().catch(() => '');
        return jsonResponse({ error: `WebDAV Error: ${response.status}`, detail: errText.slice(0, 500) + (hint ? `\n建议：${hint}` : '') }, response.status, corsHeaders);
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
        detail: errText.slice(0, 500) + (hint ? `\n建议：${hint}` : ''),
        targetUrl: operation === 'upload' ? fileUrl : baseUrl
      }, 200, corsHeaders);
    }
    return jsonResponse({ success: true, status: response.status }, 200, corsHeaders);

  } catch (err) {
    console.error('WebDAV API error:', err);
    return jsonResponse({ error: err.message }, 500, corsHeaders);
  }
}
