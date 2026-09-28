import { localStore } from './storage/localStore.js';
import { idbStore } from './storage/idbStore.js';
import { DEFAULT_COURSES, SEMESTER_START_DATE, TOTAL_WEEKS } from './data/defaultSchedule.js';
import { cleanSchoolCourses } from './utils/schoolParser.js';
import { WeekView, getCurrentRealWeek } from './views/weekView.js';
import { DayView } from './views/dayView.js';
import { ImportModal } from './views/importModal.js';
import { SettingsModal } from './views/settingsModal.js';
import { CourseDetailModal } from './views/detailModal.js';
import { AiAdjustModal } from './views/aiAdjustModal.js';

// 全局挂载 Toast 提示函数
window.showToast = (msg, type = 'info') => {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const item = document.createElement('div');
  item.className = `toast-item ${type || ''}`.trim();
  item.textContent = String(msg || '');
  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity 0.3s ease';
    setTimeout(() => item.remove(), 300);
  }, 2500);
};

class CourseApp {
  constructor() {
    this.settings = localStore.getSettings();
    this.currentRealWeek = getCurrentRealWeek(this.settings.semesterStartDate || SEMESTER_START_DATE);
    this.activeWeek = this.settings.selectedWeek || this.currentRealWeek;
    this.activeMode = this.settings.viewMode || 'week'; // 'week' | 'day'
    this.weekCardsCache = new Map(); // 内存级周课表秒开缓存，切周 0ms 零闪烁
    window.courseApp = this;
    this.initDOM();
    this.initViews();
    this.initModals();
    this.bindGlobalEvents();
    // 启动 Local-First 本地离线生命周期
    this.bootstrapLifecycle();
  }

  initDOM() {
    // 头部标签按钮
    this.btnTabWeek = document.getElementById('tabWeekBtn');
    this.btnTabDay = document.getElementById('tabDayBtn');
    this.weekViewContainer = document.getElementById('weekViewContainer');
    this.dayViewContainer = document.getElementById('dayViewContainer');
    // 头部功能按钮 (导入 与 设置)
    this.btnHeaderImport = document.getElementById('btnHeaderImport') || document.getElementById('btnHeaderUpdate');
    this.btnHeaderUpdate = this.btnHeaderImport;
    this.btnHeaderSettings = document.getElementById('btnHeaderSettings');
    // 悬浮 AI 按钮
    this.btnFloatAiAdjust = document.getElementById('btnFloatAiAdjust');
  }

  initViews() {
    // 课程详情弹窗
    this.detailModal = new CourseDetailModal({
      container: document.body,
      onRevertSuccess: () => {
        this.refreshCurrentView();
        this.syncToNativeWidget();
      }
    });

    // 1. 周视图
    this.weekView = new WeekView({
      container: this.weekViewContainer,
      semesterStartDate: this.settings.semesterStartDate || SEMESTER_START_DATE,
      totalWeeks: this.settings.totalWeeks || TOTAL_WEEKS,
      totalSections: this.settings.totalSections || 10,
      sectionTimes: this.settings.sectionTimes || null,
      weekStartDay: this.settings.weekStartDay || 'monday',
      customCurrentWeek: this.settings.customCurrentWeek || null,
      onWeekChange: (week) => {
        this.activeWeek = week;
        localStore.saveSettings({ selectedWeek: week });
        this.loadWeekData(week);
      },
      onCardClick: (card) => {
        this.detailModal.show(card);
      }
    });
    this.weekView.setWeek(this.activeWeek, false);

    // 2. 日视图
    this.dayView = new DayView({
      container: this.dayViewContainer,
      semesterStartDate: this.settings.semesterStartDate || SEMESTER_START_DATE,
      totalWeeks: this.settings.totalWeeks || TOTAL_WEEKS,
      customCurrentWeek: this.settings.customCurrentWeek || null,
      sectionTimes: this.settings.sectionTimes || null,
      onDateChange: (dateStr) => {
        this.loadDayData(dateStr);
      },
      onCardClick: (card) => {
        this.detailModal.show(card);
      }
    });
    this.switchViewMode(this.activeMode, false);
  }

  initModals() {
    // 1. 本地日历/ICS 导入弹窗
    this.importModal = new ImportModal({
      container: document.body,
      onImportSuccess: (courses) => {
        this.refreshCurrentView();
        this.syncToNativeWidget(courses);
      }
    });

    // 2. AI 智能调课控制台
    this.aiAdjustModal = new AiAdjustModal({
      container: document.body,
      onAdjustSuccess: () => {
        this.refreshCurrentView();
        this.syncToNativeWidget();
      }
    });

    // 3. 设置弹窗 (包含赞助码展示与自选 AI 设置)
    this.settingsModal = new SettingsModal({
      container: document.body,
      onSettingsChange: (newSettings) => {
        this.settings = newSettings;
        this.currentRealWeek = getCurrentRealWeek(newSettings.semesterStartDate, newSettings.customCurrentWeek, newSettings.totalWeeks);
        this.activeWeek = this.currentRealWeek;
        this.weekView.updateConfig({
          semesterStartDate: newSettings.semesterStartDate,
          totalWeeks: newSettings.totalWeeks,
          totalSections: newSettings.totalSections,
          sectionTimes: newSettings.sectionTimes,
          weekStartDay: newSettings.weekStartDay,
          customCurrentWeek: newSettings.customCurrentWeek
        });
        this.dayView.updateConfig({
          semesterStartDate: newSettings.semesterStartDate,
          totalWeeks: newSettings.totalWeeks,
          customCurrentWeek: newSettings.customCurrentWeek,
          sectionTimes: newSettings.sectionTimes
        });
        this.refreshCurrentView();
        this.syncToNativeWidget();
      }
    });
  }

  bindGlobalEvents() {
    // 视图切换
    if (this.btnTabWeek) this.btnTabWeek.addEventListener('click', () => this.switchViewMode('week'));
    if (this.btnTabDay) this.btnTabDay.addEventListener('click', () => this.switchViewMode('day'));

    // 顶栏按钮：导入 与 设置
    if (this.btnHeaderImport) {
      this.btnHeaderImport.addEventListener('click', () => {
        if (this.importModal) this.importModal.open();
      });
    }
    if (this.btnHeaderSettings) {
      this.btnHeaderSettings.addEventListener('click', () => {
        if (this.settingsModal) this.settingsModal.open();
      });
    }

    // 悬浮 AI 智能调课按钮
    if (this.btnFloatAiAdjust) {
      const openAiModal = (e) => {
        if (e && e.type === 'touchend') {
          e.preventDefault();
        }
        if (this.aiAdjustModal) this.aiAdjustModal.open();
      };
      this.btnFloatAiAdjust.addEventListener('click', openAiModal);
      this.btnFloatAiAdjust.addEventListener('touchend', openAiModal, { passive: false });
    }

    // 监听切回前台事件
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.dayView) {
          this.dayView.updateNowIndicator();
          this.dayView.refreshStatus();
        }
      }
    });

    // 接管 Android 硬件返回键、手势侧滑返回与键盘 Escape
    window.handleSystemBackPress = () => this.handleBackAction();
    window.addEventListener('popstate', () => this.handleBackAction());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.handleBackAction();
      }
    });

    // 全局接收 Android 原生自动化教务课表同步回调
    window.onNativeSchoolScheduleReceived = async (jsonRows) => {
      try {
        const rawRows = typeof jsonRows === 'string' ? JSON.parse(jsonRows) : jsonRows;
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
          if (window.showToast) window.showToast('未能提取到有效排课，请重试', 'error');
          return;
        }
        const courses = cleanSchoolCourses(rawRows);
        let detectedMaxWeek = 16;
        courses.forEach(c => {
          const ew = Number(c.endWeek || 0);
          if (ew > detectedMaxWeek) detectedMaxWeek = ew;
        });
        localStore.saveSettings({ totalWeeks: detectedMaxWeek });
        if (this.weekView) this.weekView.updateConfig({ totalWeeks: detectedMaxWeek });

        await idbStore.saveCourses(courses, true);
        const settings = localStore.getSettings();
        const week = settings.selectedWeek || 1;
        const weekCards = await idbStore.getCoursesByWeek(week);
        localStore.saveWeekSnapshot(week, weekCards);

        if (this.importModal) this.importModal.close();
        await this.refreshCurrentView();
        this.syncToNativeWidget(courses);
        if (window.showToast) {
          window.showToast(`🎉 成功同步 ${courses.length} 门晓庄专属课表！`, 'success');
        }
      } catch (err) {
        console.error('[NativeSchoolSchedule] 处理异常:', err);
        if (window.showToast) window.showToast('课表同步异常: ' + err.message, 'error');
      }
    };
  }

  handleBackAction() {
    const isModalOpen = (m) => {
      if (!m) return false;
      try {
        if (typeof m.isOpen === 'function') return m.isOpen();
        if (typeof m.isOpen === 'boolean') return m.isOpen;
        if (typeof m._isOpen === 'boolean') return m._isOpen;
        if (m.modalEl && m.modalEl.style.display && m.modalEl.style.display !== 'none') return true;
        if (m.overlay && m.overlay.style.display && m.overlay.style.display !== 'none') return true;
        if (m.pageEl && m.pageEl.style.display && m.pageEl.style.display !== 'none') return true;
      } catch (e) {}
      return false;
    };

    // Level 1: 顶层临时底部选择器
    const activePicker = document.querySelector('.picker-sheet-backdrop');
    if (activePicker) {
      activePicker.remove();
      return true;
    }

    // Level 2: 弹出的覆盖层弹窗
    if (isModalOpen(this.aiAdjustModal)) {
      this.aiAdjustModal.close();
      return true;
    }
    if (isModalOpen(this.detailModal)) {
      this.detailModal.close();
      return true;
    }
    if (isModalOpen(this.importModal)) {
      this.importModal.close();
      return true;
    }
    if (this.settingsModal && isModalOpen(this.settingsModal)) {
      if (typeof this.settingsModal.isSubViewOpen === 'function' && this.settingsModal.isSubViewOpen()) {
        this.settingsModal.closeSubTimeView();
        return true;
      }
      this.settingsModal.close();
      return true;
    }

    // Level 3: 课表主视图状态回退
    if (this.activeMode === 'week' && this.activeWeek !== this.currentRealWeek) {
      this.activeWeek = this.currentRealWeek;
      this.weekView.setWeek(this.currentRealWeek, true);
      localStore.saveSettings({ selectedWeek: this.currentRealWeek });
      if (window.showToast) {
        window.showToast(`已返回当前周 (第 ${this.currentRealWeek} 周)`, 'info');
      }
      return true;
    }

    if (this.activeMode === 'day') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const curDateStr = this.dayView.currentDate.toISOString().slice(0, 10);
      if (curDateStr !== todayStr) {
        this.dayView.setDate(new Date());
        this.loadDayData(todayStr);
        if (window.showToast) window.showToast('已返回今日课程', 'info');
        return true;
      }
    }

    // 首页双击防误触退回桌面后台
    const now = Date.now();
    if (this.lastBackPressTime && (now - this.lastBackPressTime < 2000)) {
      if (window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.minimizeApp === 'function') {
        window.AndroidWidgetBridge.minimizeApp();
      }
    } else {
      this.lastBackPressTime = now;
      if (window.showToast) {
        window.showToast('再按一次返回键退出课程表', 'info');
      }
    }
    return true;
  }

  async bootstrapLifecycle() {
    console.info('[Bootstrap] 启动纯单机 Local-First 0ms 秒开引擎...');
    // 阶段 1: 同步快照直出
    const snapshot = localStore.getWeekSnapshot(this.activeWeek);
    if (snapshot && Array.isArray(snapshot.courses) && snapshot.courses.length > 0) {
      this.weekView.renderCourses(snapshot.courses);
    }

    // 阶段 2: 异步 IndexedDB 初始化与数据自愈
    try {
      // 纯净初次体验：默认保持空白课表，不主动插入任何假课程
      await idbStore.init();
      await this.refreshCurrentView();
      this.syncToNativeWidget();
      this.warmUpWeekCache();
    } catch (err) {
      console.warn('[Bootstrap] 本地数据库唤醒异常:', err);
    }
  }

  applySemesterStart(startDate) {
    if (!startDate) return;
    localStore.clearWeekSnapshots();
    this.settings.semesterStartDate = startDate;
    localStore.saveSettings({ semesterStartDate: startDate });
    this.currentRealWeek = getCurrentRealWeek(startDate, this.settings.customCurrentWeek, this.settings.totalWeeks);
    this.activeWeek = this.currentRealWeek;
    this.weekView.updateConfig({ semesterStartDate: startDate });
    this.dayView.updateConfig({ semesterStartDate: startDate });
    this.refreshCurrentView();
  }

  clearWeekCache() {
    if (this.weekCardsCache) {
      this.weekCardsCache.clear();
    }
  }

  async warmUpWeekCache() {
    try {
      if (!this.weekCardsCache) {
        this.weekCardsCache = new Map();
      }
      const total = Number(this.settings.totalWeeks) || 20;
      const baseStart = this.settings.semesterStartDate || SEMESTER_START_DATE;
      for (let w = 1; w <= total; w++) {
        idbStore.getMergedScheduleByWeek(w, baseStart).then(cards => {
          this.weekCardsCache.set(w, cards || []);
        });
      }
    } catch (e) {}
  }

  async loadWeekData(week) {
    try {
      if (this.weekCardsCache && this.weekCardsCache.has(week)) {
        const cachedCards = this.weekCardsCache.get(week);
        this.weekView.renderCourses(cachedCards);
        return;
      }
      const baseStart = this.settings.semesterStartDate || SEMESTER_START_DATE;
      const cards = await idbStore.getMergedScheduleByWeek(week, baseStart);
      if (this.weekCardsCache) {
        this.weekCardsCache.set(week, cards);
      }
      this.weekView.renderCourses(cards);
      localStore.saveWeekSnapshot(week, cards);
    } catch (err) {
      console.error('[App] loadWeekData 失败:', err);
    }
  }

  async loadDayData(dateStr) {
    try {
      const baseStart = this.settings.semesterStartDate || SEMESTER_START_DATE;
      const dayCards = await idbStore.getMergedScheduleByDate(dateStr, baseStart);
      this.dayView.renderCourses(dayCards);
    } catch (err) {
      console.error('[App] loadDayData 失败:', err);
    }
  }

  async refreshCurrentView() {
    this.clearWeekCache();
    if (this.activeMode === 'week') {
      await this.loadWeekData(this.activeWeek);
    } else {
      const curDateStr = this.dayView ? this.dayView.currentDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      await this.loadDayData(curDateStr);
    }
  }

  switchViewMode(mode, refresh = true) {
    this.activeMode = mode;
    localStore.saveSettings({ viewMode: mode });

    if (mode === 'week') {
      this.btnTabWeek.classList.add('active');
      this.btnTabDay.classList.remove('active');
      this.weekViewContainer.style.display = 'block';
      this.dayViewContainer.style.display = 'none';
      if (refresh) this.loadWeekData(this.activeWeek);
    } else {
      this.btnTabDay.classList.add('active');
      this.btnTabWeek.classList.remove('active');
      this.dayViewContainer.style.display = 'block';
      this.weekViewContainer.style.display = 'none';
      if (refresh) {
        const curDateStr = this.dayView ? this.dayView.currentDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        this.loadDayData(curDateStr);
      }
    }
  }

  async syncToNativeWidget(allCourses = null) {
    try {
      if (typeof window !== 'undefined' && window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.updateWidgetData === 'function') {
        let coursesToSync = allCourses;
        if (!coursesToSync) {
          coursesToSync = await idbStore.getAllCourses();
        }
        const semesterStart = this.settings.semesterStartDate || SEMESTER_START_DATE;
        const totalWeeks = Number(this.settings.totalWeeks) || 20;
        const jsonPayload = JSON.stringify(coursesToSync || []);
        window.AndroidWidgetBridge.updateWidgetData(jsonPayload, semesterStart, totalWeeks);
      }
    } catch (err) {
      console.warn('[Widget] 原生小组件桥接同步轻量异常 (非Android环境忽略):', err);
    }
  }
}

// 页面加载完成后启动单机 App
document.addEventListener('DOMContentLoaded', () => {
  new CourseApp();
});
