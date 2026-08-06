// WebDAV 代理接口
// 支持 EdgeOne Pages / Cloudflare Workers

import { getCorsHeaders, jsonResponse } from './_kvAdapter.js';

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
        await fetch(storageBaseUrl, {
          method: 'MKCOL',
          headers: { 'Authorization': authHeader, 'User-Agent': 'CloudNav/1.0' }
        });
      } catch (e) {
        // 忽略 MKCOL 错误，继续尝试 PUT
      }

      // 1. 上传 JSON 备份
      const jsonPutRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: { 'Authorization': authHeader, 'User-Agent': 'CloudNav/1.0', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const jsonSuccess = jsonPutRes.ok || jsonPutRes.status === 207;

      // 2. 上传 HTML 书签文件（失败不影响主流程，仅记录结果）
      let htmlSuccess = true;
      let htmlErr = '';
      if (payload && payload.bookmarkHtml) {
        try {
          const htmlRes = await fetch(htmlFileUrl, {
            method: 'PUT',
            headers: {
              'Authorization': authHeader,
              'User-Agent': 'CloudNav/1.0',
              'Content-Type': 'text/html; charset=UTF-8'
            },
            body: payload.bookmarkHtml
          });
          htmlSuccess = htmlRes.ok || htmlRes.status === 207;
          if (!htmlSuccess) htmlErr = `HTML ${htmlRes.status}`;
        } catch (e) {
          htmlSuccess = false;
          htmlErr = String(e);
        }
      }

      if (!jsonSuccess) {
        const errText = await jsonPutRes.text().catch(() => '');
        return jsonResponse({
          success: false,
          status: jsonPutRes.status,
          error: `WebDAV returned ${jsonPutRes.status}`,
          detail: errText.slice(0, 500),
          targetUrl: fileUrl,
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

    const response = await fetch(fetchUrl, { method, headers, body: requestBody });

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders);
        }
        const errText = await response.text().catch(() => '');
        return jsonResponse({ error: `WebDAV Error: ${response.status}`, detail: errText.slice(0, 500) }, response.status, corsHeaders);
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
        detail: errText.slice(0, 500),
        targetUrl: operation === 'upload' ? fileUrl : baseUrl
      }, 200, corsHeaders);
    }
    return jsonResponse({ success: true, status: response.status }, 200, corsHeaders);

  } catch (err) {
    console.error('WebDAV API error:', err);
    return jsonResponse({ error: err.message }, 500, corsHeaders);
  }
}
