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
};
