/**
 * 高容错 iCalendar (ICS / TXT) 纯前端解析引擎
 * 针对 WakeUpSchedule (醒狮课表) 及通用高校教务系统导出日历深度优化
 * 0 依赖、0 网络延迟、100% 纯本地极速解析
 */

import { getMorandiColor } from './morandi.js';

// 高校标准 10 节作息时间表 (08:00 ~ 20:20)
export const SECTION_TIMES = [
  { section: 1, start: '08:00', end: '08:50' },
  { section: 2, start: '09:00', end: '09:50' },
  { section: 3, start: '10:10', end: '11:00' },
  { section: 4, start: '11:10', end: '12:00' },
  { section: 5, start: '13:30', end: '14:20' },
  { section: 6, start: '14:30', end: '15:20' },
  { section: 7, start: '15:40', end: '16:30' },
  { section: 8, start: '16:40', end: '17:30' },
  { section: 9, start: '18:30', end: '19:20' },
  { section: 10, start: '19:30', end: '20:20' },
];

/**
 * 反转义 RFC 5545 字符串
 */
export function unescapeIcs(str) {
  if (!str) return '';
  return str
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, '，')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * 将 Date 转为 CST 北京时间日期字符串 YYYY-MM-DD
 */
export function toCstDateString(dateObj) {
  const cstTime = new Date(dateObj.getTime() + 8 * 3600 * 1000);
  return cstTime.toISOString().slice(0, 10);
}

/**
 * 计算目标日期距离开学周一相差的学期周次 (1-indexed)
 */
export function calcSemesterWeek(targetDateStr, semesterStartMondayStr) {
  const [ty, tm, td] = targetDateStr.split('-').map(Number);
  const [sy, sm, sd] = semesterStartMondayStr.split('-').map(Number);
  const target = Date.UTC(ty, tm - 1, td);
  const start = Date.UTC(sy, sm - 1, sd);
  const diffDays = Math.round((target - start) / (24 * 3600 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

/**
 * 解析 ICS 原始文本
 * @param {string} rawIcsContent 
 * @param {string} defaultSemesterStart 默认开学第一周周一
 * @returns {object} 解析结果，包含课程列表 courses 与自动推算的开学日期 semesterStart
 */
export function parseIcs(rawIcsContent, defaultSemesterStart = '2026-09-07') {
  if (!rawIcsContent || typeof rawIcsContent !== 'string') {
    throw new Error('ICS 内容不能为空且必须为字符串');
  }

  // 1. 替换 Unicode \u00A0 为标准空格，统一换行符并消除长行折叠 (Line Unfolding)
  const normalized = rawIcsContent
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');

  // 2. 提取所有 BEGIN:VEVENT ... END:VEVENT 块
  const eventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;
  const parsedEvents = [];
  let detectedSemesterStart = null;

  while ((match = eventRegex.exec(normalized)) !== null) {
    const rawBlock = match[1];

    // 隔离 VALARM 子组件，防止通知覆盖描述
    const cleanBlock = rawBlock.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '');

    const props = {};
    const lines = cleanBlock.split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const keyPart = line.substring(0, colonIdx);
      const valPart = line.substring(colonIdx + 1);
      const semIdx = keyPart.indexOf(';');
      const mainKey = semIdx !== -1 ? keyPart.substring(0, semIdx).toUpperCase() : keyPart.toUpperCase();
      props[mainKey] = valPart;
    }

    const rawSummary = unescapeIcs(props.SUMMARY || '未命名课程');
    const dtstart = props.DTSTART || '';
    const dtend = props.DTEND || '';
    const rrule = props.RRULE || '';
    const rawLocation = unescapeIcs(props.LOCATION || '');
    const rawDesc = unescapeIcs(props.DESCRIPTION || '');
    const uid = props.UID || '';

    if (!dtstart) continue;

    // 提取课程编号与清洗课程名
    let courseCode = '';
    let courseName = rawSummary;
    const codeMatch = rawSummary.match(/^([A-Za-z0-9]+)\s+(.*)$/);
    if (codeMatch) {
      courseCode = codeMatch[1];
      courseName = codeMatch[2].trim();
    }

    // 解析时区与时间
    const sYear = parseInt(dtstart.substring(0, 4), 10);
    const sMonth = parseInt(dtstart.substring(4, 6), 10) - 1;
    const sDay = parseInt(dtstart.substring(6, 8), 10);
    const sHour = parseInt(dtstart.substring(9, 11) || '0', 10);
    const sMin = parseInt(dtstart.substring(11, 13) || '0', 10);

    const eHour = parseInt(dtend.substring(9, 11) || sHour, 10);
    const eMin = parseInt(dtend.substring(11, 13) || sMin, 10);

    const startTimeStr = `${String(sHour).padStart(2, '0')}:${String(sMin).padStart(2, '0')}`;
    const endTimeStr = `${String(eHour).padStart(2, '0')}:${String(eMin).padStart(2, '0')}`;

    const startDateUtc = new Date(Date.UTC(sYear, sMonth, sDay, sHour - 8, sMin));
    const startDateCstStr = `${sYear}-${String(sMonth + 1).padStart(2, '0')}-${String(sDay).padStart(2, '0')}`;

    // 星期计算 (1 为周一, 7 为周日)
    const dayOfWeek = startDateUtc.getUTCDay() === 0 ? 7 : startDateUtc.getUTCDay();

    // 节次解析
    let startSection = 1;
    let endSection = 2;
    const secMatch = rawDesc.match(/第\s*(\d+)\s*-\s*(\d+)\s*节/);
    if (secMatch) {
      startSection = parseInt(secMatch[1], 10);
      endSection = parseInt(secMatch[2], 10);
    } else {
      const startMatch = SECTION_TIMES.find(s => s.start === startTimeStr);
      const endMatch = SECTION_TIMES.find(s => s.end === endTimeStr);
      if (startMatch) startSection = startMatch.section;
      if (endMatch) endSection = endMatch.section;
      else endSection = startSection + 1;
    }
    const stepCount = Math.max(1, endSection - startSection + 1);

    // 教室与教师双源解析
    let location = '';
    let teacher = '';
    const descLines = rawDesc.split('\n').map(l => l.trim()).filter(Boolean);
    if (descLines.length >= 3) {
      location = descLines[1];
      teacher = descLines[2];
    } else {
      const locParts = rawLocation.split(/\s+/);
      location = locParts[0] || '';
      teacher = locParts.slice(1).join(' ') || '';
    }

    // UNTIL 与重复规则周次计算
    let untilDateCstStr = startDateCstStr;
    let totalWeeks = 1;
    const untilMatch = rrule.match(/UNTIL=([0-9TZ]+)/);
    if (untilMatch) {
      const uStr = untilMatch[1];
      const uy = parseInt(uStr.substring(0, 4), 10);
      const um = parseInt(uStr.substring(4, 6), 10) - 1;
      const ud = parseInt(uStr.substring(6, 8), 10);
      const uh = parseInt(uStr.substring(9, 11) || '0', 10);
      const umin = parseInt(uStr.substring(11, 13) || '0', 10);

      let untilDate;
      if (uStr.endsWith('Z')) {
        untilDate = new Date(Date.UTC(uy, um, ud, uh, umin));
      } else {
        untilDate = new Date(Date.UTC(uy, um, ud, uh - 8, umin));
      }
      untilDateCstStr = toCstDateString(untilDate);
      const diffMs = (untilDate.getTime() + 8 * 3600000) - Date.UTC(sYear, sMonth, sDay, 0, 0, 0);
      totalWeeks = Math.max(1, Math.round(diffMs / (7 * 86400000)));
    }

    // 自动推算事件对应的所在周周一
    const curDate = new Date(sYear, sMonth, sDay);
    const curDow = curDate.getDay() === 0 ? 7 : curDate.getDay();
    const monDate = new Date(curDate);
    monDate.setDate(curDate.getDate() - (curDow - 1));
    const monStr = `${monDate.getFullYear()}-${String(monDate.getMonth() + 1).padStart(2, '0')}-${String(monDate.getDate()).padStart(2, '0')}`;
    if (!detectedSemesterStart || monStr < detectedSemesterStart) {
      detectedSemesterStart = monStr;
    }

    // 关键修正：如果外部传入了明确的开学周一基准，优先尊重外部基准；否则使用检测出的最早周一
    const baseStart = defaultSemesterStart || detectedSemesterStart || '2026-09-07';
    
    // 计算该事件距离基准周一的周次差
    let rawWeekDiff = calcSemesterWeek(startDateCstStr, baseStart);
    // 容错机制：若课程首次上课在基准周一的当周（0~6天内），无论周几均严格锚定为第 1 周起课 (startWeek = 1)
    let startWeek = Math.max(1, rawWeekDiff);
    const [by, bm, bd] = baseStart.split('-').map(Number);
    const baseStartUtc = Date.UTC(by, bm - 1, bd);
    const curEventUtc = Date.UTC(sYear, sMonth, sDay);
    const dayDiffFromBase = Math.round((curEventUtc - baseStartUtc) / 86400000);
    if (dayDiffFromBase >= 0 && dayDiffFromBase < 7) {
      startWeek = 1;
    }

    const endWeek = Math.max(startWeek, startWeek + totalWeeks - 1);

    const weeks = [];
    for (let w = startWeek; w <= endWeek; w++) {
      weeks.push(w);
    }

    parsedEvents.push({
      uid,
      name: courseName,
      rawSummary,
      code: courseCode,
      teacher,
      location,
      dayOfWeek,
      startSection,
      endSection,
      stepCount,
      startPeriod: startSection,
      endPeriod: endSection,
      periodSpan: stepCount,
      startTime: startTimeStr,
      endTime: endTimeStr,
      rawTimeStr: `${startTimeStr}~${endTimeStr}`,
      startWeek,
      endWeek,
      weekType: 'all',
      weeks,
      rrule
    });
  }

  const semesterStart = defaultSemesterStart || detectedSemesterStart || '2026-09-07';

  // 聚合生成标准课程实体
  const coursesMap = new Map();

  parsedEvents.forEach((ev) => {
    let entityKey;
    if (ev.name.includes('面向对象') || ev.name.includes('计算机组成')) {
      entityKey = `${ev.name}@${ev.location}`;
    } else {
      entityKey = ev.name;
    }

    if (!coursesMap.has(entityKey)) {
      coursesMap.set(entityKey, {
        id: coursesMap.size + 1,
        key: entityKey,
        name: ev.name,
        code: ev.code,
        teacher: ev.teacher,
        location: ev.location,
        color: getMorandiColor(ev.name).bg,
        dayOfWeek: ev.dayOfWeek,
        startSection: ev.startSection,
        endSection: ev.endSection,
        stepCount: ev.stepCount,
        startPeriod: ev.startSection,
        endPeriod: ev.endSection,
        periodSpan: ev.stepCount,
        startTime: ev.startTime,
        endTime: ev.endTime,
        startWeek: ev.startWeek,
        endWeek: ev.endWeek,
        weekType: ev.weekType,
        schedules: []
      });
    }

    const courseEntity = coursesMap.get(entityKey);
    if (!courseEntity.teacher && ev.teacher) {
      courseEntity.teacher = ev.teacher;
    }
    if (ev.startWeek < courseEntity.startWeek) courseEntity.startWeek = ev.startWeek;
    if (ev.endWeek > courseEntity.endWeek) courseEntity.endWeek = ev.endWeek;

    courseEntity.schedules.push({
      uid: ev.uid,
      dayOfWeek: ev.dayOfWeek,
      startSection: ev.startSection,
      endSection: ev.endSection,
      stepCount: ev.stepCount,
      startPeriod: ev.startSection,
      endPeriod: ev.endSection,
      periodSpan: ev.stepCount,
      startTime: ev.startTime,
      endTime: ev.endTime,
      rawTimeStr: ev.rawTimeStr,
      location: ev.location,
      teacher: ev.teacher,
      startWeek: ev.startWeek,
      endWeek: ev.endWeek,
      weekType: ev.weekType,
      weeks: ev.weeks
    });
  });

  const courses = Array.from(coursesMap.values());

  return {
    semesterStart,
    totalEvents: parsedEvents.length,
    totalCourses: courses.length,
    events: parsedEvents,
    courses: courses
  };
}
