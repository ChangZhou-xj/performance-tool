'use strict';

var assert = require('chai').assert;
var fs = require('fs');
var path = require('path');
var os = require('os');
var xlsx = require('xlsx');
var { filterCompleted, completedTaskStatuses, extractDeveloperReportData } = require('../generate-report-kf');

describe('completedTaskStatuses', function () {

  it('包含开发完成和任务完成', function () {
    assert.isTrue(completedTaskStatuses.has('开发完成'));
    assert.isTrue(completedTaskStatuses.has('任务完成'));
  });

  it('不包含测试中和进行中', function () {
    assert.isFalse(completedTaskStatuses.has('测试中'));
    assert.isFalse(completedTaskStatuses.has('进行中'));
  });
});

describe('filterCompleted()', function () {

  it('保留开发完成和任务完成，排除其他状态', function () {
    var items = [
      { key: '1', taskStatus: '开发完成' },
      { key: '2', taskStatus: '任务完成' },
      { key: '3', taskStatus: '测试中' },
      { key: '4', taskStatus: '进行中' },
    ];
    var result = filterCompleted(items);
    assert.lengthOf(result, 2);
    assert.equal(result[0].key, '1');
    assert.equal(result[1].key, '2');
  });

  it('空数组返回空数组', function () {
    assert.lengthOf(filterCompleted([]), 0);
  });

  it('taskStatus 为空或缺失的条目被排除', function () {
    var items = [
      { key: '1', taskStatus: '开发完成' },
      { key: '2', taskStatus: '' },
      { key: '3' },
    ];
    assert.lengthOf(filterCompleted(items), 1);
  });
});

function createMockWorkRecord(rows) {
  var headers = [
    '登记人', '登记日期', '开发完成日期', '类别', '任务内容',
    '项目名称', '产品类型', '产品标识', 'A8单号、任务/问题列表编号',
    '提交编号', '提交信息', '任务状态', '需求等级', '计划完成日期',
    '缺陷引出人员', '缺陷引出日期', '缺陷引出部门',
    '初审人', '初审日期', '终审人', '终审日期', '复核人', '复核日期',
  ];
  var data = [headers].concat(rows);
  var ws = xlsx.utils.aoa_to_sheet(data);
  var wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '工作记录');
  var tmpPath = path.join(os.tmpdir(), 'mock-work-record-' + Date.now() + '.xlsx');
  xlsx.writeFile(wb, tmpPath);
  return tmpPath;
}

function makeRow(overrides) {
  var row = [
    '周兴杰', '2026年7月2日', '2026年7月2日', '', '',
    '', '', '', '', '', '', '开发完成', '', '',
    '', '', '', '', '', '', '', '', '',
  ];
  return Object.assign(row, overrides);
}

describe('monthlyDemandProgress.completedCount', function () {
  var tmpPath;

  afterEach(function () {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  });

  it('仅统计开发完成和任务完成的需求', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({ 3: '需求', 4: '开发完成需求', 11: '开发完成' }),
      makeRow({ 3: '需求', 4: '任务完成需求', 11: '任务完成' }),
      makeRow({ 3: '需求', 4: '测试中需求', 11: '测试中' }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);
    assert.equal(data.monthlyDemandProgress.completedCount, 2);
  });

  it('测试完成的需求不计入 completedCount', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({ 3: '需求', 4: '测试完成需求', 11: '测试完成' }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);
    assert.equal(data.monthlyDemandProgress.completedCount, 0);
  });
});
