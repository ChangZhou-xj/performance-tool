'use strict';
const {
  getWorkRecordPath,
  getCurrMonthData,
  getBasePath,
  createColumnMap,
  getExcludeMember,
  performanceValidateUrl,
} = require('./service/index');
// 引入处理Excel文件的库
const xlsx = require('xlsx');
const { USER_NAME, MONTH } = require('./config');
const { isEmpty, getTemplate } = require('./service');
const path = require('path');
const excelJS = require('exceljs');
const Big = require('big.js');
const { create } = require('domain');

async function extractData(inputFile) {
  // 1. 读取 Excel 文件
  const workbook = xlsx.readFile(inputFile);
  const sheetName = '工作记录'; // 默认第一个工作表，可改为指定名称
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  const currData = getCurrMonthData(data, USER_NAME, '登记人');
  console.info(`${USER_NAME}登记数据共${currData.length}条`);
  return currData;
}
function getHeaderMap(worksheet) {
  const map = {};
  worksheet.getRow(1).eachCell((cell, colNum) => {
    const key = normalizeHeader(cell.text);
    map[key] = colNum;
  });
  return map;
}

/** 行数据转换 */
function getRowData(row, headers) {
  const data = {};
  Object.entries(headers).forEach(([field, colNum]) => {
    try {
      const cell = row.getCell(colNum);
      const cellText = cell.text ? String(cell.text).trim() : '';
      data[field] = cellText;
    } catch {
      data[field] = '';
    }
  });
  return data;
}
/** 标准化列头 */
function normalizeHeader(text) {
  return text.replace(/\s+/g, '').toLowerCase();
}
/**
 * 是否是上个月
 * @param {*} dateStr
 * @returns
 */
function isLastMonthData(dateStr) {
  // 解析格式：YYYY年MM月DD日
  const parts = dateStr.split(/[年月日]/).filter(Boolean);
  if (parts.length !== 3) return false;
  const year = parseInt(parts[0]),
    month = parseInt(parts[1]) - 1,
    day = parseInt(parts[2]);
  const date = new Date(year, month, day);
  // 验证日期有效性
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  )
    return false;
  //如果环境变量里有月份，那么取环境变量里面的月份，如果没有月份取上一个月
  const now = new Date();
  const currMonth = now.getMonth();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() + 1 === currMonth
  );
}

/**
 * 创建标准化的错误条目
 * @param {number} rowNum - 行号（Excel中的实际行号）
 * @param {Array} rowErrors - 该行的错误数组，格式：[{field: 字段名, error: 错误描述}]
 * @returns {Object} 标准化后的错误条目
 */
function createErrorEntry(row, rowNum, rowErrors) {
  // 去重字段列表
  const uniqueFields = [...new Set(rowErrors.map((e) => e.field))];

  // 生成可读错误消息
  const errorMessages = rowErrors.map((e) => `${e.error}`);

  return {
    row: rowNum, // Excel中的实际行号（从2开始）
    fields: uniqueFields, // 涉及错误的字段列表（去重）
    errors: errorMessages, // 错误描述列表（带字段名前缀）
    creator: row['登记人'],
    createDate: row['登记日期'],
    errorInfo:
      `${row['缺陷是否跨部门引出'] === '否' ? '当前缺陷是本部门引出\n' : ''}` +
      (row['缺陷是否跨部门引出'] === '否'
        ? '缺陷引出时的代码评审人：' +
          `${
            isEmpty(row['缺陷引出时的代码评审人'])
              ? '未填写'
              : row['缺陷引出时的代码评审人']
          }` +
          '\n' +
          '缺陷引出时的代码监督人：' +
          `${
            isEmpty(row['缺陷引出时的代码监督人'])
              ? '未填写'
              : row['缺陷引出时的代码监督人']
          }` +
          '\n'
        : '') +
      '缺陷引出部门：' +
      `${isEmpty(row['缺陷引出部门']) ? '未填写' : row['缺陷引出部门']}` +
      '\n缺陷引出人：' +
      `${isEmpty(row['缺陷引出人员']) ? '未填写' : row['缺陷引出人员']}`,
    message: `第 ${rowNum} 行发现以下错误：${errorMessages.join('；')}`,
  };
}
function getCategoryType(category) {
  const normalized = category.replace(/\s+/g, '').toLowerCase();
  if (
    (normalized.includes('需求') || normalized === '缺陷转需求') &&
    !normalized.includes('代码迁移')
  )
    return '需求';
  if (normalized.includes('缺陷') && normalized !== '缺陷转需求') return '缺陷';
  return '其他';
}

/**
 * 校验数据
 * 1、校验数据
 * 基本信息校验：
 *    登记人、类别、项目名称、产品类型、产品标识、是否需要打包  不可为空
 * 2、数据校验
 *   类别是包含需求（需求无提交除外）或者缺陷转需求：提交编号、工作内容、提交分支、初审人、初审日期、初审意见、终审人、终审日期、终审意见、复核人、复核日期、复核意见、合并人、合并日期 不可为空 (如果是上个月的数据，需要校验需求评级是否有值)
 *   类别是需求（无提交的）：工作内容 不可为空
 *   类别是包含缺陷(缺陷转需求除外)： 缺陷引出人员、缺陷是否跨部门引出、缺陷引出部门不可以为空，如果缺陷是否跨部门引出是否的话，缺陷引出时间、缺陷引出时的代码评审人、缺陷引出时的代码监督人不可为空
 *               程序缺陷无提交： 缺陷引出人员、缺陷是否跨部门引出、缺陷引出部门
 *               如果是程序缺陷，交编号、工作内容、提交分支、初审人、初审日期、初审意见、终审人、终审日期、终审意见、复核人、复核日期、复核意见、合并人、合并日期 不可为空
 *   类别是包含代码迁移的：提交编号、工作内容、提交分支不能为空
 *
 * 3、是否需要打包，如果是是的话，现场vOrange、打包vOrange、补丁文件名称不可以为空
 * 4、额外加一个忽略检查，如果登记人在忽略检查里面，那么跳过检查
 * 5、项目打包：工作内容不能为空
 *
 *
 * @param {*} data
 */
async function validateExcelData(filePath) {
  const IGNORE_USERS = getExcludeMember();
  console.info('IGNORE_USERS', IGNORE_USERS);
  const errorMap = new Map();
  const workbook = new excelJS.Workbook();
  const defectErrorMap = new Map();

  try {
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('工作表不存在');

    // 列名标准化配置
    const SPECIAL_FIELDS = {
      ['补丁文件名称']: ['补丁文件名', 'patchfilename'],
      程序缺陷: ['程序类缺陷', 'codingdefect'],
    };

    const headers = getHeaderMap(worksheet, SPECIAL_FIELDS);
    // 核心校验规则配置
    const validationRules = {
      baseFields: [
        '登记人',
        '类别',
        '项目名称',
        '产品类型',
        '产品标识',
        '是否需要打包',
        '工作内容',
      ],

      conditionalRules: {
        // 需求类校验（包含缺陷转需求）
        ['需求']: (rowData, rowNum, isLastMonth) => {
          const errors = [];
          const isNoSubmit = rowData['类别'].includes('需求无提交');

          // 需求无提交校验
          if (isNoSubmit) {
            if (isEmpty(rowData['工作内容'])) {
              errors.push({
                field: '工作内容',
                error: '需求无提交时必须填写工作内容',
              });
            }
            return errors;
          }

          // 公共必填字段
          const requireFields = [
            '提交编号',
            '工作内容',
            '提交分支',
            '初审人',
            '初审日期',
            '初审意见',
            '终审人',
            '终审日期',
            '终审意见',
            '复核人',
            '复核日期',
            '复核意见',
            '合并人',
            '合并日期',
          ];

          // 额外校验：上月数据需要需求评级
          if (isLastMonth && isEmpty(rowData['需求等级'])) {
            errors.push({
              field: '需求等级',
              error: '上月数据必须填写需求等级',
            });
          }

          requireFields.forEach((field) => {
            if (isEmpty(rowData[field])) {
              errors.push({ field, error: `需求类必须填写${field}` });
            }
          });

          return errors;
        },

        // 缺陷类校验（排除缺陷转需求）
        ['缺陷']: (rowData) => {
          const errors = [];
          const isCodingDefect = rowData['类别'] === '程序缺陷';
          const isCrossDepartment = rowData['缺陷是否跨部门引出'] === '是';

          // 公共必填字段
          const commonFields = [
            '缺陷引出人员',
            '缺陷是否跨部门引出',
            '缺陷引出部门',
          ];

          // 非跨部门时需要额外字段
          const nonCrossFields = !isCrossDepartment
            ? [
                '缺陷引出时间',
                '缺陷引出时的代码评审人',
                '缺陷引出时的代码监督人',
              ]
            : [];

          // 程序缺陷特殊校验
          const codingFields = isCodingDefect
            ? [
                '提交编号',
                '工作内容',
                '提交分支',
                '初审人',
                '初审日期',
                '初审意见',
                '终审人',
                '终审日期',
                '终审意见',
                '复核人',
                '复核日期',
                '复核意见',
                '合并人',
                '合并日期',
              ]
            : [];

          [...commonFields, ...nonCrossFields, ...codingFields].forEach(
            (field) => {
              if (isEmpty(rowData[field])) {
                errors.push({ field, error: `当前未填写${field}` });
              }
            },
          );
          if (!isEmpty(errors)) {
            errors.unshift({
              error: `当前缺陷的类别是${rowData['类别']}，${
                isCrossDepartment
                  ? '缺陷是跨部门引出，必须填写缺陷引出时间、缺陷引出人员、缺陷引出部门'
                  : '缺陷是本部门引出，必须填写缺陷引出时间、缺陷引出时的代码评审人、缺陷引出时的代码监督人以及相关的提交信息'
              }`,
            });
          }
          return errors;
        },

        // 代码迁移类校验
        ['代码迁移']: (rowData) => {
          return ['提交编号', '工作内容', '提交分支']
            .filter((field) => isEmpty(rowData[field]))
            .map((field) => ({
              field,
              error: `代码迁移类必须填写${field}`,
            }));
        },

        // 打包校验（独立规则）
        ['打包校验']: (rowData) => {
          if (rowData['是否需要打包'] !== '是') return [];

          return ['现场vorange', '打包vorange', '补丁文件名称']
            .filter((field) => isEmpty(rowData[field]))
            .map((field) => ({
              field,
              error: `需要打包时${field}不能为空`,
            }));
        },
      },
    };
    // 遍历处理逻辑
    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const rowData = getRowData(row, headers);
      const rowErrors = [];

      // 跳过忽略用户
      if (IGNORE_USERS.includes(rowData['登记人']?.toLowerCase())) return;

      // 基础校验
      validationRules.baseFields.forEach((field) => {
        if (isEmpty(rowData[field])) {
          rowErrors.push({ field, error: `基础信息 ${field} 不能为空` });
        }
      });

      // 判断数据时间属性
      const isLastMonth = isLastMonthData(rowData['登记日期']);

      // 动态类别校验
      const categoryType = getCategoryType(rowData['类别']);
      if (validationRules.conditionalRules[categoryType]) {
        const validator = validationRules.conditionalRules[categoryType];
        rowErrors.push(...validator(rowData, rowNum, isLastMonth));
      }

      // 打包校验
      rowErrors.push(...validationRules.conditionalRules['打包校验'](rowData));

      // 合并错误信息
      if (rowErrors.length > 0) {
        errorMap.set(rowNum, createErrorEntry(rowData, rowNum, rowErrors));
        // 新增：如果是缺陷且有错误，记录行号
        if (categoryType === '缺陷') {
          defectErrorMap.set(
            rowNum,
            createErrorEntry(rowData, rowNum, rowErrors),
          );
        }
      }
    });

    return {
      errorList: Array.from(errorMap.values()),
      defectErrorList: Array.from(defectErrorMap.values()),
    };
  } catch (e) {
    throw new Error(`文件处理失败: ${e.message}`);
  }
}
class ValidatePerformance {
  static async main() {
    console.info('----> 数据校验开始');
    // 参数配置
    const inputFile = getWorkRecordPath();
    // // 步骤1 获取当前用户需要导出的绩效月份的有效数据
    // console.time('获取当前月份登记数据耗时');
    // const extractDataList = await extractData(inputFile);
    // console.timeEnd('获取当前月份登记数据耗时');
    //步骤2 校验数据
    let { errorList, defectErrorList } = await validateExcelData(inputFile);

    // 步骤3 输出错误数据
    const workbook = new excelJS.Workbook();
    const worksheet = workbook.addWorksheet('错误报告');
    const outputPath = performanceValidateUrl();

    //  定义表头
    worksheet.columns = [
      { header: '行号', key: 'row', width: 10 },
      { header: '创建者', key: 'creator', width: 15 },
      { header: '创建日期', key: 'createDate', width: 20 },
      {
        header: '涉及字段',
        key: 'fields',
        width: 20,
        style: { wrapText: true },
      },
      {
        header: '错误字段',
        key: 'errors',
        width: 40,
        style: { wrapText: true },
      },
      { header: '错误总结', key: 'message', width: 80 },
    ];
    // 3. 添加数据
    errorList.forEach((item) => {
      worksheet.addRow({
        row: item.row,
        fields: item.fields.join('\n'),
        errors: item.errors.join('\n'), // 用换行符分隔多个错误
        creator: item.creator,
        createDate: item.createDate,
        message: item.message,
      });
    });

    // 4. 设置自动换行
    worksheet.eachRow((row) => {
      row.getCell('errors').alignment = { wrapText: true };
      row.getCell('message').alignment = { wrapText: true };
    });

    // ========== 表头样式配置 ==========
    const headerStyle = {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' },
      },
      font: {
        name: '微软雅黑',
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 14, // 适当加大字号
      },
      alignment: {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true, // 确保文字适应行高
      },
      border: {
        top: { style: 'medium', color: { argb: 'FFFFFFFF' } }, // 加粗上边框
        bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } }, // 加粗下边框
      },
    };

    // ========== 定义列 ==========
    worksheet.columns = [
      { header: '行号', key: 'row', width: 10 },
      { header: '创建者', key: 'creator', width: 15 },
      { header: '创建日期', key: 'createDate', width: 20 },
      { header: '涉及字段', key: 'fields', width: 20 },
      { header: '错误字段', key: 'errors', width: 40 },
      { header: '消息总结', key: 'message', width: 80 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 30; // 设置行高为30磅（约1厘米）
    headerRow.eachCell((cell) => {
      cell.style = JSON.parse(JSON.stringify(headerStyle)); // 深拷贝样式对象
    });

    if (defectErrorList.length > 0) {
      const defectSheet = workbook.addWorksheet('缺陷错误');
      //  定义表头
      defectSheet.columns = [
        { header: '行号', key: 'row', width: 10 },
        { header: '创建者', key: 'creator', width: 15 },
        { header: '创建日期', key: 'createDate', width: 20 },
        {
          header: '引出部门、引出人',
          key: 'errorInfo',
          width: 30,
          style: { wrapText: true },
        },
        {
          header: '错误字段',
          key: 'errors',
          width: 40,
          style: { wrapText: true },
        },
      ];
      // 写表头
      // 写内容
      defectErrorList.forEach((item) => {
        defectSheet.addRow({
          row: item.row,
          fields: item.fields.join('\n'),
          errors: item.errors.join('\n'), // 用换行符分隔多个错误
          creator: item.creator,
          createDate: item.createDate,
          errorInfo: item.errorInfo,
        });
      });
      const headerRow = defectSheet.getRow(1);
      headerRow.height = 30; // 设置行高为30磅（约1厘米）
      headerRow.eachCell((cell) => {
        cell.style = JSON.parse(JSON.stringify(headerStyle)); // 深拷贝样式对象
      });
      // 4. 设置自动换行
      defectSheet.eachRow((row) => {
        row.getCell('errors').alignment = { wrapText: true };
        row.getCell('errorInfo').alignment = { wrapText: true };
      });
    }
    // 5. 保存文件
    await workbook.xlsx.writeFile(outputPath);
    console.time('数据校验耗时');
  }
}
ValidatePerformance.main();
