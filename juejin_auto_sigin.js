// v3.0 - 掘金自动签到 Node.js 版本（青龙面板）
// 移除 axios 依赖，改用 Node 18+ 内置的全局 fetch。
// 原因：青龙容器中 require('axios') 会因 node_modules 缺失/不可达报 MODULE_NOT_FOUND，
// 而 Node v20.20.2 自带 fetch，无需安装、脚本自包含更稳。业务逻辑与原 axios 版本一致。

/**
 * 环境变量配置说明：
 * JJ_COOKIE - 完整的掘金 Cookie（包含 csrf_session_id, sessionid 等）
 * JUEJIN_PARAMS - JSON格式的请求参数，包含 AID, UUID, SPIDER, MSTOKEN(需URL编码), A_BOGUS
 * SERVERCHAN_KEY - Server酱推送的 SendKey
 *
 * 示例：
 * export JJ_COOKIE="store-region=cn-bj; csrf_session_id=xxx; sessionid=xxx; ..."
 * export JUEJIN_PARAMS='{"AID":"2608","UUID":"xxx","SPIDER":"0","MSTOKEN":"xxx%3D%3D","A_BOGUS":"xxx"}'
 * export SERVERCHAN_KEY="SCTxxxxx"
 */

'use strict';

/**
 * 统一 HTTP 请求封装（替代 axios），返回与原 axios 兼容的 { status, data, headers, config }。
 * - params: 对象，自动拼接到 URL 查询串
 * - body:   字符串或对象；对象会被 JSON 序列化
 * - timeout(ms): 用 AbortController 实现超时，超时即中止请求
 */
async function httpRequest(url, { method = 'GET', params, body, headers = {}, timeout = 10000 } = {}) {
  // 拼接查询参数
  if (params && Object.keys(params).length > 0) {
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qp.append(k, v);
    }
    const qs = qp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let bodyOpt;
  if (body !== undefined && body !== null) {
    bodyOpt = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyOpt,
      signal: controller.signal
    });

    // 读取响应体：优先解析 JSON，失败则按纯文本保留
    const raw = await res.text();
    let data = raw || '';
    if (raw) {
      try { data = JSON.parse(raw); } catch { /* 保持 raw 文本 */ }
    }

    let resHeaders;
    try { resHeaders = Object.fromEntries(res.headers.entries()); } catch { resHeaders = {}; }

    // config.url 仅供调试模式读取，兼容原 axios response.config.url
    return { status: res.status, data, headers: resHeaders, config: { url } };
  } finally {
    clearTimeout(timer);
  }
}

function httpGet(url, headers, timeout, params) {
  return httpRequest(url, { method: 'GET', headers, timeout, params });
}

function httpPost(url, headers, timeout, { params, body } = {}) {
  return httpRequest(url, { method: 'POST', headers, timeout, params, body });
}

// ==================== 代理配置区域 ====================
// 是否启用代理（true/false）
const USE_PROXY = false;

// 代理配置
const PROXY_CONFIG = {
  host: '127.0.0.1',
  port: 8080,
  protocol: 'http'
};

// 是否启用调试模式（打印详细请求信息）
const DEBUG_MODE = false;
// ==================== 代理配置区域结束 ====================

/**
 * 带时间戳的日志输出
 */
function logWithTime(message) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${timestamp}] ${message}`);
}

/**
 * 获取 axios 请求配置（包含代理配置）
 */
function getRequestConfig() {
  const config = {
    timeout: 10000
  };

  if (USE_PROXY) {
    // 原生 fetch 不支持 axios 的 proxy 选项；如需代理，请改用标准代理环境变量：
    //   export HTTP_PROXY=http://127.0.0.1:8080
    //   export HTTPS_PROXY=http://127.0.0.1:8080
    logWithTime('【注意】原生 fetch 忽略 proxy 配置，如需代理请使用 HTTP_PROXY/HTTPS_PROXY 环境变量');
  }

  return config;
}

/**
 * 脚本初始化时，仅打印一次代理状态
 */
function printProxyStatusOnce() {
  if (USE_PROXY) {
    logWithTime('【代理状态】已启用代理');
  } else {
    logWithTime('【代理状态】未启用代理');
  }
}

/**
 * Server酱推送函数
 */
async function sendServerChan(sendKey, title, content) {
  const url = `https://sctapi.ftqq.com/${sendKey}.send`;
  try {
    const params = { title, desp: content };
    const response = await httpPost(url, { 'Content-Type': 'application/x-www-form-urlencoded' }, 10000, {
      body: new URLSearchParams(params).toString()
    });

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】${JSON.stringify(params)}`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200 && response.data.code === 0) {
      logWithTime('【Server酱推送】消息发送成功 ✓');
    } else {
      logWithTime(`【Server酱推送】发送失败: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    logWithTime(`【Server酱推送】发生错误: ${error.message}`);
  }
}

/**
 * 检查今日是否已签到
 */
async function checkSignInStatus(baseUrl, headers) {
  const api = 'get_today_status';
  const url = baseUrl + api;

  try {
    const config = getRequestConfig();
    const response = await httpGet(url, headers, config.timeout);

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】无`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      // 处理空响应
      if (!data || typeof data !== 'object' || data === '') {
        logWithTime('【签到状态检查】服务器返回空响应（反爬虫参数可能失效）');
        return { success: false, message: '【签到状态检查】反爬虫参数失效，请更新配置' };
      }

      if (data.err_no === 0) {
        if (data.data === true) {
          logWithTime('【今日是否签到】已签到 ✓');
          return { success: true, message: '【今日是否签到】已签到' };
        } else if (data.data === false) {
          logWithTime('【今日是否签到】未签到');
          return { success: false, message: '【今日是否签到】未签到' };
        }
      } else if (data.err_no === 403) {
        logWithTime('【登录状态】Cookie已失效,请更新Cookie');
        return { success: false, message: '【登录状态】Cookie已失效,请更新Cookie' };
      } else if (data.err_no === 401) {
        logWithTime('【登录状态】未授权,请重新登录');
        return { success: false, message: '【登录状态】未授权,请重新登录' };
      } else if (data.err_no === 400) {
        logWithTime('【请求参数】参数错误,请检查配置');
        return { success: false, message: '【请求参数】参数错误,请检查配置' };
      } else {
        logWithTime(`【当前登录状态】未登录或异常(err_no: ${data.err_no}),请更新Cookie`);
        return { success: false, message: `【当前登录状态】未登录或异常(err_no: ${data.err_no}),请更新Cookie` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【签到状态检查】请求异常: ${error.message}`);
    return { success: false, message: `【签到状态检查】请求异常: ${error.message}` };
  }
}

/**
 * 执行签到
 */
async function signIn(baseUrl, params, headers) {
  const url = `${baseUrl}check_in`;

  try {
    const config = getRequestConfig();
    const response = await httpPost(url, headers, config.timeout, { params, body: {} });

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】${JSON.stringify(params)}`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      if (data.err_no === 0 && data.err_msg === 'success') {
        logWithTime('【当前签到状态】签到成功 ✓');
        return { success: true, message: '【当前签到状态】签到成功' };
      } else if (data.err_no === 3013) {
        logWithTime(`【当前签到状态】${data.err_msg}`);
        return { success: false, message: `【当前签到状态】${data.err_msg}` };
      } else if (data.err_no === 15001) {
        logWithTime('【当前签到状态】重复签到');
        return { success: true, message: '【当前签到状态】重复签到' };
      } else if (data.err_no === 403) {
        logWithTime('【签到失败】Cookie已失效,请更新');
        return { success: false, message: '【签到失败】Cookie已失效,请更新' };
      } else if (data.err_no === 401) {
        logWithTime('【签到失败】登录态已过期,请重新登录');
        return { success: false, message: '【签到失败】登录态已过期,请重新登录' };
      } else if (data.err_no === 400) {
        logWithTime('【签到失败】请求参数错误');
        return { success: false, message: '【签到失败】请求参数错误' };
      } else {
        logWithTime(`【当前签到状态】${data.err_msg || '未知错误'} (err_no: ${data.err_no})`);
        return { success: false, message: `【当前签到状态】${data.err_msg || '未知错误'} (err_no: ${data.err_no})` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【签到功能】请求异常: ${error.message}`);
    return { success: false, message: `【签到功能】请求异常: ${error.message}` };
  }
}

/**
 * 获取当前矿石余额
 */
async function getPoints(baseUrl, headers) {
  const api = 'get_cur_point';
  const url = baseUrl + api;

  try {
    const config = getRequestConfig();
    const response = await httpGet(url, headers, config.timeout);

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】无`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      if (data.err_no === 0 && data.err_msg === 'success') {
        const points = data.data;
        logWithTime(`【矿石最新余额】${points} 💎`);
        return { success: true, points, message: `【矿石最新余额】${points}` };
      } else if (data.err_no === 403) {
        logWithTime('【获取余额失败】Cookie已失效');
        return { success: false, message: '【获取余额失败】Cookie已失效' };
      } else if (data.err_no === 401) {
        logWithTime('【获取余额失败】登录态已过期');
        return { success: false, message: '【获取余额失败】登录态已过期' };
      } else {
        logWithTime(`【API错误】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}`);
        return { success: false, message: `【API错误】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【获取余额功能】请求异常: ${error.message}`);
    return { success: false, message: `【获取余额功能】请求异常: ${error.message}` };
  }
}

/**
 * 检查是否有免费抽奖次数
 */
async function getFree(baseUrl, params, headers) {
  const url = `${baseUrl}lottery_config/get`;

  try {
    const config = getRequestConfig();
    const response = await httpGet(url, headers, config.timeout, params);

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${response.config.url}`);
      logWithTime(`【调试-请求参数】${JSON.stringify(params)}`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      // 处理空响应（反爬虫拦截）
      if (!data || typeof data !== 'object' || data === '') {
        logWithTime('【查询失败】服务器返回空响应，可能原因：');
        logWithTime('  1. a_bogus 参数已过期（需重新获取）');
        logWithTime('  2. msToken 参数已失效（需重新获取）');
        logWithTime('  3. Cookie 已过期或不完整');
        logWithTime('  提示：请打开浏览器 F12，重新复制最新的参数');
        return { success: false, message: '【查询失败】反爬虫参数失效，请更新 a_bogus 和 msToken' };
      }

      if (data.err_no === 0 && data.err_msg === 'success') {
        const freeCount = data.data?.free_count || 0;
        logWithTime(`【免费抽奖次数】${freeCount} 次 🎟️`);
        return { success: freeCount > 0, message: `【免费抽奖次数】${freeCount}` };
      } else if (data.err_no === 403) {
        logWithTime('【查询失败】Cookie已失效');
        return { success: false, message: '【查询失败】Cookie已失效' };
      } else if (data.err_no === 401) {
        logWithTime('【查询失败】登录态已过期');
        return { success: false, message: '【查询失败】登录态已过期' };
      } else {
        logWithTime(`【API错误】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}`);
        return { success: false, message: `【API错误】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【获取免费抽奖次数功能】请求异常: ${error.message}`);
    return { success: false, message: `【获取免费抽奖次数功能】请求异常: ${error.message}` };
  }
}

/**
 * 执行抽奖
 */
async function draw(baseUrl, params, headers) {
  const url = `${baseUrl}lottery/draw`;

  try {
    const config = getRequestConfig();
    const response = await httpPost(url, headers, config.timeout, { params, body: {} });

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】${JSON.stringify(params)}`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      if (data.err_no === 0 && data.err_msg === 'success') {
        const lotteryName = data.data.lottery_name;
        logWithTime(`【今日抽奖奖品】${lotteryName} 🎉`);
        return { success: true, message: `【今日抽奖奖品】${lotteryName}` };
      } else if (data.err_no === 403) {
        logWithTime('【抽奖失败】Cookie已失效');
        return { success: false, message: '【抽奖失败】Cookie已失效' };
      } else if (data.err_no === 401) {
        logWithTime('【抽奖失败】登录态已过期');
        return { success: false, message: '【抽奖失败】登录态已过期' };
      } else if (data.err_no === 2002) {
        logWithTime('【抽奖失败】没有抽奖次数');
        return { success: false, message: '【抽奖失败】没有抽奖次数' };
      } else {
        logWithTime(`【抽奖失败】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}`);
        return { success: false, message: `【抽奖失败】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【抽奖功能】请求异常: ${error.message}`);
    return { success: false, message: `【抽奖功能】请求异常: ${error.message}` };
  }
}

/**
 * 获取中奖信息和幸运值
 */
async function getWin(baseUrl, aid, uuid, spider, headers) {
  const api = 'lottery_lucky/my_lucky';
  const url = baseUrl + api;

  try {
    const config = getRequestConfig();
    const requestParams = { aid, uuid, spider };
    const response = await httpPost(url, {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded'
    }, config.timeout, {
      body: new URLSearchParams(requestParams).toString()
    });

    // 调试模式：打印请求详情
    if (DEBUG_MODE) {
      logWithTime(`【调试-请求URL】${url}`);
      logWithTime(`【调试-请求参数】${JSON.stringify(requestParams)}`);
      logWithTime(`【调试-响应状态】${response.status}`);
      logWithTime(`【调试-响应头】${JSON.stringify(response.headers)}`);
      logWithTime(`【调试-数据类型】${typeof response.data}`);
      logWithTime(`【调试-原始数据】${response.data}`);
      logWithTime(`【调试-响应内容】${JSON.stringify(response.data)}`);
    }

    if (response.status === 200) {
      const data = response.data;

      if (data.err_no === 0 && data.err_msg === 'success') {
        const totalValue = data.data.total_value;
        const pointsResult = await getPoints(baseUrl, headers);

        if (pointsResult.success) {
          const needPoints = (6000 - totalValue) * 20;
          const diff = pointsResult.points - needPoints;
          logWithTime(`【当前幸运数值】${totalValue}/6000 🍀`);

          if (diff >= 0) {
            logWithTime('【距离中奖还差】0 矿石 (已满足条件 ✓)');
            return { success: true, message: `【当前幸运数值】${totalValue}\n【距离中奖还差】0 矿石！` };
          } else {
            logWithTime(`【距离中奖还差】${Math.abs(diff)} 矿石`);
            return { success: true, message: `【当前幸运数值】${totalValue}\n【距离中奖还差】${Math.abs(diff)} 矿石！` };
          }
        } else {
          return { success: false, message: pointsResult.message };
        }
      } else if (data.err_no === 403) {
        logWithTime('【获取幸运值失败】Cookie已失效');
        return { success: false, message: '【获取幸运值失败】Cookie已失效' };
      } else if (data.err_no === 401) {
        logWithTime('【获取幸运值失败】登录态已过期');
        return { success: false, message: '【获取幸运值失败】登录态已过期' };
      } else {
        logWithTime(`【获取幸运值失败】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}`);
        return { success: false, message: `【获取幸运值失败】err_no: ${data.err_no}, err_msg: ${data.err_msg || '未知错误'}` };
      }
    } else {
      logWithTime(`【请求失败】HTTP 状态码: ${response.status}`);
      return { success: false, message: `【请求失败】HTTP 状态码: ${response.status}` };
    }
  } catch (error) {
    logWithTime(`【获取幸运值功能】请求异常: ${error.message}`);
    return { success: false, message: `【获取幸运值功能】请求异常: ${error.message}` };
  }
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 主函数
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  logWithTime('掘金自动签到脚本 v3.0 (Node.js版本) 启动');
  console.log('='.repeat(60) + '\n');

  logWithTime('⚠️  重要提示：a_bogus 和 msToken 参数有效期较短（通常几分钟）');
  logWithTime('⚠️  如遇到空响应错误，请重新打开浏览器 F12 获取最新参数');
  console.log();

  // 显示代理状态（仅一次）
  printProxyStatusOnce();
  console.log();

  // 获取环境变量
  const cookie = process.env.JJ_COOKIE;
  const paramsStr = process.env.JUEJIN_PARAMS;
  const serverChanKey = process.env.SERVERCHAN_KEY;

  if (!cookie || !paramsStr || !serverChanKey) {
    logWithTime('❌ 错误：缺少必要环境变量 JJ_COOKIE, JUEJIN_PARAMS 或 SERVERCHAN_KEY');
    process.exit(1);
  }

  // 解析 JUEJIN_PARAMS
  let params;
  try {
    params = JSON.parse(paramsStr);
    const { AID: aid, UUID: uuid, SPIDER: spider, MSTOKEN: msToken, A_BOGUS: aBogus } = params;

    // URL 解码参数（因为 axios 会自动编码，避免双重编码）
    const decodedMsToken = decodeURIComponent(msToken);
    const decodedABogus = decodeURIComponent(aBogus);

    logWithTime('✓ 配置参数加载成功');
    if (DEBUG_MODE) {
      logWithTime(`  - 原始 msToken: ${msToken.substring(0, 20)}...`);
      logWithTime(`  - 解码后 msToken: ${decodedMsToken.substring(0, 20)}...`);
      logWithTime(`  - 原始 a_bogus: ${aBogus}`);
      logWithTime(`  - 解码后 a_bogus: ${decodedABogus}`);
    }

    const baseUrl = 'https://api.juejin.cn/growth_api/v1/';
    const commonParams = {
      aid,
      uuid,
      spider,
      msToken: decodedMsToken,   // 使用解码后的值
      a_bogus: decodedABogus      // 使用解码后的值
    };

    const headers = {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0',
      'origin': 'https://juejin.cn',
      'Referer': 'https://juejin.cn/',
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'content-type': 'application/json',
      'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'priority': 'u=1, i'
    };

    // 存储通知消息
    const notifyMessages = ['【掘金签到结果】'];

    // 检查签到状态
    console.log('\n' + '-'.repeat(60));
    logWithTime('步骤1: 检查签到状态');
    console.log('-'.repeat(60));
    const signStatus = await checkSignInStatus(baseUrl, headers);
    notifyMessages.push(signStatus.message);

    if (signStatus.success) {
      console.log('\n' + '-'.repeat(60));
      logWithTime('步骤2: 检查抽奖机会');
      console.log('-'.repeat(60));
      const freeStatus = await getFree(baseUrl, commonParams, headers);
      notifyMessages.push(freeStatus.message);

      if (freeStatus.success) {
        const drawStatus = await draw(baseUrl, commonParams, headers);
        notifyMessages.push(drawStatus.message);
      }
    } else {
      console.log('\n' + '-'.repeat(60));
      logWithTime('步骤2: 执行签到');
      console.log('-'.repeat(60));
      let signResult = await signIn(baseUrl, commonParams, headers);
      notifyMessages.push(signResult.message);

      if (!signResult.success) {
        logWithTime('签到失败，1秒后重试...');
        await sleep(1000);
        signResult = await signIn(baseUrl, commonParams, headers);
        notifyMessages.push(signResult.message);
      }

      console.log('\n' + '-'.repeat(60));
      logWithTime('步骤3: 检查抽奖机会');
      console.log('-'.repeat(60));
      const freeStatus = await getFree(baseUrl, commonParams, headers);
      notifyMessages.push(freeStatus.message);

      if (freeStatus.success) {
        const drawStatus = await draw(baseUrl, commonParams, headers);
        notifyMessages.push(drawStatus.message);
      }
    }

    // 获取幸运值和余额
    console.log('\n' + '-'.repeat(60));
    logWithTime('步骤4: 查询幸运值信息');
    console.log('-'.repeat(60));
    const winStatus = await getWin(baseUrl, aid, uuid, spider, headers);
    notifyMessages.push(winStatus.message);

    // 发送 Server酱通知
    console.log('\n' + '-'.repeat(60));
    logWithTime('步骤5: 发送通知');
    console.log('-'.repeat(60));
    const title = '掘金签到结果';
    const content = notifyMessages.join('\n');
    if (!DEBUG_MODE) {
      await sendServerChan(serverChanKey, title, content);
    }

    console.log('\n' + '='.repeat(60));
    logWithTime('所有任务执行完成 ✓');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    logWithTime(`❌ 错误：JUEJIN_PARAMS 解析失败 - ${error.message}`);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  logWithTime(`❌ 程序执行出错: ${error.message}`);
  process.exit(1);
});
