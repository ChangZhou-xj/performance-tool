'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const PYTHON_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'fill-a8-work-hours.py');

/**
 * 为单个账号执行 A8 工时填报
 * 通过 Python 子进程调用 Playwright 浏览器自动化脚本
 * @param {Object} account
 * @param {string} account.name 显示名称
 * @param {string} account.username 账号
 * @param {string} account.password 密码
 * @param {string} [account.fillMethod='template'] 填写方式：template 或 copy
 * @param {Object} [options={}]
 * @param {string} [options.url] A8 登录页 URL
 * @param {boolean} [options.headless=true] 是否无头模式
 * @param {number} [options.slowMo=300] Playwright slowMo
 * @param {number} [options.timeout=300000] Python 进程超时（毫秒）
 * @param {string} [options.date] 指定填报日期 YYYY-MM-DD
 * @returns {Promise<{success: boolean, account: string, error?: string, screenshot?: string, steps?: string[]}>}
 */
async function fillWorkHoursForAccount(account, options = {}) {
  const {
    url = '',
    headless = true,
    slowMo = 300,
    timeout = 300000,
    date,
    dryRun = false,
  } = options;

  if (!account || !account.username || !account.password) {
    return {
      success: false,
      account: account?.name || account?.username || 'unknown',
      error: '账号或密码缺失',
      screenshot: null,
    };
  }

  const params = {
    url,
    username: account.username,
    password: account.password,
    name: account.name || account.username,
    fillMethod: account.fillMethod || 'template',
    headless,
    slowMo,
  };

  if (date) {
    params.date = date;
  }

  if (dryRun) {
    params.dryRun = true;
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `a8-fill-${Date.now()}-${account.username}.json`,
  );

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(params), 'utf-8');

    const childPromise = new Promise((resolve) => {
      const child = spawn('python3.12', [PYTHON_SCRIPT, '--file', tmpFile], {
        cwd: PROJECT_ROOT,
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          account: account.name || account.username,
          error: `启动 Python 失败: ${err.message}`,
          screenshot: null,
        });
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            account: account.name || account.username,
            error: `Python 进程异常退出 (code=${code}): ${stderr || stdout || '无输出'}`,
            screenshot: null,
          });
          return;
        }

        const resultLine = stdout
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('RESULT:'));

        if (!resultLine) {
          resolve({
            success: false,
            account: account.name || account.username,
            error: `未解析到 RESULT 输出: ${stdout || '空输出'}`,
            screenshot: null,
          });
          return;
        }

        try {
          const result = JSON.parse(resultLine.substring(7));
          resolve({
            success: result.success || false,
            account: result.account || account.name || account.username,
            error: result.error || null,
            screenshot: result.screenshot || null,
            steps: result.steps || [],
          });
        } catch (err) {
          resolve({
            success: false,
            account: account.name || account.username,
            error: `解析 RESULT 失败: ${err.message}`,
            screenshot: null,
          });
        }
      });
    });

    return await childPromise;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {
      // 临时文件可能不存在或已删除，忽略
    }
  }
}

module.exports = {
  fillWorkHoursForAccount,
};
