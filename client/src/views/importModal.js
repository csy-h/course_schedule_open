/**
 * 课表导入控制台 (极简版)
 * 1. 南京晓庄学院教务直连 (手机本地原生自动化安全通道)
 * 2. 本地日历文件导入 (.ics / WakeUp 醒狮课表)
 */

import { idbStore } from '../storage/idbStore.js';
import { localStore } from '../storage/localStore.js';
import { parseIcs } from '../utils/icsParser.js';
import { SEMESTER_START_DATE } from '../data/defaultSchedule.js';

export class ImportModal {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onImportSuccess = options.onImportSuccess || (() => {});
    this._isOpen = false;
    this.initDOM();
  }

  initDOM() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-overlay school-import-overlay';
    this.modalEl.id = 'importModalBackdrop';
    this.modalEl.style.setProperty('display', 'none', 'important');

    this.modalEl.innerHTML = `
      <div class="modal-dialog" style="max-width: 360px; width: 90%; border-radius: 18px; padding: 20px; background: #FFFFFF; box-shadow: 0 12px 32px rgba(0,0,0,0.12);">
        <!-- 头部导航 -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btnImportBack" style="display: none; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-main); padding: 0 4px; line-height: 1;">‹</button>
            <span style="font-size: 17px; font-weight: 700; color: var(--text-main);" id="importTitle">导入课表</span>
          </div>
          <button id="btnImportClose" style="background: none; border: none; font-size: 22px; cursor: pointer; color: #94A3B8; padding: 0 4px; line-height: 1;">&times;</button>
        </div>

        <!-- 错误提示 -->
        <div id="importErrorAlert" style="display: none; background: #FEE2E2; color: #DC2626; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 500; margin-bottom: 14px;"></div>

        <!-- 面板 1: 选择导入方式 (极简双卡片) -->
        <div id="panelSelectMode" style="display: flex; flex-direction: column; gap: 12px;">
          <!-- 选项 1: 南京晓庄学院 -->
          <div id="optNjxzc" style="display: flex; align-items: center; gap: 14px; padding: 16px; background: #F0FDF4; border: 1.5px solid #86EFAC; border-radius: 14px; cursor: pointer; transition: all 0.2s;">
            <div style="font-size: 28px;">🎓</div>
            <div style="flex: 1;">
              <div style="font-size: 15px; font-weight: 700; color: #166534;">南京晓庄学院</div>
              <div style="font-size: 12px; color: #15803D;">教务直连 · 一键同步个人课表</div>
            </div>
            <span style="font-size: 18px; color: #166534; font-weight: 700;">›</span>
          </div>

          <!-- 选项 2: 本地日历文件 -->
          <div id="optLocalIcs" style="display: flex; align-items: center; gap: 14px; padding: 16px; background: #EFF6FF; border: 1.5px solid #93C5FD; border-radius: 14px; cursor: pointer; transition: all 0.2s;">
            <input type="file" id="fileIcsHidden" accept=".ics,text/calendar" style="display: none;" />
            <div style="font-size: 28px;">📁</div>
            <div style="flex: 1;">
              <div style="font-size: 15px; font-weight: 700; color: #1E40AF;">导入日历文件</div>
              <div style="font-size: 12px; color: #2563EB;">支持 .ics / WakeUp 醒狮课表</div>
            </div>
            <span style="font-size: 18px; color: #1E40AF; font-weight: 700;">›</span>
          </div>
        </div>

        <!-- 面板 2: 晓庄教务直连表单 -->
        <div id="panelNjxzcForm" style="display: none;">
          <form id="formNjxzc" style="display: flex; flex-direction: column; gap: 12px;">
            <div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">学号</div>
              <input type="text" id="njxzcUser" placeholder="教务学号" class="form-input" style="width: 100%; height: 42px; font-size: 14px; box-sizing: border-box;" required />
            </div>

            <div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">密码</div>
              <div style="position: relative;">
                <input type="password" id="njxzcPwd" placeholder="统一身份认证密码" class="form-input" style="width: 100%; height: 42px; font-size: 14px; box-sizing: border-box; padding-right: 40px;" required />
                <button type="button" id="btnTogglePwd" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 16px; color: #64748B;">👁️</button>
              </div>
            </div>

            <div style="font-size: 12px; line-height: 1.5; color: #92400E; background: #FFFBEB; padding: 10px 12px; border-radius: 8px;">
              学校教务入口目前仅支持 HTTP，登录与课表同步不具备 HTTPS 传输保护。若不希望通过该入口登录，可返回选择本地 ICS 文件导入。
            </div>

            <div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">学期</div>
              <select id="njxzcSemester" class="form-input" style="width: 100%; height: 42px; font-size: 13px; box-sizing: border-box; background: var(--bg-surface);">
                <option value="2026-2027-1" selected>2026-2027学年第1学期 (当前学期)</option>
                <option value="2025-2026-2">2025-2026学年第2学期</option>
                <option value="2025-2026-1">2025-2026学年第1学期</option>
              </select>
            </div>

            <button type="submit" id="btnStartNjxzcSync" style="height: 44px; margin-top: 6px; font-size: 15px; font-weight: 700; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #FFFFFF; border: none; border-radius: 10px; cursor: pointer; box-shadow: 0 4px 12px rgba(16,185,129,0.3);">
              🚀 开始同步课表
            </button>
          </form>
        </div>
      </div>
    `;

    this.container.appendChild(this.modalEl);
    this.bindEvents();
  }

  bindEvents() {
    const btnClose = this.modalEl.querySelector('#btnImportClose');
    const btnBack = this.modalEl.querySelector('#btnImportBack');
    const optNjxzc = this.modalEl.querySelector('#optNjxzc');
    const optLocalIcs = this.modalEl.querySelector('#optLocalIcs');
    const fileInput = this.modalEl.querySelector('#fileIcsHidden');
    const formNjxzc = this.modalEl.querySelector('#formNjxzc');
    const btnTogglePwd = this.modalEl.querySelector('#btnTogglePwd');
    const pwdInput = this.modalEl.querySelector('#njxzcPwd');

    // 遮罩点击与关闭
    btnClose.addEventListener('click', () => this.close());
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.close();
    });

    // 密码明密文切换
    btnTogglePwd.addEventListener('click', () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        btnTogglePwd.textContent = '🔒';
      } else {
        pwdInput.type = 'password';
        btnTogglePwd.textContent = '👁️';
      }
    });

    // 返回按钮
    btnBack.addEventListener('click', () => {
      this.showSelection();
    });

    // 选项 1: 南京晓庄学院
    optNjxzc.addEventListener('click', () => {
      this.showNjxzcForm();
    });

    // 选项 2: 本地日历文件
    optLocalIcs.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        await this.handleIcsFile(file);
      }
    });

    // 表单提交
    formNjxzc.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitNjxzc();
    });
  }

  showSelection() {
    this.modalEl.querySelector('#panelSelectMode').style.display = 'flex';
    this.modalEl.querySelector('#panelNjxzcForm').style.display = 'none';
    this.modalEl.querySelector('#btnImportBack').style.display = 'none';
    this.modalEl.querySelector('#importTitle').textContent = '导入课表';
    this.hideError();
  }

  showNjxzcForm() {
    this.modalEl.querySelector('#panelSelectMode').style.display = 'none';
    this.modalEl.querySelector('#panelNjxzcForm').style.display = 'block';
    this.modalEl.querySelector('#btnImportBack').style.display = 'inline-block';
    this.modalEl.querySelector('#importTitle').textContent = '南京晓庄学院';
    this.hideError();

    // 自动填充保存过的学号
    const savedUser = localStore.getItem('cs_njxzc_username', '');
    const userInput = this.modalEl.querySelector('#njxzcUser');
    if (savedUser && userInput && !userInput.value) {
      userInput.value = savedUser;
    }
  }

  showError(msg) {
    const el = this.modalEl.querySelector('#importErrorAlert');
    if (el) {
      el.textContent = `❌ ${msg}`;
      el.style.display = 'block';
    }
  }

  hideError() {
    const el = this.modalEl.querySelector('#importErrorAlert');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  submitNjxzc() {
    this.hideError();
    const username = this.modalEl.querySelector('#njxzcUser').value.trim();
    const password = this.modalEl.querySelector('#njxzcPwd').value.trim();
    const semester = this.modalEl.querySelector('#njxzcSemester').value;

    if (!username) {
      this.showError('请输入教务学号');
      return;
    }
    if (!password) {
      this.showError('请输入密码');
      return;
    }

    localStore.setItem('cs_njxzc_username', username);

    const submitBtn = this.modalEl.querySelector('#btnStartNjxzcSync');
    const pwdInput = this.modalEl.querySelector('#njxzcPwd');

    // 检测 Android 原生桥接并执行前置密码正确性拦截
    if (window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.verifyNjxzcCredentials === 'function') {
      submitBtn.disabled = true;
      submitBtn.textContent = '🔒 正在验证教务账号密码...';
      if (window.showToast) window.showToast('正在验证教务账号密码...', 'info');

      window.onNjxzcVerifyResult = (isValid, errorMsg) => {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 开始同步课表';

        if (isValid) {
          if (window.showToast) window.showToast('🎉 账号验证通过，正在同步课表...', 'success');
          // 密码完全正确，启动原生自动化提取容器
          window.AndroidWidgetBridge.startAutomatedSchoolImport(username, password, semester, false);
        } else {
          const tip = errorMsg || '用户名或密码错误';
          this.showError(tip);
          if (window.showToast) window.showToast(tip, 'error');
          if (pwdInput) {
            pwdInput.value = '';
            pwdInput.focus();
          }
        }
      };

      window.AndroidWidgetBridge.verifyNjxzcCredentials(username, password);
    } else if (window.AndroidWidgetBridge && typeof window.AndroidWidgetBridge.startAutomatedSchoolImport === 'function') {
      window.AndroidWidgetBridge.startAutomatedSchoolImport(username, password, semester, false);
    } else {
      this.showError('南京晓庄学院一键直连需在 Android 手机客户端中使用；当前环境请使用【导入日历文件】');
      if (window.showToast) window.showToast('请在手机 App 中使用教务直连', 'error');
    }
  }

  async handleIcsFile(file) {
    this.hideError();
    if (!file || !file.name.toLowerCase().endsWith('.ics')) {
      this.showError('仅支持 .ics 格式的日历文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const cfg = localStore.getSettings() || {};
        const defaultStart = cfg.semesterStartDate || SEMESTER_START_DATE;
        const parsed = parseIcs(text, defaultStart);
        const courses = parsed.courses || [];

        if (courses.length === 0) {
          throw new Error('未能识别到有效课程安排');
        }

        // 智能自适应学期起止
        if (parsed.semesterStart) {
          localStore.saveSettings({ semesterStartDate: parsed.semesterStart });
          if (window.courseApp && typeof window.courseApp.applySemesterStart === 'function') {
            window.courseApp.applySemesterStart(parsed.semesterStart);
          }
        }

        let detectedMaxWeek = 16;
        courses.forEach(c => {
          const ew = Number(c.endWeek || 0);
          if (ew > detectedMaxWeek) detectedMaxWeek = ew;
        });
        localStore.saveSettings({ totalWeeks: detectedMaxWeek });
        if (window.courseApp && window.courseApp.weekView) {
          window.courseApp.weekView.updateConfig({ totalWeeks: detectedMaxWeek });
        }

        await idbStore.saveCourses(courses, true);
        await idbStore.clearAdjustments();

        const week = cfg.selectedWeek || 1;
        const weekCards = await idbStore.getCoursesByWeek(week);
        localStore.saveWeekSnapshot(week, weekCards);

        this.close();
        this.onImportSuccess(courses);
        if (window.showToast) {
          window.showToast(`🎉 成功导入 ${courses.length} 门课程！`, 'success');
        }
      } catch (err) {
        this.showError('解析失败: ' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  open() {
    this._isOpen = true;
    this.showSelection();
    this.modalEl.style.setProperty('display', 'flex', 'important');
  }

  close() {
    this._isOpen = false;
    this.modalEl.style.setProperty('display', 'none', 'important');
  }

  isOpen() {
    return this._isOpen;
  }
}
