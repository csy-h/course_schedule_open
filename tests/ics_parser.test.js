const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SAMPLE_PATH = path.join(__dirname, '..', 'test_schedule_sample.ics');

async function runTests() {
  const { parseIcs } = await import('../client/src/utils/icsParser.js');
  const sample = parseIcs(fs.readFileSync(SAMPLE_PATH, 'utf8'), '2026-09-07');
  assert.strictEqual(sample.totalEvents, 8);
  assert.strictEqual(sample.totalCourses, 8);
  assert(sample.courses.every(course => course.name && course.schedules.length > 0));

  const escapedAndAlarm = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:synthetic-1@courseschedule.local
SUMMARY:CS101 安全测试课程
DTSTART;TZID=Asia/Shanghai:20260907T080000
DTEND;TZID=Asia/Shanghai:20260907T095000
RRULE:FREQ=WEEKLY;UNTIL=20261221T235959Z
LOCATION:A楼201 测试教师甲\\,测试教师乙
DESCRIPTION:第 1 - 2 节\\nA楼201\\n测试教师甲\\,测试教师乙
BEGIN:VALARM
DESCRIPTION:不应进入课程内容的告警
END:VALARM
END:VEVENT
END:VCALENDAR`;
  const parsed = parseIcs(escapedAndAlarm, '2026-09-07');
  assert.strictEqual(parsed.totalEvents, 1);
  assert.strictEqual(parsed.events[0].code, 'CS101');
  assert.strictEqual(parsed.events[0].name, '安全测试课程');
  assert(parsed.events[0].teacher.includes('测试教师甲，测试教师乙'));
  assert(!parsed.events[0].name.includes('告警'));

  const folded = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:synthetic-2@courseschedule.local
SUMMARY:超长
 课程名
DTSTART;TZID=Asia/Shanghai:20260907T080000
DTEND;TZID=Asia/Shanghai:20260907T095000
DESCRIPTION:第 1 - 2 节\\n长
 教室\\n测试教师
END:VEVENT
END:VCALENDAR`;
  const foldedResult = parseIcs(folded, '2026-09-07');
  assert.strictEqual(foldedResult.events[0].name, '超长课程名');
  assert.strictEqual(foldedResult.events[0].location, '长教室');
  assert.strictEqual(foldedResult.events[0].teacher, '测试教师');

  console.log('ICS 解析测试通过：仓库内脱敏样本、转义、告警隔离与折叠行。');
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
