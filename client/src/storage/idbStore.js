import { localStore } from './localStore.js';

const DB_NAME = 'CourseScheduleDB';
const DB_VERSION = 2;
const STORE_COURSES = 'courses';
const STORE_INITIAL_COURSES = 'initial_courses';
const STORE_ADJUSTMENTS = 'adjustments';
const STORE_SYNC_QUEUE = 'sync_queue';

let dbPromise = null;

export function normalizeToMonday(dateStr) {
  if (!dateStr) return '2026-09-07';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    dt.setDate(dt.getDate() + diffToMonday);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, '0');
    const nd = String(dt.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  } catch (e) {
    return dateStr;
  }
}

export function calcWeekFromDate(dateStr, baseMondayStr = '2026-09-07') {
  if (!dateStr) return null;
  try {
    const mondayStr = normalizeToMonday(baseMondayStr);
    const [by, bm, bd] = mondayStr.split('-').map(Number);
    const [ty, tm, td] = dateStr.split('-').map(Number);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    const targetUtc = Date.UTC(ty, tm - 1, td);
    const diffDays = Math.round((targetUtc - baseUtc) / 86400000);
    return Math.floor(diffDays / 7) + 1;
  } catch (e) {
    return null;
  }
}

function resolveEffectiveWeek(adj, type = 'target', baseStart = '2026-09-07') {
  const dateStr = (type === 'target') ? (adj.target_date || adj.targetDate) : (adj.original_date || adj.originalDate);
  if (dateStr) {
    const w = calcWeekFromDate(dateStr, baseStart);
    if (w !== null) return w;
  }
  const staticW = (type === 'target')
    ? (adj.target_week ?? adj.targetWeek ?? adj.week)
    : (adj.original_week ?? adj.originalWeek ?? adj.week);
  if (staticW !== null && staticW !== undefined) return Number(staticW);
  const dateMatch = String(adj.reason || '').match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? calcWeekFromDate(dateMatch[1], baseStart) : null;
}

export function adjustmentMatchesBaseCard(adj, item) {
  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  const originalDay = Number(adj.original_day ?? adj.originalDay);
  const originalStart = Number(adj.original_start_section ?? adj.originalStartSection);
  const originalEnd = Number(adj.original_end_section ?? adj.originalEndSection ?? originalStart);
  if (originalDay && originalDay !== Number(item.dayOfWeek)) return false;
  const courseId = adj.initial_course_id ?? adj.initialCourseId ?? adj.originalCourseId;
  const courseName = adj.course_name || adj.courseName || adj.name;
  if (courseId != null && courseId !== '') {
    if (String(item.courseId) !== String(courseId)) return false;
  } else if (!courseName || norm(item.name) !== norm(courseName)) {
    return false;
  }
  return !originalStart || !(item.endSection < originalStart || item.startSection > originalEnd);
}

export function applyDayOverride(cards, sourceCards, adj, targetWeek) {
  const targetMs = /^\d{4}-\d{2}-\d{2}$/.test(adj.target_date || '') ? Date.parse(`${adj.target_date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(targetMs) || new Date(targetMs).toISOString().slice(0, 10) !== adj.target_date) return cards;
  const targetDay = new Date(targetMs).getUTCDay() || 7;
  const sourceDay = Number(adj.source_day);
  if (!Number.isInteger(targetDay) || !Number.isInteger(sourceDay) || sourceDay < 1 || sourceDay > 7) return cards;
  const retained = adj.replace_target === true ? cards.filter(c => Number(c.dayOfWeek) !== targetDay) : [...cards];
  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  for (const source of sourceCards) {
    if (Number(source.dayOfWeek) !== sourceDay || source.isCancelled || source.isReduced) continue;
    retained.push({
      ...source,
      id: `day_${adj.id}_${source.id}`,
      scheduleId: `day_${adj.id}_${source.scheduleId || source.id}`,
      dayOfWeek: targetDay,
      startWeek: targetWeek,
      endWeek: targetWeek,
      weekType: 'all',
      weeks: [targetWeek],
      isAdjusted: true,
      isAdded: true,
      isCancelled: false,
      isReduced: false,
      status: 'active',
      adjustId: adj.id,
      adjustType: 'day_override',
      adjustReason: adj.reason,
      originalDay: sourceDay,
      originalWeek: Number(adj.source_week),
      pointerSourceText: `${adj.source_date || ''} 周${dayNames[sourceDay - 1]}`.trim(),
      source: 'adjusted',
      badge: '↪ 补课'
    });
  }
  return retained;
}

export function flagScheduleConflicts(cards) {
  const result = cards.map(card => ({ ...card, hasConflict: false, conflictingCourses: [] }));
  for (let i = 0; i < result.length; i++) {
    const a = result[i];
    if (a.isCancelled || a.isReduced) continue;
    const aStart = Number(a.startSection);
    const aEnd = Number(a.endSection);
    if (!Number.isInteger(aStart) || !Number.isInteger(aEnd) || aStart < 1 || aEnd < aStart) continue;
    for (let j = i + 1; j < result.length; j++) {
      const b = result[j];
      if (b.isCancelled || b.isReduced || Number(a.dayOfWeek) !== Number(b.dayOfWeek)) continue;
      const bStart = Number(b.startSection);
      const bEnd = Number(b.endSection);
      if (!Number.isInteger(bStart) || !Number.isInteger(bEnd) || bStart < 1 || bEnd < bStart) continue;
      if (aStart > bEnd || bStart > aEnd) continue;
      if (a.courseId != null && b.courseId != null && String(a.courseId) === String(b.courseId) && a.name === b.name) continue;
      if (a.id === b.id) continue;
      a.hasConflict = b.hasConflict = true;
      a.conflictingCourses.push({ id: b.id, name: b.name, startSection: b.startSection, endSection: b.endSection, location: b.location || '', teacher: b.teacher || '' });
      b.conflictingCourses.push({ id: a.id, name: a.name, startSection: a.startSection, endSection: a.endSection, location: a.location || '', teacher: a.teacher || '' });
    }
  }
  return result;
}


export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('当前环境不支持 IndexedDB'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // 1. 兼容旧版 courses 表
      if (!db.objectStoreNames.contains(STORE_COURSES)) {
        const courseStore = db.createObjectStore(STORE_COURSES, { keyPath: 'id' });
        courseStore.createIndex('name', 'name', { unique: false });
      }
      // 2. 离线同步队列表
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
        queueStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      // 3. 双轨基石：官方基础底座表 initial_courses
      if (!db.objectStoreNames.contains(STORE_INITIAL_COURSES)) {
        const initStore = db.createObjectStore(STORE_INITIAL_COURSES, { keyPath: 'id' });
        initStore.createIndex('name', 'name', { unique: false });
      }
      // 4. 双轨差量：调课记录表 adjustments
      if (!db.objectStoreNames.contains(STORE_ADJUSTMENTS)) {
        const adjStore = db.createObjectStore(STORE_ADJUSTMENTS, { keyPath: 'id', autoIncrement: true });
        adjStore.createIndex('status', 'status', { unique: false });
        adjStore.createIndex('target_week', 'target_week', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error('[IDBStore] 打开数据库失败:', event.target.error);
      reject(event.target.error);
    };
  });
  return dbPromise;
}

export const idbStore = {
  async init() {
    return openDB();
  },

  // ==================== 1. 官方初始课表基座 (Initial Courses) ====================
  async saveInitialCourses(courses, overwrite = false) {
    if (!Array.isArray(courses)) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_INITIAL_COURSES, STORE_COURSES], 'readwrite');
      const initStore = tx.objectStore(STORE_INITIAL_COURSES);
      const courseStore = tx.objectStore(STORE_COURSES);

      if (overwrite) {
        initStore.clear();
        courseStore.clear();
      }

      courses.forEach((c, idx) => {
        const item = { ...c };
        if (item.id === undefined || item.id === null) {
          item.id = Date.now() + idx + Math.floor(Math.random() * 1000);
        }
        initStore.put(item);
        courseStore.put(item); // 保持向后兼容
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getInitialCourses() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INITIAL_COURSES, 'readonly');
      const store = tx.objectStore(STORE_INITIAL_COURSES);
      const req = store.getAll();
      req.onsuccess = () => {
        const res = req.result || [];
        if (res.length > 0) {
          resolve(res);
        } else {
          // 若 initial_courses 暂无数据，尝试回退从旧的 courses 读取
          this.getAllCourses().then(resolve).catch(() => resolve([]));
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getCourses() {
    return this.getInitialCourses();
  },

  // ==================== 2. 调课记录图层 (Adjustments) ====================
  async saveAdjustment(adjustment) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ADJUSTMENTS, 'readwrite');
      const store = tx.objectStore(STORE_ADJUSTMENTS);
      const item = {
        ...adjustment,
        status: adjustment.status || 'active',
        created_at: adjustment.created_at || new Date().toISOString()
      };
      if (item.id === undefined || item.id === null) {
        delete item.id; // 让 autoIncrement 生成
      }
      const req = store.put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAdjustments(status = 'active') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ADJUSTMENTS, 'readonly');
      const store = tx.objectStore(STORE_ADJUSTMENTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        if (!status) return resolve(all);
        resolve(all.filter(a => a.status === status));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async clearAdjustments() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ADJUSTMENTS, 'readwrite');
      const store = tx.objectStore(STORE_ADJUSTMENTS);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async revertAdjustment(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ADJUSTMENTS, 'readwrite');
      const store = tx.objectStore(STORE_ADJUSTMENTS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.status = 'reverted';
          store.put(item);
          tx.oncomplete = () => resolve(true);
        } else {
          resolve(false);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async deleteAdjustment(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ADJUSTMENTS, 'readwrite');
      const store = tx.objectStore(STORE_ADJUSTMENTS);
      store.delete(id);
      if (!isNaN(Number(id))) {
        try { store.delete(Number(id)); } catch (_) {}
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ==================== 3. 核心：纯本地双轨合并视图引擎 ====================
  /**
   * 纯本地秒级合并指定周课表
   * 基座(Initial Courses) + 差量(Adjustments) = 最终呈现视图(Merged View)
   * 保证基础课表永不被抹除，调课精准定位叠放！
   */
  async getMergedScheduleByWeek(week, semesterStart = null, officialOnly = false) {
    const targetWeek = Number(week) || 1;
    let baseStart = semesterStart;
    if (!baseStart) {
      try {
        const s = localStore.getSettings();
        baseStart = s ? s.semesterStartDate : null;
      } catch (e) {}
    }
    if (!baseStart) baseStart = '2026-09-07';

    const initialCourses = await this.getInitialCourses();

    // 1. 筛选出该周本应上的基础课卡片
    const baseCards = [];
    initialCourses.forEach((c) => {
      const schedules = Array.isArray(c.schedules) && c.schedules.length > 0
        ? c.schedules
        : [{
            id: `sch_${c.id}`,
            dayOfWeek: c.dayOfWeek || 1,
            startSection: c.startPeriod || c.startSection || 1,
            endSection: c.endPeriod || c.endSection || (c.startPeriod || 1) + 1,
            stepCount: c.periodSpan || c.stepCount || 2,
            startTime: c.startTime || '08:00',
            endTime: c.endTime || '09:50',
            location: c.location || '',
            teacher: c.teacher || '',
            startWeek: c.startWeek || 1,
            endWeek: c.endWeek || 16,
            weekType: c.weekType || 'all',
            weeks: c.weeks || []
          }];

      schedules.forEach((s) => {
        let isHit = false;
        if (Array.isArray(s.weeks) && s.weeks.length > 0) {
          isHit = s.weeks.includes(targetWeek);
        } else {
          const sW = s.startWeek || 1;
          const eW = s.endWeek || 20;
          if (targetWeek >= sW && targetWeek <= eW) {
            const wt = s.weekType || 'all';
            if (wt === 'all') isHit = true;
            else if (wt === 'odd' && targetWeek % 2 !== 0) isHit = true;
            else if (wt === 'even' && targetWeek % 2 === 0) isHit = true;
          }
        }

        if (isHit) {
          const sStart = s.startPeriod || s.startSection || 1;
          const sEnd = s.endPeriod || s.endSection || (sStart + 1);
          const sSpan = s.periodSpan || s.stepCount || (sEnd - sStart + 1);
          baseCards.push({
            id: s.id || `sch_${c.id}_${s.dayOfWeek}_${sStart}`,
            scheduleId: s.id,
            courseId: c.id,
            name: c.name,
            code: c.code || '',
            teacher: s.teacher || c.teacher || '',
            location: s.location || c.location || '',
            color: c.color || '#7A9E9F',
            dayOfWeek: s.dayOfWeek,
            startSection: sStart,
            endSection: sEnd,
            stepCount: sSpan,
            startPeriod: sStart,
            endPeriod: sEnd,
            periodSpan: sSpan,
            startTime: s.startTime || '08:00',
            endTime: s.endTime || '09:50',
            startWeek: s.startWeek || 1,
            endWeek: s.endWeek || 20,
            weekType: s.weekType || 'all',
            weeks: s.weeks || [],
            isAdjusted: false,
            source: 'initial',
            badge: '🏫 官方'
          });
        }
      });
    });

    // 补课引用的是该日原本应上的课程，即使来源日后来被标为节假日停课。
    if (officialOnly) return baseCards;
    const adjustments = await this.getAdjustments('active');

    // 2. 筛选本周相关的停课/调离记录 (支持绝对公历日期动态推算)
    const activeRemovals = adjustments.filter(adj => {
      const actType = (adj.action_type || adj.actionType || adj.adjustType || '').toLowerCase();
      if (actType !== 'moved' && actType !== 'cancelled' && actType !== 'cancel' && actType !== 'reschedule') return false;
      const origW = resolveEffectiveWeek(adj, 'original', baseStart);
      return (origW === null || origW === undefined || Number(origW) === targetWeek);
    });

    // 3. 处理基础课程：未变动的正常保留，剪掉/停课/调离的课程标记为虚化淡化虚框
    const merged = [];
    for (const item of baseCards) {
      const matchedAdj = activeRemovals.find(adj => adjustmentMatchesBaseCard(adj, item));

      if (matchedAdj) {
        const rawAct = (matchedAdj.action_type || matchedAdj.actionType || matchedAdj.adjustType || 'cancelled').toLowerCase();
        const actType = (rawAct === 'reschedule' || rawAct === 'moved') ? 'moved' : 'cancelled';
        merged.push({
          ...item,
          isAdjusted: true,
          isReduced: true,
          isCancelled: true,
          status: 'cancelled',
          adjustId: matchedAdj.id,
          adjustType: actType,
          adjustReason: matchedAdj.reason || (actType === 'moved' ? '已调往其他时段' : '放假停课'),
          badge: actType === 'moved' ? '🚫 调离' : '🚫 停课'
        });
      } else {
        merged.push(item);
      }
    }

    // 4. 叠加调入或新增的调课卡片 (指针式指向原课程，支持绝对日期动态对齐)
    for (const adj of adjustments) {
      const tgtW = resolveEffectiveWeek(adj, 'target', baseStart);
      const rawAct = (adj.action_type || adj.actionType || adj.adjustType || '').toLowerCase();
      const isAddition = rawAct === 'moved' || rawAct === 'added' || rawAct === 'reschedule' || rawAct === 'add';
      if (isAddition) {
        if (tgtW === null || tgtW === undefined || Number(tgtW) === targetWeek) {
          const sStart = Number(adj.target_start_section || adj.targetStartSection || adj.newStartSection || 1);
          const sEnd = Number(adj.target_end_section || adj.targetEndSection || adj.newEndSection || (sStart + 1));
          const sSpan = sEnd - sStart + 1;
          const tgtDay = Number(adj.target_day || adj.targetDay || adj.newDayOfWeek || 1);
          const cName = adj.course_name || adj.courseName || adj.name;
          const origDay = adj.original_day || adj.originalDay;
          const origStart = adj.original_start_section || adj.originalStartSection;
          const origWeek = adj.original_week || adj.originalWeek || adj.week;

          let pointerSourceText = '';
          if (origDay) {
            const dayNames = ['一','二','三','四','五','六','日'];
            pointerSourceText = `原周${dayNames[Number(origDay) - 1] || origDay}`;
          }

          merged.push({
            id: `adj_${adj.id || Math.random()}`,
            scheduleId: `adj_${adj.id || Math.random()}`,
            courseId: adj.initial_course_id || adj.initialCourseId || adj.originalCourseId || 0,
            name: cName,
            code: '',
            teacher: adj.newTeacher || adj.teacher || '',
            location: adj.newLocation || adj.target_location || adj.targetLocation || adj.location || '待定教室',
            color: adj.color || '#E07A5F',
            dayOfWeek: tgtDay,
            startSection: sStart,
            endSection: sEnd,
            stepCount: sSpan,
            startPeriod: sStart,
            endPeriod: sEnd,
            periodSpan: sSpan,
            startTime: adj.target_start_time || adj.targetStartTime || adj.newStartTime || '08:00',
            endTime: adj.target_end_time || adj.targetEndTime || adj.newEndTime || '09:50',
            startWeek: targetWeek,
            endWeek: targetWeek,
            weekType: 'all',
            weeks: [targetWeek],
            isAdjusted: true,
            isAdded: true,
            adjustId: adj.id,
            adjustType: rawAct === 'added' || rawAct === 'add' ? 'added' : 'moved',
            adjustReason: adj.reason,
            originalDay: origDay,
            originalStartSection: origStart,
            originalWeek: origWeek,
            pointerSourceText: pointerSourceText,
            source: 'adjusted',
            badge: (rawAct === 'moved' || rawAct === 'reschedule') ? '⚡ 调入' : '⚡ 补课'
          });
        }
      }
    }

    // 日期指向只保存关系；从原周官方排课取卡片，避免假期停课记录吞掉补课来源。
    let finalCards = merged;
    const overrides = adjustments.filter(adj => (adj.action_type || adj.adjustType) === 'day_override' &&
      adj.target_date && calcWeekFromDate(adj.target_date, baseStart) === targetWeek);
    const sourceWeekCache = new Map([[targetWeek, baseCards]]);
    for (const adj of overrides) {
      const sourceWeek = Number(adj.source_week);
      if (!Number.isInteger(sourceWeek) || sourceWeek < 1) continue;
      if (!sourceWeekCache.has(sourceWeek)) {
        sourceWeekCache.set(sourceWeek, await this.getMergedScheduleByWeek(sourceWeek, baseStart, true));
      }
      finalCards = applyDayOverride(finalCards, sourceWeekCache.get(sourceWeek), adj, targetWeek);
    }

    // 依星期几和开始节次升序排序，再在最终可见课程上计算冲突。
    finalCards.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startSection - b.startSection;
    });

    return flagScheduleConflicts(finalCards);
  },

  async getCoursesByWeek(week, semesterStart = null) {
    return this.getMergedScheduleByWeek(week, semesterStart);
  },

  async getCoursesByDate(dateStr, baseMondayStr = '2026-09-07') {
    let targetDate;
    if (!dateStr) {
      targetDate = new Date();
    } else {
      targetDate = new Date(dateStr + 'T00:00:00');
    }
    const dayOfWeek = targetDate.getDay() === 0 ? 7 : targetDate.getDay();
    const [by, bm, bd] = baseMondayStr.split('-').map(Number);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    const targetUtc = Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const diffDays = Math.round((targetUtc - baseUtc) / 86400000);
    const weekNumber = Math.max(1, Math.floor(diffDays / 7) + 1);

    const weekCards = await this.getMergedScheduleByWeek(weekNumber, baseMondayStr);
    const dayItems = weekCards.filter(item => item.dayOfWeek === dayOfWeek);
    return {
      date: dateStr || targetDate.toISOString().slice(0, 10),
      week: weekNumber,
      dayOfWeek,
      items: dayItems
    };
  },

  async getMergedScheduleByDate(dateStr, baseMondayStr = '2026-09-07') {
    const result = await this.getCoursesByDate(dateStr, baseMondayStr);
    return result.items;
  },

  // ==================== 4. 兼容老接口与离线队列 ====================
  async getAllCourses() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_COURSES, 'readonly');
      const store = tx.objectStore(STORE_COURSES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async saveCourses(courses, overwrite = false) {
    return this.saveInitialCourses(courses, overwrite);
  },

  async saveCourse(course) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_INITIAL_COURSES, STORE_COURSES], 'readwrite');
      const store = tx.objectStore(STORE_COURSES);
      const initStore = tx.objectStore(STORE_INITIAL_COURSES);
      const item = { ...course };
      if (!item.id) item.id = Date.now();
      store.put(item);
      initStore.put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteCourse(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_INITIAL_COURSES, STORE_COURSES], 'readwrite');
      tx.objectStore(STORE_COURSES).delete(id);
      tx.objectStore(STORE_INITIAL_COURSES).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearAllCourses() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_INITIAL_COURSES, STORE_COURSES, STORE_ADJUSTMENTS], 'readwrite');
      tx.objectStore(STORE_COURSES).clear();
      tx.objectStore(STORE_INITIAL_COURSES).clear();
      tx.objectStore(STORE_ADJUSTMENTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async enqueueSync(action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_QUEUE);
      const item = { ...action, timestamp: Date.now() };
      const req = store.add(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getSyncQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_SYNC_QUEUE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async removeSyncItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      tx.objectStore(STORE_SYNC_QUEUE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearSyncQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      tx.objectStore(STORE_SYNC_QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ==================== 5. 错位数据静默自动平移自愈机制 ====================
  /**
   * 自动平移自愈 (Shift Healing)
   * 彻底解决历史版本 ICS 解析将周一、周二课程右移 1 周 (变为 2~17 周、2~13 周) 的问题
   */
  async selfHealShiftedCourses() {
    try {
      const courses = await this.getInitialCourses();
      if (!Array.isArray(courses) || courses.length === 0) return false;

      let hasAnomaly = false;
      const healedCourses = courses.map(c => {
        let courseChanged = false;
        const schedules = (Array.isArray(c.schedules) && c.schedules.length > 0) ? c.schedules : [];

        const healedSchedules = schedules.map(s => {
          const sw = Number(s.startWeek);
          const ew = Number(s.endWeek);
          const weeks = Array.isArray(s.weeks) ? s.weeks : [];
          
          // 判定特征：startWeek 为 2，且 (endWeek === 17 或 13 或 9)，或包含第 17 周且不包含第 1 周
          const isShifted = (sw === 2 && (ew === 17 || ew === 13 || ew === 9)) ||
                            (weeks.includes(17) && !weeks.includes(1));

          if (isShifted) {
            hasAnomaly = true;
            courseChanged = true;
            const newSw = Math.max(1, sw - 1);
            const newEw = Math.max(newSw, ew - 1);
            const newWeeks = weeks.map(w => Math.max(1, w - 1));
            return {
              ...s,
              startWeek: newSw,
              endWeek: newEw,
              weeks: newWeeks
            };
          }
          return s;
        });

        if (courseChanged) {
          const sw = Number(c.startWeek);
          const ew = Number(c.endWeek);
          const weeks = Array.isArray(c.weeks) ? c.weeks : [];
          const newSw = (sw === 2) ? 1 : sw;
          const newEw = (ew === 17) ? 16 : ew;
          const newWeeks = weeks.includes(17) ? weeks.map(w => Math.max(1, w - 1)) : weeks;
          return {
            ...c,
            startWeek: newSw,
            endWeek: newEw,
            weeks: newWeeks,
            schedules: healedSchedules
          };
        }
        return c;
      });

      if (hasAnomaly) {
        console.info('[DataSelfHealing] 检测到历史版本周次错位数据，已执行自动平移自愈！');
        await this.saveInitialCourses(healedCourses, true);
        localStore.clearWeekSnapshots();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[DataSelfHealing] 自愈检测异常:', e);
      return false;
    }
  }
};
