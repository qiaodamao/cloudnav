
import { Category, LinkItem, WebDavConfig, SearchConfig, AIConfig } from "../types";

// Helper to call our Cloudflare Proxy
// This solves the CORS issue by delegating the request to the backend
const callWebDavProxy = async (operation: 'check' | 'upload' | 'download', config: WebDavConfig, payload?: any) => {
    try {
        const response = await fetch('/api/webdav', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

export const checkWebDavConnection = async (config: WebDavConfig): Promise<boolean> => {
    if (!config.url || !config.username || !config.password) return false;
    const result = await callWebDavProxy('check', config);
    return result?.success === true;
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
