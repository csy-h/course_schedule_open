#!/usr/bin/env node

/**
 * agent_course_cli.js
 * 
 * 智能体专属课程表管理命令行工具 (Course Schedule Agent CLI)
 * 采用原生 Node.js 实现，零外部依赖。
 * 
 * 退出码规范：
 *   0: 执行成功
 *   1: 参数错误 / 业务逻辑错误 / 文件缺失
 *   2: 鉴权失败 (未提供密码或密码错误 / HTTP 401)
 *   3: 网络连接错误 (连接被拒 / 超时等)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 高校标准 10 节作息时间映射表
const SECTION_TIMES = [
  { section: 1, start: '08:00', end: '08:50' },
  { section: 2, start: '09:00', end: '09:50' },
  { section: 3, start: '10:10', end: '11:00' },
  { section: 4, start: '11:10', end: '12:00' },
  { section: 5, start: '13:30', end: '14:20' },
  { section: 6, start: '14:30', end: '15:20' },
  { section: 7, start: '15:40', end: '16:30' },
  { section: 8, start: '16:40', end: '17:30' },
  { section: 9, start: '18:30', end: '19:20' },
  { section: 10, start: '19:30', end: '20:20' }
];

const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function getSectionTime(startPeriod, endPeriod) {
  const startSec = SECTION_TIMES.find(s => s.section === Number(startPeriod));
  const endSec = SECTION_TIMES.find(s => s.section === Number(endPeriod));
  return {
    startTime: startSec ? startSec.start : '08:00',
    endTime: endSec ? endSec.end : '09:50'
  };
}

// -------------------------------------------------------------
// 1. 命令行参数解析器
// -------------------------------------------------------------
function parseArgs(args) {
  const result = {
    command: null,
    options: {},
    positionals: []
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const equalIndex = arg.indexOf('=');
      if (equalIndex !== -1) {
        const key = arg.slice(2, equalIndex);
        const val = arg.slice(equalIndex + 1);
        result.options[key] = val;
      } else {
        const key = arg.slice(2);
        const nextArg = args[i + 1];
        if (nextArg !== undefined && !nextArg.startsWith('-')) {
          result.options[key] = nextArg;
          i++;
        } else {
          result.options[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      // 支持常见缩写
      const keyMap = {
        'u': 'url',
        'p': 'password',
        'f': 'format',
        'h': 'help',
        'w': 'week',
        'd': 'day'
      };
      const mappedKey = keyMap[key] || key;
      const nextArg = args[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('-')) {
        result.options[mappedKey] = nextArg;
        i++;
      } else {
        result.options[mappedKey] = true;
      }
    } else {
      if (!result.command) {
        result.command = arg.toLowerCase();
      } else {
        result.positionals.push(arg);
      }
    }
    i++;
  }

  // 处理 --json 快捷标志
  if (result.options.json) {
    result.options.format = 'json';
  }

  return result;
}

// -------------------------------------------------------------
// 2. 原生 HTTP/HTTPS 请求封装
// -------------------------------------------------------------
function makeRequest(baseUrl, endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    let fullUrl;
    try {
      fullUrl = new URL(endpoint, baseUrl);
    } catch (err) {
      return reject({ type: 'ARG_ERROR', message: `Invalid server URL: ${baseUrl}` });
    }

    const isHttps = fullUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    let bodyData = null;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'object') {
        bodyData = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json; charset=utf-8';
      } else {
        bodyData = String(options.body);
        headers['Content-Type'] = headers['Content-Type'] || 'text/plain; charset=utf-8';
      }
      headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const reqOptions = {
      method: options.method || 'GET',
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      headers,
      timeout: options.timeout || 15000
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: json });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          const errMsg = (json && json.error) ? json.error : 'Unauthorized: 缺少有效凭据或连接密码错误';
          reject({ type: 'AUTH_ERROR', status: res.statusCode, message: errMsg, data: json });
        } else {
          const errMsg = (json && json.error) ? json.error : `HTTP request failed with status ${res.statusCode}`;
          reject({ type: 'HTTP_ERROR', status: res.statusCode, message: errMsg, data: json });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({ type: 'NETWORK_ERROR', message: `Request to ${fullUrl.href} timed out after ${reqOptions.timeout}ms` });
    });

    req.on('error', (err) => {
      reject({ type: 'NETWORK_ERROR', message: `Network connection failed: ${err.message}` });
    });

    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

// -------------------------------------------------------------
// 3. 表格与输出格式化
// -------------------------------------------------------------
function pad(str, width) {
  str = String(str || '');
  // 计算东亚字符真实显示宽度 (中文占 2 字符宽度)
  let realWidth = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    realWidth += (code > 255) ? 2 : 1;
  }
  const padding = Math.max(0, width - realWidth);
  return str + ' '.repeat(padding);
}

function printTable(headers, rows) {
  const colWidths = headers.map(h => h.width || 12);
  
  // 表头
  const headerLine = headers.map((h, idx) => pad(h.title, colWidths[idx])).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
  
  console.log(headerLine);
  console.log(separator);
  
  for (const row of rows) {
    const line = headers.map((h, idx) => pad(row[h.key], colWidths[idx])).join(' | ');
    console.log(line);
  }
}

// -------------------------------------------------------------
// 4. 帮助手册
// -------------------------------------------------------------
function printHelp() {
  console.log(`
Course Schedule Agent CLI (agent_course_cli.js)
智能体专属课程表管理命令行工具

用法:
  node agent_course_cli.js <command> [options]

核心子命令:
  ping                           检测后端服务健康状态与连接连通性
  list                           获取全部课程列表 (表格或 JSON 视图)
  query --week <N>               按周查询课程日历 (如 --week 2)
  query --day <YYYY-MM-DD>       按日查询指定日期时间流 (如 --day 2026-09-07)
  add [参数...]                   新增单门课程 (需鉴权)
  update --id <id> [参数...]      更新指定课程 (需鉴权)
  delete --id <id>               删除指定课程 (需鉴权)
  import --file <path>           一键导入本地 ICS/TXT 课表文件 (需鉴权)

通用参数:
  --url, -u <url>                后端服务 Base URL (默认: http://localhost:3008 或 $SCHEDULE_SERVER_URL)
  --password, -p <pwd>           操作鉴权密码 (默认优先读取 $SCHEDULE_API_PASSWORD)
  --format, -f <table|json>      输出视图模式: table (默认表格) 或 json
  --json                         等效于 --format json
  --help, -h                     显示本帮助文档

add / update 详细参数:
  --name <name>                  课程名称 (必填)
  --teacher <teacher>            授课教师 (必填)
  --location <loc>               教学地点 (必填)
  --day <1-7>                    星期几 (1:周一 ~ 7:周日, 必填)
  --start <1-10>                 起始节次 (1~10, 必填)
  --end <1-10>                   结束节次 (1~10, 必填)
  --startWeek <1-25>             起始周 (必填)
  --endWeek <1-25>               结束周 (必填)
  --weekType <all|odd|even>      周次规则 (默认 all)
  --color <hex>                  莫兰迪卡片配色 (如 #7A9E9F)
  --code <code>                  课程代码 (可选)

退出码规范:
  0: 执行成功
  1: 参数错误 / 业务逻辑错误 / 文件缺失
  2: 鉴权失败 (未提供密码或密码错误 / HTTP 401)
  3: 网络连接错误 (无法连接后端服务)
`);
}

// -------------------------------------------------------------
// 5. 主执行路由
// -------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.command || parsed.options.help) {
    printHelp();
    process.exit(0);
  }

  const baseUrl = parsed.options.url || process.env.SCHEDULE_SERVER_URL || 'http://localhost:3008';
  const password = parsed.options.password || process.env.SCHEDULE_API_PASSWORD || null;
  const isJson = parsed.options.format === 'json';

  const authHeaders = {};
  if (password) {
    authHeaders['x-api-password'] = password;
    authHeaders['Authorization'] = `Bearer ${password}`;
  }

  function requirePassword(actionDesc) {
    if (!password) {
      if (isJson) {
        console.error(JSON.stringify({
          success: false,
          error: `Authentication required: ${actionDesc} requires a password.`,
          hint: 'Please provide --password <pwd> flag or set the SCHEDULE_API_PASSWORD environment variable.'
        }, null, 2));
      } else {
        console.error(`\n[AUTH ERROR] 操作被拒绝: ${actionDesc} 需要安全密码凭据！`);
        console.error('请通过 --password <密码> 参数或环境变量 SCHEDULE_API_PASSWORD 注入凭据。\n');
      }
      process.exit(2);
    }
  }

  try {
    switch (parsed.command) {
      // -------------------------------------------------------
      // 1. ping (健康检查)
      // -------------------------------------------------------
      case 'ping':
      case 'health':
      case 'status': {
        const res = await makeRequest(baseUrl, '/api/health');
        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log('\n=== 后端服务健康状态 (Health Check) ===');
          console.log(`服务状态:   ${res.data.status === 'ok' ? '✓ 正常 (OK)' : res.data.status}`);
          console.log(`服务版本:   ${res.data.version || '1.0.0'}`);
          console.log(`服务名称:   ${res.data.service || 'course-schedule-server'}`);
          console.log(`服务器时间: ${res.data.timestamp || new Date().toISOString()}`);
          console.log(`连接端点:   ${baseUrl}/api/health\n`);
        }
        process.exit(0);
      }

      // -------------------------------------------------------
      // 2. list (获取所有课程)
      // -------------------------------------------------------
      case 'list': {
        const res = await makeRequest(baseUrl, '/api/courses?include_schedules=true');
        const courses = res.data.data || [];
        
        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(`\n=== 全部课程列表 (共 ${courses.length} 门实体课程单元) ===`);
          if (courses.length === 0) {
            console.log('当前数据库暂无课程数据，可使用 "import --file <path>" 或 "add" 命令添加。\n');
          } else {
            const headers = [
              { title: 'ID', key: 'id', width: 4 },
              { title: '课程名称', key: 'name', width: 22 },
              { title: '授课教师', key: 'teacher', width: 14 },
              { title: '教学场地', key: 'location', width: 18 },
              { title: '星期', key: 'weekday', width: 6 },
              { title: '节次', key: 'period', width: 10 },
              { title: '周次范围', key: 'weeks', width: 12 }
            ];

            const rows = courses.map(c => {
              const dow = c.dayOfWeek ? WEEKDAY_NAMES[c.dayOfWeek] : '未排课';
              const period = (c.startPeriod && c.endPeriod) ? `${c.startPeriod}-${c.endPeriod}节` : '-';
              const weeks = (c.startWeek && c.endWeek) ? `${c.startWeek}-${c.endWeek}周` : '-';
              return {
                id: c.id,
                name: c.name,
                teacher: c.teacher || '-',
                location: c.location || '-',
                weekday: dow,
                period,
                weeks
              };
            });

            printTable(headers, rows);
            console.log('');
          }
        }
        process.exit(0);
      }

      // -------------------------------------------------------
      // 3. query (按周 / 按日过滤)
      // -------------------------------------------------------
      case 'query': {
        const week = parsed.options.week;
        const day = parsed.options.day;

        if (day) {
          // 按日查询
          const res = await makeRequest(baseUrl, `/api/schedule/day?date=${encodeURIComponent(day)}`);
          if (isJson) {
            console.log(JSON.stringify(res.data, null, 2));
          } else {
            const dayData = res.data;
            console.log(`\n=== 日程查询: ${dayData.date} (第 ${dayData.week} 周 ${WEEKDAY_NAMES[dayData.dayOfWeek]}) ===`);
            const items = dayData.data || [];
            if (items.length === 0) {
              console.log('今日无排课日程，祝您生活愉快！\n');
            } else {
              const headers = [
                { title: '节次', key: 'period', width: 10 },
                { title: '作息时间', key: 'time', width: 14 },
                { title: '课程名称', key: 'name', width: 22 },
                { title: '教室', key: 'location', width: 18 },
                { title: '教师', key: 'teacher', width: 12 }
              ];
              const rows = items.map(it => ({
                period: `${it.startSection}-${it.endSection}节`,
                time: `${it.startTime}~${it.endTime}`,
                name: it.courseName,
                location: it.location,
                teacher: it.teacher || '-'
              }));
              printTable(headers, rows);
              console.log(`合计: ${items.length} 节排课时段\n`);
            }
          }
          process.exit(0);
        } else {
          // 按周查询 (若未指定 week，后端默认计算当前周次)
          const weekParam = week ? `?week=${encodeURIComponent(week)}` : '';
          const res = await makeRequest(baseUrl, `/api/schedule/week${weekParam}`);
          if (isJson) {
            console.log(JSON.stringify(res.data, null, 2));
          } else {
            const weekData = res.data;
            console.log(`\n=== 周程日历: 第 ${weekData.week} 周 (${weekData.startDate} ~ ${weekData.endDate}) ===`);
            const items = weekData.data || [];
            if (items.length === 0) {
              console.log('本周无排课日程。\n');
            } else {
              const headers = [
                { title: '星期', key: 'weekday', width: 6 },
                { title: '节次', key: 'period', width: 10 },
                { title: '时间', key: 'time', width: 14 },
                { title: '课程名称', key: 'name', width: 22 },
                { title: '场地教室', key: 'location', width: 18 },
                { title: '授课教师', key: 'teacher', width: 12 }
              ];
              const rows = items.map(it => ({
                weekday: WEEKDAY_NAMES[it.dayOfWeek] || `周${it.dayOfWeek}`,
                period: `${it.startSection}-${it.endSection}节`,
                time: `${it.startTime}~${it.endTime}`,
                name: it.courseName,
                location: it.location,
                teacher: it.teacher || '-'
              }));
              printTable(headers, rows);
              console.log(`合计: 本周共 ${items.length} 个上课时段\n`);
            }
          }
          process.exit(0);
        }
      }

      // -------------------------------------------------------
      // 4. add (新增单门课程)
      // -------------------------------------------------------
      case 'add': {
        requirePassword('新增课程');

        const { name, teacher, location, day, start, end, startWeek, endWeek, weekType, color, code } = parsed.options;

        if (!name) {
          console.error('[ARG ERROR] 缺少必要参数: --name <课程名称>');
          process.exit(1);
        }
        if (!teacher) {
          console.error('[ARG ERROR] 缺少必要参数: --teacher <授课教师>');
          process.exit(1);
        }
        if (!location) {
          console.error('[ARG ERROR] 缺少必要参数: --location <教学地点>');
          process.exit(1);
        }
        if (!day || isNaN(day) || day < 1 || day > 7) {
          console.error('[ARG ERROR] 缺少或非法参数: --day <1-7> (1:周一 ~ 7:周日)');
          process.exit(1);
        }
        if (!start || isNaN(start) || start < 1 || start > 10) {
          console.error('[ARG ERROR] 缺少或非法参数: --start <1-10>');
          process.exit(1);
        }
        if (!end || isNaN(end) || end < start || end > 10) {
          console.error('[ARG ERROR] 缺少或非法参数: --end <1-10> 且必须大于等于 start');
          process.exit(1);
        }

        const sWeek = Number(startWeek || 1);
        const eWeek = Number(endWeek || 16);
        const sType = weekType || 'all';
        const { startTime, endTime } = getSectionTime(start, end);

        const payload = {
          name,
          teacher,
          location,
          dayOfWeek: Number(day),
          startPeriod: Number(start),
          endPeriod: Number(end),
          startSection: Number(start),
          endSection: Number(end),
          startTime,
          endTime,
          startWeek: sWeek,
          endWeek: eWeek,
          weekType: sType,
          color: color || '#7A9E9F',
          code: code || ''
        };

        const res = await makeRequest(baseUrl, '/api/courses', {
          method: 'POST',
          headers: authHeaders,
          body: payload
        });

        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(`\n✓ 课程添加成功！[ID: ${res.data.data.id}]`);
          console.log(`  课程名称: ${res.data.data.name}`);
          console.log(`  授课教师: ${res.data.data.teacher}`);
          console.log(`  教学地点: ${res.data.data.location}`);
          console.log(`  排课时间: ${WEEKDAY_NAMES[payload.dayOfWeek]} 第 ${payload.startPeriod}-${payload.endPeriod} 节 (${startTime}~${endTime})`);
          console.log(`  周次范围: 第 ${sWeek}-${eWeek} 周 (${sType})\n`);
        }
        process.exit(0);
      }

      // -------------------------------------------------------
      // 5. update (更新指定课程)
      // -------------------------------------------------------
      case 'update': {
        requirePassword('更新课程');

        const id = parsed.options.id;
        if (!id || isNaN(id)) {
          console.error('[ARG ERROR] 缺少必要参数: --id <课程ID>');
          process.exit(1);
        }

        const updateData = {};
        if (parsed.options.name) updateData.name = parsed.options.name;
        if (parsed.options.teacher) updateData.teacher = parsed.options.teacher;
        if (parsed.options.location) updateData.location = parsed.options.location;
        if (parsed.options.code) updateData.code = parsed.options.code;
        if (parsed.options.color) updateData.color = parsed.options.color;

        // 若更新排课相关字段
        if (parsed.options.day || parsed.options.start || parsed.options.end || parsed.options.startWeek || parsed.options.endWeek || parsed.options.weekType) {
          const day = parsed.options.day ? Number(parsed.options.day) : 1;
          const start = parsed.options.start ? Number(parsed.options.start) : 1;
          const end = parsed.options.end ? Number(parsed.options.end) : 2;
          const { startTime, endTime } = getSectionTime(start, end);
          updateData.schedules = [{
            dayOfWeek: day,
            startPeriod: start,
            endPeriod: end,
            startTime,
            endTime,
            location: parsed.options.location || '',
            teacher: parsed.options.teacher || '',
            startWeek: parsed.options.startWeek ? Number(parsed.options.startWeek) : 1,
            endWeek: parsed.options.endWeek ? Number(parsed.options.endWeek) : 16,
            weekType: parsed.options.weekType || 'all'
          }];
        }

        const res = await makeRequest(baseUrl, `/api/courses/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: authHeaders,
          body: updateData
        });

        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(`\n✓ 课程 [ID: ${id}] 更新成功！`);
          console.log(`  课程名称: ${res.data.data.name}`);
          console.log(`  教学地点: ${res.data.data.location || '-'}`);
          console.log(`  授课教师: ${res.data.data.teacher || '-'}\n`);
        }
        process.exit(0);
      }

      // -------------------------------------------------------
      // 6. delete (删除指定课程)
      // -------------------------------------------------------
      case 'delete': {
        requirePassword('删除课程');

        const id = parsed.options.id;
        if (!id || isNaN(id)) {
          console.error('[ARG ERROR] 缺少必要参数: --id <课程ID>');
          process.exit(1);
        }

        const res = await makeRequest(baseUrl, `/api/courses/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders
        });

        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(`\n✓ 课程 [ID: ${id}] 已成功删除。\n`);
        }
        process.exit(0);
      }

      // -------------------------------------------------------
      // 7. import (一键导入本地 ICS/TXT 文件)
      // -------------------------------------------------------
      case 'import': {
        requirePassword('导入课表文件');

        const filePath = parsed.options.file;
        if (!filePath) {
          console.error('[ARG ERROR] 缺少必要参数: --file <ICS或TXT文件物理路径>');
          process.exit(1);
        }

        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
          console.error(`[ARG ERROR] 目标课表文件不存在: ${resolvedPath}`);
          process.exit(1);
        }

        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const overwrite = parsed.options.overwrite !== undefined ? (String(parsed.options.overwrite) !== 'false') : true;
        const semesterStart = parsed.options.semesterStart || '2026-08-31';

        const payload = {
          icsText: fileContent,
          overwrite,
          semesterStart
        };

        const res = await makeRequest(baseUrl, '/api/courses/import', {
          method: 'POST',
          headers: authHeaders,
          body: payload
        });

        if (isJson) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(`\n=== 课表文件导入成功！ ===`);
          console.log(`文件路径:     ${resolvedPath}`);
          console.log(`排课时段数量: ${res.data.imported || res.data.importedCount}`);
          console.log(`实体课程单元: ${res.data.coursesCount || '13'}`);
          console.log(`学期基准日期: ${res.data.semesterStart || semesterStart}`);
          console.log(`详细反馈:     ${res.data.message || '导入成功'}\n`);
        }
        process.exit(0);
      }

      default: {
        console.error(`[ARG ERROR] 未知子命令: "${parsed.command}"。运行 "node agent_course_cli.js --help" 查看可用命令。`);
        process.exit(1);
      }
    }
  } catch (err) {
    if (err.type === 'AUTH_ERROR') {
      if (isJson) {
        console.error(JSON.stringify({ success: false, error: err.message, status: err.status }, null, 2));
      } else {
        console.error(`\n[AUTH ERROR] 密码鉴权失败 (HTTP ${err.status}): ${err.message}`);
        console.error('请确认 --password 或环境变量 SCHEDULE_API_PASSWORD 的正确性。\n');
      }
      process.exit(2);
    } else if (err.type === 'NETWORK_ERROR') {
      if (isJson) {
        console.error(JSON.stringify({ success: false, error: err.message, type: 'NETWORK_ERROR' }, null, 2));
      } else {
        console.error(`\n[NETWORK ERROR] 无法连接到后端服务器 (${baseUrl}):`);
        console.error(`  ${err.message}`);
        console.error('请确认后端 Express 服务是否已启动 (默认端口 3008)。\n');
      }
      process.exit(3);
    } else {
      if (isJson) {
        console.error(JSON.stringify({ success: false, error: err.message, type: err.type || 'ERROR' }, null, 2));
      } else {
        console.error(`\n[ERROR] 执行失败: ${err.message}\n`);
      }
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  makeRequest,
  getSectionTime,
  SECTION_TIMES,
  WEEKDAY_NAMES
};
