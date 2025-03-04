'use strict';

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
 * 生成个人绩效
 */
class GeneratePerformance {
  /**
   * 开始运行
   */
  static main() {
    try {
    } catch (err) {
      console.error(err);
    } finally {
      console.info(`----> 生成绩效结束`);
    }
  }
}
