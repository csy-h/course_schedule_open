/**
 * 南京晓庄学院教务课表数据清洗与聚合引擎
 * 纯前端 / 纯手机本地运行，0 依赖，0 网络通信
 */

import { getMorandiColor } from './morandi.js';

// 晓庄标准 1-10 节作息时间映射表
export const NJXZC_SECTION_TIMES = {
  1: { start: '08:00', end: '08:45' },
  2: { start: '08:50', end: '09:35' },
  3: { start: '09:55', end: '10:40' },
  4: { start: '10:45', end: '11:30' },
  5: { start: '13:30', end: '14:15' },
  6: { start: '14:20', end: '15:05' },
  7: { start: '15:25', end: '16:10' },
  8: { start: '16:15', end: '17:00' },
  9: { start: '18:30', end: '19:15' },
  10: { start: '19:25', end: '20:10' }
};

export function calculateNjxzcTimes(startSec, endSec) {
  const s = Math.max(1, Math.min(10, parseInt(startSec, 10) || 1));
  const e = Math.max(s, Math.min(10, parseInt(endSec, 10) || s));
  return {
    startTime: NJXZC_SECTION_TIMES[s]?.start || '08:00',
    endTime: NJXZC_SECTION_TIMES[e]?.end || '09:35'
  };
}

/**
 * 晓庄周次解析：支持离散周、多区间、单双周标识
 * 例如："1-8,10-17周"、"1-16周(单)"、"2-16周(双)"、"3,5,7,9-12周"
 */
export function parseNjxzcWeeks(zcStr = '', dszFlag = '0') {
  if (!zcStr || typeof zcStr !== 'string') {
    return {
      startWeek: 1,
      endWeek: 16,
      weekType: 'all',
      weeks: Array.from({ length: 16 }, (_, i) => i + 1)
    };
  }

  const clean = zcStr.replace(/\s+/g, '');
  const hasOdd = clean.includes('单') || dszFlag === '1';
  const hasEven = clean.includes('双') || dszFlag === '2';
  let detectedWeekType = 'all';
  if (hasOdd && !hasEven) detectedWeekType = 'odd';
  else if (hasEven && !hasOdd) detectedWeekType = 'even';
  else detectedWeekType = 'all';

  const parts = clean.split(/[,，]/);
  const weeksSet = new Set();

  for (const part of parts) {
    if (!part) continue;
    let partType = detectedWeekType;
    if (part.includes('单')) partType = 'odd';
    else if (part.includes('双')) partType = 'even';

    const rangeMatch = part.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
      const s = parseInt(rangeMatch[1], 10);
      const e = parseInt(rangeMatch[2], 10);
      for (let w = s; w <= e; w++) {
        if (partType === 'odd' && w % 2 === 0) continue;
        if (partType === 'even' && w % 2 !== 0) continue;
        weeksSet.add(w);
      }
    } else {
      const nums = part.match(/\d+/g);
      if (nums) {
        for (const numStr of nums) {
          const w = parseInt(numStr, 10);
          if (partType === 'odd' && w % 2 === 0) continue;
          if (partType === 'even' && w % 2 !== 0) continue;
          weeksSet.add(w);
        }
      }
    }
  }

  const weeks = Array.from(weeksSet).sort((a, b) => a - b);
  const startWeek = weeks.length > 0 ? weeks[0] : 1;
  const endWeek = weeks.length > 0 ? weeks[weeks.length - 1] : 16;

  return {
    startWeek,
    endWeek,
    weekType: detectedWeekType,
    weeks: weeks.length > 0 ? weeks : Array.from({ length: 16 }, (_, i) => i + 1)
  };
}

/**
 * 清洗金智教务原始排课单元并聚合成符合系统标准的课程实体
 */
export function cleanSchoolCourses(rawList = []) {
  const courseMap = new Map();
  let courseIdSeq = 1;

  for (const row of rawList) {
    const name = (row.KCM || '未命名课程').trim();
    const code = (row.KCH || '').trim();
    const teacher = (row.SKJS || '').trim();
    const location = (row.JASMC || '待定').trim();
    let dayOfWeek = parseInt(row.SKXQ, 10);
    if (isNaN(dayOfWeek)) dayOfWeek = 1;
    else if (dayOfWeek === 0) dayOfWeek = 7;
    const startSection = parseInt(row.KSJC, 10) || 1;
    const endSection = Math.max(startSection, parseInt(row.JSJC, 10) || startSection);
    const stepCount = Math.max(1, endSection - startSection + 1);

    const weekInfo = parseNjxzcWeeks(row.SKZC || '1-16', row.DSZ);
    const times = calculateNjxzcTimes(startSection, endSection);

    const scheduleSlot = {
      name,
      code,
      teacher,
      location,
      dayOfWeek,
      startSection,
      endSection,
      stepCount,
      startPeriod: startSection,
      endPeriod: endSection,
      periodSpan: stepCount,
      startTime: times.startTime,
      endTime: times.endTime,
      startWeek: weekInfo.startWeek,
      endWeek: weekInfo.endWeek,
      weekType: weekInfo.weekType,
      weeks: weekInfo.weeks
    };

    if (!courseMap.has(name)) {
      const morandi = getMorandiColor(name);

      courseMap.set(name, {
        id: courseIdSeq++,
        name,
        code,
        teacher,
        location,
        color: morandi.bg,
        dayOfWeek,
        startSection,
        endSection,
        stepCount,
        startPeriod: startSection,
        endPeriod: endSection,
        periodSpan: stepCount,
        startTime: times.startTime,
        endTime: times.endTime,
        startWeek: weekInfo.startWeek,
        endWeek: weekInfo.endWeek,
        weekType: weekInfo.weekType,
        weeks: [...weekInfo.weeks],
        schedules: [scheduleSlot]
      });
    } else {
      const existing = courseMap.get(name);
      if (!existing.teacher && teacher) existing.teacher = teacher;
      if (!existing.code && code) existing.code = code;
      if (weekInfo.startWeek < existing.startWeek) existing.startWeek = weekInfo.startWeek;
      if (weekInfo.endWeek > existing.endWeek) existing.endWeek = weekInfo.endWeek;
      if (existing.weekType !== weekInfo.weekType) existing.weekType = 'all';

      const combinedWeeks = new Set([...existing.weeks, ...weekInfo.weeks]);
      existing.weeks = Array.from(combinedWeeks).sort((a, b) => a - b);
      existing.schedules.push(scheduleSlot);
    }
  }

  return Array.from(courseMap.values());
}
