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
  EMAIL_CONFIG,
  EMAIL_RECIPIENT,
};
