'use strict';
require('dotenv').config();
const process = require('process');

// tencentDocsId
const TENCENT_DOCS_ID = process.env.TENCENT_DOCS_ID;

// tencentDocsCookie
const TENCENT_DOCS_COOKIE = process.env.TENCENT_DOCS_COOKIE;

// userName
const USER_NAME = process.env.USER_NAME;

//month
const MONTH = process.env.MONTH

//year
const YEAR = process.env.YEAR

//DEPARTMENT
const DEPARTMENT = process.env.DEPARTMENT

//EXCLUDE_MEMBER
const EXCLUDE_MEMBER = process.env.EXCLUDE_MEMBER

// A8 工时填报配置
// 默认复用项目已有 A8 系统的账号和登录地址
const A8_WORK_BASE_URL = process.env.A8_BASE_URL || 'http://120.35.0.67:28101';
const A8_WORK_URL = process.env.A8_WORK_URL || process.env.A8_LOGIN_URL || `${A8_WORK_BASE_URL}/seeyon/main.do?method=main`;
const A8_WORK_USERNAME = process.env.A8_WORK_USERNAME || process.env.A8_USERNAME || '1003854';
const A8_WORK_PASSWORD = process.env.A8_WORK_PASSWORD || process.env.A8_PASSWORD || '';
const A8_WORK_FILL_METHOD = process.env.A8_WORK_FILL_METHOD || 'copy';
const A8_WORK_HEADLESS = process.env.A8_WORK_HEADLESS !== 'false';
const A8_WORK_SLOWMO = Number(process.env.A8_WORK_SLOWMO || '300');
// Python 解释器命令，用于运行 Playwright 自动化脚本（Windows 可能是 python/py，Linux/青龙为 python3）
const A8_WORK_PYTHON = process.env.A8_WORK_PYTHON || 'python3';
// 单账号最多尝试次数（含首次）。A8 服务端延迟波动会使「发送前」阶段（登录/导航/历史记录加载）
// 偶发失败，重跑一次即可成功；已点击发送的绝不重试以防重复提交。默认 2 次。
const A8_FILL_ATTEMPTS = Number(process.env.A8_FILL_ATTEMPTS || '2');

// 邮件配置
const EMAIL_CONFIG = {
  host: process.env.EMAIL_HOST || 'smtp.exmail.qq.com',
  port: process.env.EMAIL_PORT || 465,
  secure: true,
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASSWORD,
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
};

const EMAIL_RECIPIENT = {
  to: process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',') : [],
  cc: process.env.EMAIL_CC ? process.env.EMAIL_CC.split(',') : [],
};

/**
 * contentType
 * MIME：https://www.iana.org/assignments/media-types/media-types.xhtml
 */
const CONTENT_TYPE = {
  // json
  JSON: 'application/json;charset=UTF-8',
  // form-data qs
  FORM_URLENCODED: 'application/x-www-form-urlencoded;charset=UTF-8',
  // form-data  upload
  FORM_DATA: 'multipart/form-data;charset=UTF-8',
  // octet-stream download
  OCTET_STREAM: 'application/octet-stream;charset=UTF-8',
};

module.exports = {
  TENCENT_DOCS_ID,
  TENCENT_DOCS_COOKIE,
  CONTENT_TYPE,
  USER_NAME,
  MONTH,
  YEAR,
  DEPARTMENT,
  EXCLUDE_MEMBER,
  A8_WORK_URL,
  A8_WORK_USERNAME,
  A8_WORK_PASSWORD,
  A8_WORK_FILL_METHOD,
  A8_WORK_HEADLESS,
  A8_WORK_SLOWMO,
  A8_WORK_PYTHON,
  A8_FILL_ATTEMPTS,
  EMAIL_CONFIG,
  EMAIL_RECIPIENT,
};
