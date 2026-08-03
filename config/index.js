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
const A8_WORK_URL = process.env.A8_WORK_URL || process.env.A8_LOGIN_URL || 'http://120.35.0.66:19995/wui/index.html#/?_key=vrtmcx';
const A8_WORK_USERNAME = process.env.A8_WORK_USERNAME || process.env.A8_USERNAME || '';
const A8_WORK_PASSWORD = process.env.A8_WORK_PASSWORD || process.env.A8_PASSWORD || '';
const A8_WORK_FILL_METHOD = process.env.A8_WORK_FILL_METHOD || 'template';
const A8_WORK_HEADLESS = process.env.A8_WORK_HEADLESS !== 'false';
const A8_WORK_SLOWMO = Number(process.env.A8_WORK_SLOWMO || '300');

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
  EMAIL_CONFIG,
  EMAIL_RECIPIENT,
};
