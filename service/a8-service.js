'use strict';

const { execSync } = require('child_process');
const path = require('path');

/**
 * A8 工单查询服务
 * 通过 Python Playwright 脚本与 A8 系统交互，提取工单流程和处理人信息
 */

const A8_BASE_URL = process.env.A8_BASE_URL || 'http://120.35.0.67:28101/';
const A8_LOGIN_URL = process.env.A8_LOGIN_URL || 'http://120.35.0.67:28101/seeyon/main.do?method=main';
const A8_USERNAME = process.env.A8_USERNAME || '1003854';
const A8_PASSWORD = process.env.A8_PASSWORD || 'zxjqwe@621';

// Python 脚本路径
const SCRIPT_DIR = path.join(__dirname, '..', 'scripts');

/**
 * 批量查询多个工单的处理人信息
 * 使用同一个浏览器会话，避免重复登录
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

  const scriptPath = path.join(SCRIPT_DIR, 'a8-batch-query.py');
  const args = JSON.stringify({
    ticketNos: uniqueTicketNos,
    baseUrl: A8_BASE_URL,
    loginUrl: A8_LOGIN_URL,
    username: A8_USERNAME,
    password: A8_PASSWORD,
  });

  try {
    const result = execSync(`python3 "${scriptPath}" '${args.replace(/'/g, "'\\''")}'`, {
      timeout: 300000, // 5分钟超时
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const resultMap = new Map();
    const lines = result.trim().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('RESULT:')) {
        const jsonStr = trimmed.substring(7).trim();
        try {
          const data = JSON.parse(jsonStr);
          if (data.ticketNo && data.info) {
            resultMap.set(data.ticketNo, data.info);
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
 * @param {object} info - 工单信息
 * @returns {string} 如 "开发：张三，当前处理：李四"
 */
function formatHandlerInfo(info) {
  if (!info) return '';

  const parts = [];
  if (info.developer) {
    parts.push(`开发：${info.developer}`);
  }
  if (info.currentHandler) {
    parts.push(`当前处理：${info.currentHandler}`);
  } else if (info.currentNode) {
    parts.push(`当前节点：${info.currentNode}`);
  }

  return parts.length > 0 ? parts.join('，') : '';
}

module.exports = {
  batchQueryWorkorders,
  formatHandlerInfo,
};