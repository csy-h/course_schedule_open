const assert = require('assert');

async function run() {
  const { escapeHtml } = await import('../client/src/utils/sanitize.js');
  const { normalizeAiBaseUrl } = await import('../client/src/utils/aiEndpoint.js');
  const payload = '"><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(payload);
  assert(!escaped.includes('<img'));
  assert(!escaped.includes('"'));
  assert.strictEqual(normalizeAiBaseUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/?token=1']) {
    assert.throws(() => normalizeAiBaseUrl(url));
  }
  console.log('安全测试通过：HTML 转义和 HTTPS 端点校验。');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
