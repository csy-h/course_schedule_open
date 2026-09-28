import { normalizeAiBaseUrl, safeFetch } from './aiEndpoint.js';
import { DEFAULT_SECTION_TIMES } from '../storage/localStore.js';
import { calcWeekFromDate, normalizeToMonday } from '../storage/idbStore.js';

/**
 * 纯前端本地智能调课引擎 (Local AI Adjuster)
 * 
 * 核心特性：
 * 1. 保留本地规则解析函数，供独立调用和测试；应用界面中的 AI 调课需用户配置远程端点；
 * 2. 多元格式支持：支持 9.25到10.7、9/25-10/7、9月25日至10月7日 等复杂日期跨度放假；
 * 3. 自选大模型接入：支持直连用户填写的 HTTPS 模型 API 端点；
 * 4. 纯本地双轨存储：调课仅作用于本地 adjusted_courses 独立图层，随时可一键撤销恢复。
 */

// 中文数字转阿拉伯数字
function parseCnNum(str) {
  if (!str) return 0;
  const map = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (map[str]) return map[str];
  const num = parseInt(str, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * 根据开学日期与周次，计算某周某天的公历日期 (YYYY-MM-DD)
 */
function getDateOfWeekDay(semesterStartDate, week, dayOfWeek) {
  const start = new Date(semesterStartDate);
  const diffDays = (week - 1) * 7 + (dayOfWeek - 1);
  const target = new Date(start.getTime() + diffDays * 24 * 60 * 60 * 1000);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 计算两个 YYYY-MM-DD 日期之间的所有天数列表
 */
function getDatesInRange(startStr, endStr) {
  const dates = [];
  let curr = new Date(startStr);
  const end = new Date(endStr);
  while (curr <= end) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    curr = new Date(curr.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function runsInWeek(schedule, course, week) {
  const weeks = Array.isArray(schedule.weeks) && schedule.weeks.length ? schedule.weeks
    : (Array.isArray(course.weeks) && course.weeks.length ? course.weeks : null);
  if (weeks) return weeks.map(Number).includes(week);
  const first = Number(schedule.startWeek ?? course.startWeek ?? 1);
  const last = Number(schedule.endWeek ?? course.endWeek ?? 20);
  if (week < first || week > last) return false;
  const type = schedule.weekType || course.weekType || 'all';
  return type === 'all' || (type === 'odd' && week % 2 === 1) || (type === 'even' && week % 2 === 0);
}

function getCourseSlots(courses, week) {
  return courses.flatMap(course => {
    const schedules = Array.isArray(course.schedules) && course.schedules.length ? course.schedules : [course];
    return schedules.filter(s => runsInWeek(s, course, week)).map(s => ({
      courseId: course.id,
      name: course.name || course.course_name,
      dayOfWeek: Number(s.dayOfWeek ?? s.day_of_week),
      startSection: Number(s.startSection ?? s.startPeriod ?? s.start_section),
      endSection: Number(s.endSection ?? s.endPeriod ?? s.end_section),
      startTime: s.startTime || course.startTime,
      endTime: s.endTime || course.endTime,
      location: s.location || course.location,
      teacher: s.teacher || course.teacher
    }));
  });
}

function selectNamedSlots(slots, rawName) {
  const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
  const exact = slots.filter(s => norm(s.name) === norm(rawName));
  const matches = exact.length ? exact : slots.filter(s => norm(s.name).includes(norm(rawName)));
  return new Set(matches.map(s => String(s.courseId))).size === 1 ? matches : [];
}

/**
 * 本地纯规则解析与调课执行引擎
 * @param {string} instruction 用户的调课自然语言文本
 * @param {Array} currentCourses 当前周次排课列表
 * @param {number} currentWeek 当前周次
 * @param {string} semesterStartDate 开学第一周周一公历日期
 */
export function applyLocalRuleAdjustment(instruction, currentCourses = [], currentWeek = 1,
  semesterStartDate = '2026-09-07', sectionTimes = DEFAULT_SECTION_TIMES) {
  const text = instruction.trim();
  const createdAdjustments = [];
  const startYear = parseInt((semesterStartDate || '2026-09-07').slice(0, 4), 10) || new Date().getFullYear();

  // -------------------------------------------------------------
  // 规则 1: 日期范围停课 / 放假 (如 9.25到10.7放假、9/25-10/7停课)
  // -------------------------------------------------------------
  const holidayRangeRegex = /(?:(\d{4})[年\.\/-])?(\d{1,2})[月\.\/-](\d{1,2})[日号]?\s*(?:到|至|~|-)\s*(?:(\d{4})[年\.\/-])?(\d{1,2})[月\.\/-](\d{1,2})[日号]?\s*(?:放假|停课|休息|不上课|不上|调休|放假调休)/;
  const holidayMatch = text.match(holidayRangeRegex);

  if (holidayMatch) {
    const y1 = holidayMatch[1] ? parseInt(holidayMatch[1], 10) : startYear;
    const m1 = parseInt(holidayMatch[2], 10);
    const d1 = parseInt(holidayMatch[3], 10);
    const y2 = holidayMatch[4] ? parseInt(holidayMatch[4], 10) : y1;
    const m2 = parseInt(holidayMatch[5], 10);
    const d2 = parseInt(holidayMatch[6], 10);

    const startDateStr = `${y1}-${String(m1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;
    const endDateStr = `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
    const dateRangeList = getDatesInRange(startDateStr, endDateStr);

    let matchCount = 0;
    dateRangeList.forEach(dateStr => {
      const dt = new Date(dateStr);
      const semStart = new Date(semesterStartDate);
      const diffMs = dt.getTime() - semStart.getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const targetWeek = Math.floor(diffDays / 7) + 1;
      let targetDay = dt.getDay();
      if (targetDay === 0) targetDay = 7;

      const hitSlots = [];
      currentCourses.forEach(c => {
        const cName = c.name || c.course_name;
        if (Array.isArray(c.schedules) && c.schedules.length > 0) {
          c.schedules.forEach(s => {
            const sDay = Number(s.dayOfWeek || s.day_of_week);
            if (sDay === targetDay && runsInWeek(s, c, targetWeek)) {
              hitSlots.push({
                courseId: c.id,
                name: cName,
                dayOfWeek: sDay,
                startSection: s.startSection || s.startPeriod || 1,
                endSection: s.endSection || s.endPeriod || 2
              });
            }
          });
        } else {
          const cDay = Number(c.dayOfWeek || c.day_of_week);
          if (cDay === targetDay && runsInWeek(c, c, targetWeek)) {
            hitSlots.push({
              courseId: c.id,
              name: cName,
              dayOfWeek: cDay,
              startSection: c.startSection || c.startPeriod || 1,
              endSection: c.endSection || c.endPeriod || 2
            });
          }
        }
      });

      hitSlots.forEach(slot => {
        matchCount++;
        createdAdjustments.push({
          id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          originalCourseId: slot.courseId,
          initial_course_id: slot.courseId,
          initialCourseId: slot.courseId,
          week: targetWeek,
          target_week: targetWeek,
          original_week: targetWeek,
          originalWeek: targetWeek,
          targetWeek: targetWeek,
          target_date: dateStr,
          original_date: dateStr,
          original_day: slot.dayOfWeek,
          originalDay: slot.dayOfWeek,
          original_start_section: slot.startSection,
          originalStartSection: slot.startSection,
          original_end_section: slot.endSection,
          originalEndSection: slot.endSection,
          adjustType: 'cancel',
          action_type: 'cancelled',
          actionType: 'cancelled',
          courseName: slot.name,
          course_name: slot.name,
          name: slot.name,
          reason: `法定节假日放假停课 (${startDateStr} ~ ${endDateStr})`,
          createdAt: new Date().toISOString()
        });
      });
    });

    return {
      success: true,
      mode: 'local_rule',
      actionCount: createdAdjustments.length,
      adjustments: createdAdjustments,
      message: createdAdjustments.length > 0
        ? `🎉 成功解析放假停课指令！已停课 ${startDateStr} 至 ${endDateStr} 范围内的全部 ${createdAdjustments.length} 门课程。`
        : `🎉 成功识别放假指令 (${startDateStr} 至 ${endDateStr})！但经核对该日期范围内您原本就无排课安排，无需额外调整。`
    };
  }

  // -------------------------------------------------------------
  // 规则 2: 单日或相对日期停课 (如 周五停课、周三下午不上课)
  // -------------------------------------------------------------
  const singleCancelMatch = text.match(/(?:本周|下周)?(?:周|星期)([一二三四五六日天1-7])(?:(上午|下午|晚上))?\s*(?:放假|停课|休息|不上课)/);
  if (singleCancelMatch) {
    const dayOfWeek = parseCnNum(singleCancelMatch[1]);
    const timeBucket = singleCancelMatch[2];
    const isNextWeek = text.includes('下周');
    const targetWeek = isNextWeek ? currentWeek + 1 : currentWeek;

    const hitCourses = getCourseSlots(currentCourses, targetWeek).filter(slot => {
      if (slot.dayOfWeek !== dayOfWeek) return false;
      const startSec = slot.startSection;
      if (timeBucket === '上午' && startSec > 4) return false;
      if (timeBucket === '下午' && (startSec < 5 || startSec > 8)) return false;
      if (timeBucket === '晚上' && startSec < 9) return false;
      return true;
    });

    hitCourses.forEach(c => {
      createdAdjustments.push({
        id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        originalCourseId: c.courseId,
        initial_course_id: c.courseId,
        week: targetWeek,
        original_week: targetWeek,
        action_type: 'cancelled',
        original_day: c.dayOfWeek,
        original_start_section: c.startSection,
        original_end_section: c.endSection,
        adjustType: 'cancel',
        courseName: c.name || c.course_name,
        reason: '用户自然语言指令单日停课',
        createdAt: new Date().toISOString()
      });
    });

    return {
      success: true,
      mode: 'local_rule',
      actionCount: createdAdjustments.length,
      adjustments: createdAdjustments,
      message: createdAdjustments.length > 0
        ? `已成功为您停掉第 ${targetWeek} 周星期${singleCancelMatch[1]}的 ${createdAdjustments.length} 门课程。`
        : `已识别停课意向，但第 ${targetWeek} 周星期${singleCancelMatch[1]}该时段并无课程排期。`
    };
  }

  // -------------------------------------------------------------
  // 规则 3: 修改教室地点 (如 把马克思改到实验楼302)
  // -------------------------------------------------------------
  const locMatch = text.match(/把?(.+?)(?:的教室|的地点)?(?:改到|换到|调整到|在)\s*([A-Za-z0-9\u4e00-\u9fa5\-_#]+)(?:上课|教室)?/);
  if (locMatch && !text.includes('第') && !text.includes('节') && !text.includes('周')) {
    const rawName = locMatch[1].trim();
    const newLoc = locMatch[2].trim();
    const matched = selectNamedSlots(getCourseSlots(currentCourses, currentWeek), rawName);

    if (matched.length > 0) {
      matched.forEach(c => {
        createdAdjustments.push({
          id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          originalCourseId: c.courseId,
          initial_course_id: c.courseId,
          week: currentWeek,
          original_week: currentWeek,
          target_week: currentWeek,
          action_type: 'moved',
          original_day: c.dayOfWeek,
          original_start_section: c.startSection,
          original_end_section: c.endSection,
          target_day: c.dayOfWeek,
          target_start_section: c.startSection,
          target_end_section: c.endSection,
          target_start_time: c.startTime || sectionTimes.find(s => Number(s.section) === c.startSection)?.start,
          target_end_time: c.endTime || sectionTimes.find(s => Number(s.section) === c.endSection)?.end,
          adjustType: 'modify',
          courseName: c.name || c.course_name,
          newLocation: newLoc,
          reason: `临时换教室至 ${newLoc}`,
          createdAt: new Date().toISOString()
        });
      });

      return {
        success: true,
        mode: 'local_rule',
        actionCount: createdAdjustments.length,
        adjustments: createdAdjustments,
        message: `已将【${matched[0].name || rawName}】本周教室调整至 ${newLoc}。`
      };
    }
  }

  // -------------------------------------------------------------
  // 规则 4: 调时间节次 (如 把周一上午的物理调到周三下午第5-6节)
  // -------------------------------------------------------------
  const rescheduleMatch = text.match(/把?(?:周|星期)?([一二三四五六日天1-7])?(?:的)?(.+?)(?:调到|改到|换到)(?:本周|下周)?(?:周|星期)?([一二三四五六日天1-7])(?:(上午|下午|晚上))?(?:第?(\d{1,2})(?:[-到至](\d{1,2}))?节)?(?:(?:在|到)(.+?))?$/);
  if (rescheduleMatch) {
    const targetName = rescheduleMatch[2].trim();
    const newDay = parseCnNum(rescheduleMatch[3]);
    let newStartSec = parseInt(rescheduleMatch[5], 10) || 1;
    let newEndSec = parseInt(rescheduleMatch[6], 10) || (newStartSec + 1);
    const newLoc = rescheduleMatch[7] ? rescheduleMatch[7].trim() : null;

    if (!rescheduleMatch[5] && rescheduleMatch[4]) {
      if (rescheduleMatch[4] === '上午') { newStartSec = 1; newEndSec = 2; }
      if (rescheduleMatch[4] === '下午') { newStartSec = 5; newEndSec = 6; }
      if (rescheduleMatch[4] === '晚上') { newStartSec = 9; newEndSec = 10; }
    }

    const originalDay = parseCnNum(rescheduleMatch[1]);
    const matched = selectNamedSlots(getCourseSlots(currentCourses, currentWeek), targetName)
      .filter(slot => !originalDay || slot.dayOfWeek === originalDay);

    if (matched.length === 1) {
      const c = matched[0];
      const timeRange = sectionTimes.find(s => Number(s.section) === newStartSec)
        || DEFAULT_SECTION_TIMES.find(s => Number(s.section) === newStartSec);
      const endTimeRange = sectionTimes.find(s => Number(s.section) === newEndSec)
        || DEFAULT_SECTION_TIMES.find(s => Number(s.section) === newEndSec);
      if (!timeRange || !endTimeRange) return { success: false, mode: 'local_rule', error: '目标节次超出作息表' };

      createdAdjustments.push({
        id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        originalCourseId: c.courseId,
        initial_course_id: c.courseId,
        week: currentWeek,
        original_week: currentWeek,
        target_week: currentWeek,
        action_type: 'moved',
        original_day: c.dayOfWeek,
        original_start_section: c.startSection,
        original_end_section: c.endSection,
        target_day: newDay,
        target_start_section: newStartSec,
        target_end_section: newEndSec,
        target_start_time: timeRange.start,
        target_end_time: endTimeRange.end,
        adjustType: 'reschedule',
        courseName: c.name || c.course_name,
        newDayOfWeek: newDay,
        newStartSection: newStartSec,
        newEndSection: newEndSec,
        newStartTime: timeRange.start,
        newEndTime: endTimeRange.end,
        newLocation: newLoc || c.location,
        reason: '时间调整',
        createdAt: new Date().toISOString()
      });

      return {
        success: true,
        mode: 'local_rule',
        actionCount: 1,
        adjustments: createdAdjustments,
        message: `已将【${c.name}】调整至周${rescheduleMatch[3]}第 ${newStartSec}-${newEndSec} 节${newLoc ? ' (教室: ' + newLoc + ')' : ''}。`
      };
    }
  }

  // 若均未匹配到标准模式，返回友好提示
  return {
    success: false,
    mode: 'local_rule',
    error: '未能识别具体的调课动作。建议使用常见句式，如：“9.25到10.7放假停课”、“把大学物理改到实验楼302” 或 “把周一上午的课调到周四下午第5-6节”。'
  };
}

/** 把模型动作转换为可写入调整图层的记录；遇到歧义时拒绝猜测课程。 */
export function normalizeRemoteAction(act, weekCards, activeWeek, instruction, sectionTimes = [], totalWeeks = 20) {
  const type = String(act?.type || '').toLowerCase();
  if (!['cancel', 'reschedule', 'modify', 'add'].includes(type)) {
    throw new Error('模型返回了不支持的调课动作');
  }
  const originalWeek = Number(act.originalWeek ?? act.original_week ?? act.week ?? activeWeek);
  const targetWeek = Number(act.targetWeek ?? act.target_week ?? act.week ?? originalWeek);
  if (![originalWeek, targetWeek].every(w => Number.isInteger(w) && w >= 1 && w <= totalWeeks)) {
    throw new Error('模型返回的周次超出当前学期范围');
  }

  const name = String(act.courseName || '').trim();
  const courseId = act.originalCourseId == null ? '' : String(act.originalCourseId).trim();
  let card = null;
  if (type !== 'add') {
    const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
    let matches = courseId
      ? weekCards.filter(c => String(c.courseId) === courseId || String(c.id) === courseId)
      : weekCards.filter(c => norm(c.name) === norm(name));
    if (!matches.length && !courseId && name) {
      matches = weekCards.filter(c => norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name)));
    }
    const originalDay = Number(act.originalDayOfWeek ?? act.originalDay ?? act.original_day);
    const originalStart = Number(act.originalStartSection ?? act.original_start_section);
    if (originalDay) matches = matches.filter(c => Number(c.dayOfWeek) === originalDay);
    if (originalStart) matches = matches.filter(c => Number(c.startSection) === originalStart);
    if (matches.length !== 1) {
      throw new Error(matches.length ? `课程“${name || courseId}”对应多个时段，请写明原星期与节次`
        : `第 ${originalWeek} 周找不到课程“${name || courseId}”`);
    }
    card = matches[0];
  } else if (!name) {
    throw new Error('新增课程缺少课程名称');
  }

  const targetDay = Number(act.newDayOfWeek ?? card?.dayOfWeek);
  const targetStart = Number(act.newStartSection ?? card?.startSection);
  const targetEnd = Number(act.newEndSection ?? card?.endSection);
  if (type === 'add' && (act.newDayOfWeek == null || act.newStartSection == null || act.newEndSection == null)) {
    throw new Error('新增课程必须指定星期和起止节次');
  }
  if (type !== 'cancel' && (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 7 ||
      !Number.isInteger(targetStart) || !Number.isInteger(targetEnd) ||
      targetStart < 1 || targetEnd > sectionTimes.length || targetEnd < targetStart)) {
    throw new Error('模型返回的目标星期或节次无效');
  }
  if (type === 'modify' && act.newLocation == null && act.newTeacher == null &&
      act.newDayOfWeek == null && act.newStartSection == null && act.newEndSection == null) {
    throw new Error('修改课程缺少新的时间、地点或教师');
  }

  const actionType = type === 'cancel' ? 'cancelled' : (type === 'add' ? 'added' : 'moved');
  const resolvedName = card?.name || name;
  const resolvedId = card?.courseId ?? 0;
  const startTime = sectionTimes.find(s => Number(s.section) === targetStart)?.start || card?.startTime || '08:00';
  const endTime = sectionTimes.find(s => Number(s.section) === targetEnd)?.end || card?.endTime || '09:50';
  return {
    id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    initial_course_id: resolvedId,
    originalCourseId: resolvedId,
    course_name: resolvedName,
    courseName: resolvedName,
    adjustType: type,
    action_type: actionType,
    week: targetWeek,
    original_week: originalWeek,
    target_week: targetWeek,
    original_day: card?.dayOfWeek ?? null,
    original_start_section: card?.startSection ?? null,
    original_end_section: card?.endSection ?? null,
    target_day: type === 'cancel' ? null : targetDay,
    target_start_section: type === 'cancel' ? null : targetStart,
    target_end_section: type === 'cancel' ? null : targetEnd,
    target_start_time: type === 'cancel' ? null : startTime,
    target_end_time: type === 'cancel' ? null : endTime,
    newLocation: act.newLocation || card?.location || '',
    newTeacher: act.newTeacher || card?.teacher || '',
    reason: act.reason || instruction,
    createdAt: new Date().toISOString()
  };
}

/** 模型只描述日期指向关系；课程卡片由本地课表在显示时解析。 */
export function normalizeDayOverrideAction(act, semesterStartDate, instruction, totalWeeks = 20) {
  const targetDate = String(act?.targetDate || '').trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? Date.parse(`${targetDate}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== targetDate) {
    throw new Error('模型返回的目标日期无效');
  }
  const targetWeek = calcWeekFromDate(targetDate, semesterStartDate);
  const sourceDay = Number(act.sourceDayOfWeek);
  const offset = Number(act.sourceWeekOffset ?? 0);
  const sourceWeek = act.sourceWeek == null ? targetWeek + offset : Number(act.sourceWeek);
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > totalWeeks ||
      !Number.isInteger(sourceDay) || sourceDay < 1 || sourceDay > 7 ||
      !Number.isInteger(offset) || !Number.isInteger(sourceWeek) ||
      sourceWeek < 1 || sourceWeek > totalWeeks) {
    throw new Error('模型返回的来源星期或周次超出当前学期');
  }
  const [y, m, d] = normalizeToMonday(semesterStartDate).split('-').map(Number);
  const sourceMs = Date.UTC(y, m - 1, d) + ((sourceWeek - 1) * 7 + sourceDay - 1) * 86400000;
  const sourceDate = new Date(sourceMs).toISOString().slice(0, 10);
  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  return {
    id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action_type: 'day_override',
    adjustType: 'day_override',
    week: targetWeek,
    target_week: targetWeek,
    target_date: targetDate,
    source_week: sourceWeek,
    source_day: sourceDay,
    source_date: sourceDate,
    replace_target: act.replaceTarget === true,
    courseName: `${targetDate} 按周${dayNames[sourceDay - 1]}上课`,
    reason: act.reason || instruction,
    createdAt: new Date().toISOString()
  };
}

/**
 * 客户端直连 DeepSeek / OpenAI 官方大模型接口 (可选高级功能)
 */
export async function callRemoteDeepSeekApi({
  instruction,
  currentCourses = [],
  week = 1,
  semesterStartDate = '2026-09-07',
  now = new Date(),
  apiKey,
  apiUrl = 'https://api.deepseek.com',
  model = 'deepseek-chat'
}) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('未配置 API Key');
  }

  let endpoint = normalizeAiBaseUrl(apiUrl);
  if (!endpoint.includes('/chat/completions')) {
    if (endpoint.endsWith('/v1')) {
      endpoint = `${endpoint}/chat/completions`;
    } else {
      endpoint = `${endpoint}/v1/chat/completions`;
    }
  }

  const dayPointerIntent = /(?:\d{1,2}[.月/-]\d{1,2}|\d{4}-\d{2}-\d{2})/.test(instruction) &&
    /(?:周[一二三四五六日天1-7]|星期[一二三四五六日天1-7])/.test(instruction) &&
    /(?:补|按|上|改为|改成)/.test(instruction);
  const simplifiedCourses = (dayPointerIntent ? [] : currentCourses).map(c => ({
    id: c.id,
    name: c.name || c.course_name,
    teacher: c.teacher,
    location: c.location,
    dayOfWeek: c.dayOfWeek || c.day_of_week,
    startSection: c.startSection || c.start_section,
    endSection: c.endSection || c.end_section,
    schedules: Array.isArray(c.schedules) ? c.schedules.map(s => ({
      dayOfWeek: s.dayOfWeek,
      startSection: s.startSection ?? s.startPeriod,
      endSection: s.endSection ?? s.endPeriod,
      weeks: s.weeks,
      startWeek: s.startWeek,
      endWeek: s.endWeek,
      weekType: s.weekType
    })) : []
  }));

  const localToday = new Date(now);
  if (!Number.isFinite(localToday.getTime())) throw new Error('设备当前日期无效');
  const todayDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
  const todayDay = localToday.getDay() || 7;
  const todayWeek = calcWeekFromDate(todayDate, semesterStartDate);
  const todayWeekText = todayWeek >= 1 ? `第 ${todayWeek} 周` : '开学前';
  const todayDayText = ['一', '二', '三', '四', '五', '六', '日'][todayDay - 1];

  const systemPrompt = `你是大学课表指令解析器。只提取用户明确要求的动作，输出纯 JSON，不要 Markdown。相对日期（今天、明天、本周、下周）以用户消息中的设备今天日期和实际周次为准，不把当前浏览周当作今天。日期所属年份根据设备今天和学期开始日期推断。
日期指向使用 type="day_override"，字段 targetDate(YYYY-MM-DD)、sourceDayOfWeek(1-7)、sourceWeekOffset(整数，默认0)、replaceTarget(布尔值)、reason。该动作仅建立日期到来源星期排课的指向，绝不逐门复制课程。"补周二的课"用 replaceTarget=false，保留目标日原课；只有用户明确说"改按周二上课"、"替换当天课程"等才用 true。普通课程调课仍用其他动作。
输出格式严格遵循 JSON（不要包含任何 markdown 或解释文字）：
{
  "explanation": "简短给用户的调课总结",
  "actions": [
    {
      "type": "day_override | reschedule | cancel | modify | add",
      "targetDate": "日期指向时填写 YYYY-MM-DD",
      "sourceDayOfWeek": "日期指向时填写 1-7",
      "sourceWeekOffset": "日期指向时填写来源周相对目标周的偏移，默认0",
      "replaceTarget": false,
      "courseName": "课程真实全称 (如高等数学 (上))",
      "originalCourseId": 课程ID(数字或字符),
      "originalWeek": 原课程周次(1-20),
      "originalDayOfWeek": 原星期几(1-7),
      "originalStartSection": 原起始节次(1-10),
      "targetWeek": 目标周次(1-20),
      "newDayOfWeek": 星期几(1-7),
      "newStartSection": 起始节次(1-10),
      "newEndSection": 结束节次(1-10),
      "newLocation": "新教室",
      "newTeacher": "新教师",
      "reason": "调课理由"
    }
  ]
}`;

  const userPrompt = `学期起始日: ${semesterStartDate}。设备今天: ${todayDate}，星期${todayDayText}，实际${todayWeekText}。当前浏览: 第 ${week} 周。${dayPointerIntent ? '此请求可能是整日排课指向；课程由本地读取，无需课程列表。' : `课程: ${JSON.stringify(simplifiedCourses)}`}\n用户指令: ${instruction}`;

  const makePayload = (withResponseFormat = true) => {
    const payload = {
      model: model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    if (withResponseFormat) {
      payload.response_format = { type: 'json_object' };
    }
    return payload;
  };

  let resp = await safeFetch(endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(makePayload(true))
  });

  // 若模型不支持 response_format 返回 400，自动降级重试纯 Prompt 提取模式
  if (!resp.ok && resp.status === 400) {
    const errText = await resp.text().catch(() => '');
    if (/response_format|json_object|parameter|unsupported/i.test(errText)) {
      resp = await safeFetch(endpoint, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(makePayload(false))
      });
    } else {
      throw new Error(`API 请求失败 (HTTP 400): ${errText.slice(0, 150)}`);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`API 请求失败 (HTTP ${resp.status}): ${errText.slice(0, 150)}`);
  }

  const json = await resp.json();
  const rawContent = json.choices?.[0]?.message?.content || '{}';
  
  // 健壮提取 JSON，兼容 markdown 代码块及首尾说明文本
  let parsed = {};
  let cleaned = String(rawContent).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (err) {
        throw new Error('无法解析大模型返回的 JSON 数据: ' + err.message);
      }
    } else {
      throw new Error('大模型未返回有效的 JSON 结构');
    }
  }

  return parsed;
}
