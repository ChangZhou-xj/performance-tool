'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const PYTHON_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'fill-a8-work-hours.py');

// 不可重试的错误：环境/依赖问题重试也是同样结果，重试只会白白拖长每日任务耗时。
const NON_RETRYABLE_RE = /启动 Python 失败|ModuleNotFoundError|No module named|playwright|libglib|shared libraries|cannot open shared object file/i;

/**
 * 判断某次失败是否值得重试。
 * 关键安全约束：一旦 steps 里出现「发送成功」，说明已点击过发送按钮，
 * 再重试可能造成重复提交工时，因此绝不重试。其余（登录/导航/历史记录加载等
 * 发送前阶段的失败，如 A8 服务端间歇性慢导致「未找到历史记录」）可安全重试。
 * @param {{success:boolean, error?:string|null, steps?:string[]}} result
 * @returns {boolean}
 */
function isRetryable(result) {
  if (result.success) return false;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (steps.includes('发送成功')) return false; // 已发送，禁止重试防重复提交
  if (result.error && NON_RETRYABLE_RE.test(result.error)) return false; // 环境问题，重试无意义
  return true;
}

/**
 * 执行一次 Python 子进程填报，返回解析后的结果对象。
 * @param {Function} spawnFn child_process.spawn（可注入以便测试）
 * @param {string} pythonCmd
 * @param {string} tmpFile 参数 JSON 文件路径
 * @param {number} timeout 子进程超时（毫秒）
 * @param {{name?:string, username?:string}} account
 * @returns {Promise<{success:boolean, account:string, error?:string|null, screenshot?:string|null, steps?:string[]}>}
 */
function runOnce(spawnFn, pythonCmd, tmpFile, timeout, account) {
  const accountName = account.name || account.username;
  return new Promise((resolve) => {
    const child = spawnFn(pythonCmd, [PYTHON_SCRIPT, '--file', tmpFile], {
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
        account: accountName,
        error: `启动 Python 失败: ${err.message}`,
        screenshot: null,
        steps: [],
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr || stdout || '无输出';
        let error = `Python 进程异常退出 (code=${code}): ${detail}`;
        // 常见环境问题：青龙首次部署缺 Playwright 依赖或浏览器系统库
        if (/ModuleNotFoundError|No module named|playwright/i.test(detail)) {
          error += '（提示：青龙首次使用请先运行 npm run setup:a8 安装 Playwright；'
            + '或已装专用 Python 时设置 A8_WORK_PYTHON 指向它）';
        } else if (/libglib|shared libraries|cannot open shared object file|Target page, context or browser has been closed/i.test(detail)) {
          error += '（提示：Chromium 浏览器系统依赖缺失，请在青龙容器内执行 npm run setup:a8 安装；'
            + '若安装后仍失败，请按 setup 脚本提示手动安装对应系统库）';
        }
        resolve({
          success: false,
          account: accountName,
          error,
          screenshot: null,
          steps: [],
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
          account: accountName,
          error: `未解析到 RESULT 输出: ${stdout || '空输出'}`,
          screenshot: null,
          steps: [],
        });
        return;
      }

      try {
        const result = JSON.parse(resultLine.substring(7));
        resolve({
          success: result.success || false,
          account: result.account || accountName,
          error: result.error || null,
          screenshot: result.screenshot || null,
          steps: Array.isArray(result.steps) ? result.steps : [],
        });
      } catch (err) {
        resolve({
          success: false,
          account: accountName,
          error: `解析 RESULT 失败: ${err.message}`,
          screenshot: null,
          steps: [],
        });
      }
    });
  });
}

/**
 * 为单个账号执行 A8 工时填报
 * 通过 Python 子进程调用 Playwright 浏览器自动化脚本。
 *
 * A8 服务端延迟存在波动：历史记录（「我发起的数据」区）由异步 XHR 填充，
 * 服务端慢时单次运行可能来不及加载（2026-09-04 同账号重跑即成功，2026-09-07
 * 单次运行等满 30s 容器仍为空）。因此对「发送前阶段」的可重试失败做有界重试，
 * 把间歇性失败转化为最终成功；已发送过的绝不重试以防重复提交。
 *
 * @param {Object} account
 * @param {string} account.name 显示名称
 * @param {string} account.username 账号
 * @param {string} account.password 密码
 * @param {string} [account.fillMethod='template'] 填写方式：template 或 copy
 * @param {Object} [options={}]
 * @param {string} [options.url] A8 登录页 URL
 * @param {boolean} [options.headless=true] 是否无头模式
 * @param {number} [options.slowMo=300] Playwright slowMo
 * @param {number} [options.timeout=300000] 单次 Python 进程超时（毫秒）
 * @param {string} [options.date] 指定填报日期 YYYY-MM-DD
 * @param {number} [options.attempts=2] 最多尝试次数（含首次）；仅对发送前的可重试失败生效
 * @param {Function} [options.spawnFn] child_process.spawn（可注入，主要用于测试）
 * @param {string} [options.pythonCmd='python3'] Python 解释器命令
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
    pythonCmd = 'python3',
    attempts = 2,
    spawnFn = spawn,
  } = options;

  if (!account || !account.username || !account.password) {
    return {
      success: false,
      account: account?.name || account?.username || 'unknown',
      error: '账号或密码缺失',
      screenshot: null,
      steps: [],
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

  const maxAttempts = Math.max(1, Number(attempts) || 1);

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(params), 'utf-8');

    let lastResult = null;
    let attemptsMade = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastResult = await runOnce(spawnFn, pythonCmd, tmpFile, timeout, account);
      attemptsMade = attempt;

      if (lastResult.success) return lastResult;

      // 不可重试（已发送 / 环境问题）或已用尽次数：停止
      if (attempt >= maxAttempts || !isRetryable(lastResult)) {
        break;
      }
      // 可重试：记录并重跑（重新登录+导航，规避 A8 服务端本次慢导致的加载失败）
      console.error(
        `[a8-fill] ${lastResult.account} 第 ${attempt}/${maxAttempts} 次尝试失败（发送前），重试中: ${lastResult.error || '未知错误'}`,
      );
    }

    // 多次尝试后仍失败：标注重试次数，便于日志与 Server酱 通知定位间歇性问题
    if (!lastResult.success && attemptsMade > 1) {
      lastResult.error = `${lastResult.error || '未知错误'}（已重试 ${attemptsMade} 次仍失败）`;
    }
    return lastResult;
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
  isRetryable,
};
