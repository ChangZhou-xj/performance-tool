'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * A8 工单查询服务
 * 通过 Python requests 脚本与 A8 系统交互，提取工单流程和处理人信息（纯 HTTP 版本）
 */

const A8_BASE_URL = process.env.A8_BASE_URL || 'http://120.35.0.67:28101/';
const A8_LOGIN_URL = process.env.A8_LOGIN_URL || 'http://120.35.0.67:28101/seeyon/main.do?method=main';
const A8_USERNAME = process.env.A8_USERNAME || '1003854';
const A8_PASSWORD = process.env.A8_PASSWORD || 'zxjqwe@621';

// Python 脚本路径
const SCRIPT_DIR = path.join(__dirname, '..', 'scripts');

/**
 * 批量查询多个工单的处理人信息
 * 使用纯 HTTP API 调用，无需 Playwright 浏览器
 * @param {string[]} ticketNos - 工单编号列表
 * @param {Function} [onProgress] - 进度回调 (current, total, ticketNo)
 * @returns {Promise<Map<string, object>>} ticketNo -> 工单信息的映射
 */
async function batchQueryWorkorders(ticketNos, onProgress) {
  // 过滤出有效的 A8 单号
  const validTicketNos = ticketNos.filter((no) => no && no.match(/^(KFXQ|QXWT)-CX-\d+$/));
  const uniqueTicketNos = [...new Set(validTicketNos)];

  if (uniqueTicketNos.length === 0) {
    return new Map();
  }

  const scriptPath = path.join(SCRIPT_DIR, 'a8-batch-query-api.py');
  const args = JSON.stringify({
    ticketNos: uniqueTicketNos,
    baseUrl: A8_BASE_URL,
    loginUrl: A8_LOGIN_URL,
    username: A8_USERNAME,
    password: A8_PASSWORD,
  });

  try {
    // Windows 上单引号不可靠，通过临时文件传递 JSON 参数
    const tmpFile = path.join(os.tmpdir(), `a8-query-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, args, 'utf-8');
    let result;
    try {
      result = execSync(`python3 "${scriptPath}" --file "${tmpFile}"`, {
        timeout: 300000, // 5分钟超时
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }

    const resultMap = new Map();
    const lines = result.trim().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('RESULT:')) {
        const jsonStr = trimmed.substring(7).trim();
        try {
          const data = JSON.parse(jsonStr);
          if (data.ticketNo) {
            // 新版 a8-batch-query-api.py 直接在根级别输出 developer/currentHandler
            const info = {
              developer: data.developer || data.info?.developer || null,
              currentHandler: data.currentHandler || data.info?.currentHandler || null,
            };
            resultMap.set(data.ticketNo, info);
            if (onProgress) {
              onProgress(resultMap.size, uniqueTicketNos.length, data.ticketNo);
            }
          }
        } catch (_) {
          // 忽略解析失败的行
        }
      }
    }

    return resultMap;
  } catch (err) {
    console.warn(`⚠️ A8 批量查询失败: ${err.message}`);
    return new Map();
  }
}

/**
 * 格式化处理人信息为简短文本
 * 只展示开发人员和当前处理人，用（）包括
 * @param {object} info - 工单信息
 * @returns {string} 如 "（开发人员：张三）（当前处理人：李四）"
 */
function formatHandlerInfo(info) {
  if (!info) return '';

  if (info.currentHandler) {
    return `（当前处理人：${info.currentHandler}）`;
  }

  return '';
}

/**
 * 抓包模式：登录 A8 并打开一个工单，记录所有 HTTP 请求
 * @param {string} ticketNo - 要抓包的工单号
 * @returns {Promise<Array>} 网络请求日志
 */
async function captureA8Requests(ticketNo) {
  // 抓包模式仅 Playwright 版本支持，HTTP 版本返回空
  // 如需抓包，临时切换回 a8-batch-query.py
  console.warn('⚠️ 抓包模式需要 Playwright 版本 (a8-batch-query.py)，当前使用 HTTP 版本');
  return [];
}

module.exports = {
  batchQueryWorkorders,
  formatHandlerInfo,
  captureA8Requests,
};