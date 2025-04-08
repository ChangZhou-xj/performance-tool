'use strict';
const process = require('process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const shell = require('shelljs');
const axios = require('axios');
const crypto = require('crypto');
const { USER_NAME } = require("../config");

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
 * 获取绩效模版excel文件路径
 */
function getTemplate() {
  return path.join(getBasePath(), 'data', 'performance-template.xlsx');
}

/**
 * 生成绩效excel文件路径
 * @returns {string}
 */
function performanceUrl() {
  return path.join(getBasePath(), 'data', `${USER_NAME}.xlsx`);
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

/**
 * 获取当前人员的当前月的是所有数据
 */
function getCurrMonthData(data , userName , colName) {
  if (data.length < 1) throw new Error("Excel 文件无数据");
  // 2. 定位列索引
  const headers = data[0];
  const registrantCol = headers.findIndex((h) => String(h).trim() === colName);
  const dateCol = headers.findIndex((h) => String(h).trim() === "登记日期");
  if (registrantCol === -1 || dateCol === -1) {
    throw new Error(`未找到${colName}或【登记日期】列`);
  }
  // 3. 获取当前月份范围  如果环境变量里有月份则取环境变量里面的月份
  const envMonth =  process.env.MONTH;
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  // 月份为上一个月 TODO：1月的时候需要取上一年的12月 后面需要处理一下
  const currentMonth = !isEmpty(envMonth)? Number(envMonth) : currentDate.getMonth()+1;
  // 4. 过滤数据
  const filteredData = [headers]; // 保留标题行
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const registrant = row[registrantCol];
    const dateStr = row[dateCol];
    // 条件1：登记人为"测试"
    if (!String(registrant).trim().includes(userName) ) continue;

    // 条件2：日期解析及月份验证
    let date;
    try {
      // 解析格式：2025年2月22日
      const [year, month, day] = dateStr
          .split(/[年月日]/)
          .filter(Boolean)
          .map(Number);
      date = new Date(year, month-1 , day); // 月份从0开始
    } catch (e) {
      console.warn(`跳过无效日期行 ${i + 1}: ${dateStr}`);
      continue;
    }
    // 验证日期有效性及是否在当前月
    if (
        isNaN(date.getTime()) ||
        date.getFullYear() !== currentYear ||
        date.getMonth() + 1 !== currentMonth
    ) {
      continue;
    }
    filteredData.push(row);
  }
  return filteredData;
}

/**
 * 【基本数据过滤】
 *  1、登记人、登记日期、项目名称、产品类型、产品标识 、类别 不可以为空
 */
function filterBasicData(data){
  // 定义必须存在的列名
  const requiredColumns = [
    "登记人",
    "登记日期",
    "项目名称",
    "产品类型",
    "产品标识",
    "类别"
  ];
  // 定位列索引
  const headers = data[0];
  const columnIndices = {};

  for (const colName of requiredColumns) {
    const index = headers.findIndex(h =>
        String(h).trim() === colName
    );
    if (index === -1) throw new Error(`缺少必要列【${colName}】`);
    columnIndices[colName] = index;
  }

  // 过滤数据
  const filteredData = [headers];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 条件3：所有必须列非空
    let hasEmptyField = false;
    for (const colName of requiredColumns) {
      const value = row[columnIndices[colName]];
      if (!isEmpty(value)) {
        hasEmptyField = true;
        break;
      }
    }
    if (hasEmptyField) continue;

    filteredData.push(row);
  }
  return filteredData;
}

/**
 * 类别 是包含【需求】的  提交编号、提交分支、需求等级、修改内容、PP单号、任务/问题列表编号、AI评审人、AI评审意见、初审人、初审日期、初审意见、终审人、终审日期、终审意见、复核人、复核日期、复核意见、合并人、合并日期  不可以为空
 */
function filterDeveloperDemand(data){
  // 当类别包含"需求"时需要校验的额外列
  const requiredConditionalColumns = [
    "提交编号", "提交分支", "需求等级", "修改内容", "PP单号",
    "任务/问题列表编号", "AI评审人", "AI评审意见", "初审人", "初审日期",
    "初审意见", "终审人", "终审日期", "终审意见", "复核人",
    "复核日期", "复核意见", "合并人", "合并日期"
  ];
  const headers = data[0];
  const columnIndices = {};
}

// ================== Levenshtein 距离算法实现 ==================
function levenshteinDistance(a, b) {
  const matrix = [];
  let i, j;

  // 初始化矩阵
  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // 计算距离
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      const substitutionCost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,    // 删除操作
          matrix[i][j - 1] + 1,    // 插入操作
          matrix[i - 1][j - 1] + substitutionCost  // 替换操作
      );
    }
  }

  return matrix[b.length][a.length];
}
// ================== 标准化字符串 ==================
function normalizeString(str) {
  return String(str)
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ''); // 移除特殊字符
}

// ================== 带容错的列匹配逻辑 ==================
function findBestColumnMatch(targetCol, sourceHeaders, threshold = 2) {
  const normalizedTarget = normalizeString(targetCol);

  let minDistance = Infinity;
  let bestMatchIndex = -1;

  sourceHeaders.forEach((sourceCol, index) => {
    const normalizedSource = normalizeString(sourceCol);
    const distance = levenshteinDistance(normalizedTarget, normalizedSource);

    if (distance < minDistance) {
      minDistance = distance;
      bestMatchIndex = index;
    }
  });

  // 返回匹配结果和置信度
  return {
    index: minDistance <= threshold ? bestMatchIndex : -1,
    confidence: 1 - (minDistance / Math.max(normalizedTarget.length, normalizeString(sourceHeaders[bestMatchIndex]).length))
  };
}


// ================== 修改后的列映射逻辑 ==================
function createColumnMap(templateColumns, originalHeaders) {
  const columnMap = [];

  templateColumns.forEach(templateCol => {
    // 先尝试精确匹配
    const exactMatchIndex = originalHeaders.findIndex(h =>
        normalizeString(h) === normalizeString(templateCol)
    );

    if (exactMatchIndex !== -1) {
      columnMap.push({
        templateCol: templateCol,
        originalCol: originalHeaders[exactMatchIndex],
        originalIndex: exactMatchIndex,
        matchType: 'exact'
      });
    } else {
      // 使用模糊匹配
      const { index, confidence } = findBestColumnMatch(
          templateCol,
          originalHeaders,
          2 // 允许最大编辑距离
      );

      if (index !== -1 && confidence > 0.6) { // 置信度阈值
        columnMap.push({
          templateCol: templateCol,
          originalCol: originalHeaders[index],
          originalIndex: index,
          matchType: 'fuzzy',
          confidence: confidence
        });
      } else {
        columnMap.push({
          templateCol: templateCol,
          originalCol: null,
          originalIndex: -1,
          matchType: 'none'
        });
      }
    }
  });
  return columnMap;
}

/**
 * 复制单元格样式
 * @param {Object} sourceCell 源单元格
 * @param {Object} targetCell 目标单元格
 */
function copyCellStyle(sourceCell, targetCell) {
  // 基础样式
  targetCell.style = {
    ...sourceCell.style,
    font: { ...sourceCell.font },
    fill: { ...sourceCell.fill },
    border: { ...sourceCell.border },
    alignment: { ...sourceCell.alignment },
    numFmt: sourceCell.numFmt
  };

  // 特殊属性
  if (sourceCell.isMerged) {
    targetCell._merge = sourceCell._merge;
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
  getCurrMonthData,
  filterBasicData,
  getTemplate,
  createColumnMap,
  copyCellStyle,
  performanceUrl,
};
