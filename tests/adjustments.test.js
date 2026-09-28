const assert = require('assert');

async function run() {
  const { applyLocalRuleAdjustment, normalizeRemoteAction, normalizeDayOverrideAction, callRemoteDeepSeekApi } = await import('../client/src/utils/localAiAdjuster.js');
  const { idbStore, adjustmentMatchesBaseCard, calcWeekFromDate, applyDayOverride, flagScheduleConflicts } = await import('../client/src/storage/idbStore.js');
  const { DEFAULT_SECTION_TIMES, localStore } = await import('../client/src/storage/localStore.js');
  const course = { id: 7, name: '高等数学', schedules: [
    { dayOfWeek: 5, startSection: 1, endSection: 2, startWeek: 1, endWeek: 20, weeks: [] },
    { dayOfWeek: 3, startSection: 3, endSection: 4, startWeek: 1, endWeek: 20, weeks: [] }
  ] };

  const holiday = applyLocalRuleAdjustment('9.25到10.7放假调休', [course], 3, '2026-09-07');
  assert.deepStrictEqual(holiday.adjustments.map(a => a.original_date),
    ['2026-09-25', '2026-09-30', '2026-10-02', '2026-10-07']);
  assert.deepStrictEqual([...new Set(holiday.adjustments.map(a => a.week))], [3, 4, 5]);
  assert.strictEqual(calcWeekFromDate('2026-10-07', '2026-09-07'), 5);

  const single = applyLocalRuleAdjustment('本周周五停课', [course], 3, '2026-09-07');
  assert.strictEqual(single.adjustments.length, 1);
  assert.strictEqual(single.adjustments[0].original_day, 5);
  assert.strictEqual(single.adjustments[0].action_type, 'cancelled');
  const changedRoom = applyLocalRuleAdjustment('把高等数学改到实验楼302',
    [{ id: 7, name: '高等数学', schedules: [{ dayOfWeek: 1, startSection: 1,
      endSection: 2, startWeek: 1, endWeek: 20, weeks: [] }] }], 3, '2026-09-07');
  assert.strictEqual(changedRoom.adjustments[0].action_type, 'moved');
  assert.strictEqual(changedRoom.adjustments[0].target_day, 1);
  assert.strictEqual(changedRoom.adjustments[0].target_start_section, 1);
  const rescheduled = applyLocalRuleAdjustment('把周一高等数学调到周三第5-6节',
    [{ id: 7, name: '高等数学', schedules: [{ dayOfWeek: 1, startSection: 1,
      endSection: 2, startWeek: 1, endWeek: 20, weeks: [] }] }], 3, '2026-09-07');
  assert.strictEqual(rescheduled.adjustments[0].original_day, 1);
  assert.strictEqual(rescheduled.adjustments[0].target_day, 3);
  assert.strictEqual(rescheduled.adjustments[0].target_start_section, 5);
  const morningMove = applyLocalRuleAdjustment('把周一高等数学调到周三第3-4节',
    [{ id: 7, name: '高等数学', schedules: [{ dayOfWeek: 1, startSection: 1,
      endSection: 2, startWeek: 1, endWeek: 20, weeks: [] }] }], 3, '2026-09-07');
  assert.strictEqual(morningMove.adjustments[0].target_start_time, DEFAULT_SECTION_TIMES[2].start);

  const card = { id: 'sch_7', courseId: 7, name: '高等数学', dayOfWeek: 5,
    startSection: 1, endSection: 2, startTime: '08:00', endTime: '09:35', location: 'A101' };
  const nearName = { ...card, courseId: 8, name: '高等数学实验' };
  assert(adjustmentMatchesBaseCard(single.adjustments[0], card));
  assert(!adjustmentMatchesBaseCard(single.adjustments[0], nearName));
  assert(!adjustmentMatchesBaseCard({ courseName: '高等数学', original_day: 5,
    original_start_section: 1 }, nearName));

  const modified = normalizeRemoteAction({ type: 'modify', originalCourseId: 7,
    courseName: '高等数学', newLocation: 'B202' }, [card], 3, '换教室', DEFAULT_SECTION_TIMES);
  assert.strictEqual(modified.action_type, 'moved');
  assert.strictEqual(modified.original_day, 5);
  assert.strictEqual(modified.target_day, 5);
  assert.strictEqual(modified.target_start_section, 1);
  assert.strictEqual(modified.newLocation, 'B202');
  assert.throws(() => normalizeRemoteAction({ type: 'add', courseName: '补课' },
    [card], 3, '加课', DEFAULT_SECTION_TIMES), /必须指定/);
  assert.throws(() => normalizeRemoteAction({ type: 'cancel', courseName: '高等数学' },
    [card, { ...card, id: 'sch_7_2', dayOfWeek: 3 }], 3, '停课', DEFAULT_SECTION_TIMES), /多个时段/);
  const added = normalizeRemoteAction({ type: 'add', courseName: '补课',
    newDayOfWeek: 2, newStartSection: 5, newEndSection: 6 }, [], 3, '加课', DEFAULT_SECTION_TIMES);
  assert.strictEqual(added.action_type, 'added');
  assert.strictEqual(added.target_day, 2);
  const cancelled = normalizeRemoteAction({ type: 'cancel', originalCourseId: 7,
    courseName: '高等数学', originalDayOfWeek: 5, originalStartSection: 1 }, [card], 3, '停课', DEFAULT_SECTION_TIMES);
  assert.strictEqual(cancelled.action_type, 'cancelled');
  const moved = normalizeRemoteAction({ type: 'reschedule', originalCourseId: 7,
    courseName: '高等数学', newDayOfWeek: 3, newStartSection: 5, newEndSection: 6 },
    [card], 3, '调课', DEFAULT_SECTION_TIMES);
  assert.strictEqual(moved.action_type, 'moved');

  const pointer = normalizeDayOverrideAction({ type: 'day_override', targetDate: '2026-10-01',
    sourceDayOfWeek: 2 }, '2026-09-07', '10.1 补周二的课');
  assert.strictEqual(pointer.target_week, 4);
  assert.strictEqual(pointer.source_date, '2026-09-29');
  assert.strictEqual(pointer.replace_target, false);
  assert.throws(() => normalizeDayOverrideAction({ targetDate: '2026-02-30', sourceDayOfWeek: 2 },
    '2026-02-02', '补课'), /日期无效/);
  const existing = { id: 'existing', courseId: 9, name: '大学英语', dayOfWeek: 4,
    startSection: 1, endSection: 2, location: 'B101' };
  const source = { id: 'source', courseId: 7, name: '高等数学', dayOfWeek: 2,
    startSection: 2, endSection: 3, location: 'A101' };
  const addedDay = applyDayOverride([existing], [source], pointer, 4);
  assert.strictEqual(addedDay.length, 2);
  assert.strictEqual(addedDay[1].dayOfWeek, 4);
  assert.strictEqual(addedDay[1].source, 'adjusted');
  const conflicts = flagScheduleConflicts(addedDay);
  assert.strictEqual(conflicts[0].hasConflict, true);
  assert.strictEqual(conflicts[1].conflictingCourses[0].name, '大学英语');
  assert.strictEqual(conflicts[0].conflictingCourses[0].name, '高等数学');
  assert.strictEqual(flagScheduleConflicts([{ ...existing, isCancelled: true }, addedDay[1]])[1].hasConflict, false);
  assert.strictEqual(flagScheduleConflicts([{ ...existing, endSection: 1 }, { ...addedDay[1], startSection: 2 }])[0].hasConflict, false);
  const replacing = applyDayOverride([existing], [source], { ...pointer, replace_target: true }, 4);
  assert.strictEqual(replacing.length, 1);
  assert.strictEqual(replacing[0].name, '高等数学');
  const originalInitial = idbStore.getInitialCourses;
  const originalAdjustments = idbStore.getAdjustments;
  idbStore.getInitialCourses = async () => [
    { id: 7, name: '高等数学', schedules: [{ id: 'math-tue', dayOfWeek: 2,
      startSection: 2, endSection: 3, startWeek: 1, endWeek: 20 }] },
    { id: 9, name: '大学英语', schedules: [{ id: 'english-thu', dayOfWeek: 4,
      startSection: 1, endSection: 2, startWeek: 1, endWeek: 20 }] }
  ];
  idbStore.getAdjustments = async () => [pointer];
  const integrated = await idbStore.getMergedScheduleByWeek(4, '2026-09-07');
  assert.strictEqual(integrated.length, 3);
  assert.strictEqual(integrated.filter(c => c.hasConflict).length, 2);
  assert(integrated.some(c => c.adjustType === 'day_override' && c.name === '高等数学'));

  // 复现：10 月 7 日周三被假期记录停课，10 月 10 日仍应能补原周三的三门课。
  const holidayPointer = normalizeDayOverrideAction({ targetDate: '2026-10-10',
    sourceDayOfWeek: 3 }, '2026-09-07', '10月10日按周三课表上课，补10月7日周三课程');
  const sourceCourses = [
    { id: 11, name: '课程甲', schedules: [{ id: 'wed-a', dayOfWeek: 3, startSection: 1, endSection: 2, startWeek: 1, endWeek: 20 }] },
    { id: 12, name: '课程乙', schedules: [{ id: 'wed-b', dayOfWeek: 3, startSection: 3, endSection: 4, startWeek: 1, endWeek: 20 }] },
    { id: 13, name: '课程丙', schedules: [{ id: 'wed-c', dayOfWeek: 3, startSection: 5, endSection: 6, startWeek: 1, endWeek: 20 }] }
  ];
  idbStore.getInitialCourses = async () => sourceCourses;
  idbStore.getAdjustments = async () => [
    ...sourceCourses.map(c => ({ id: `cancel-${c.id}`, action_type: 'cancelled', initial_course_id: c.id,
      original_week: 5, original_day: 3, original_start_section: c.schedules[0].startSection })),
    holidayPointer
  ];
  const holidayMerged = await idbStore.getMergedScheduleByWeek(5, '2026-09-07');
  assert.strictEqual(holidayMerged.filter(c => c.dayOfWeek === 3 && c.isCancelled).length, 3);
  assert.deepStrictEqual(holidayMerged.filter(c => c.dayOfWeek === 6 && c.adjustType === 'day_override').map(c => c.name),
    ['课程甲', '课程乙', '课程丙']);
  assert.strictEqual((await idbStore.getMergedScheduleByDate('2026-10-10', '2026-09-07')).length, 3);
  const previousWeekPointer = normalizeDayOverrideAction({ targetDate: '2026-10-10',
    sourceDayOfWeek: 3, sourceWeekOffset: -1 }, '2026-09-07', '补前一周周三');
  idbStore.getAdjustments = async () => [previousWeekPointer];
  assert.strictEqual((await idbStore.getMergedScheduleByWeek(5, '2026-09-07'))
    .filter(c => c.dayOfWeek === 6 && c.adjustType === 'day_override').length, 3);
  idbStore.getInitialCourses = originalInitial;
  idbStore.getAdjustments = originalAdjustments;
  const originalGetWeek = idbStore.getMergedScheduleByWeek;
  idbStore.getMergedScheduleByWeek = async () => conflicts;
  const dateCards = await idbStore.getMergedScheduleByDate('2026-10-01', '2026-09-07');
  assert.strictEqual(dateCards.length, 2);
  idbStore.getMergedScheduleByWeek = originalGetWeek;

  let capturedPrompt = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    capturedPrompt = JSON.parse(options.body).messages[1].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"actions":[]}' } }] }) };
  };
  await callRemoteDeepSeekApi({ instruction: '10.1 补周二的课', currentCourses: [course],
    semesterStartDate: '2026-09-07', week: 5, now: new Date(2026, 8, 27, 12), apiKey: 'sample-key' });
  assert(!capturedPrompt.includes('高等数学'), '日期指向请求不应发送完整课程表');
  assert(capturedPrompt.includes('设备今天: 2026-09-27，星期日，实际第 3 周'));
  assert(capturedPrompt.includes('当前浏览: 第 5 周'));
  globalThis.fetch = originalFetch;

  globalThis.localStorage = { data: {}, getItem(k) { return this.data[k] ?? null; },
    setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } };
  localStore.setApiKey('sample-key');
  assert.strictEqual(localStore.getApiKey(), 'sample-key');
  assert(!JSON.stringify(localStorage.data).includes('sample-key'));
  assert(!('cs_sec_k' in localStorage.data));
  localStore.setApiKey('');
  let encryptedKey = '';
  globalThis.window = { AndroidWidgetBridge: {
    loadApiKey() { return encryptedKey; },
    storeApiKey(key) { encryptedKey = key; return true; }
  } };
  localStorage.setItem('cs_sec_k', Buffer.from('old-key').toString('base64'));
  assert.strictEqual(localStore.getApiKey(), 'old-key');
  assert.strictEqual(encryptedKey, 'old-key');
  assert.strictEqual(localStorage.getItem('cs_sec_k'), null);
  localStore.setApiKey('');
  delete globalThis.window;
  console.log('调课回归测试通过：跨周、日期指向、冲突、动作映射、课程匹配和密钥存储。');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
