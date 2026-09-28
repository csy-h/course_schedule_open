
const KEY_SNAPSHOT = 'cs_week_snapshot';
const KEY_SETTINGS = 'cs_app_settings';
const KEY_LAST_SYNC = 'cs_last_sync_timestamp';
let sessionApiKey = '';
export const DEFAULT_SECTION_TIMES = [
  { section: 1, start: '08:00', end: '08:45' },
  { section: 2, start: '08:50', end: '09:35' },
  { section: 3, start: '09:55', end: '10:40' },
  { section: 4, start: '10:45', end: '11:30' },
  { section: 5, start: '13:30', end: '14:15' },
  { section: 6, start: '14:20', end: '15:05' },
  { section: 7, start: '15:25', end: '16:10' },
  { section: 8, start: '16:15', end: '17:00' },
  { section: 9, start: '18:30', end: '19:15' },
  { section: 10, start: '19:20', end: '20:05' }
];

const DEFAULT_SETTINGS = {
  selectedWeek: 1,
  viewMode: 'week', // 'week' | 'day'
  semesterStartDate: '2026-09-07',
  weekStartDay: 'monday', // 'monday' | 'sunday'
  customCurrentWeek: null, // null 为自动计算，数字为手动指定
  totalSections: 10, // 一天课程节数
  totalWeeks: 20, // 学期周数
  fixedDurationEnabled: true, // 固定上课时长联动开关
  sectionDurationMinutes: 45, // 每节课时长(分钟)
  sectionTimes: DEFAULT_SECTION_TIMES // 作息表
};
const KEY_SEC_API_KEY = 'cs_sec_k';

function getSecureKeyBridge() {
  const bridge = typeof window !== 'undefined' ? window.AndroidWidgetBridge : null;
  return bridge && typeof bridge.loadApiKey === 'function' && typeof bridge.storeApiKey === 'function'
    ? bridge : null;
}

export const localStore = {
  getWeekSnapshot(week = null) {
    try {
const raw = localStorage.getItem(KEY_SNAPSHOT);
if (!raw) return null;
const parsed = JSON.parse(raw);
if (week !== null && parsed.week !== Number(week)) {
return null;
}
return parsed;
    } catch (e) {
console.warn('[LocalStore] 读取快照失败:', e);
return null;
    }
  },
  saveWeekSnapshot(week, courses) {
    try {
      const snapshot = {
        week: Number(week) || 1,
        courses: Array.isArray(courses) ? courses : [],
        timestamp: Date.now()
      };
      localStorage.setItem(KEY_SNAPSHOT, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[LocalStore] 保存快照失败:', e);
    }
  },
  removeWeekSnapshot(week = null) {
    try {
      if (week === null) {
        localStorage.removeItem(KEY_SNAPSHOT);
      } else {
        const raw = localStorage.getItem(KEY_SNAPSHOT);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.week === Number(week)) {
            localStorage.removeItem(KEY_SNAPSHOT);
          }
        }
      }
    } catch (e) {}
  },
  clearWeekSnapshots() {
    try {
      localStorage.removeItem(KEY_SNAPSHOT);
    } catch (e) {}
  },
getSettings() {
    try {
const raw = localStorage.getItem(KEY_SETTINGS);
if (!raw) return { ...DEFAULT_SETTINGS };
const stored = JSON.parse(raw);
if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_SETTINGS };
// 升级时删除旧版本明文保存的密钥与废弃后端凭据，不自动恢复到当前会话。
if ('deepseekApiKey' in stored || 'password' in stored || 'serverUrl' in stored) {
  delete stored.deepseekApiKey;
  delete stored.password;
  delete stored.serverUrl;
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(stored));
}
return { ...DEFAULT_SETTINGS, ...stored };
    } catch (e) {
return { ...DEFAULT_SETTINGS };
    }
  },
saveSettings(partialSettings) {
    try {
const current = this.getSettings();
const updated = { ...current, ...partialSettings };
delete updated.deepseekApiKey;
delete updated.password;
delete updated.serverUrl;
localStorage.setItem(KEY_SETTINGS, JSON.stringify(updated));
return updated;
    } catch (e) {
console.warn('[LocalStore] 保存设置失败:', e);
return this.getSettings();
    }
  },
getApiKey() {
    if (sessionApiKey) return sessionApiKey;
    const bridge = getSecureKeyBridge();
    try {
      if (bridge) {
        sessionApiKey = bridge.loadApiKey() || '';
      }
    } catch (e) {}
    // 旧版曾把可逆 Base64 写入 LocalStorage。只读取一次以迁移，随后立即清除。
    try {
      const legacy = localStorage.getItem(KEY_SEC_API_KEY);
      if (legacy) {
        localStorage.removeItem(KEY_SEC_API_KEY);
        if (!sessionApiKey) {
          const decoded = typeof atob === 'function' ? atob(legacy)
            : (typeof Buffer !== 'undefined' ? Buffer.from(legacy, 'base64').toString('utf-8') : '');
          sessionApiKey = decoded;
          if (bridge && decoded) bridge.storeApiKey(decoded);
        }
      }
    } catch (e) {
      try { localStorage.removeItem(KEY_SEC_API_KEY); } catch (_) {}
    }
    return sessionApiKey;
  },
setApiKey(apiKey) {
    sessionApiKey = String(apiKey || '').trim();
    try { localStorage.removeItem(KEY_SEC_API_KEY); } catch (e) {}
    const bridge = getSecureKeyBridge();
    if (!bridge) return false; // 浏览器预览和 Android 6 以下仅在当前会话使用
    try { return Boolean(bridge.storeApiKey(sessionApiKey)); } catch (e) { return false; }
  },
getLastSync() {
    try {
const v = localStorage.getItem(KEY_LAST_SYNC);
return v ? Number(v) : null;
    } catch (e) {
return null;
    }
  },
setLastSync(timestamp = Date.now()) {
    try {
localStorage.setItem(KEY_LAST_SYNC, String(timestamp));
    } catch (e) {}
  },
  getItem(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return raw;
      }
    } catch (err) {
      return defaultValue;
    }
  },
  setItem(key, value) {
    try {
      if (typeof value === 'object' && value !== null) {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, String(value));
      }
    } catch (err) {
      console.warn('[LocalStore] setItem error:', key, err);
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {}
  },
clearAll() {
    try {
localStorage.removeItem(KEY_SNAPSHOT);
localStorage.removeItem(KEY_LAST_SYNC);
    } catch (e) {}
  }
};
