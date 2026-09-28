export function normalizeAiBaseUrl(rawUrl) {
  let str = String(rawUrl || '').trim();
  if (!str) {
    throw new Error('请输入有效的 HTTPS API 端点');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(str)) {
    str = 'https://' + str;
  }
  let url;
  try {
    url = new URL(str);
  } catch (_) {
    throw new Error('请输入有效的 HTTPS API 端点');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('API 端点必须是无账号、查询参数的 HTTPS 地址');
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * 安全网络请求工具：
 * 在 Android App 环境下，优先通过原生 AndroidWidgetBridge.executeHttpsRequest 发起请求，
 * 彻底穿透 WebView CORS 跨域限制，支持直连自建反代、OneAPI、第三方模型网关。
 * 在浏览器/Node 开发测试环境下，无缝回退至标准 fetch。
 */
export async function safeFetch(url, options = {}) {
  if (typeof window !== 'undefined' && window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.executeHttpsRequest === 'function') {
    try {
      const method = (options.method || 'GET').toUpperCase();
      const headers = options.headers || {};
      const body = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
      const rawRes = window.AndroidWidgetBridge.executeHttpsRequest(url, method, JSON.stringify(headers), body);
      if (rawRes) {
        const parsed = JSON.parse(rawRes);
        const status = Number(parsed.status) || 200;
        const textContent = String(parsed.body || '');
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: parsed.statusText || '',
          text: async () => textContent,
          json: async () => JSON.parse(textContent || '{}')
        };
      }
    } catch (e) {
      console.warn('[Bridge] 原生 HTTPS 请求异常，回退至 fetch:', e);
    }
  }
  return fetch(url, options);
}
