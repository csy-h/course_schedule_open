export const SEMESTER_START_DATE = '2026-09-07';
export const TOTAL_WEEKS = 20;
export const SECTION_TIMES = [
  { section: 1, start: '08:00', end: '08:50', name: '第1节' },
  { section: 2, start: '09:00', end: '09:50', name: '第2节' },
  { section: 3, start: '10:10', end: '11:00', name: '第3节' },
  { section: 4, start: '11:10', end: '12:00', name: '第4节' },
  { section: 5, start: '13:30', end: '14:20', name: '第5节' },
  { section: 6, start: '14:30', end: '15:20', name: '第6节' },
  { section: 7, start: '15:40', end: '16:30', name: '第7节' },
  { section: 8, start: '16:40', end: '17:30', name: '第8节' },
  { section: 9, start: '18:30', end: '19:20', name: '第9节' },
  { section: 10, start: '19:30', end: '20:20', name: '第10节' }
];

function genWeeks(start, end, type = 'all') {
  const arr = [];
  for (let w = start; w <= end; w++) {
    if (type === 'odd' && w % 2 === 0) continue;
    if (type === 'even' && w % 2 !== 0) continue;
    arr.push(w);
  }
  return arr;
}

const RAW = [
  {
    id: 1,
    name: '高等数学 (上)',
    code: 'MATH101',
    teacher: '张老师',
    location: '科技楼 阶梯教室A',
    color: '#4A7C59',
    dayOfWeek: 1,
    startPeriod: 1,
    endPeriod: 2,
    periodSpan: 2,
    startTime: '08:00',
    endTime: '09:50',
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 1,
        startPeriod: 1,
        endPeriod: 2,
        periodSpan: 2,
        startTime: '08:00',
        endTime: '09:50',
        location: '科技楼 阶梯教室A',
        teacher: '张老师',
        startWeek: 1,
        endWeek: 16,
        weekType: 'all'
      }
    ]
  },
  {
    id: 2,
    name: '大学英语视听说',
    code: 'ENG102',
    teacher: '李教授',
    location: '语音实验楼 302',
    color: '#8E9AAF',
    dayOfWeek: 1,
    startPeriod: 3,
    endPeriod: 4,
    periodSpan: 2,
    startTime: '10:10',
    endTime: '12:00',
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 1,
        startPeriod: 3,
        endPeriod: 4,
        periodSpan: 2,
        startTime: '10:10',
        endTime: '12:00',
        location: '语音实验楼 302',
        teacher: '李教授',
        startWeek: 1,
        endWeek: 16,
        weekType: 'all'
      }
    ]
  },
  {
    id: 3,
    name: '数据结构与算法',
    code: 'CS201',
    teacher: '王副教授',
    location: '图文信息中心 405',
    color: '#7A9E9F',
    dayOfWeek: 2,
    startPeriod: 1,
    endPeriod: 2,
    periodSpan: 2,
    startTime: '08:00',
    endTime: '09:50',
    startWeek: 1,
    endWeek: 16,
    weekType: 'odd',
    schedules: [
      {
        dayOfWeek: 2,
        startPeriod: 1,
        endPeriod: 2,
        periodSpan: 2,
        startTime: '08:00',
        endTime: '09:50',
        location: '图文信息中心 405',
        teacher: '王副教授',
        startWeek: 1,
        endWeek: 16,
        weekType: 'odd'
      }
    ]
  },
  {
    id: 4,
    name: '计算机网络技术',
    code: 'CS202',
    teacher: '陈老师',
    location: '实验实训中心 201',
    color: '#9B89B3',
    dayOfWeek: 2,
    startPeriod: 3,
    endPeriod: 4,
    periodSpan: 2,
    startTime: '10:10',
    endTime: '12:00',
    startWeek: 1,
    endWeek: 16,
    weekType: 'even',
    schedules: [
      {
        dayOfWeek: 2,
        startPeriod: 3,
        endPeriod: 4,
        periodSpan: 2,
        startTime: '10:10',
        endTime: '12:00',
        location: '实验实训中心 201',
        teacher: '陈老师',
        startWeek: 1,
        endWeek: 16,
        weekType: 'even'
      }
    ]
  },
  {
    id: 5,
    name: '操作系统原理与设计',
    code: 'CS301',
    teacher: '赵老师',
    location: '软件工程实训机房 3',
    color: '#D4A373',
    dayOfWeek: 3,
    startPeriod: 5,
    endPeriod: 8,
    periodSpan: 4,
    startTime: '13:30',
    endTime: '17:30',
    startWeek: 1,
    endWeek: 12,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 3,
        startPeriod: 5,
        endPeriod: 8,
        periodSpan: 4,
        startTime: '13:30',
        endTime: '17:30',
        location: '软件工程实训机房 3',
        teacher: '赵老师',
        startWeek: 1,
        endWeek: 12,
        weekType: 'all'
      }
    ]
  },
  {
    id: 6,
    name: '体育专项（羽毛球）',
    code: 'PE101',
    teacher: '孙教练',
    location: '风雨操场 2号羽毛球场',
    color: '#7F9183',
    dayOfWeek: 4,
    startPeriod: 5,
    endPeriod: 6,
    periodSpan: 2,
    startTime: '13:30',
    endTime: '15:20',
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 4,
        startPeriod: 5,
        endPeriod: 6,
        periodSpan: 2,
        startTime: '13:30',
        endTime: '15:20',
        location: '风雨操场 2号羽毛球场',
        teacher: '孙教练',
        startWeek: 1,
        endWeek: 16,
        weekType: 'all'
      }
    ]
  },
  {
    id: 7,
    name: '创意设计与人工智能',
    code: 'AI101',
    teacher: '周老师',
    location: '创新创业基地 102',
    color: '#A37081',
    dayOfWeek: 5,
    startPeriod: 3,
    endPeriod: 4,
    periodSpan: 2,
    startTime: '10:10',
    endTime: '12:00',
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 5,
        startPeriod: 3,
        endPeriod: 4,
        periodSpan: 2,
        startTime: '10:10',
        endTime: '12:00',
        location: '创新创业基地 102',
        teacher: '周老师',
        startWeek: 1,
        endWeek: 16,
        weekType: 'all'
      }
    ]
  },
  {
    id: 8,
    name: '职业生涯规划与创新',
    code: 'CAR101',
    teacher: '钱老师',
    location: '笃学楼 208',
    color: '#6D8B9B',
    dayOfWeek: 5,
    startPeriod: 7,
    endPeriod: 8,
    periodSpan: 2,
    startTime: '15:40',
    endTime: '17:30',
    startWeek: 9,
    endWeek: 16,
    weekType: 'all',
    schedules: [
      {
        dayOfWeek: 5,
        startPeriod: 7,
        endPeriod: 8,
        periodSpan: 2,
        startTime: '15:40',
        endTime: '17:30',
        location: '笃学楼 208',
        teacher: '钱老师',
        startWeek: 9,
        endWeek: 16,
        weekType: 'all'
      }
    ]
  }
];

export const DEFAULT_COURSES = RAW.map(c => ({
  ...c,
  schedules: c.schedules.map(s => ({
    ...s,
    startSection: s.startPeriod,
    endSection: s.endPeriod,
    stepCount: s.periodSpan,
    weeks: genWeeks(s.startWeek, s.endWeek, s.weekType)
  }))
}));
