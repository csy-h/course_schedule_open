import { getMorandiColor } from '../utils/morandi.js';
import { DEFAULT_SECTION_TIMES } from '../storage/localStore.js';
import { escapeHtml } from '../utils/sanitize.js';

const WEEK_DAYS_MON = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_DAYS_SUN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function normalizeToMonday(dateStr) {
  if (!dateStr) return '2026-09-07';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay(); // 0 是周日, 1 是周一...
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

export function getCurrentRealWeek(baseMondayStr = '2026-09-07', customWeek = null, totalWeeks = 20) {
  if (customWeek !== null && customWeek !== undefined && Number(customWeek) >= 1) {
    return Math.min(Math.max(1, Number(customWeek)), totalWeeks || 25);
  }
  try {
    const mondayStr = normalizeToMonday(baseMondayStr);
    const now = new Date();
    const [by, bm, bd] = mondayStr.split('-').map(Number);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((nowUtc - baseUtc) / 86400000);
    const week = Math.floor(diffDays / 7) + 1;
    return Math.min(Math.max(1, week), totalWeeks || 25);
  } catch (e) {
    return 1;
  }
}

export function getWeekDates(week, baseMondayStr = '2026-09-07', weekStartDay = 'monday') {
  try {
    const mondayStr = normalizeToMonday(baseMondayStr);
    const [by, bm, bd] = mondayStr.split('-').map(Number);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    // 若每周起始日是周日，周日比该周周一提前 1 天
    const offsetDays = (weekStartDay === 'sunday') ? -1 : 0;
    const weekStartMs = baseUtc + (week - 1) * 7 * 86400000 + offsetDays * 86400000;
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartMs + i * 86400000);
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      dates.push(`${mm}-${dd}`);
    }
    return dates;
  } catch (e) {
    return ['--', '--', '--', '--', '--', '--', '--'];
  }
}

export class WeekView {
  constructor(options) {
    this.container = options.container;
    this.semesterStartDate = options.semesterStartDate || '2026-09-07';
    this.totalWeeks = options.totalWeeks || 20;
    this.totalSections = options.totalSections || 10;
    this.sectionTimes = options.sectionTimes || DEFAULT_SECTION_TIMES;
    this.weekStartDay = options.weekStartDay || 'monday';
    this.customCurrentWeek = options.customCurrentWeek || null;
    this.onWeekChange = options.onWeekChange || (() => {});
    this.onCardClick = options.onCardClick || (() => {});

    this.currentRealWeek = getCurrentRealWeek(this.semesterStartDate, this.customCurrentWeek, this.totalWeeks);
    this.selectedWeek = this.currentRealWeek;
    this.courseCards = [];
    this.initSkeleton();
  }

  updateConfig(options) {
    const oldStart = this.semesterStartDate;
    if (options.semesterStartDate) this.semesterStartDate = options.semesterStartDate;
    if (options.totalWeeks) this.totalWeeks = options.totalWeeks;
    if (options.totalSections) this.totalSections = options.totalSections;
    if (options.sectionTimes) this.sectionTimes = options.sectionTimes;
    if (options.weekStartDay) this.weekStartDay = options.weekStartDay;
    if (options.customCurrentWeek !== undefined) this.customCurrentWeek = options.customCurrentWeek;

    this.currentRealWeek = getCurrentRealWeek(this.semesterStartDate, this.customCurrentWeek, this.totalWeeks);
    if ((options.semesterStartDate && options.semesterStartDate !== oldStart) || this.selectedWeek > this.totalWeeks) {
      this.selectedWeek = this.currentRealWeek;
    }
    this.initSkeleton();
    this.setWeek(this.selectedWeek, false);
    if (this.courseCards && this.courseCards.length > 0) {
      this.renderCourses(this.courseCards);
    }
  }

  initSkeleton() {
    const weekDays = this.weekStartDay === 'sunday' ? WEEK_DAYS_SUN : WEEK_DAYS_MON;
    const activeTimes = (this.sectionTimes && this.sectionTimes.length > 0)
      ? this.sectionTimes.slice(0, this.totalSections)
      : DEFAULT_SECTION_TIMES.slice(0, this.totalSections);

    this.container.innerHTML = `
      <div class="week-view-wrapper">
        <!-- 周次轮播条 -->
        <div class="week-carousel-container">
          <button class="back-to-current-week-btn" id="btnBackCurrentWeek" title="快速回到当前真实周">
            <span class="icon">↺</span>
            <span class="btn-text">本周</span>
          </button>
          <div class="week-carousel-scroll" id="weekCarouselScroll">
            ${Array.from({ length: this.totalWeeks }, (_, i) => i + 1).map(w => `
              <button class="week-chip ${w === this.selectedWeek ? 'active' : ''} ${w === this.currentRealWeek ? 'is-current-real' : ''}" data-week="${w}">
                <span>第 ${w} 周</span>
                ${w === this.currentRealWeek ? '<span class="current-dot"></span>' : ''}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 7 列星期表头 -->
        <div class="week-days-header" id="weekDaysHeader">
          <div class="header-corner">
            <span class="corner-text">${new Date().getMonth() + 1}月</span>
          </div>
          ${weekDays.map((name, i) => `
            <div class="day-header-col" data-col="${i + 1}" id="dayHeader_${i + 1}">
              <div class="day-name">${name}</div>
              <div class="day-date" id="dayDate_${i + 1}">--</div>
            </div>
          `).join('')}
        </div>

        <!-- 网格主体容器 -->
        <div class="week-grid-container" id="weekGrid" style="grid-template-rows: repeat(${this.totalSections}, minmax(58px, auto));">
          <!-- 左侧作息刻度列 -->
          ${activeTimes.map(sec => `
            <div class="time-slot-cell" style="grid-column: 1; grid-row: ${sec.section};">
              <span class="section-num">${sec.section}</span>
              <span class="section-time">${sec.start}</span>
              <span class="section-time">${sec.end}</span>
            </div>
          `).join('')}
          <!-- 课程卡片动态注入层 -->
          <div class="course-cards-layer" id="courseCardsLayer"></div>
          <!-- 今日整列沉浸式聚焦高亮衬带 -->
          <div class="today-grid-highlight-strip" id="todayGridHighlight" style="display: none;"></div>
        </div>
      </div>
    `;

    this.carouselScroll = this.container.querySelector('#weekCarouselScroll');
    this.btnBackCurrentWeek = this.container.querySelector('#btnBackCurrentWeek');
    this.courseCardsLayer = this.container.querySelector('#courseCardsLayer');
    this.bindEvents();
    this.updateHeaderDates();
    this.centerActiveChip();
  }

  bindEvents() {
    this.carouselScroll.addEventListener('click', (e) => {
      const chip = e.target.closest('.week-chip');
      if (!chip) return;
      const week = parseInt(chip.dataset.week, 10);
      if (week && week !== this.selectedWeek) {
        this.setWeek(week);
      }
    });

    this.btnBackCurrentWeek.addEventListener('click', () => {
      this.setWeek(this.currentRealWeek);
    });
  }

  setWeek(week, triggerCallback = true) {
    this.selectedWeek = Number(week) || 1;
    // 关键：严禁在数据就绪前提前置空 DOM 造成白屏闪烁！旧卡片保持稳定显示，等待新卡片瞬时原子接替
    const chips = this.carouselScroll.querySelectorAll('.week-chip');
    chips.forEach(c => {
      const w = parseInt(c.dataset.week, 10);
      c.classList.toggle('active', w === this.selectedWeek);
    });

    const isNotCurrent = this.selectedWeek !== this.currentRealWeek;
    this.btnBackCurrentWeek.classList.toggle('highlight', isNotCurrent);
    this.btnBackCurrentWeek.innerHTML = `
      <span class="icon">↺</span>
      <span>${isNotCurrent ? '回本周' : '本周'}</span>
    `;
    this.updateHeaderDates();
    this.centerActiveChip();
    if (triggerCallback) {
      this.onWeekChange(this.selectedWeek);
    }
  }

  centerActiveChip() {
    const activeChip = this.carouselScroll.querySelector('.week-chip.active');
    if (activeChip) {
      const scrollLeft = activeChip.offsetLeft - (this.carouselScroll.clientWidth / 2) + (activeChip.clientWidth / 2);
      this.carouselScroll.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
    }
  }

  updateHeaderDates() {
    const dates = getWeekDates(this.selectedWeek, this.semesterStartDate, this.weekStartDay);
    const now = new Date();
    // 0=周日, 1=周一... 6=周六
    const rawDay = now.getDay();
    // 转换成列索引 1~7
    let todayCol = 1;
    if (this.weekStartDay === 'sunday') {
      todayCol = rawDay + 1; // 周日为第1列(索引1)
    } else {
      todayCol = (rawDay === 0) ? 7 : rawDay; // 周一为第1列
    }

    const isCurrentWeek = this.selectedWeek === this.currentRealWeek;
    dates.forEach((dateStr, idx) => {
      const colNum = idx + 1;
      const dateEl = this.container.querySelector(`#dayDate_${colNum}`);
      const colEl = this.container.querySelector(`#dayHeader_${colNum}`);
      if (dateEl) dateEl.textContent = dateStr;
      if (colEl) {
        const isToday = isCurrentWeek && (colNum === todayCol);
        colEl.classList.toggle('is-today', isToday);

        let badgeEl = colEl.querySelector('.today-indicator-pill');
        if (isToday) {
          if (!badgeEl) {
            badgeEl = document.createElement('span');
            badgeEl.className = 'today-indicator-pill';
            badgeEl.textContent = '今日';
            colEl.appendChild(badgeEl);
          }
        } else if (badgeEl) {
          badgeEl.remove();
        }
      }
    });

    const highlightStrip = this.container.querySelector('#todayGridHighlight');
    if (highlightStrip) {
      if (isCurrentWeek) {
        highlightStrip.style.display = 'block';
        highlightStrip.style.gridColumn = `${todayCol + 1}`;
        highlightStrip.style.gridRow = `1 / span ${this.totalSections}`;
      } else {
        highlightStrip.style.display = 'none';
      }
    }
  }

  renderCourses(cards) {
    this.courseCards = cards || [];
    if (!this.courseCardsLayer) return;

    // 空课表时瞬时置空并呈现优雅极简水印
    if (!cards || cards.length === 0) {
      this.courseCardsLayer.replaceChildren();
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'week-empty-placeholder';
      emptyDiv.innerHTML = `
        <div class="empty-icon">☕</div>
        <div class="empty-title">暂无课程安排</div>
        <div class="empty-subtitle">点击右上角【导入】开始使用</div>
      `;
      this.courseCardsLayer.appendChild(emptyDiv);
      return;
    }

    // 关键优化：在内存 DocumentFragment 中一次性装配全部节点，再由 replaceChildren 原子替换，真正 0 帧露白、零闪烁！
    const fragment = document.createDocumentFragment();

    cards.forEach((card) => {
      // 星期列计算：
      // card.dayOfWeek: 1=周一 ~ 7=周日
      let colIndex = 2; // 默认网格第2列
      if (this.weekStartDay === 'sunday') {
        // 周日排在第1个（网格第2列），周一排在第2个（网格第3列）... 周六排在第7个（网格第8列）
        colIndex = (card.dayOfWeek === 7) ? 2 : (card.dayOfWeek + 2);
      } else {
        // 周一排在第1个（网格第2列）
        colIndex = card.dayOfWeek + 1;
      }

      const startRow = card.startSection || card.startPeriod || 1;
      const span = card.stepCount || card.periodSpan || 2;
      const palette = getMorandiColor(card.name);
      const cardEl = document.createElement('div');
      const isReduced = Boolean(card.isReduced || card.adjustType === 'cancel' || card.status === 'cancelled');
      const isAdded = Boolean(card.isAdjusted || card.adjustType === 'add' || card.source === 'adjusted');

      let cardClass = `course-card span-${span}`;
      if (isReduced) {
        cardClass += ' is-reduced is-cancelled';
      } else if (isAdded) {
        cardClass += ' is-adjusted';
      }
      if (card.hasConflict) cardClass += ' has-conflict';

      cardEl.className = cardClass;
      cardEl.style.gridColumn = `${colIndex}`;
      cardEl.style.gridRow = `${startRow} / span ${span}`;
      if (isReduced) {
        cardEl.style.backgroundColor = 'rgba(241, 245, 249, 0.75)';
        cardEl.style.borderColor = '#94A3B8';
        cardEl.style.color = '#64748B';
      } else if (isAdded) {
        cardEl.style.backgroundColor = '#FFF4EE';
        cardEl.style.borderColor = '#E07A5F';
        cardEl.style.color = '#9C3D18';
      } else {
        cardEl.style.backgroundColor = palette.bg;
        cardEl.style.borderColor = palette.border;
        cardEl.style.color = palette.text;
      }
      if (card.hasConflict) {
        cardEl.style.backgroundColor = '#FEE2E2';
        cardEl.style.borderColor = '#DC2626';
        cardEl.style.color = '#991B1B';
      }

      const displayLoc = card.location ? card.location.trim() : '';
      const displayTeacher = card.teacher ? card.teacher.trim() : '';

      // 调课标记文本 (地点上方显示轻量提示)
      let adjustTagHtml = '';
      if (isReduced) {
        const tagText = card.adjustType === 'moved' ? '[调离]' : '[停课]';
        adjustTagHtml = `<div class="card-adjust-tag is-reduced-tag" style="color: #EF4444; font-weight: 700;">${escapeHtml(tagText)}</div>`;
      } else if (isAdded) {
        const tagText = card.pointerSourceText ? `[调·${card.pointerSourceText}]` : (card.adjustType === 'moved' ? '[调入]' : '[补课]');
        adjustTagHtml = `<div class="card-adjust-tag is-added-tag" style="color: #D97706; font-weight: 700;">${escapeHtml(tagText)}</div>`;
      }

      const safeName = escapeHtml(card.name || '未命名课程');
      const safeLoc = escapeHtml(displayLoc);
      const safeTeacher = escapeHtml(displayTeacher);
      const safeStartTime = escapeHtml(card.startTime || '');
      const safeEndTime = escapeHtml(card.endTime || '');

      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-name" title="${safeName}">${safeName}</div>
          <div class="card-meta">
            ${card.hasConflict ? '<div class="conflict-label">⚠ 冲突</div>' : ''}
            ${adjustTagHtml}
            ${safeLoc ? `<div class="card-loc" title="${safeLoc}">${safeLoc}</div>` : ''}
            ${span >= 2 && safeTeacher ? `<div class="card-teacher" title="${safeTeacher}">${safeTeacher}</div>` : ''}
            ${span >= 4 ? `<div class="card-time-range">${safeStartTime}-${safeEndTime}</div>` : ''}
          </div>
        </div>
      `;

      cardEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onCardClick(card);
      });
      fragment.appendChild(cardEl);
    });

    this.courseCardsLayer.replaceChildren(fragment);
  }
}
