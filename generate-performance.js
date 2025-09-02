'use strict';
const {
  getWorkRecordPath,
  getCurrMonthData,
  getBasePath,
  createColumnMap,
  performanceUrl,
} = require('./service/index');
// 引入处理Excel文件的库
const xlsx = require('xlsx');
const { USER_NAME, MONTH } = require('./config');
const { isEmpty, getTemplate } = require('./service');
const path = require('path');
const excelJS = require('exceljs');
const Big = require('big.js');

/**
 * 需求等级 分值维护
 * @type
 */
const demandLevelMap = {
  A类: 15,
  '2A类': 30,
  B类: 9,
  '2B类': 18,
  C类: 3,
  '2C类': 6,
  D类: 1,
  '2D类': 2,
  E类: 0.2,
  '2E类': 0.4,
};
/**
 * 精确加法（使用 big.js）
 * @param {number|string} num1
 * @param {number|string} num2
 * @returns {string} 字符串形式的精确结果
 */
function preciseAdd(num1, num2) {
  try {
    return new Big(num1).plus(new Big(num2)).toString();
  } catch (error) {
    throw new Error(`加法计算错误: ${error.message}`);
  }
}

/**
 * 统计维度
 */
const DIMENSION = {
  department1: '开发一部',
  department2: '开发二部',
  department3: '开发三部',
  department4: '开发四部',
  department5: '开发五部',
  departmentPlatform: '平台开发部',
  departmentFrontEnd: '前端开发部',
  departmentWuHan: '华中开发部',
  autoTest: '自动化测试',
  autoTool: '自动化工具',
};

/**
 * excel列
 */
const COLUMN = {
  productType: '产品类型',
  productName: '产品名称',
  productCode: '产品标识符',
  repository: '代码仓库Git地址（HTTPS）',
  branch: '分支',
  statisticsTotal: '统计代码总行数',
  statisticsChange: '统计代码变更行数',
};

/**
 * 获取统计维度代码
 */
const getDimensionCode = (function () {
  let dimensionRelation = {};

  return (dimensionName) => {
    if (!(dimensionName in dimensionRelation)) {
      for (let dimensionCode in DIMENSION) {
        dimensionRelation[DIMENSION[dimensionCode]] = dimensionCode;
      }
    }
    return dimensionRelation[dimensionName];
  };
})();

/**
 * 获取excel列代码
 */
const getColumnCode = (function () {
  let columnRelation = {};

  return (columnName) => {
    if (!(columnName in columnRelation)) {
      for (let columnCode in COLUMN) {
        columnRelation[COLUMN[columnCode]] = columnCode;
      }
    }
    return columnRelation[columnName];
  };
})();

/**
 * 构建行数据
 * @param {*} rowData
 * @returns
 */
function buildRowData(rowData) {
  let result = {};
  for (let key in rowData) {
    result[getColumnCode(key)] = rowData[key];
  }
  return result;
}

/**
 * 获取仓库excel数据
 * @returns
 */
function getRepositoryData() {
  let fileContent = xlsx.readFile(getRepositoryPath());
  return fileContent.SheetNames.reduce((acc, e) => {
    let sheet = fileContent.Sheets[e];
    let sheetData = xlsx.utils.sheet_to_json(sheet);
    acc[getDimensionCode(e)] = sheetData.map(buildRowData);
    return acc;
  }, {});
}
/**
 * 是否是当前导出绩效月
 * @param {*} dateStr
 * @returns
 */
function isCurrentMonth(dateStr) {
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
  const currMonth = !isEmpty(MONTH) ? Number(MONTH) : now.getMonth() + 1;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() + 1 === currMonth
  );
}
/**
 * 计算评审分值
 */
function calculateScore(reviewDeductionPoints, value) {
  switch (value) {
    case '二次评审通过':
      return (reviewDeductionPoints += 0.5);
    case '二次及以上评审通过':
      return (reviewDeductionPoints += 1);
    default:
      return reviewDeductionPoints;
  }
}
/**
 * 处理数据
 * 1、获取当前人的工作记录里面的所有数据
 */
async function processData() {
  try {
    //获取有效数据
    const filteredData = await extractData();
    // 2. 定义目标Sheet配置
    const sheetConfig = {
      需求: { data: [], columns: null },
      缺陷: { data: [], columns: null },
      代码提交记录: { data: [], columns: null },
      代码评审: { data: [], columns: null },
      '代码迁移-一体化': { data: [], columns: null },
      '项目打包（只作为打包登记）': { data: [], columns: null },
    };
    // 3. 分类数据
    const typeIndex = filteredData[0].findIndex((e) => e === '类别');
    const currUserIndex = filteredData[0].findIndex((e) => e === '登记人');
    const registrationTimeIndex = filteredData[0].findIndex(
      (e) => e === '登记日期',
    );
    filteredData.slice(1).forEach((row) => {
      // 跳过标题行
      const category = row[typeIndex]; //类别
      const categoryStr = String(category).trim();
      const currUser = row[currUserIndex];
      const currUserStr = String(currUser).trim();
      const registrationTime = row[registrationTimeIndex];

      // 判断归属Sheet
      const targetSheets = [];
      if (
        categoryStr.includes('需求') &&
        currUserStr === USER_NAME &&
        isCurrentMonth(registrationTime)
      )
        targetSheets.push('需求');
      if (
        categoryStr.includes('缺陷') &&
        categoryStr !== '缺陷转需求' &&
        currUserStr === USER_NAME &&
        isCurrentMonth(registrationTime)
      )
        targetSheets.push('缺陷');

      // 添加到对应Sheet数据集
      //如果是需求需要构建需求的分，根据需求等级
      const demandLevelIndex = filteredData[0].findIndex(
        (e) => e === '需求等级',
      );
      targetSheets.forEach((sheetName) => {
        sheetConfig[sheetName].data.push(row);
      });
      //代码提交必须有提交编号和工作内容 且是当前月
      const commitSeq = filteredData[0].findIndex((e) => e === '提交编号');
      const commitContentSeq = filteredData[0].findIndex(
        (e) => e === '工作内容',
      );

      if (
        !isEmpty(row[commitSeq]) &&
        !isEmpty(row[commitContentSeq]) &&
        currUserStr === USER_NAME &&
        categoryStr !== '项目打包（只作为打包登记）' &&
        categoryStr !== '代码迁移-一体化' &&
        isCurrentMonth(registrationTime)
      )
        sheetConfig['代码提交记录'].data.push(row);
      //合并人 合并日期不为空算做代码评审  暂时改为复核人、复核日期
      const mergeUserSeq = filteredData[0].findIndex((e) => e === '复核人');
      const mergeUserDate = filteredData[0].findIndex((e) => e === '复核日期');
      if (!isEmpty(row[mergeUserSeq]) && !isEmpty(row[mergeUserDate]))
        sheetConfig['代码评审'].data.push(row);

      //类型是项目打包（只作为打包登记）登记到项目打包（只作为打包登记）
      if (
        categoryStr === '项目打包（只作为打包登记）' &&
        currUserStr === USER_NAME
      )
        sheetConfig['项目打包（只作为打包登记）'].data.push(row);
      if (categoryStr === '代码迁移-一体化' && currUserStr === USER_NAME)
        sheetConfig['代码迁移-一体化'].data.push(row);
    });
    console.info(`需求共${sheetConfig['需求'].data.length}条`);
    console.info(`缺陷共${sheetConfig['缺陷'].data.length}条`);
    console.info(`代码提交记录共${sheetConfig['代码提交记录'].data.length}条`);
    console.info(`代码评审共${sheetConfig['代码评审'].data.length}条`);
    console.info(
      `代码迁移-一体化共${sheetConfig['代码迁移-一体化'].data.length}条`,
    );
    console.info(
      `项目打包（只作为打包登记）共${sheetConfig['项目打包（只作为打包登记）'].data.length}条`,
    );
    return {
      需求: sheetConfig['需求'].data,
      缺陷: sheetConfig['缺陷'].data,
      代码提交记录: sheetConfig['代码提交记录'].data,
      代码评审: sheetConfig['代码评审'].data,
      '代码迁移-一体化': sheetConfig['代码迁移-一体化'].data,
      '项目打包（只作为打包登记）':
        sheetConfig['项目打包（只作为打包登记）'].data,
      headers: filteredData[0],
    };
  } catch (err) {
    console.error(err);
  }
}
function normalizeString(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]/g, '');
}
// 需求等级计算函数
function calculateDemandLevel(levelStr) {
  // 1. 安全处理输入
  if (!levelStr || typeof levelStr !== 'string') return 0;

  // 2. 拆分并清洗等级项
  return levelStr
    .split(',')
    .map((item) => {
      // 2.1 去除首尾空格和特殊字符
      const cleaned = item.trim().replace(/[^0-9A类B类C类D类E类]/g, '');

      // 2.2 精确匹配等级项
      return demandLevelMap[cleaned] || 0; // 未匹配的项计为0
    })
    .reduce((sum, val) => sum + val, 0); // 3. 求和计算
}
/**
 * 处理分值计算
 */
async function processWorkbook(inputPath) {
  // 1. 读取工作簿
  const workbook = new excelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  // 2. 遍历所有工作表（按需可指定特定sheet） 构建需求分、bug分
  const sheetName = [
    '需求',
    '缺陷',
    '代码提交记录',
    '代码评审',
    '项目打包（只作为打包登记）',
    '代码迁移-一体化',
    '加减分类别',
  ];
  let demandSum = 0;
  let bugSum = 0;
  let commit = 0;
  let reviewSum = 0;
  let leadingOutDefects = 0; //引出缺陷
  let leadingOutDefectsData = [];
  let migrate = 0; //一体化迁移
  let pack = 0; //打包
  for (const item in sheetName) {
    const worksheet = workbook.getWorksheet(sheetName[item]);
    if (sheetName[item] === '需求') {
      let demandLevelCol = -1;
      let devEffortCol = -1;
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const header = cell.text.trim();
        if (header === '需求等级') demandLevelCol = colNumber;
        if (header === '工作量') devEffortCol = colNumber;
      });
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // 跳过标题行

        // 6. 获取需求等级值
        const levelCell = row.getCell(demandLevelCol);
        const calculatedValue = calculateDemandLevel(levelCell.text);
        demandSum += calculateDemandLevel(levelCell.text);

        // 7. 写入开发量列（保留原有样式）
        const targetCell = row.getCell(devEffortCol);
        targetCell.value = calculatedValue;
      });
    } else {
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        let devEffortCol = -1;
        if (rowNumber === 1) return; // 跳过标题行
        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell, colNumber) => {
          const header = cell.text.trim();
          if (header === '工作量') devEffortCol = colNumber;
        });

        // 7. 写入开发量列（保留原有样式）
        const targetCell = row.getCell(devEffortCol);
        const cellValue = {
          缺陷: 1,
          代码提交记录: 0.2,
          代码评审: 0.2,
          '代码迁移-一体化': 0.2,
          '项目打包（只作为打包登记）': 0.2,
        };
        targetCell.value = cellValue[sheetName[item]];
        if (sheetName[item] === '缺陷') bugSum = preciseAdd(bugSum, 1);
        if (sheetName[item] === '代码提交记录')
          commit = preciseAdd(commit, 0.2);
        if (sheetName[item] === '代码评审')
          reviewSum = preciseAdd(reviewSum, 0.2);
      });
    }
  }
  // 8.构建ai的加分项  获取页签名字是'代码评审'的页签，找到列名包含'AI使用截图'的截图列，过滤出不为空的数据 并且 登记人是本人的
  // 9.构建评审扣分，初审意见、终审意见、复核意见  ，二次评审通过扣0.5  二次及以上评审通过扣1
  let aiNumber = 0;
  let reviewDeductionPoints = 0; //代码评审扣分
  {
    const worksheet = workbook.getWorksheet('代码评审');
    const headerRow = worksheet.getRow(1);
    let aiCol = -1;
    let currUserIndex = -1;
    let firstTrial = -1; //初审意见
    let finalOpinion = -1; //终审意见
    let reviewOpinion = -1; // 复核意见

    headerRow.eachCell((cell, colNumber) => {
      const header = cell.text.trim();
      if (header.includes('AI使用截图')) aiCol = colNumber;
      if (header === '登记人') currUserIndex = colNumber;
      if (header === '初审意见') firstTrial = colNumber;
      if (header === '终审意见') finalOpinion = colNumber;
      if (header === '复核意见') reviewOpinion = colNumber;
    });
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过标题行
      const targetCell = row.getCell(aiCol);
      const currUserName = row.getCell(currUserIndex);
      if (!isEmpty(targetCell.value) && currUserName.value === USER_NAME) {
        aiNumber += 1;
      }
      if (currUserName.value === USER_NAME) {
        const firstTrialCell = row.getCell(firstTrial);
        reviewDeductionPoints = calculateScore(
          reviewDeductionPoints,
          firstTrialCell.value,
        );
        const finalOpinionCell = row.getCell(finalOpinion);
        reviewDeductionPoints = calculateScore(
          reviewDeductionPoints,
          finalOpinionCell.value,
        );
        const reviewOpinionCell = row.getCell(reviewOpinion);
        reviewDeductionPoints = calculateScore(
          reviewDeductionPoints,
          reviewOpinionCell.value,
        );
      }
    });
  }
  //获取工作表中，所有引出人是本人的，并且登记日期是本月的; 并将引出人是自己的数据放到【加减分】里
  let reviewDelNumber = 0;
  {
    const workRecordPatch = getWorkRecordPath();
    const workbook = xlsx.readFile(workRecordPatch);
    const sheetName = '工作记录'; // 默认第一个工作表，可改为指定名称
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    leadingOutDefectsData = getCurrMonthData(data, USER_NAME, '缺陷引出人员');
    //需要去掉标题行
    leadingOutDefects = leadingOutDefectsData.length - 1;
  }
  //找到 '加减分类别' 的页签 ，找到ai代码优化 加减类别为AI代码优化  自评分为aiNumber*0.5
  {
    const worksheet = workbook.getWorksheet('加减分类别');
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { name: '微软雅黑', bold: true, color: { argb: 'FF000000' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFC000' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
      cell.alignment = cell.alignment || {};
      cell.alignment.vertical = 'middle';
      cell.alignment.horizontal = 'center';
    });

    let type = -1;
    let typeValueIndex = -1;
    let leaderIndex = -1;
    let describeIndex = -1;
    let dateIndex = -1;
    headerRow.eachCell((cell, colNumber) => {
      const header = cell.text.trim();
      if (header === '加减类别') type = colNumber;
      if (header === '自评分') typeValueIndex = colNumber;
      if (header === '直接上级评分') leaderIndex = colNumber;
      if (header === '描述') describeIndex = colNumber;
      if (header === '时间') dateIndex = colNumber;
    });
    const rowValues = [];
    rowValues[type] = 'AI代码优化';
    rowValues[typeValueIndex] = aiNumber * 0.5;
    rowValues[leaderIndex] = aiNumber * 0.5;
    rowValues[describeIndex] = 'ai代码优化共' + aiNumber + '次';
    const insertedRow = worksheet.insertRow(2, rowValues, 'o');
    // 设置边框和自动换行
    insertedRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
      cell.alignment = cell.alignment || {};
      cell.alignment.wrapText = true;
    });

    const reasonIndex = leadingOutDefectsData[0].findIndex(
      (e) => e === '缺陷描述及原因',
    );
    const commitDateIndex = leadingOutDefectsData[0].findIndex(
      (e) => e === '登记日期',
    );

    for (let i = 1; i < leadingOutDefectsData.length; i++) {
      const rowValues = [];
      rowValues[type] = '引出缺陷';
      rowValues[typeValueIndex] = -3;
      rowValues[leaderIndex] = -3;
      rowValues[describeIndex] = leadingOutDefectsData[i][reasonIndex];
      rowValues[dateIndex] = leadingOutDefectsData[i][commitDateIndex];
      const insertedRow = worksheet.insertRow(2, rowValues, 'o');
      // 设置边框和自动换行
      insertedRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
        cell.alignment = cell.alignment || {};
        cell.alignment.wrapText = true;
      });
    }
  }
  //找到'代码迁移-一体化'
  {
    const worksheet = workbook.getWorksheet('代码迁移-一体化');
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过标题行
      migrate += 1;
    });
  }
  //找到 项目打包（只作为打包登记）
  {
    const worksheet = workbook.getWorksheet('项目打包（只作为打包登记）');
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过标题行
      pack += 1;
    });
  }

  let reviewerData = [];
  let verifierData = [];
  //处理评审人的扣分项  获取工作记录表中，登记日期是本月的  缺陷引出时的代码评审人、缺陷引出时的代码监督人  是当前登录人的，需要将数据放到  '加减分类别' 里面
  {
    const workRecordPatch = getWorkRecordPath();
    const workbook = xlsx.readFile(workRecordPatch);
    const sheetName = '工作记录'; // 默认第一个工作表，可改为指定名称
    const allWorksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(allWorksheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    reviewerData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码评审人');
    verifierData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码监督人');
  }
  {
    const worksheet = workbook.getWorksheet('加减分类别');
    const headerRow = worksheet.getRow(1);
    let type = -1;
    let typeValueIndex = -1;
    let leaderIndex = -1;
    let describeIndex = -1;
    let dateIndex = -1;
    // let registrantIndex = -1;
    headerRow.eachCell((cell, colNumber) => {
      const header = cell.text.trim();
      if (header === '加减类别') type = colNumber;
      if (header === '自评分') typeValueIndex = colNumber;
      if (header === '直接上级评分') leaderIndex = colNumber;
      if (header === '描述') describeIndex = colNumber;
      if (header === '时间') dateIndex = colNumber;
    });

    const reasonIndex = leadingOutDefectsData[0].findIndex(
      (e) => e === '缺陷描述及原因',
    );
    const commitDateIndex = leadingOutDefectsData[0].findIndex(
      (e) => e === '缺陷引出时间',
    );

    for (let i = 1; i < reviewerData.length; i++) {
      const rowValues = [];
      rowValues[type] = '评审引出缺陷';
      rowValues[typeValueIndex] = -0.5;
      rowValues[leaderIndex] = -0.5;
      rowValues[
        describeIndex
      ] = `登记人:${reviewerData[i][0]}\n登记时间：${reviewerData[i][1]}\n${reviewerData[i][reasonIndex]}`;
      rowValues[dateIndex] = reviewerData[i][commitDateIndex];
      const insertedRow = worksheet.insertRow(2, rowValues, 'o');
      // 设置边框和自动换行
      insertedRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
        cell.alignment = cell.alignment || {};
        cell.alignment.wrapText = true;
      });
      reviewDelNumber += 1;
    }
    for (let i = 1; i < verifierData.length; i++) {
      const rowValues = [];
      rowValues[type] = '督查引出缺陷';
      rowValues[typeValueIndex] = -0.5;
      rowValues[leaderIndex] = -0.5;
      rowValues[
        describeIndex
      ] = `登记人:${verifierData[i][0]}\n登记时间：${verifierData[i][1]}\n${verifierData[i][reasonIndex]}`;
      rowValues[dateIndex] = verifierData[i][commitDateIndex];
      const insertedRow = worksheet.insertRow(2, rowValues, 'o');
      // 设置边框和自动换行
      insertedRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
        cell.alignment = cell.alignment || {};
        cell.alignment.wrapText = true;
      });
      reviewDelNumber += 1;
    }

    {
      const rowValues = [];
      rowValues[type] = '评审不通过';
      rowValues[typeValueIndex] = -reviewDeductionPoints;
      rowValues[leaderIndex] = -reviewDeductionPoints;
      rowValues[describeIndex] = `评审不通过共扣${reviewDeductionPoints}分`;
      const insertedRow = worksheet.insertRow(2, rowValues, 'o');
      // 设置边框和自动换行
      insertedRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
        cell.alignment = cell.alignment || {};
        cell.alignment.wrapText = true;
      });
    }
  }
  //处理【考核表】 将需求总分汇总到【开发需求工作量】里；将缺陷工作量汇总到【缺陷工作量】；将代码提交汇总到【代码提交】；将ai汇总到【加分项】；将代码评审汇总到【代码评审】里 ； 将评审引出缺陷汇总到【减分项】
  {
    const worksheet = workbook.getWorksheet('考核表');
    const headerRow = worksheet.getRow(1);
    let score = -1; //自评分列
    let assessmentIndicators = -1; //考核指标
    headerRow.eachCell((cell, colNumber) => {
      const header = cell.text.trim();
      if (header === '自评分') score = colNumber;
      if (header === '考核指标') assessmentIndicators = colNumber;
    });
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过标题行
      const targetCell = row.getCell(assessmentIndicators);
      if (targetCell.value === '缺陷工作量') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(bugSum);
      }
      if (targetCell.value === '开发需求工作量') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(demandSum);
      }
      if (targetCell.value === '代码提交') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(commit);
      }
      if (targetCell.value === '引出缺陷') {
        const targetCell = row.getCell(score);
        targetCell.value = -Number(leadingOutDefects * 3);
      }
      if (targetCell.value === '代码评审') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(reviewSum);
      }
      if (targetCell.value === '加分项') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(aiNumber * 0.5);
      }
      if (targetCell.value === '减分项') {
        const targetCell = row.getCell(score);
        targetCell.value = -Number(reviewDelNumber * 0.5);
      }
      if (targetCell.value === '代码迁移（一体化）') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(migrate * 0.2);
      }
      if (targetCell.value === '项目打包（只做打包登记）') {
        const targetCell = row.getCell(score);
        targetCell.value = Number(pack * 0.2);
      }
      if (targetCell.value === '合并代码不通过') {
        const targetCell = row.getCell(score);
        targetCell.value = -Number(reviewDeductionPoints);
      }
    });
    function markFormulasDirty(worksheet) {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.formula) {
            // 触发公式重计算
            cell.value = {
              formula: cell.formula,
              date1904: false, // 使用1900日期系统
            };
          }
        });
      });
    }

    // 方案2：标记公式单元格为脏数据
    markFormulasDirty(worksheet);
  }

  // 9. 保存文件

  workbook.calcProperties.fullCalcOnLoad = true;

  await workbook.xlsx.writeFile(inputPath);
  console.log(`处理完成，文件已保存至：${inputPath}`);
}
/**
 * 获取有效数据
 * 【基本校验】1、登记人、登记日期、项目名称、产品类型、产品标识 、类别 不可以为空
 *
 * 有效数据:  1、数据的登记人是当前人的,并且登记日期是当前绩效统计月
 *          2、初审人是当前人的，并且初审日期是当前绩效统计月
 *          3、终审人是当前人的，并且终审日期是当前绩效统计月
 *          4、复核人是当前人的，并且复核日期是当前绩效统计月
 *          5、AI评审人是当前人的，并且AI评审日期是当前绩效统计月
 */
async function extractData() {
  // 1. 读取 Excel 文件
  const workRecordPatch = getWorkRecordPath();
  const workbook = xlsx.readFile(workRecordPatch);
  const sheetName = '工作记录'; // 默认第一个工作表，可改为指定名称
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

  // ================== 列定义 ==================
  // 基础必须列
  const requiredBaseColumns = [
    '登记人',
    '登记日期',
    '项目名称',
    '产品类型',
    '产品标识',
    '类别',
  ];

  // 条件列配置（按类别关键词分组）
  const conditionalColumnsConfig = {
    需求: ['工作内容'],
    缺陷: [
      '缺陷引出人员',
      '缺陷是否跨部门引出',
      '缺陷引出部门',
      '缺陷引出时间',
      '缺陷描述及原因',
    ],
  };
  // ================== 列索引定位 ==================
  const headers = data[0];
  const columnIndices = {};

  // 基础列校验
  for (const colName of requiredBaseColumns) {
    const index = headers.findIndex((h) => String(h).trim() === colName);
    if (index === -1) throw new Error(`缺少必要列【${colName}】`);
    columnIndices[colName] = index;
  }

  // 条件列索引采集（允许不存在）
  const conditionalColumnIndices = {};
  for (const [keyword, columns] of Object.entries(conditionalColumnsConfig)) {
    for (const colName of columns) {
      if (!conditionalColumnIndices[colName]) {
        // 避免重复采集
        const index = headers.findIndex((h) => String(h).trim() === colName);
        conditionalColumnIndices[colName] = index; // 可能为-1
      }
    }
  }
  // ================== 数据过滤 ==================
  const filteredData = [headers];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 2. 定位列索引
    const colIndex = {
      registrant: headers.findIndex((h) => h === '登记人'),
      regDate: headers.findIndex((h) => h === '登记日期'),
      reviewer: headers.findIndex((h) => h === '初审人'),
      reviewDate: headers.findIndex((h) => h === '初审日期'),
      finalReviewer: headers.findIndex((h) => h === '终审人'),
      finalReviewDate: headers.findIndex((h) => h === '终审日期'),
      verifier: headers.findIndex((h) => h === '复核人'),
      verifyDate: headers.findIndex((h) => h === '复核日期'),
      aiReviewer: headers.findIndex((h) => h === 'AI评审人'),
      aiReviewerDate: headers.findIndex((h) => h === 'AI评审日期'),
      defectDetector: headers.findIndex((h) => h === '缺陷引出人员'),
    };

    // 条件1: 登记人+登记时间
    const cond1 =
      String(row[colIndex.registrant]).trim() === USER_NAME &&
      isCurrentMonth(row[colIndex.regDate] || '');

    // 条件2: 审核人+审核时间
    const cond2 =
      colIndex.reviewer !== -1 &&
      colIndex.reviewDate !== -1 &&
      String(row[colIndex.reviewer]).trim() === USER_NAME &&
      isCurrentMonth(row[colIndex.reviewDate] || '');

    // 条件3: 终审人+终审时间
    const cond3 =
      colIndex.finalReviewer !== -1 &&
      colIndex.finalReviewDate !== -1 &&
      String(row[colIndex.finalReviewer]).trim() === USER_NAME &&
      isCurrentMonth(row[colIndex.finalReviewDate] || '');

    // 条件4: 复核人+复核时间
    const cond4 =
      colIndex.verifier !== -1 &&
      colIndex.verifyDate !== -1 &&
      String(row[colIndex.verifier]).trim() === USER_NAME &&
      isCurrentMonth(row[colIndex.verifyDate] || '');

    // 条件5： ai评审人 + ai评审时间
    const cond5 =
      colIndex.aiReviewer !== -1 &&
      colIndex.aiReviewerDate !== -1 &&
      String(row[colIndex.aiReviewer]).trim().includes(USER_NAME) &&
      isCurrentMonth(row[colIndex.aiReviewerDate] || '');

    // 条件6: 登记人+ 复核时间 暂时去掉
    const cond6 = (
        String(row[colIndex.registrant]).trim() === USER_NAME &&
        isCurrentMonth(row[colIndex.verifyDate]||'')
    );
    //条件7：引出人员 + 登记日期
    const cond7 =
      String(row[colIndex.defectDetector]).trim() === USER_NAME &&
      isCurrentMonth(row[colIndex.regDate] || '');

    if (!(cond1 || cond2 || cond3 || cond4 || cond5 || cond7 || cond6)) {
      continue;
    }

    // 条件3：基础列非空
    let hasEmptyField = false;
    for (const colName of requiredBaseColumns) {
      const value = row[columnIndices[colName]];
      if (isEmpty(value)) {
        hasEmptyField = true;
        break;
      }
    }
    if (hasEmptyField) continue;

    // 条件4：动态条件列校验
    const category = String(row[columnIndices['类别']]);
    const activeConditions = [];

    if (category.includes('需求') || category === '缺陷转需求')
      activeConditions.push('需求');
    if (category.includes('缺陷') && category !== '缺陷转需求')
      activeConditions.push('缺陷');

    for (const condition of activeConditions) {
      const requiredColumns = conditionalColumnsConfig[condition];
      for (const colName of requiredColumns) {
        const colIndex = conditionalColumnIndices[colName];
        // 列不存在或值为空
        if (colIndex === -1 || isEmpty(row[colIndex])) {
          hasEmptyField = true;
          break;
        }
      }
      if (hasEmptyField) break;
    }
    if (hasEmptyField) continue;
    filteredData.push(row);
  }
  console.info(`当前导出数据符合规范的一共${filteredData.length}条`);
  return filteredData;
}

/**
 * 样式复制
 * @param {*} templatePath
 * @param {*} outputPath
 * @param {*} data
 */
async function copyStylesWithData(templatePath, outputPath, data) {
  const workbook = new excelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  // 样式复制核心逻辑
  async function processSheet(sheetName, dataRows) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return;

    // 清空旧数据（保留标题行）
    const headerRow = sheet.getRow(1);
    sheet.spliceRows(2, sheet.rowCount);
    // 创建列映射
    const templateColumns = headerRow.values.slice(1);
    const columnMap = templateColumns.map((templateCol) =>
      data.headers.findIndex(
        (h) => normalizeString(h) === normalizeString(templateCol),
      ),
    );

    // 写入数据并复制样式
    dataRows.forEach((rowData, rowIndex) => {
      const newRow = sheet.getRow(rowIndex + 2);

      templateColumns.forEach((col, colIndex) => {
        const cell = newRow.getCell(colIndex + 1);
        const dataIndex = columnMap[colIndex];

        // 赋值数据
        cell.value = dataIndex !== -1 ? rowData[dataIndex] : null;
        // 获取模板的“数据区”样式行（第2行）
        const templateDataRow = sheet.getRow(2);
        // 写入数据并复制样式
        dataRows.forEach((rowData, rowIndex) => {
          const newRow = sheet.getRow(rowIndex + 2);
          templateColumns.forEach((col, colIndex) => {
            const cell = newRow.getCell(colIndex + 1);
            const dataIndex = columnMap[colIndex];
            // 赋值数据
            cell.value = dataIndex !== -1 ? rowData[dataIndex] : null;
            // 复制第2行的样式
            const templateCell = templateDataRow.getCell(colIndex + 1);
            if (templateCell) {
              cell.font = templateCell.font
                ? JSON.parse(JSON.stringify(templateCell.font))
                : undefined;
              cell.alignment = templateCell.alignment
                ? JSON.parse(JSON.stringify(templateCell.alignment))
                : undefined;
              cell.border = templateCell.border
                ? JSON.parse(JSON.stringify(templateCell.border))
                : undefined;
              cell.fill = templateCell.fill
                ? JSON.parse(JSON.stringify(templateCell.fill))
                : undefined;
            }
          });
        });
      });
    });
    headerRow.eachCell((cell) => {
      cell.font = { name: '微软雅黑', bold: true, color: { argb: 'FF000000' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFC000' }, // 橙黄色
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
      cell.alignment = cell.alignment || {};
      cell.alignment.vertical = 'middle';
      cell.alignment.horizontal = 'center';
    });
  }

  // 处理sheet
  await processSheet('需求', data['需求']);
  await processSheet('缺陷', data['缺陷']);
  await processSheet('代码提交记录', data['代码提交记录']);
  await processSheet('代码评审', data['代码评审']);
  await processSheet('代码迁移-一体化', data['代码迁移-一体化']);
  await processSheet(
    '项目打包（只作为打包登记）',
    data['项目打包（只作为打包登记）'],
  );
  // 保存文件
  await workbook.xlsx.writeFile(outputPath);
}
/**
 * 生成个人绩效
 */
class GeneratePerformance {
  /**
   * 开始运行
   */
  static async main() {
    try {
      console.info('----> 生成绩效开始');
      // 参数配置
      const inputFile = getWorkRecordPath();
      const templatePath = getTemplate();
      const outputFile = performanceUrl();

      // 步骤1：数据处理
      console.time('数据处理耗时');
      const processedData = await processData(inputFile);
      console.timeEnd('数据处理耗时');
      // 步骤2：样式化导出
      console.time('样式导出耗时');
      await copyStylesWithData(templatePath, outputFile, {
        需求: processedData['需求'],
        缺陷: processedData['缺陷'],
        代码提交记录: processedData['代码提交记录'],
        代码评审: processedData['代码评审'],
        '代码迁移-一体化': processedData['代码迁移-一体化'],
        '项目打包（只作为打包登记）':
          processedData['项目打包（只作为打包登记）'],
        headers: processedData.headers,
      });
      console.timeEnd('样式导出耗时');
      //处理需求、缺陷的分值
      console.time('分值计算耗时');
      await processWorkbook(outputFile);
      console.timeEnd('分值计算耗时');
    } catch (err) {
      console.error(err);
    } finally {
      console.info(`----> 生成绩效结束`);
    }
  }
}
GeneratePerformance.main();
