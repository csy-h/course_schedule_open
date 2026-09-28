
import { getMorandiColor } from '../utils/morandi.js';
import { getCurrentRealWeek, normalizeToMonday } from './weekView.js';
import { escapeHtml } from '../utils/sanitize.js';
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export class DayView {
  constructor(options) {
    this.container = options.container;
    this.semesterStartDate = options.semesterStartDate || '2026-09-07';
    this.totalWeeks = options.totalWeeks || 20;
    this.customCurrentWeek = options.customCurrentWeek || null;
    this.sectionTimes = options.sectionTimes || null;
    this.onDateChange = options.onDateChange || (() => {});
    this.onCardClick = options.onCardClick || (() => {});
    this.currentDate = new Date(); // 正在查看的日期
    this.items = [];
    this.timerId = null;
    this.initSkeleton();
  }

  updateConfig(options) {
    if (options.semesterStartDate) this.semesterStartDate = options.semesterStartDate;
    if (options.totalWeeks) this.totalWeeks = options.totalWeeks;
    if (options.customCurrentWeek !== undefined) this.customCurrentWeek = options.customCurrentWeek;
    if (options.sectionTimes !== undefined) this.sectionTimes = options.sectionTimes;
    this.updateDateUI();
    this.refreshStatus();
  }

  getCourseTimes(card) {
    const startSec = card.startSection || card.startPeriod;
    const endSec = card.endSection || card.endPeriod || startSec;
    if (this.sectionTimes && Array.isArray(this.sectionTimes) && startSec) {
      const startSlot = this.sectionTimes.find(s => s.section === Number(startSec)) || this.sectionTimes[Number(startSec) - 1];
      const endSlot = this.sectionTimes.find(s => s.section === Number(endSec)) || this.sectionTimes[Number(endSec) - 1];
      if (startSlot && endSlot) {
        return {
          startTime: startSlot.start || card.startTime || '08:00',
          endTime: endSlot.end || card.endTime || '09:35'
        };
      }
    }
    return {
      startTime: card.startTime || '08:00',
      endTime: card.endTime || '09:35'
    };
  }
initSkeleton() {
    this.container.innerHTML = `
<div class="day-view-wrapper">
<!-- 顶部日期切换与导航 -->
<div class="day-nav-bar">
<button class="day-nav-btn" id="btnPrevDay" title="上一天">‹</button>
<div class="day-info-wrapper" id="dayInfoWrapper">
<div class="day-main-date" id="dayMainDate">2026年9月11日 星期五</div>
<div class="day-sub-info" id="daySubInfo">
<span class="badge-week" id="dayWeekBadge">第 2 周</span>
<span class="badge-count" id="dayCountBadge">今日共 0 门课</span>
</div>
</div>
<button class="day-nav-btn" id="btnNextDay" title="下一天">›</button>
<button class="day-today-btn" id="btnToday">今天</button>
</div>
<!-- 纵向时间流主体 -->
<div class="day-timeline-container" id="dayTimelineContainer">
<!-- 实时时间红线指示器 -->
<div class="timeline-now-line" id="timelineNowLine" style="display: none;">
<div class="now-badge" id="nowTimeBadge">14:20</div>
<div class="now-dot"></div>
<div class="now-line-track"></div>
</div>
<!-- 课程卡片与空闲时段列表 -->
<div class="timeline-stream" id="timelineStream"></div>
</div>
</div>
    `;
    this.dayMainDate = this.container.querySelector('#dayMainDate');
    this.dayWeekBadge = this.container.querySelector('#dayWeekBadge');
    this.dayCountBadge = this.container.querySelector('#dayCountBadge');
    this.timelineStream = this.container.querySelector('#timelineStream');
    this.timelineNowLine = this.container.querySelector('#timelineNowLine');
    this.nowTimeBadge = this.container.querySelector('#nowTimeBadge');
    this.bindEvents();
    this.startClockTimer();
  }
bindEvents() {
    this.container.querySelector('#btnPrevDay').addEventListener('click', () => {
this.currentDate.setDate(this.currentDate.getDate() - 1);
this.handleDateChanged();
    });
    this.container.querySelector('#btnNextDay').addEventListener('click', () => {
this.currentDate.setDate(this.currentDate.getDate() + 1);
this.handleDateChanged();
    });
    this.container.querySelector('#btnToday').addEventListener('click', () => {
this.currentDate = new Date();
this.handleDateChanged();
    });
  }
handleDateChanged() {
    this.updateDateUI();
    const dateStr = this.currentDate.toISOString().slice(0, 10);
    this.onDateChange(dateStr);
  }
setDate(date) {
    this.currentDate = typeof date === 'string' ? new Date(date + 'T00:00:00') : new Date(date);
    this.updateDateUI();
  }
updateDateUI() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth() + 1;
    const date = this.currentDate.getDate();
    const dow = WEEK_DAYS[this.currentDate.getDay()];
    const mondayStr = normalizeToMonday(this.semesterStartDate);
    const [by, bm, bd] = mondayStr.split('-').map(Number);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    const targetUtc = Date.UTC(year, month - 1, date);
    const diffDays = Math.round((targetUtc - baseUtc) / 86400000);
    const week = Math.max(1, Math.floor(diffDays / 7) + 1);
    this.dayMainDate.textContent = `${year}年${month}月${date}日 ${dow}`;
    this.dayWeekBadge.textContent = `第 ${week} 周`;
  }
startClockTimer() {
    this.updateNowIndicator();
    this.timerId = setInterval(() => {
this.updateNowIndicator();
this.refreshStatus();
    }, 30000); // 每 30 秒校准一次
  }
destroy() {
    if (this.timerId) {
clearInterval(this.timerId);
this.timerId = null;
    }
  }
  updateNowIndicator() {
    const now = new Date();
    const isToday = now.getFullYear() === this.currentDate.getFullYear() &&
      now.getMonth() === this.currentDate.getMonth() &&
      now.getDate() === this.currentDate.getDate();

    if (!isToday || !this.items || this.items.length === 0) {
      this.timelineNowLine.style.display = 'none';
      return;
    }

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const nowMinutes = hours * 60 + minutes;

    const cards = Array.from(this.timelineStream.querySelectorAll('.timeline-course-card'));
    if (cards.length === 0) {
      this.timelineNowLine.style.display = 'none';
      return;
    }

    // 提取所有卡片的起止分钟与关联的 DOM 行
    const parsedSlots = cards.map((el) => {
      const sStr = el.dataset.startTime || '08:00';
      const eStr = el.dataset.endTime || '09:50';
      const [sH, sM] = sStr.split(':').map(Number);
      const [eH, eM] = eStr.split(':').map(Number);
      return {
        el,
        rowEl: el.closest('.timeline-item-row') || el,
        startMin: sH * 60 + sM,
        endMin: eH * 60 + eM
      };
    }).sort((a, b) => a.startMin - b.startMin);

    const firstSlot = parsedSlots[0];
    const lastSlot = parsedSlots[parsedSlots.length - 1];

    // 早于第一门课 60 分钟以上或晚于最后一门课 60 分钟以上隐藏指示线
    if (nowMinutes < firstSlot.startMin - 60 || nowMinutes > lastSlot.endMin + 60) {
      this.timelineNowLine.style.display = 'none';
      return;
    }

    this.timelineNowLine.style.display = 'flex';
    this.nowTimeBadge.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    let targetTop = 0;

    // 1. 当前处于某门课程的有效时间内
    const activeSlot = parsedSlots.find(s => nowMinutes >= s.startMin && nowMinutes <= s.endMin);
    if (activeSlot) {
      const row = activeSlot.rowEl;
      const progress = (activeSlot.endMin > activeSlot.startMin)
        ? (nowMinutes - activeSlot.startMin) / (activeSlot.endMin - activeSlot.startMin)
        : 0.5;
      // 🚀 核心关键：红线 100% 绝对物理穿插在当前进行中课程卡片内部！
      targetTop = row.offsetTop + (row.offsetHeight * Math.min(0.90, Math.max(0.10, progress)));
    } else if (nowMinutes < firstSlot.startMin) {
      // 2. 早于第一门课
      const row = firstSlot.rowEl;
      const diff = firstSlot.startMin - nowMinutes;
      targetTop = Math.max(8, row.offsetTop - Math.min(36, diff * 0.8));
    } else if (nowMinutes > lastSlot.endMin) {
      // 3. 晚于最后一门课
      const row = lastSlot.rowEl;
      const diff = nowMinutes - lastSlot.endMin;
      targetTop = row.offsetTop + row.offsetHeight + Math.min(36, diff * 0.8);
    } else {
      // 4. 处于两门课之间的空隙（课间休息 / 午休 / 晚饭间歇）
      for (let i = 0; i < parsedSlots.length - 1; i++) {
        const prev = parsedSlots[i];
        const next = parsedSlots[i + 1];
        if (nowMinutes > prev.endMin && nowMinutes < next.startMin) {
          const prevRow = prev.rowEl;
          const nextRow = next.rowEl;
          const prevBottom = prevRow.offsetTop + prevRow.offsetHeight;
          const nextTop = nextRow.offsetTop;
          const gapDuration = next.startMin - prev.endMin;
          const gapProgress = gapDuration > 0 ? (nowMinutes - prev.endMin) / gapDuration : 0.5;
          targetTop = prevBottom + (nextTop - prevBottom) * gapProgress;
          break;
        }
      }
    }

    this.timelineNowLine.style.top = `${targetTop}px`;
  }

  calculateStatus(startTimeStr, endTimeStr) {
    const now = new Date();
    const isToday = now.getFullYear() === this.currentDate.getFullYear() &&
      now.getMonth() === this.currentDate.getMonth() &&
      now.getDate() === this.currentDate.getDate();

    if (!isToday) {
      return { status: 'pending', badgeText: '⚪ 待开始', statusText: '计划排课' };
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = startTimeStr.split(':').map(Number);
    const [eH, eM] = endTimeStr.split(':').map(Number);
    const startMinutes = sH * 60 + sM;
    const endMinutes = eH * 60 + eM;

    // 🚀 核心作息优化：检测跨越晚餐或午餐的长大节课程（例如 7-10 节 15:25~20:05）
    const isCrossDinnerLongCourse = (startMinutes <= 15 * 60 + 40 && endMinutes >= 19 * 60);
    const isCrossLunchLongCourse = (startMinutes <= 11 * 60 && endMinutes >= 14 * 60);

    if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
      if (isCrossDinnerLongCourse) {
        const afternoonEnd = 17 * 60; // 下午第 8 节下课 17:00
        const eveningStart = 18 * 60 + 30; // 晚间第 9 节开课 18:30

        if (nowMinutes <= afternoonEnd) {
          // 下午段进行中：以下午放学吃晚饭为倒计时，彻底告别 245 分钟！
          const remaining = afternoonEnd - nowMinutes;
          return {
            status: 'ongoing',
            badgeText: '🟢 进行中',
            statusText: `正在上课 (距下午下课还剩 ${remaining} 分钟 · 晚间尚有2节)`
          };
        } else if (nowMinutes < eveningStart) {
          // 晚饭课间休整中 (17:00 ~ 18:30)
          const waitMinutes = eveningStart - nowMinutes;
          return {
            status: 'upcoming',
            badgeText: '🍱 晚间休整',
            statusText: `晚饭课间休整中 (距 18:30 晚课还剩 ${waitMinutes} 分钟)`
          };
        } else {
          // 晚间段进行中 (18:30 ~ 20:05)
          const remaining = endMinutes - nowMinutes;
          return {
            status: 'ongoing',
            badgeText: '🟢 进行中',
            statusText: `正在上课 (距晚课结束还剩 ${remaining} 分钟)`
          };
        }
      }

      if (isCrossLunchLongCourse) {
        const morningEnd = 12 * 60;
        const afternoonStart = 13 * 60 + 30;
        if (nowMinutes <= morningEnd) {
          const remaining = morningEnd - nowMinutes;
          return {
            status: 'ongoing',
            badgeText: '🟢 进行中',
            statusText: `正在上课 (距上午下课还剩 ${remaining} 分钟 · 下午尚有排课)`
          };
        } else if (nowMinutes < afternoonStart) {
          const waitMinutes = afternoonStart - nowMinutes;
          return {
            status: 'upcoming',
            badgeText: '🍱 午间休整',
            statusText: `午休课间休整中 (距 13:30 下午课还剩 ${waitMinutes} 分钟)`
          };
        }
      }

      const remaining = endMinutes - nowMinutes;
      return {
        status: 'ongoing',
        badgeText: '🟢 进行中',
        statusText: `正在上课 (距下课还剩 ${remaining} 分钟)`
      };
    } else if (nowMinutes < startMinutes) {
      const waitMinutes = startMinutes - nowMinutes;
      if (waitMinutes <= 30) {
        return {
          status: 'upcoming',
          badgeText: '🟡 即将开始',
          statusText: `下节课程 (还有 ${waitMinutes} 分钟上课)`
        };
      } else {
        return {
          status: 'pending',
          badgeText: '⚪ 待开始',
          statusText: `${startTimeStr} 开课`
        };
      }
    } else {
      return {
        status: 'finished',
        badgeText: '🔘 已结束',
        statusText: '已结课'
      };
    }
  }

  refreshStatus() {
    const cards = this.timelineStream.querySelectorAll('.timeline-course-card');
    cards.forEach((cardEl) => {
      const startTime = cardEl.dataset.startTime;
      const endTime = cardEl.dataset.endTime;
      if (!startTime || !endTime) return;
      const { status, badgeText, statusText } = this.calculateStatus(startTime, endTime);
      cardEl.classList.remove('status-pending', 'status-upcoming', 'status-ongoing', 'status-finished');
      cardEl.classList.add(`status-${status}`);
      const badgeEl = cardEl.querySelector('.status-pill');
      const textEl = cardEl.querySelector('.status-hint');
      if (badgeEl) badgeEl.textContent = badgeText;
      if (textEl) textEl.textContent = statusText;
    });
  }
renderCourses(items) {
    this.renderItems(items);
  }
renderItems(items) {
    this.items = items || [];
    this.dayCountBadge.textContent = `今日共 ${this.items.length} 门课`;
    if (this.items.length === 0) {
      this.timelineStream.innerHTML = `
<div class="empty-day-state">
<div class="empty-icon">☕</div>
<div class="empty-title">今日无课，尽享自由！</div>
<div class="empty-subtitle">可以温习功课或去图书馆转转~</div>
</div>
`;
      this.updateNowIndicator();
      return;
    }
    // 动态根据作息设置提取每门课的起止时间并排序
    const enriched = this.items.map(card => {
      const { startTime, endTime } = this.getCourseTimes(card);
      return {
        ...card,
        startTime,
        endTime
      };
    });

    const sorted = enriched.sort((a, b) => {
      const aStart = a.startTime || '00:00';
      const bStart = b.startTime || '00:00';
      return aStart.localeCompare(bStart);
    });

    let html = '';
    for (let i = 0; i < sorted.length; i++) {
      const card = sorted[i];
      const palette = getMorandiColor(card.name);
      const { status, badgeText, statusText } = this.calculateStatus(card.startTime, card.endTime);
      const isReduced = Boolean(card.isReduced || card.adjustType === 'cancel' || card.status === 'cancelled');
      const isAdded = Boolean(card.isAdjusted || card.adjustType === 'add' || card.source === 'adjusted');
      let extraCardClass = '';
      if (isReduced) extraCardClass += ' is-reduced';
      if (isAdded) extraCardClass += ' is-adjusted';
      if (card.hasConflict) extraCardClass += ' has-conflict';

      let sourcePillHtml = '';
      if (isReduced) {
        const tagText = card.adjustType === 'moved' ? '[调离]' : '[停课]';
        sourcePillHtml = `<span class="card-source-pill pill-reduced" style="background:#FEE2E2;color:#DC2626;font-weight:700;padding:2px 6px;border-radius:6px;font-size:10px;">${escapeHtml(tagText)}</span>`;
      } else if (isAdded) {
        const tagText = card.pointerSourceText ? `[调·${card.pointerSourceText}]` : (card.adjustType === 'moved' ? '[调入]' : '[补课]');
        sourcePillHtml = `<span class="card-source-pill pill-adjusted" style="background:#FEF3C7;color:#D97706;font-weight:700;padding:2px 6px;border-radius:6px;font-size:10px;">${escapeHtml(tagText)}</span>`;
      }

      const safeName = escapeHtml(card.name || '未命名课程');
      const safeLoc = escapeHtml(card.location || '待定教室');
      const safeTeacher = escapeHtml(card.teacher || '');
      const safeStartTime = escapeHtml(card.startTime || '');
      const safeEndTime = escapeHtml(card.endTime || '');
      const safeBadgeText = escapeHtml(badgeText);
      const safeStatusText = escapeHtml(statusText);

      html += `
<div class="timeline-item-row">
<div class="time-axis-col">
<span class="axis-time">${safeStartTime}</span>
<span class="axis-duration">${Math.max(1, Math.min(10, Number(card.periodSpan || card.stepCount) || 2))}节课</span>
</div>
<div class="timeline-course-card status-${status}${extraCardClass}" 
data-start-time="${safeStartTime}" 
data-end-time="${safeEndTime}" 
data-index="${i}"
style="background-color: ${card.hasConflict ? '#FEE2E2' : palette.bg}; border-color: ${card.hasConflict ? '#DC2626' : palette.border}; color: ${card.hasConflict ? '#991B1B' : palette.text};">
<div class="card-header-bar">
<span class="status-pill">${safeBadgeText}</span>
${sourcePillHtml}
${card.hasConflict ? '<span class="conflict-label">⚠ 冲突</span>' : ''}
<span class="status-hint">${safeStatusText}</span>
</div>
<div class="card-main-title">${safeName}</div>
<div class="card-details-row">
<div class="detail-item"><span class="icon">📍</span>${safeLoc}</div>
${safeTeacher ? `<div class="detail-item"><span class="icon">👤</span>${safeTeacher}</div>` : ''}
<div class="detail-item"><span class="icon">⏰</span>${safeStartTime} ~ ${safeEndTime}</div>
</div>
</div>
</div>`;
    }
    this.timelineStream.innerHTML = html;
    // 绑定点击事件
    this.timelineStream.querySelectorAll('.timeline-course-card').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        if (sorted[idx]) {
          this.onCardClick(sorted[idx]);
        }
      });
    });
    this.updateNowIndicator();
  }
}
