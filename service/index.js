'use strict';
const process = require('process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const shell = require('shelljs');
const axios = require('axios');
const crypto = require('crypto');

/**
 * 获取应用根路径
 */
const getBasePath = (function () {
  let baseDir;
  return () => {
    if (!baseDir) {
      baseDir = process.cwd();
    }
    return baseDir;
  };
})();

/**
 * 改变终端路径
 * @param {*} path
 */
function changeShellPath(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`${path}路径不存在!`);
  }
  shell.cd(path);
}

/**
 * 执行命令
 * @param {*} command
 * @returns
 */
function execCommand(command) {
  let result = shell.exec(command);
  if (result.code !== 0) {
    throw new Error(`执行${command}出错，${result.stderr}`);
  } else {
    return result;
  }
}

/**
 * 删除文件
 * @param {*} filePath
 */
async function removeFile(filePath) {
  try {
    await fsPromises.access(filePath);
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') { // Only log errors other than "file not found"
      console.error(`Error remove file ${filePath}: ${err.message}`);
    }
  }
}

/**
 * 是否为空
 * @param {*} value
 * @returns
 */
function isEmpty(value) {
  if (typeof value === 'undefined') {
    return true;
  } else if (value === null) {
    return true;
  } else if (typeof value === 'string' && value === '') {
    return true;
  } else if (typeof value === 'number' && isNaN(value)) {
    return true;
  } else if (Array.isArray(value) && value.length === 0) {
    return true;
  } else if (value instanceof Number && isNaN(value)) {
    return true;
  } else if (
    value.toString() === '[object Object]' &&
    Object.keys(value).length === 0
  ) {
    return true;
  } else {
    return false;
  }
}

/**
 * 生成hash
 * @param {*} value
 * @returns
 */
function generateHash(value) {
  try {
    /**
     * 计算hash的方法
     * @param {*} val
     * @returns
     */
    const hashValue = (val) => {
      const jsonString = JSON.stringify(val);
      return crypto.createHash('sha256').update(jsonString).digest('hex');
    };

    if (value === null || value === undefined) {
      return hashValue(null);
    }

    if (Array.isArray(value) || typeof value !== 'object') {
      // 处理数组和简单类型
      return hashValue(value);
    }

    // 处理对象
    const pairs = Object.entries(value);
    if (pairs.length === 0) {
      return hashValue({});
    }

    const sortedPairs = pairs.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    return hashValue(sortedPairs);
  } catch (error) {
    console.error('Error in getHash:', error.message, error.stack);
    throw new Error('Failed to compute hash');
  }
}

/**
 * 获取工作记录excel文件路径
 * @returns
 */
function getWorkRecordPath() {
  return path.join(getBasePath(), 'data', 'work-record.xlsx');
}

/**
 * 清理dist目录
 */
function clearDist() {
  try {
    changeShellPath(path.join(getBasePath(), 'dist'));
    execCommand('rm -rf !.gitkeep *');
    changeShellPath(getBasePath());
  } catch (err) {
    console.error(err);
  }
}

module.exports = {
  getBasePath,
  changeShellPath,
  execCommand,
  removeFile,
  isEmpty,
  generateHash,
  getWorkRecordPath,
  clearDist,
};