import { getMorandiColor } from '../utils/morandi.js';
import { idbStore } from '../storage/idbStore.js';
import { localStore } from '../storage/localStore.js';

export class CourseDetailModal {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onRevertSuccess = options.onRevertSuccess || (() => {});
    this.currentCard = null;
    this.initSkeleton();
  }

  initSkeleton() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.id = 'courseDetailModalBackdrop';
    this.modalEl.style.display = 'none';
    this.modalEl.innerHTML = `
      <div class="modal-dialog-bottom-sheet">
        <div class="modal-header">
          <div class="modal-title-box">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="modal-title" id="detailCourseName">课程名称</span>
              <span id="detailAdjustBadge" style="display: none; font-size: 11px; background: #FEE2E2; color: #DC2626; padding: 2px 6px; border-radius: 6px; font-weight: 700;">⚡ 调课</span>
            </div>
            <span class="modal-desc" id="detailCourseCode">课程代码</span>
          </div>
          <button class="modal-close-btn" id="btnDetailClose">✕</button>
        </div>

        <div class="modal-body detail-modal-body">
          <div class="detail-color-pill" id="detailColorPill"></div>

          <div class="detail-info-list">
            <div class="detail-info-item">
              <span class="detail-label">📍 上课地点</span>
              <span class="detail-value" id="detailLocation">--</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-label">👤 授课教师</span>
              <span class="detail-value" id="detailTeacher">--</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-label">⏰ 上课节次</span>
              <span class="detail-value" id="detailSection">--</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-label">📅 适用周次</span>
              <span class="detail-value" id="detailWeeks">--</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-label">🏷️ 课程属性</span>
              <span class="detail-value" id="detailWeekType">每周</span>
            </div>
            <div class="detail-info-item" id="rowAdjustReason" style="display: none;">
              <span class="detail-label">💡 调课说明</span>
              <span class="detail-value" id="detailAdjustReason" style="color: #E07A5F; font-weight: 600;">--</span>
            </div>
          </div>

          <div class="detail-conflicts" id="detailConflicts" style="display: none;">
            <div class="detail-conflict-heading">⚠️ 与以下课程冲突</div>
            <div id="detailConflictList"></div>
          </div>

          <div class="detail-action-bar" style="display: flex; gap: 10px; margin-top: 16px;">
            <button class="btn-secondary" id="btnDetailRevertAdjust" style="display: none; flex: 1; height: 42px; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; font-weight: 600; border-radius: 8px; cursor: pointer;">
              ↩️ 撤销本次调课
            </button>
            <button class="btn-primary" id="btnDetailConfirm" style="flex: 1; height: 42px; cursor: pointer;">
              知道了
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.modalEl);
    this.courseNameEl = this.modalEl.querySelector('#detailCourseName');
    this.adjustBadgeEl = this.modalEl.querySelector('#detailAdjustBadge');
    this.courseCodeEl = this.modalEl.querySelector('#detailCourseCode');
    this.colorPillEl = this.modalEl.querySelector('#detailColorPill');
    this.locationEl = this.modalEl.querySelector('#detailLocation');
    this.teacherEl = this.modalEl.querySelector('#detailTeacher');
    this.sectionEl = this.modalEl.querySelector('#detailSection');
    this.weeksEl = this.modalEl.querySelector('#detailWeeks');
    this.weekTypeEl = this.modalEl.querySelector('#detailWeekType');
    this.rowAdjustReason = this.modalEl.querySelector('#rowAdjustReason');
    this.detailAdjustReason = this.modalEl.querySelector('#detailAdjustReason');
    this.conflictsEl = this.modalEl.querySelector('#detailConflicts');
    this.conflictListEl = this.modalEl.querySelector('#detailConflictList');
    this.btnRevertAdjust = this.modalEl.querySelector('#btnDetailRevertAdjust');

    this.bindEvents();
  }

  bindEvents() {
    this.modalEl.querySelector('#btnDetailClose').addEventListener('click', () => this.close());
    this.modalEl.querySelector('#btnDetailConfirm').addEventListener('click', () => this.close());
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.close();
    });

    if (this.btnRevertAdjust) {
      this.btnRevertAdjust.addEventListener('click', async () => {
        if (!this.currentCard || !this.currentCard.isAdjusted) return;
        const adjId = this.currentCard.adjustId;
        if (!adjId) {
          window.showToast('无法获取调课ID', 'error');
          return;
        }

        try {
          window.showToast('正在撤回调课...', 'info');
          await idbStore.revertAdjustment(Number(adjId) || adjId);
          window.showToast('✅ 已成功撤销该调课，原课程已恢复！', 'success');
          this.close();
          this.onRevertSuccess();
        } catch (e) {
          window.showToast('撤回失败: ' + e.message, 'error');
        }
      });
    }
  }

  show(card) {
    if (!card) return;
    this.currentCard = card;
    const palette = getMorandiColor(card.name);

    this.courseNameEl.textContent = card.name || '未知课程';
    this.courseCodeEl.textContent = card.code ? `代码: ${card.code}` : '常规课程';
    this.colorPillEl.style.backgroundColor = card.color || palette.bg;
    this.colorPillEl.style.borderColor = palette.border;
    this.locationEl.textContent = card.location || '未标注地点';
    this.teacherEl.textContent = card.teacher || '未标注教师';

    const startSec = card.startSection || card.startPeriod || 1;
    const endSec = card.endSection || card.endPeriod || startSec;
    const span = card.stepCount || card.periodSpan || (endSec - startSec + 1);

    // 动态提取用户作息时间设置
    let displayStartTime = card.startTime || '08:00';
    let displayEndTime = card.endTime || '09:35';
    try {
      const settings = localStore.getSettings();
      const secTimes = settings.sectionTimes || [];
      if (Array.isArray(secTimes) && secTimes.length >= startSec) {
        const startSlot = secTimes.find(s => s.section === Number(startSec)) || secTimes[Number(startSec) - 1];
        const endSlot = secTimes.find(s => s.section === Number(endSec)) || secTimes[Number(endSec) - 1];
        if (startSlot && startSlot.start) displayStartTime = startSlot.start;
        if (endSlot && endSlot.end) displayEndTime = endSlot.end;
      }
    } catch (e) {}

    this.sectionEl.textContent = `第 ${startSec} ~ ${endSec} 节 (${displayStartTime} ~ ${displayEndTime} · 跨 ${span} 节)`;

    const conflicts = Array.isArray(card.conflictingCourses) ? card.conflictingCourses : [];
    this.conflictsEl.style.display = conflicts.length ? 'block' : 'none';
    this.conflictListEl.replaceChildren();
    for (const other of conflicts) {
      const row = document.createElement('div');
      row.className = 'detail-conflict-row';
      const title = document.createElement('strong');
      title.textContent = other.name || '未命名课程';
      const info = document.createElement('span');
      info.textContent = `第 ${other.startSection}～${other.endSection} 节 · ${other.location || '地点未标注'}${other.teacher ? ` · ${other.teacher}` : ''}`;
      row.append(title, info);
      this.conflictListEl.appendChild(row);
    }

    const startW = card.startWeek || 1;
    const endW = card.endWeek || 20;
    if (Array.isArray(card.weeks) && card.weeks.length > 0) {
      this.weeksEl.textContent = `第 ${card.weeks.join(', ')} 周`;
    } else {
      this.weeksEl.textContent = `第 ${startW} ~ ${endW} 周`;
    }

    // 调课专属展示与独立撤销按钮
    if (card.isAdjusted) {
      this.adjustBadgeEl.style.display = 'inline-block';
      this.adjustBadgeEl.textContent = card.badge || '⚡ 调课';

      if (card.isReduced) {
        this.adjustBadgeEl.style.background = '#FEE2E2';
        this.adjustBadgeEl.style.color = '#DC2626';
        this.weekTypeEl.textContent = `停课/调离 (${card.adjustType === 'moved' ? '已调往其他时段' : '本周停课'})`;
        if (this.btnRevertAdjust) {
          this.btnRevertAdjust.style.display = 'block';
          this.btnRevertAdjust.textContent = '↩️ 恢复此课 (撤销停课)';
          this.btnRevertAdjust.style.background = '#ECFDF5';
          this.btnRevertAdjust.style.color = '#059669';
          this.btnRevertAdjust.style.borderColor = '#A7F3D0';
        }
      } else {
        this.adjustBadgeEl.style.background = '#FEF3C7';
        this.adjustBadgeEl.style.color = '#D97706';
        const srcInfo = card.pointerSourceText ? ` (指针引用: ${card.pointerSourceText})` : '';
        this.weekTypeEl.textContent = `AI 调课调整 (${card.adjustType === 'moved' ? '调入' : '补课'}${srcInfo})`;
        if (this.btnRevertAdjust) {
          this.btnRevertAdjust.style.display = 'block';
          this.btnRevertAdjust.textContent = '↩️ 撤销本次调入';
          this.btnRevertAdjust.style.background = '#FEE2E2';
          this.btnRevertAdjust.style.color = '#DC2626';
          this.btnRevertAdjust.style.borderColor = '#FCA5A5';
        }
      }

      if (this.rowAdjustReason) {
        this.rowAdjustReason.style.display = 'flex';
        this.detailAdjustReason.textContent = card.adjustReason || '用户自主调课';
      }
    } else {
      this.adjustBadgeEl.style.display = 'none';
      let wtText = '每周上课 (官方初始)';
      if (card.weekType === 'odd') wtText = '单周上课 (官方初始)';
      if (card.weekType === 'even') wtText = '双周上课 (官方初始)';
      this.weekTypeEl.textContent = wtText;
      if (this.rowAdjustReason) {
        this.rowAdjustReason.style.display = 'none';
      }
      if (this.btnRevertAdjust) {
        this.btnRevertAdjust.style.display = 'none';
      }
    }

    this.modalEl.style.display = 'flex';
  }

  isOpen() {
    return Boolean(this.modalEl && this.modalEl.style.display !== 'none');
  }

  close() {
    this.currentCard = null;
    this.modalEl.style.display = 'none';
  }
}
