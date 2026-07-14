var assert = require('chai').assert;
var fs = require('fs');
var path = require('path');
var os = require('os');
var xlsx = require('xlsx');
var { extractDeveloperReportData } = require('../generate-report-kf');

// 构造与真实工作记录一致表头的 mock xlsx，返回临时文件路径
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
  var tmpPath = path.join(os.tmpdir(), `mock-work-record-${Date.now()}.xlsx`);
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

describe('extractDeveloperReportData 代码迁移分类', function () {
  var tmpPath;

  beforeEach(function () {
    tmpPath = null;
  });

  afterEach(function () {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  });

  it('代码迁移-需求 应进入 migrations 而非 demands', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({ 3: '代码迁移-需求', 4: '迁移差旅费旺季标准代码', 8: 'KFXQ-CX-2026061700019' }),
      makeRow({ 3: '需求', 4: '正常需求开发任务', 8: 'KFXQ-CX-2026061700020' }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);

    assert.equal(data.migrations.length, 1, '代码迁移应进入 migrations');
    assert.include(data.migrations[0].text, '代码迁移-需求');
    assert.equal(data.demands.length, 1, '仅正常需求进入 demands');
    assert.notInclude(data.demands[0].text, '代码迁移');
  });

  it('代码迁移-缺陷 应进入 migrations 而非缺陷列表', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({ 3: '代码迁移-缺陷', 4: '迁移缺陷修复代码', 8: 'QXWT-CX-2026062200138' }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);

    assert.equal(data.migrations.length, 1, '代码迁移-缺陷应进入 migrations');
    assert.equal(data.ppDefects.length, 0, '代码迁移-缺陷不应进入 ppDefects');
    assert.equal(data.nonPpDefects.length, 0, '代码迁移-缺陷不应进入 nonPpDefects');
  });
});
