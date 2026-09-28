/**
 * AI 智能调课全屏控制台组件
 * 
 * 核心准则：
 * 1. 用户配置 HTTPS 模型端点和会话密钥后主动发起调课请求；
 * 2. 彻底免卡密：零收费、零额度限制、无限次随意调课；
 * 3. 独立调课图层：所有调课变动保存在本地 adjusted_courses 独立存储，随时一键还原官方初始排课。
 */

import { localStore, DEFAULT_SECTION_TIMES } from '../storage/localStore.js';
import { idbStore } from '../storage/idbStore.js';
import { callRemoteDeepSeekApi, applyLocalRuleAdjustment, normalizeRemoteAction, normalizeDayOverrideAction } from '../utils/localAiAdjuster.js';
import { escapeHtml } from '../utils/sanitize.js';

export class AiAdjustModal {
  constructor({ container = document.body, onAdjustSuccess = () => {} } = {}) {
    this.container = container;
    this.onAdjustSuccess = onAdjustSuccess;
    this.lastTargetWeek = null;
    this.initDOM();
  }

  initDOM() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'ai-adjust-fullscreen-page';
    this.overlay.style.display = 'none';

    this.overlay.innerHTML = `
      <!-- 原生沉浸式导航顶栏 -->
      <div class="ai-fullscreen-header">
        <button class="ai-header-back-btn" id="btnAiClose" title="返回课表" aria-label="返回课表">
          <span class="back-arrow">‹</span>
          <span class="back-text">返回</span>
        </button>
        <div class="ai-header-title-box">
          <div class="ai-header-title">AI 智能调课</div>
        </div>
        <button class="ai-header-action-btn" id="btnAiHeaderClear" title="清空全部调课">重置</button>
      </div>

      <!-- 全屏滚动主体 -->
      <div class="ai-fullscreen-scroll-content">
        <!-- 调课需求输入卡片 -->
        <div class="ai-card-section" style="margin-top: 10px;">
          <div class="section-title-row">
            <span class="section-title-text">调课需求指令</span>
          </div>

          <div class="ai-textarea-wrapper">
            <textarea id="aiInstructionInput" class="ai-fullscreen-textarea" rows="3" placeholder="输入调课需求，如：9.25至10.7放假调休 或 改到周五第3节"></textarea>
            <button type="button" class="btn-clear-textarea" id="btnClearAiInput" title="清空输入">✕</button>
          </div>

          <!-- 主提交按钮 -->
          <button type="button" class="btn-ai-primary-submit" id="btnSubmitAiAdjust">
            <span class="btn-text">开始智能调课</span>
          </button>
        </div>

        <!-- 3. 调课结果反馈卡片 -->
        <div class="ai-result-card" id="aiResultBox" style="display: none;">
          <div class="result-header">
            <span class="result-title-text" id="aiResultTitle">调课成功</span>
          </div>
          <div class="result-body-text" id="aiResultDetail">--</div>
          <!-- 调课完成一键返回课表主按钮 -->
          <button type="button" class="btn-return-schedule" id="btnAiResultBack">
            返回主课表查看效果
          </button>
        </div>

        <!-- 4. 当前已调课程明细列表 -->
        <div class="ai-card-section adjustments-list-card">
          <div class="section-title-row">
            <div class="title-with-badge">
              <span class="section-title-text">已生效调课记录</span>
              <span id="adjustmentsCountBadge" class="count-pill">0 项</span>
            </div>
          </div>

          <div id="adjustmentsItemsList" class="adjustments-flow-container">
            <!-- 动态填充 -->
          </div>
        </div>

        <!-- 底部操作区域 -->
        <div class="ai-bottom-safe-box" style="margin-top: 14px;">
          <button type="button" class="btn-restore-official" id="btnClearAllAdjustments">
            <span>恢复原始课表</span>
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(this.overlay);
    this.bindEvents();
  }

  bindEvents() {
    // 返回主课表
    this.overlay.querySelector('#btnAiClose').addEventListener('click', () => this.close());

    // 调课结果卡片中的“返回主课表查看效果”大按钮
    const btnResultBack = this.overlay.querySelector('#btnAiResultBack');
    if (btnResultBack) {
      btnResultBack.addEventListener('click', () => {
        this.close();
        if (window.courseApp && this.lastTargetWeek) {
          try {
            window.courseApp.switchViewMode('week');
            window.courseApp.setWeek(this.lastTargetWeek, true);
          } catch (e) {}
        }
      });
    }

    // 清空文本框
    const inputArea = this.overlay.querySelector('#aiInstructionInput');
    const btnClearInput = this.overlay.querySelector('#btnClearAiInput');
    if (btnClearInput && inputArea) {
      btnClearInput.addEventListener('click', () => {
        inputArea.value = '';
        inputArea.focus();
      });
    }

    // 提交调课
    this.overlay.querySelector('#btnSubmitAiAdjust').addEventListener('click', async () => {
      await this.handleAiAdjust();
    });

    // 顶栏与底栏一键重置全部调课
    const handleClearAll = async () => {
      if (!confirm('确定要撤销全部调课记录，将课表 100% 恢复为初始状态吗？')) return;
      await this.handleClearAllAdjustments();
    };

    this.overlay.querySelector('#btnAiHeaderClear').addEventListener('click', handleClearAll);
    this.overlay.querySelector('#btnClearAllAdjustments').addEventListener('click', handleClearAll);
  }

  async handleAiAdjust() {
    const input = this.overlay.querySelector('#aiInstructionInput');
    const instruction = input.value.trim();
    if (!instruction) {
      if (window.showToast) window.showToast('请输入具体的调课指令', 'error');
      return;
    }

    const btnSubmit = this.overlay.querySelector('#btnSubmitAiAdjust');
    btnSubmit.disabled = true;
    btnSubmit.style.opacity = '0.6';
    btnSubmit.querySelector('.btn-text').textContent = '正在等待 AI 返回调课指令...';
    if (window.showToast) window.showToast('正在请求 AI 解析指令...', 'info');

    const resultBox = this.overlay.querySelector('#aiResultBox');
    const resultTitle = this.overlay.querySelector('#aiResultTitle');
    const resultDetail = this.overlay.querySelector('#aiResultDetail');

    try {
      const cfg = localStore.getSettings() || {};
      const activeWeek = (window.courseApp && window.courseApp.activeWeek) ? window.courseApp.activeWeek : 1;

      // 严格校验 API Key，彻底移除本地静默自动调课
      const apiKey = localStore.getApiKey();
      if (!apiKey) {
        if (window.showToast) window.showToast('请先在【设置】中配置 API Key 后再使用 AI 调课', 'error');
        if (confirm('尚未配置 API Key，是否现在前往【设置】页面进行配置？')) {
          this.close();
          if (window.courseApp && window.courseApp.settingsModal) {
            window.courseApp.settingsModal.open();
          }
        }
        btnSubmit.disabled = false;
        btnSubmit.style.opacity = '1';
        btnSubmit.querySelector('.btn-text').textContent = '开始智能调课';
        return;
      }

      // 提取全部本地课程与当前周排课
      const courses = await idbStore.getCourses();
      const semesterStart = cfg.semesterStartDate || '2026-09-07';

      // 1. 优先尝试本地日期范围放假规则 (针对跨周停课，如 9.25到10.7放假/调休，自动覆盖全部跨周天数)
      const holidayRuleRes = applyLocalRuleAdjustment(instruction, courses, activeWeek, semesterStart,
        cfg.sectionTimes || DEFAULT_SECTION_TIMES);
      const holidayAdjustments = (holidayRuleRes && holidayRuleRes.success && Array.isArray(holidayRuleRes.adjustments))
        ? holidayRuleRes.adjustments
        : [];

      let adjustResult = null;

      try {
        // 先让等待状态绘制出来；Android 原生 HTTPS 桥接在请求期间会同步等待。
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const remoteRes = await callRemoteDeepSeekApi({
          instruction,
          currentCourses: courses,
          week: activeWeek,
          semesterStartDate: semesterStart,
          apiKey,
          apiUrl: cfg.deepseekApiUrl || 'https://api.deepseek.com',
          model: cfg.deepseekModel || 'deepseek-chat'
        });

        if (remoteRes && Array.isArray(remoteRes.actions)) {
          const remoteAdjustments = [];
          const cardsByWeek = new Map();
          for (const act of remoteRes.actions) {
            if (act.type === 'day_override') {
              remoteAdjustments.push(normalizeDayOverrideAction(act, semesterStart, instruction, cfg.totalWeeks || 20));
              continue;
            }
            const originalWeek = Number(act.originalWeek ?? act.original_week ?? act.week ?? activeWeek);
            if (!Number.isInteger(originalWeek) || originalWeek < 1 || originalWeek > (cfg.totalWeeks || 20)) {
              throw new Error('模型返回的原课程周次无效');
            }
            if (!cardsByWeek.has(originalWeek)) {
              cardsByWeek.set(originalWeek, await idbStore.getMergedScheduleByWeek(originalWeek, semesterStart));
            }
            remoteAdjustments.push(normalizeRemoteAction(
              act, cardsByWeek.get(originalWeek), activeWeek, instruction,
              cfg.sectionTimes || DEFAULT_SECTION_TIMES, cfg.totalWeeks || 20
            ));
          }

          // 将本地跨周放假记录与远程大模型动作智能合并
          const mergedAdjustments = [...holidayAdjustments];
          remoteAdjustments.forEach(ra => {
            const exists = holidayAdjustments.some(ha =>
              ha.week === ra.week &&
              ha.adjustType === ra.adjustType &&
              String(ha.originalCourseId ?? '') === String(ra.originalCourseId ?? '') &&
              Number(ha.original_day) === Number(ra.original_day) &&
              Number(ha.original_start_section) === Number(ra.original_start_section)
            );
            if (!exists) {
              mergedAdjustments.push(ra);
            }
          });

          adjustResult = {
            success: true,
            mode: 'deepseek_api',
            message: remoteRes.explanation || '大模型已完成智能调课解析',
            adjustments: mergedAdjustments
          };
        }
      } catch (apiErr) {
        if (holidayAdjustments.length > 0) {
          adjustResult = {
            success: true,
            mode: 'local_rule',
            message: holidayRuleRes.message || '已成功解析放假停课安排',
            adjustments: holidayAdjustments
          };
        } else {
          if (window.showToast) window.showToast(`AI 调课失败: ${apiErr.message}`, 'error');
          resultBox.style.display = 'block';
          resultTitle.textContent = 'AI 调课失败';
          resultDetail.innerHTML = `
            <div style="font-size: 13px; color: #DC2626; padding: 6px 0; line-height: 1.6;">
              ${escapeHtml(apiErr.message || '大模型服务请求异常')}
            </div>
          `;
          try {
            resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (_) {}
          return;
        }
      }

      if (adjustResult && adjustResult.success) {
        const adjustmentsToSave = adjustResult.adjustments || [];

        for (const adj of adjustmentsToSave) {
          await idbStore.saveAdjustment(adj);
        }

        // 清空输入框
        input.value = '';

        // 调课生效后清空周课表缓存
        if (window.courseApp && typeof window.courseApp.clearWeekCache === 'function') {
          window.courseApp.clearWeekCache();
        }
        if (window.courseApp && typeof window.courseApp.warmUpWeekCache === 'function') {
          window.courseApp.warmUpWeekCache();
        }

        if (adjustmentsToSave.length === 0) {
          if (window.showToast) window.showToast(adjustResult.message || '所选时段内暂无需要调整的课程', 'info');
          resultBox.style.display = 'block';
          resultTitle.textContent = '调课处理完成';
          resultDetail.innerHTML = `
            <div style="font-size: 13.5px; color: var(--text-main); padding: 6px 0; line-height: 1.6;">
              ${escapeHtml(adjustResult.message || '调课指令已成功识别，但所选日期区间内暂无课程需要调整。')}
            </div>
          `;
        } else {
          if (window.showToast) window.showToast(`调课成功！已更新 ${adjustmentsToSave.length} 门课程排期`, 'success');
          resultBox.style.display = 'block';
          this.lastTargetWeek = adjustmentsToSave[0]?.week || activeWeek;

          resultTitle.textContent = `调课已生效 (共处理 ${adjustmentsToSave.length} 门课程)`;
          const itemsHtml = adjustmentsToSave.map((a, i) => `
            <div style="font-size: 12px; padding: 5px 0; border-bottom: 1px dashed #E2E8F0;">
              <strong>${i + 1}. ${escapeHtml(a.courseName || a.course_name || a.name || '课程')}</strong>
              <span style="color: ${a.adjustType === 'cancel' ? '#EF4444' : '#10B981'}; font-weight: 700; margin-left: 4px;">
                [${a.adjustType === 'cancel' ? '停课' : '调整'}]
              </span>:
              ${escapeHtml(a.reason || '调课')}
            </div>
          `).join('');

          resultDetail.innerHTML = `
            <div style="margin-bottom: 8px;"><strong>执行详情:</strong> ${escapeHtml(adjustResult.message || '已成功映射至本地课表')}</div>
            <div style="max-height: 180px; overflow-y: auto;">${itemsHtml}</div>
          `;
        }

        await this.renderAdjustmentsList();
        this.onAdjustSuccess();
      } else {
        if (window.showToast) window.showToast('未能识别具体的调课动作', 'error');
      }
    } catch (e) {
      if (window.showToast) window.showToast('调课异常: ' + e.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.style.opacity = '1';
      btnSubmit.querySelector('.btn-text').textContent = '开始智能调课';
    }
  }

  async handleClearAllAdjustments() {
    try {
      if (window.showToast) window.showToast('正在恢复初始课表...', 'info');
      await idbStore.clearAdjustments();

      if (window.showToast) window.showToast('已 100% 恢复为初始课表！', 'success');
      this.overlay.querySelector('#aiResultBox').style.display = 'none';
      await this.renderAdjustmentsList();

      if (window.courseApp && typeof window.courseApp.clearWeekCache === 'function') {
        window.courseApp.clearWeekCache();
      }
      if (window.courseApp && typeof window.courseApp.warmUpWeekCache === 'function') {
        window.courseApp.warmUpWeekCache();
      }

      this.onAdjustSuccess();
      setTimeout(() => this.close(), 400);
    } catch (e) {
      if (window.showToast) window.showToast('恢复课表异常: ' + e.message, 'error');
    }
  }

  async renderAdjustmentsList() {
    const listEl = this.overlay.querySelector('#adjustmentsItemsList');
    const badgeEl = this.overlay.querySelector('#adjustmentsCountBadge');
    if (!listEl) return;

    try {
      const items = await idbStore.getAdjustments();
      if (badgeEl) badgeEl.textContent = `${items.length} 项`;

      if (items.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 18px 0; color: #94A3B8; font-size: 13px;">
            暂无调课记录
          </div>
        `;
        return;
      }

      listEl.innerHTML = items.map(item => `
        <div class="adjustment-item-card">
          <div class="adj-item-left">
            <div class="adj-item-badge ${item.adjustType === 'cancel' ? 'badge-cancelled' : 'badge-modified'}">
              ${item.adjustType === 'cancel' ? '已停课' : '已调整'}
            </div>
            <div class="adj-item-content">
              <div class="adj-item-course-name">${escapeHtml(item.courseName || item.course_name || item.name || '课程')}</div>
              <div class="adj-item-desc">${escapeHtml(item.reason || '时间/地点变动')}</div>
            </div>
          </div>
          <button type="button" class="btn-undo-single-adj" data-id="${escapeHtml(item.id)}" title="撤销此项">
            撤销
          </button>
        </div>
      `).join('');

      listEl.querySelectorAll('.btn-undo-single-adj').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const adjId = e.currentTarget.dataset.id;
          if (adjId) {
            try {
              await idbStore.deleteAdjustment(adjId);
              if (window.showToast) window.showToast('已撤销该调课项', 'success');
              await this.renderAdjustmentsList();
              if (window.courseApp && typeof window.courseApp.clearWeekCache === 'function') {
                window.courseApp.clearWeekCache();
              }
              if (window.courseApp && typeof window.courseApp.warmUpWeekCache === 'function') {
                window.courseApp.warmUpWeekCache();
              }
              this.onAdjustSuccess();
            } catch (err) {
              if (window.showToast) window.showToast('撤销异常: ' + err.message, 'error');
            }
          }
        });
      });
    } catch (e) {
      console.warn('renderAdjustmentsList error:', e);
    }
  }

  open() {
    this.overlay.style.display = 'flex';
    this.renderAdjustmentsList();
  }

  close() {
    this.overlay.style.display = 'none';
  }
}
