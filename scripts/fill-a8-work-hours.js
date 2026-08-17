'use strict';

const fs = require('fs');
const path = require('path');

const {
  A8_WORK_URL,
  A8_WORK_USERNAME,
  A8_WORK_PASSWORD,
  A8_WORK_FILL_METHOD,
  A8_WORK_HEADLESS,
  A8_WORK_SLOWMO,
  A8_WORK_PYTHON,
} = require('../config');
const { fillWorkHoursForAccount } = require('../service/a8-fill-service');
const { getServerChanConfig, sendServerChanNotify } = require('../send-serverchan');

const ACCOUNTS_FILE = path.join(__dirname, '..', 'a8-accounts.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getNow() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function getLogFilePath() {
  return path.join(LOGS_DIR, `${getToday()}-a8-fill.log`);
}

function loadLogEntries() {
  ensureLogsDir();
  const logFile = getLogFilePath();
  if (!fs.existsSync(logFile)) {
    return [];
  }
  try {
    const content = fs.readFileSync(logFile, 'utf-8').trim();
    if (!content) return [];
    return JSON.parse(content);
  } catch (err) {
    console.warn(`读取日志文件失败: ${err.message}`);
    return [];
  }
}

function saveLogEntries(entries) {
  ensureLogsDir();
  const logFile = getLogFilePath();
  fs.writeFileSync(logFile, JSON.stringify(entries, null, 2), 'utf-8');
}

function logMessage(entries, message) {
  const entry = { time: getNow(), message };
  entries.push(entry);
  console.log(`[${entry.time}] ${message}`);
  saveLogEntries(entries);
}

function saveResult(entries, accountName, success, details = {}) {
  const entry = {
    date: getToday(),
    time: getNow(),
    account: accountName,
    success,
    ...details,
  };
  entries.push(entry);
  saveLogEntries(entries);
}

async function sendNotification(entries, successCount, total) {
  const { sendKey } = getServerChanConfig();
  if (!sendKey) {
    logMessage(entries, '未配置 Server酱密钥 (SERVERCHAN_KEY / SCTKEY / SCKEY)，跳过通知');
    return;
  }

  const status = successCount === total ? '成功' : `失败(${successCount}/${total})`;
  logMessage(entries, `发送 Server酱 通知: ${status}`);
  try {
    await sendServerChanNotify({
      status,
      logFilePath: getLogFilePath(),
      titlePrefix: process.env.SERVERCHAN_TITLE_PREFIX || 'A8工时填报',
    });
    logMessage(entries, 'Server酱 通知发送成功');
  } catch (err) {
    logMessage(entries, `Server酱 通知忽略: ${err.message}`);
  }
}

function loadAccounts() {
  // 如果存在 a8-accounts.json，读取所有账号（不过滤 enabled，入口脚本按 --all 决定）
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
      const accounts = JSON.parse(data);
      if (!Array.isArray(accounts)) {
        throw new Error('a8-accounts.json 必须是数组');
      }
      return accounts;
    } catch (err) {
      console.error(`读取 ${ACCOUNTS_FILE} 失败: ${err.message}`);
      process.exit(1);
    }
  }

  // 否则使用 .env 单账号
  if (!A8_WORK_USERNAME || !A8_WORK_PASSWORD) {
    console.error('未配置 A8 工时填报账号（请检查 .env 或创建 a8-accounts.json）');
    process.exit(1);
  }

  return [
    {
      name: A8_WORK_USERNAME,
      username: A8_WORK_USERNAME,
      password: A8_WORK_PASSWORD,
      fillMethod: A8_WORK_FILL_METHOD,
    },
  ];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let user = null;
  let all = false;
  let date = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user' && i + 1 < args.length) {
      user = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      all = true;
    } else if (args[i] === '--date' && i + 1 < args.length) {
      date = args[i + 1];
      i++;
    }
  }

  return { user, all, date };
}

function resolveAccounts(rawAccounts, user, all) {
  if (user) {
    const matched = rawAccounts.find(
      (acc) => acc.username === user || acc.name === user,
    );
    if (!matched) {
      console.error(`未找到用户: ${user}`);
      process.exit(1);
    }
    return [matched];
  }

  if (all) {
    return rawAccounts.filter((acc) => acc.enabled !== false);
  }

  // 默认单账号模式
  if (rawAccounts.length === 1) {
    return [rawAccounts[0]];
  }

  // 存在多个账号但无 --all 时，默认处理第一个
  return [rawAccounts[0]];
}

async function main() {
  const startTime = new Date();
  const entries = loadLogEntries();
  logMessage(entries, '========== A8 工时填报开始 ==========');

  const { user, all, date } = parseArgs();
  const rawAccounts = loadAccounts();
  const accounts = resolveAccounts(rawAccounts, user, all);

  if (user) {
    logMessage(entries, `仅处理指定用户: ${user}`);
  } else if (all) {
    logMessage(entries, `批量处理 ${accounts.length} 个账号`);
  } else {
    logMessage(entries, `处理单账号: ${accounts[0].name || accounts[0].username}`);
  }

  if (accounts.length === 0) {
    logMessage(entries, '没有可处理的账号');
    process.exit(0);
  }

  logMessage(entries, `账号列表: ${accounts.map((a) => a.name || a.username).join(', ')}`);

  const options = {
    url: A8_WORK_URL,
    headless: A8_WORK_HEADLESS,
    slowMo: A8_WORK_SLOWMO,
    pythonCmd: A8_WORK_PYTHON,
    date,
  };

  const results = [];
  for (const account of accounts) {
    const accountName = account.name || account.username;
    logMessage(entries, `开始处理账号: ${accountName}`);
    const result = await fillWorkHoursForAccount(account, options);
    results.push(result);
    saveResult(entries, accountName, result.success, {
      error: result.error,
      screenshot: result.screenshot,
      fillMethod: account.fillMethod || 'template',
      steps: result.steps,
    });
    const status = result.success ? '✓ 成功' : `✗ 失败 - ${result.error}`;
    logMessage(entries, `${accountName}: ${status}`);
  }

  const endTime = new Date();
  const duration = Math.round((endTime - startTime) / 1000);
  const successCount = results.filter((r) => r.success).length;

  logMessage(entries, '========== A8 工时填报结果 ==========');
  for (const result of results) {
    const status = result.success ? '✓ 成功' : `✗ 失败 - ${result.error}`;
    logMessage(entries, `${result.account}: ${status}`);
  }
  logMessage(entries, `总计: ${successCount}/${results.length} 成功, 耗时: ${duration}秒`);
  logMessage(entries, '========== A8 工时填报结束 ==========');
  saveLogEntries(entries);

  // 由 ql-task-a8-fill.sh 驱动时由包装脚本统一发送通知，避免重复推送
  if (process.env.A8_NO_NOTIFY !== '1') {
    await sendNotification(entries, successCount, results.length);
  }

  process.exit(successCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
