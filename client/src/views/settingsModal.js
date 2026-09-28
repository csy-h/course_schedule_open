import { localStore, DEFAULT_SECTION_TIMES } from '../storage/localStore.js';
import { idbStore } from '../storage/idbStore.js';
import { DEFAULT_COURSES } from '../data/defaultSchedule.js';
import { normalizeAiBaseUrl, safeFetch } from '../utils/aiEndpoint.js';

export class SettingsModal {
  constructor(options) {
    this.container = options.container;
    this.onSettingsChange = options.onSettingsChange || (() => {});
    this.currentSettings = localStore.getSettings();
    this.tempSectionTimes = JSON.parse(JSON.stringify(this.currentSettings.sectionTimes || DEFAULT_SECTION_TIMES));
    this.initSkeleton();
  }

  initSkeleton() {
    this.pageEl = document.createElement('div');
    this.pageEl.className = 'full-settings-page';
    this.pageEl.id = 'fullSettingsPage';
    this.pageEl.style.display = 'none';

    this.pageEl.innerHTML = `
      <!-- 主设置页面 -->
      <div id="mainSettingsContainer" style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;">
        <div class="full-settings-header">
          <button class="btn-page-nav-back" id="btnSettingsNavBack">
            <span style="font-size: 20px; line-height: 1;">‹</span>
            <span>返回课表</span>
          </button>
          <span class="full-settings-title">课表与系统设置</span>
          <button class="btn-page-save" id="btnSettingsMainSave">保存</button>
        </div>

        <div class="full-settings-content">
          <!-- 分组 1: 课表导入 -->
          <div class="settings-section-divider" style="margin-top: 2px;">
            <span class="settings-section-title">📥 课表导入</span>
          </div>

          <div class="settings-group-card" style="padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" id="rowSettingsOpenIcs">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">📥</span>
                <div>
                  <div style="font-size: 14px; font-weight: 600; color: var(--text-main);">导入课表文件</div>
                  <div style="font-size: 11.5px; color: var(--text-muted);">支持 WakeUp 课程表 · 标准 RFC 5545 ICS 日历文件</div>
                </div>
              </div>
              <span class="settings-cell-arrow">›</span>
            </div>
          </div>

          <!-- 分组 2: 课表与学期参数 -->
          <div class="settings-section-divider">
            <span class="settings-section-title">📅 课表与学期参数</span>
          </div>

          <div class="settings-group-card">
            <!-- 1. 上课时间 -->
            <div class="settings-cell" id="rowSectionTimes">
              <div class="settings-cell-label">上课时间作息</div>
              <div class="settings-cell-value clickable">
                <span>点击此处更改</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>

            <!-- 2. 开学时间 -->
            <div class="settings-cell" id="rowSemesterStart">
              <div class="settings-cell-label">开学时间</div>
              <div class="settings-cell-value clickable">
                <span id="valSemesterStart">2026-09-07</span>
                <span class="settings-cell-arrow">›</span>
                <input type="date" id="inputHiddenStartDate" style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0;" />
              </div>
            </div>

            <!-- 3. 每周起始日 -->
            <div class="settings-cell" id="rowWeekStartDay">
              <div class="settings-cell-label">每周起始日</div>
              <div class="settings-cell-value clickable">
                <span id="valWeekStartDay">星期一</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>

            <!-- 4. 当前周 -->
            <div class="settings-cell" id="rowCurrentWeek">
              <div class="settings-cell-label">当前周</div>
              <div class="settings-cell-value clickable">
                <span id="valCurrentWeek">第 1 周</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>

            <!-- 5. 一天课程节数 -->
            <div class="settings-cell" id="rowTotalSections">
              <div class="settings-cell-label">一天课程节数</div>
              <div class="settings-cell-value clickable">
                <span id="valTotalSections">10 节</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>

            <!-- 6. 学期周数 -->
            <div class="settings-cell" id="rowTotalWeeks">
              <div class="settings-cell-label">学期周数</div>
              <div class="settings-cell-value clickable">
                <span id="valTotalWeeks">20 周</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>
          </div>

          <!-- 分组 3: AI 调课配置 (选填) -->
          <div class="settings-section-divider">
            <span class="settings-section-title">🤖 AI 调课设置 (选填)</span>
          </div>

          <div class="settings-group-card" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
            <div>
              <div style="font-size: 12.5px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">API Key</div>
              <input type="password" id="inputSettingAiKey" placeholder="" class="form-input" style="font-size: 13px; width: 100%; box-sizing: border-box;" autocomplete="off" spellcheck="false" />
            </div>
            <div>
              <div style="font-size: 12.5px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">API 端点</div>
              <input type="text" id="inputSettingAiUrl" placeholder="" class="form-input" style="font-size: 13px; width: 100%; box-sizing: border-box;" autocomplete="off" spellcheck="false" />
            </div>
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 12.5px; font-weight: 600; color: var(--text-main);">模型名称</span>
                <button type="button" id="btnFetchAiModels" style="background: none; border: none; color: #2563EB; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0;">获取模型列表</button>
              </div>
              <input type="text" id="inputSettingAiModel" placeholder="" class="form-input" style="font-size: 13px; width: 100%; box-sizing: border-box;" autocomplete="off" spellcheck="false" />
              <select id="selectSettingAiModel" class="form-input" style="display: none; font-size: 12.5px; width: 100%; box-sizing: border-box; margin-top: 6px; background-color: var(--card-bg, #ffffff);"></select>
            </div>
          </div>

          <!-- 分组 4: 课表管理与备份 -->
          <div class="settings-section-divider">
            <span class="settings-section-title">📅 课表管理与备份</span>
          </div>

          <div class="settings-group-card" style="padding: 12px 16px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13.5px; font-weight: 600; color: var(--text-main);">导出当前课表 (.ics)</span>
              <button class="btn-primary" id="btnExportIcs" style="height: 32px; padding: 0 14px; font-size: 12px;">导出</button>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px;">
              <span style="font-size: 13.5px; font-weight: 600; color: #DC2626;">清空当前所有课程</span>
              <button id="btnClearAllCourses" style="height: 32px; padding: 0 14px; font-size: 12px; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; border-radius: 8px; cursor: pointer; font-weight: 600;">清空</button>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px;">
              <span style="font-size: 13.5px; font-weight: 600; color: var(--text-main);">载入示例测试课表</span>
              <button id="btnLoadDemoCourses" style="height: 32px; padding: 0 14px; font-size: 12px; background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; border-radius: 8px; cursor: pointer; font-weight: 600;">载入</button>
            </div>
          </div>

          <!-- 分组 5: 赞助支持 (做小点，紧贴版本信息上方，点击才弹二维码) -->
          <div class="settings-section-divider">
            <span class="settings-section-title">☕ 赞助支持</span>
          </div>

          <div class="settings-group-card" style="padding: 0;">
            <div class="settings-cell clickable" id="btnPreviewSponsorQr">
              <div class="settings-cell-label" style="display: flex; align-items: center; gap: 8px;">
                <span>☕</span>
                <span>赞助开发者</span>
              </div>
              <div class="settings-cell-value">
                <span style="font-size: 12px; color: var(--text-muted);">自愿赞助支持</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>
          </div>

          <!-- 分组 6: 关于 -->
          <div class="settings-section-divider">
            <span class="settings-section-title">ℹ️ 关于</span>
          </div>

          <div class="settings-group-card" style="padding: 12px 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-size: 14px; font-weight: 600; color: var(--text-main);">Course Schedule</div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">纯本地离线单机版 · 保护隐私</div>
              </div>
              <span id="labelCurrentVersion" style="background: var(--primary-light); color: var(--primary-color); font-weight: 700; font-size: 12px; padding: 3px 8px; border-radius: 8px;">v2.2.6</span>
            </div>
          </div>

          <!-- 底部留白保证在全面屏手机上能完全滑到底部 -->
          <div style="height: 60px;"></div>
        </div>
      </div>

      <!-- 子设置页面: 上课时间设置 -->
      <div id="subTimeSettingsContainer" style="display: none; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;">
        <div class="full-settings-header">
          <button class="btn-page-nav-back" id="btnSubTimeBack">
            <span style="font-size: 20px; line-height: 1;">‹</span>
            <span>返回</span>
          </button>
          <span class="full-settings-title">上课时间设置</span>
          <button class="btn-page-save" id="btnSubTimeSave">保存</button>
        </div>

        <div class="full-settings-content">
          <!-- 顶部联动卡片 -->
          <div class="settings-group-card">
            <div class="settings-cell" style="cursor: default;">
              <div class="settings-cell-main">
                <span class="settings-cell-label">固定上课时长</span>
                <span class="settings-cell-sub">修改上课时间会跟随联动</span>
              </div>
              <label class="switch-control">
                <input type="checkbox" id="switchFixedDuration" />
                <span class="switch-slider"></span>
              </label>
            </div>

            <div class="settings-cell" id="rowDurationMinutes">
              <div class="settings-cell-label">每节课时长 (分钟)</div>
              <div class="settings-cell-value clickable">
                <span id="valDurationMinutes">45分钟</span>
                <span class="settings-cell-arrow">›</span>
              </div>
            </div>
          </div>

          <!-- 节次时间列表标题与操作 -->
          <div class="section-list-header">
            <span class="section-list-hint">请注意是 24 小时制！</span>
            <button class="btn-add-section" id="btnAddSection">
              <span>➕</span> <span>添加</span>
            </button>
          </div>

          <!-- 节次列表容器 -->
          <div class="settings-group-card" id="sectionItemsContainer"></div>

          <div style="display: flex; justify-content: center; margin-top: 10px; margin-bottom: 50px;">
            <button class="btn-text-danger" id="btnResetDefaultTimes" style="font-size: 13px; font-weight: 600;">
              🔄 恢复默认作息时间
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.pageEl);

    // 页面与容器元素
    this.mainContainer = this.pageEl.querySelector('#mainSettingsContainer');
    this.subTimeContainer = this.pageEl.querySelector('#subTimeSettingsContainer');

    // 导航按键
    this.btnNavBack = this.pageEl.querySelector('#btnSettingsNavBack');
    this.btnMainSave = this.pageEl.querySelector('#btnSettingsMainSave');
    this.btnSubTimeBack = this.pageEl.querySelector('#btnSubTimeBack');
    this.btnSubTimeSave = this.pageEl.querySelector('#btnSubTimeSave');

    // 课表参数元素
    this.valSemesterStart = this.pageEl.querySelector('#valSemesterStart');
    this.inputHiddenStartDate = this.pageEl.querySelector('#inputHiddenStartDate');
    this.valWeekStartDay = this.pageEl.querySelector('#valWeekStartDay');
    this.valCurrentWeek = this.pageEl.querySelector('#valCurrentWeek');
    this.valTotalSections = this.pageEl.querySelector('#valTotalSections');
    this.valTotalWeeks = this.pageEl.querySelector('#valTotalWeeks');

    // 作息时间元素
    this.switchFixedDuration = this.pageEl.querySelector('#switchFixedDuration');
    this.valDurationMinutes = this.pageEl.querySelector('#valDurationMinutes');
    this.sectionItemsContainer = this.pageEl.querySelector('#sectionItemsContainer');
    this.btnAddSection = this.pageEl.querySelector('#btnAddSection');
    this.btnResetDefaultTimes = this.pageEl.querySelector('#btnResetDefaultTimes');

    this.labelCurrentVersion = this.pageEl.querySelector('#labelCurrentVersion');

    this.bindEvents();
  }

  // 通用底部选择器模态面板
  showPickerSheet({ title, options, current, onSelect }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'picker-sheet-backdrop';

    const card = document.createElement('div');
    card.className = 'picker-sheet-card';

    card.innerHTML = `
      <div class="picker-sheet-header">
        <span class="picker-sheet-title">${title}</span>
        <button class="picker-sheet-close">✕</button>
      </div>
      <div class="picker-sheet-body">
        ${options.map(opt => `
          <div class="picker-option-item ${opt.value === current ? 'selected' : ''}" data-val="${opt.value}">
            <span class="picker-option-label">${opt.label}</span>
            ${opt.value === current ? '<span class="picker-option-check">✓</span>' : ''}
          </div>
        `).join('')}
      </div>
    `;

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const closeSheet = () => {
      backdrop.style.opacity = '0';
      backdrop.style.transition = 'opacity 0.15s ease';
      setTimeout(() => backdrop.remove(), 150);
    };

    card.querySelector('.picker-sheet-close').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet();
    });

    card.querySelector('.picker-sheet-body').addEventListener('click', (e) => {
      const item = e.target.closest('.picker-option-item');
      if (!item) return;
      const val = item.dataset.val;
      closeSheet();
      onSelect(val);
    });
  }

  // 全屏放大赞赏码预览
  showSponsorPreviewModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.style.zIndex = '9999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.background = 'rgba(0, 0, 0, 0.75)';

    modal.innerHTML = `
      <div style="background: #ffffff; border-radius: 20px; padding: 24px; text-align: center; max-width: 85vw; box-shadow: 0 10px 30px rgba(0,0,0,0.3); animation: popIn 0.2s ease;">
        <div style="font-size: 16px; font-weight: 700; color: #333; margin-bottom: 6px;">微信扫一扫赞赏作者</div>
        <div style="font-size: 12px; color: #666; margin-bottom: 16px;">可截图后在微信扫码，非常感谢您的认可与支持！</div>
        <img src="./src/assets/sponsor_qrcode.jpg" alt="微信赞赏码" style="width: 240px; height: 240px; object-fit: contain; border-radius: 12px; display: block; margin: 0 auto;" />
        <button style="margin-top: 18px; width: 100%; height: 38px; border-radius: 19px; background: #f0f0f0; border: none; font-size: 13px; font-weight: 600; color: #555; cursor: pointer;">
          关闭
        </button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', () => modal.remove());
  }

  bindEvents() {
    // 返回主课表
    if (this.btnNavBack) {
      this.btnNavBack.addEventListener('click', () => {
        if (this.isSubViewOpen()) {
          this.closeSubTimeView();
        } else {
          this.close();
        }
      });
    }

    // 保存主设置
    if (this.btnMainSave) {
      this.btnMainSave.addEventListener('click', () => {
        this.saveMainSettings();
      });
    }

    // 点击赞赏码放大预览
    const btnSponsor = this.pageEl.querySelector('#btnPreviewSponsorQr');
    if (btnSponsor) {
      btnSponsor.addEventListener('click', () => {
        this.showSponsorPreviewModal();
      });
    }

    // 导出当前课表为 .ics 文件
    const btnExport = this.pageEl.querySelector('#btnExportIcs');
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        await this.handleExportIcs();
      });
    }

    // 清空所有课程
    const btnClearCourses = this.pageEl.querySelector('#btnClearAllCourses');
    if (btnClearCourses) {
      btnClearCourses.addEventListener('click', async () => {
        if (!confirm('确定要清空当前所有课程与调课记录吗？清空后课表将重置为空白状态。')) return;
        try {
          await idbStore.clearAllCourses();
          localStore.clearWeekSnapshots();
          if (window.courseApp) {
            await window.courseApp.refreshCurrentView();
            window.courseApp.syncToNativeWidget([]);
          }
          if (window.showToast) window.showToast('课表已成功清空', 'success');
        } catch (e) {
          if (window.showToast) window.showToast('清空失败: ' + e.message, 'error');
        }
      });
    }

    // 载入示例测试课表
    const btnLoadDemo = this.pageEl.querySelector('#btnLoadDemoCourses');
    if (btnLoadDemo) {
      btnLoadDemo.addEventListener('click', async () => {
        try {
          await idbStore.saveCourses(DEFAULT_COURSES, true);
          localStore.clearWeekSnapshots();
          if (window.courseApp) {
            await window.courseApp.refreshCurrentView();
            window.courseApp.syncToNativeWidget(DEFAULT_COURSES);
          }
          if (window.showToast) window.showToast('已载入示例测试课表', 'success');
        } catch (e) {
          if (window.showToast) window.showToast('载入失败: ' + e.message, 'error');
        }
      });
    }

    // 设置页内调起课表导入
    const rowSettingsIcs = this.pageEl.querySelector('#rowSettingsOpenIcs');
    if (rowSettingsIcs) {
      rowSettingsIcs.addEventListener('click', () => {
        if (window.courseApp && window.courseApp.importModal) {
          window.courseApp.importModal.open();
        }
      });
    }

    // 进入与退出上课时间子设置
    const rowSectionTimes = this.pageEl.querySelector('#rowSectionTimes');
    if (rowSectionTimes) {
      rowSectionTimes.addEventListener('click', () => {
        this.openSubTimeView();
      });
    }
    if (this.btnSubTimeBack) {
      this.btnSubTimeBack.addEventListener('click', () => {
        this.closeSubTimeView();
      });
    }
    if (this.btnSubTimeSave) {
      this.btnSubTimeSave.addEventListener('click', () => {
        this.saveSubTimeSettings();
        this.closeSubTimeView();
      });
    }

    // 1. 开学时间设置
    const rowSemesterStart = this.pageEl.querySelector('#rowSemesterStart');
    if (rowSemesterStart && this.inputHiddenStartDate) {
      rowSemesterStart.addEventListener('click', () => {
        if (typeof this.inputHiddenStartDate.showPicker === 'function') {
          this.inputHiddenStartDate.showPicker();
        } else {
          this.inputHiddenStartDate.focus();
          this.inputHiddenStartDate.click();
        }
      });

      this.inputHiddenStartDate.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          this.currentSettings.semesterStartDate = val;
          this.valSemesterStart.textContent = val;
          if (window.showToast) window.showToast(`开学时间已调整为: ${val}`);
        }
      });
    }

    // 2. 每周起始日
    this.pageEl.querySelector('#rowWeekStartDay').addEventListener('click', () => {
      this.showPickerSheet({
        title: '选择每周起始日',
        current: this.currentSettings.weekStartDay || 'monday',
        options: [
          { label: '星期一 (大学标准习惯)', value: 'monday' },
          { label: '星期日 (西方历法习惯)', value: 'sunday' }
        ],
        onSelect: (val) => {
          this.currentSettings.weekStartDay = val;
          this.valWeekStartDay.textContent = (val === 'sunday') ? '星期日' : '星期一';
          if (window.showToast) window.showToast(`已设置为从【${this.valWeekStartDay.textContent}】开始`);
        }
      });
    });

    // 3. 当前周手动校准
    this.pageEl.querySelector('#rowCurrentWeek').addEventListener('click', () => {
      const opts = [
        { label: '🔄 自动计算 (跟随开学时间)', value: 'auto' },
        ...Array.from({ length: 25 }, (_, i) => ({
          label: `第 ${i + 1} 周 ${i === 0 ? '(开学首周)' : ''}`,
          value: String(i + 1)
        }))
      ];
      const curVal = this.currentSettings.customCurrentWeek ? String(this.currentSettings.customCurrentWeek) : 'auto';

      this.showPickerSheet({
        title: '设置当前周次',
        current: curVal,
        options: opts,
        onSelect: (val) => {
          if (val === 'auto') {
            this.currentSettings.customCurrentWeek = null;
            this.valCurrentWeek.textContent = '自动计算';
            if (window.showToast) window.showToast('已恢复为根据开学日期自动计算周次');
          } else {
            const num = parseInt(val, 10);
            this.currentSettings.customCurrentWeek = num;
            this.valCurrentWeek.textContent = `第 ${num} 周`;
            if (window.showToast) window.showToast(`已手动锁定当前周为第 ${num} 周`);
          }
        }
      });
    });

    // 4. 一天课程节数设置
    this.pageEl.querySelector('#rowTotalSections').addEventListener('click', () => {
      const opts = [
        { label: '8 节课 (常规4上午+4下午)', value: '8' },
        { label: '10 节课 (标准4上午+4下午+2晚自习)', value: '10' },
        { label: '12 节课 (丰富5上午+5下午+2晚课)', value: '12' },
        { label: '14 节课 (全天作息)', value: '14' },
        { label: '16 节课', value: '16' },
        { label: '20 节课 (超长作息)', value: '20' }
      ];
      const cur = String(this.currentSettings.totalSections || 10);

      this.showPickerSheet({
        title: '选择一天课程节数',
        current: cur,
        options: opts,
        onSelect: (val) => {
          const num = parseInt(val, 10);
          this.currentSettings.totalSections = num;
          this.valTotalSections.textContent = `${num} 节`;
          if (window.showToast) window.showToast(`一天课程节数已设置为 ${num} 节`);
        }
      });
    });

    // 5. 学期周数设置
    this.pageEl.querySelector('#rowTotalWeeks').addEventListener('click', () => {
      const opts = [
        { label: '16 周 (短学期)', value: '16' },
        { label: '18 周 (常见高校学期)', value: '18' },
        { label: '20 周 (标准完整学期)', value: '20' },
        { label: '22 周 (长学期)', value: '22' },
        { label: '25 周 (超长学期)', value: '25' }
      ];
      const cur = String(this.currentSettings.totalWeeks || 20);

      this.showPickerSheet({
        title: '选择学期总周数',
        current: cur,
        options: opts,
        onSelect: (val) => {
          const num = parseInt(val, 10);
          this.currentSettings.totalWeeks = num;
          this.valTotalWeeks.textContent = `${num} 周`;
          if (window.showToast) window.showToast(`学期周数已设置为 ${num} 周`);
        }
      });
    });

    // 固定时长开关
    if (this.switchFixedDuration) {
      this.switchFixedDuration.addEventListener('change', (e) => {
        this.currentSettings.fixedDurationEnabled = e.target.checked;
      });
    }

    // 每节课时长
    const rowDurationMinutes = this.pageEl.querySelector('#rowDurationMinutes');
    if (rowDurationMinutes) {
      rowDurationMinutes.addEventListener('click', () => {
        const opts = [
          { label: '40 分钟', value: '40' },
          { label: '45 分钟 (大学标准推荐)', value: '45' },
          { label: '50 分钟', value: '50' },
          { label: '60 分钟', value: '60' },
          { label: '90 分钟 (大节连上)', value: '90' }
        ];
        const cur = String(this.currentSettings.sectionDurationMinutes || 45);

        this.showPickerSheet({
          title: '选择每节课时长',
          current: cur,
          options: opts,
          onSelect: (val) => {
            const num = parseInt(val, 10);
            this.currentSettings.sectionDurationMinutes = num;
            if (this.valDurationMinutes) this.valDurationMinutes.textContent = `${num}分钟`;
            if (this.currentSettings.fixedDurationEnabled) {
              this.recalculateAllEndTimes();
            }
            if (window.showToast) window.showToast(`单节时长已设置为 ${num} 分钟`);
          }
        });
      });
    }

    // 添加节次
    if (this.btnAddSection) {
      this.btnAddSection.addEventListener('click', () => {
        const nextSec = this.tempSectionTimes.length + 1;
        let start = '20:30';
        let end = '21:15';
        if (this.tempSectionTimes.length > 0) {
          const last = this.tempSectionTimes[this.tempSectionTimes.length - 1];
          start = this.addMinutes(last.end, 10);
          end = this.addMinutes(start, this.currentSettings.sectionDurationMinutes || 45);
        }
        this.tempSectionTimes.push({ section: nextSec, start, end });
        this.renderSectionItems();
      });
    }

    // 恢复默认作息
    if (this.btnResetDefaultTimes) {
      this.btnResetDefaultTimes.addEventListener('click', () => {
        this.tempSectionTimes = JSON.parse(JSON.stringify(DEFAULT_SECTION_TIMES));
        this.renderSectionItems();
        if (window.showToast) window.showToast('已恢复为标准 1-10 节作息时间');
      });
    }

    // 获取模型列表并导入
    const btnFetchModels = this.pageEl.querySelector('#btnFetchAiModels');
    const selectModel = this.pageEl.querySelector('#selectSettingAiModel');
    const inputModel = this.pageEl.querySelector('#inputSettingAiModel');
    const inputKey = this.pageEl.querySelector('#inputSettingAiKey');
    const inputUrl = this.pageEl.querySelector('#inputSettingAiUrl');

    if (btnFetchModels && selectModel && inputModel) {
      btnFetchModels.addEventListener('click', async () => {
        const apiKey = (inputKey ? inputKey.value.trim() : '') || localStore.getApiKey();
        const rawUrl = (inputUrl ? inputUrl.value.trim() : '') || (this.currentSettings.deepseekApiUrl || 'https://api.deepseek.com');

        if (!apiKey) {
          if (window.showToast) window.showToast('请先输入 API Key', 'error');
          if (inputKey) inputKey.focus();
          return;
        }

        btnFetchModels.disabled = true;
        btnFetchModels.textContent = '正在获取...';

        try {
          const base = normalizeAiBaseUrl(rawUrl);
          const endpoints = [];
          if (base.endsWith('/v1')) {
            endpoints.push(`${base}/models`);
            endpoints.push(`${base.slice(0, -3)}/models`);
          } else {
            endpoints.push(`${base}/v1/models`);
            endpoints.push(`${base}/models`);
          }

          let models = null;
          let lastErr = null;

          for (const ep of endpoints) {
            try {
              const res = await safeFetch(ep, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                  'Authorization': `Bearer ${apiKey}`
                }
              });
              if (res.ok) {
                const data = await res.json().catch(() => null);
                let list = null;
                if (data && Array.isArray(data.data)) {
                  list = data.data;
                } else if (data && Array.isArray(data.models)) {
                  list = data.models;
                } else if (Array.isArray(data)) {
                  list = data;
                }
                if (list && list.length > 0) {
                  models = list;
                  break;
                }
              } else {
                const errText = await res.text().catch(() => '');
                lastErr = new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`);
              }
            } catch (fetchErr) {
              lastErr = fetchErr;
            }
          }

          if (!models || models.length === 0) {
            throw lastErr || new Error('未获取到模型列表，请确认端点与 Key 是否正确');
          }

          selectModel.replaceChildren();
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = '-- 点击选择模型直接导入 --';
          selectModel.appendChild(placeholder);
          let count = 0;
          for (const model of models) {
            const modelId = typeof model === 'string' ? model : (model?.id || model?.name || model?.model);
            if (!modelId || typeof modelId !== 'string') continue;
            const option = document.createElement('option');
            option.value = modelId;
            option.textContent = modelId;
            selectModel.appendChild(option);
            count++;
          }
          selectModel.style.display = 'block';

          if (window.showToast) window.showToast(`成功获取 ${count} 个模型`, 'success');
        } catch (e) {
          if (window.showToast) window.showToast(`获取失败: ${e.message}`, 'error');
        } finally {
          btnFetchModels.disabled = false;
          btnFetchModels.textContent = '获取模型列表';
        }
      });

      selectModel.addEventListener('change', () => {
        if (selectModel.value) {
          inputModel.value = selectModel.value;
          if (window.showToast) window.showToast(`已选定模型: ${selectModel.value}`, 'info');
        }
      });
    }
  }

  async handleExportIcs() {
    try {
      const courses = await idbStore.getCourses();
      if (!courses || courses.length === 0) {
        if (window.showToast) window.showToast('当前暂无排课数据可导出', 'info');
        return;
      }

      let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CourseSchedule//Standalone//CN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:我的课程表'
      ];

      courses.forEach(c => {
        icsContent.push('BEGIN:VEVENT');
        icsContent.push(`SUMMARY:${c.name || '课程'}`);
        if (c.location) icsContent.push(`LOCATION:${c.location}`);
        if (c.teacher) icsContent.push(`DESCRIPTION:教师: ${c.teacher}`);
        icsContent.push(`UID:course_${c.id}_${Date.now()}@courseschedule.local`);
        icsContent.push('STATUS:CONFIRMED');
        icsContent.push('END:VEVENT');
      });

      icsContent.push('END:VCALENDAR');
      const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `我的课程表_${new Date().toISOString().slice(0, 10)}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (window.showToast) window.showToast('✅ 课表文件已成功导出', 'success');
    } catch (err) {
      if (window.showToast) window.showToast(`导出失败: ${err.message}`, 'error');
    }
  }

  openSubTimeView() {
    this.tempSectionTimes = JSON.parse(JSON.stringify(this.currentSettings.sectionTimes || DEFAULT_SECTION_TIMES));
    this.switchFixedDuration.checked = this.currentSettings.fixedDurationEnabled !== false;
    this.valDurationMinutes.textContent = `${this.currentSettings.sectionDurationMinutes || 45}分钟`;
    this.renderSectionItems();
    this.mainContainer.style.display = 'none';
    this.subTimeContainer.style.display = 'flex';
  }

  closeSubTimeView() {
    this.subTimeContainer.style.display = 'none';
    this.mainContainer.style.display = 'flex';
  }

  renderSectionItems() {
    this.sectionItemsContainer.innerHTML = '';
    this.tempSectionTimes.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'section-row-item';
      row.innerHTML = `
        <span class="section-item-label">第 ${index + 1} 节课</span>
        <div class="section-time-inputs">
          <input type="text" class="time-pill-input input-start" maxlength="5" />
          <span class="time-sep">-</span>
          <input type="text" class="time-pill-input input-end" maxlength="5" />
          ${index >= 10 ? `<button class="btn-del-section" title="删除本节">✕</button>` : ''}
        </div>
      `;

      const startInput = row.querySelector('.input-start');
      const endInput = row.querySelector('.input-end');
      startInput.value = String(item.start || '');
      endInput.value = String(item.end || '');

      startInput.addEventListener('change', (e) => {
        item.start = e.target.value.trim();
        if (this.currentSettings.fixedDurationEnabled) {
          const duration = this.currentSettings.sectionDurationMinutes || 45;
          item.end = this.addMinutes(item.start, duration);
          endInput.value = item.end;
        }
      });

      endInput.addEventListener('change', (e) => {
        item.end = e.target.value.trim();
      });

      const btnDel = row.querySelector('.btn-del-section');
      if (btnDel) {
        btnDel.addEventListener('click', () => {
          this.tempSectionTimes.splice(index, 1);
          this.renderSectionItems();
        });
      }

      this.sectionItemsContainer.appendChild(row);
    });
  }

  recalculateAllEndTimes() {
    const duration = this.currentSettings.sectionDurationMinutes || 45;
    this.tempSectionTimes.forEach(item => {
      item.end = this.addMinutes(item.start, duration);
    });
    this.renderSectionItems();
  }

  addMinutes(timeStr, mins) {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    const [h, m] = timeStr.split(':').map(Number);
    let total = h * 60 + m + mins;
    if (total >= 24 * 60) total %= (24 * 60);
    const newH = Math.floor(total / 60);
    const newM = total % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  saveSubTimeSettings() {
    this.currentSettings.sectionTimes = JSON.parse(JSON.stringify(this.tempSectionTimes));
    localStore.saveSettings({
      sectionTimes: this.currentSettings.sectionTimes,
      fixedDurationEnabled: this.currentSettings.fixedDurationEnabled,
      sectionDurationMinutes: this.currentSettings.sectionDurationMinutes
    });
    if (window.showToast) window.showToast('✅ 上课作息时间已保存', 'success');
    this.onSettingsChange(this.currentSettings);
  }

  saveMainSettings() {
    const aiKeyInput = this.pageEl.querySelector('#inputSettingAiKey');
    const apiKey = aiKeyInput ? aiKeyInput.value.trim() : localStore.getApiKey();
    const aiUrlInput = this.pageEl.querySelector('#inputSettingAiUrl');
    if (aiUrlInput) {
      try {
        this.currentSettings.deepseekApiUrl = normalizeAiBaseUrl(aiUrlInput.value.trim() || 'https://api.deepseek.com');
      } catch (err) {
        if (window.showToast) window.showToast(err.message, 'error');
        aiUrlInput.focus();
        return;
      }
    }
    const aiModelInput = this.pageEl.querySelector('#inputSettingAiModel');
    if (aiModelInput) {
      this.currentSettings.deepseekModel = aiModelInput.value.trim();
    }

    const keyPersisted = localStore.setApiKey(apiKey);
    localStore.clearWeekSnapshots();
    localStore.saveSettings(this.currentSettings);
    if (window.showToast) window.showToast(keyPersisted || !apiKey
      ? '✅ 课表设置已保存'
      : '课表设置已保存；当前设备的 API Key 仅在本次运行有效', keyPersisted || !apiKey ? 'success' : 'info');
    this.onSettingsChange(this.currentSettings);
    this.close();
  }

  open() {
    this.currentSettings = localStore.getSettings();

    // 回填课表参数
    this.valSemesterStart.textContent = this.currentSettings.semesterStartDate || '2026-09-07';
    this.inputHiddenStartDate.value = this.currentSettings.semesterStartDate || '2026-09-07';
    this.valWeekStartDay.textContent = this.currentSettings.weekStartDay === 'sunday' ? '星期日' : '星期一';
    this.valCurrentWeek.textContent = this.currentSettings.customCurrentWeek ? `第 ${this.currentSettings.customCurrentWeek} 周` : '自动计算';
    this.valTotalSections.textContent = `${this.currentSettings.totalSections || 10} 节`;
    this.valTotalWeeks.textContent = `${this.currentSettings.totalWeeks || 20} 周`;

    // 回填 AI 设置
    const aiKeyInput = this.pageEl.querySelector('#inputSettingAiKey');
    if (aiKeyInput) {
      aiKeyInput.value = localStore.getApiKey();
    }
    const aiUrlInput = this.pageEl.querySelector('#inputSettingAiUrl');
    if (aiUrlInput) aiUrlInput.value = this.currentSettings.deepseekApiUrl || '';
    const aiModelInput = this.pageEl.querySelector('#inputSettingAiModel');
    if (aiModelInput) aiModelInput.value = this.currentSettings.deepseekModel || '';
    const selectModel = this.pageEl.querySelector('#selectSettingAiModel');
    if (selectModel) selectModel.style.display = 'none';

    // 回填作息数据
    this.tempSectionTimes = JSON.parse(JSON.stringify(this.currentSettings.sectionTimes || DEFAULT_SECTION_TIMES));

    this.mainContainer.style.display = 'flex';
    this.subTimeContainer.style.display = 'none';

    // 回填真实版本号
    try {
      if (window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.getAppVersionName === 'function') {
        const v = window.AndroidWidgetBridge.getAppVersionName();
        if (v) this.labelCurrentVersion.textContent = `v${v}`;
      } else {
        this.labelCurrentVersion.textContent = 'v2.2.6';
      }
    } catch (e) {
      this.labelCurrentVersion.textContent = 'v2.2.6';
    }

    this.pageEl.style.display = 'flex';
  }

  isOpen() {
    return Boolean(this.pageEl && this.pageEl.style.display !== 'none');
  }

  isSubViewOpen() {
    return Boolean(this.subTimeContainer && this.subTimeContainer.style.display === 'flex');
  }

  close() {
    this.pageEl.style.display = 'none';
  }
}
