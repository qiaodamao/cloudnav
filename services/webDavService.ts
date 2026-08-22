
import { Category, LinkItem, WebDavConfig, SearchConfig, AIConfig } from "../types";

// Helper to call our Cloudflare Proxy
// This solves the CORS issue by delegating the request to the backend
const callWebDavProxy = async (operation: 'check' | 'upload' | 'download', config: WebDavConfig, payload?: any) => {
    try {
        // WebDAV 代理需登录鉴权（防 SSRF/开放代理），携带管理员 token
        const token = localStorage.getItem('cloudnav_auth_token') || localStorage.getItem('authToken') || '';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['x-auth-password'] = token;
        const response = await fetch('/api/webdav', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                operation,
                config,
                payload
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(`WebDAV Proxy Error: ${response.status}`, errText);
            return { success: false, status: response.status, error: `Proxy ${response.status}`, detail: errText.slice(0, 500) };
        }

        return await response.json();
    } catch (e: any) {
        console.error("WebDAV Proxy Network Error", e);
        return { success: false, error: `Network: ${e?.message || String(e)}` };
    }
}

export const checkWebDavConnection = async (config: WebDavConfig): Promise<{ success: boolean; error?: string; detail?: string }> => {
    if (!config.url || !config.username || !config.password) {
        return { success: false, error: '配置不完整', detail: '请填写服务器地址、用户名和应用密码' };
    }
    const result = await callWebDavProxy('check', config);
    if (result?.success === true) return { success: true };
    return {
        success: false,
        error: result?.error || '连接失败',
        detail: result?.detail || ''
    };
};

export const uploadBackup = async (
    config: WebDavConfig,
    data: { links: LinkItem[], categories: Category[], searchConfig?: SearchConfig, aiConfig?: AIConfig, uploadedIcons?: any[], bookmarkHtml?: string },
    options?: { filename?: string }
): Promise<{ success: boolean; error?: string; detail?: string; targetUrl?: string; htmlUploaded?: boolean; htmlError?: string }> => {
    const payload = options?.filename ? { ...data, _filename: options.filename } : data;
    const result: any = await callWebDavProxy('upload', config, payload);
    if (result?.success === true) return { success: true, htmlUploaded: result?.htmlUploaded, htmlError: result?.htmlError };
    return {
        success: false,
        error: result?.error || 'Unknown error',
        detail: result?.detail || '',
        targetUrl: result?.targetUrl || '',
        htmlUploaded: result?.htmlUploaded,
        htmlError: result?.htmlError
    };
};

export const downloadBackup = async (config: WebDavConfig): Promise<{ links: LinkItem[], categories: Category[], searchConfig?: SearchConfig, aiConfig?: AIConfig } | null> => {
    const result = await callWebDavProxy('download', config);

    // Check if the result looks like valid backup data
    if (result && Array.isArray(result.links) && Array.isArray(result.categories)) {
        return result as { links: LinkItem[], categories: Category[], searchConfig?: SearchConfig, aiConfig?: AIConfig };
    }
    return null;
};

/**
 * 打包本地图标为 base64（用于备份上传）
 * 从 links 中收集所有 /api/favicon?key= 形式的图标 URL，逐个拉取并转为 base64
 */
export const fetchIconsAsBase64 = async (
    linksList: LinkItem[],
    onProgress?: (current: number, total: number) => void
): Promise<Array<{ key: string, platform: 'edgeone' | 'cloudflare', data: string }>> => {
    const uploadedIcons: Array<{ key: string, platform: 'edgeone' | 'cloudflare', data: string }> = [];

    const iconUrls = new Set<string>();
    linksList.forEach(l => {
        if (l.edgeoneBlobUrl && l.edgeoneBlobUrl.startsWith('/api/favicon?key=')) {
            iconUrls.add(l.edgeoneBlobUrl);
        }
        if (l.cloudflareR2Url && l.cloudflareR2Url.startsWith('/api/favicon?key=')) {
            iconUrls.add(l.cloudflareR2Url);
        }
        if (l.icon && l.icon.startsWith('/api/favicon?key=')) {
            iconUrls.add(l.icon);
        }
    });

    const total = iconUrls.size;
    let current = 0;

    for (const iconUrl of iconUrls) {
        current++;
        if (onProgress) onProgress(current, total);

        try {
            const urlObj = new URL(iconUrl, window.location.origin);
            const key = urlObj.searchParams.get('key');
            if (!key) continue;

            const res = await fetch(iconUrl);
            if (!res.ok) continue;

            const blob = await res.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            let platform: 'edgeone' | 'cloudflare' = 'edgeone';
            const matchingLink = linksList.find(l => l.cloudflareR2Url === iconUrl || (l.icon === iconUrl && l.iconType === 'upload-cloudflare'));
            if (matchingLink) {
                platform = 'cloudflare';
            }

            uploadedIcons.push({ key, platform, data: base64 });
        } catch (e) {
            console.error(`Failed to export icon: ${iconUrl}`, e);
        }
    }

    return uploadedIcons;
};
