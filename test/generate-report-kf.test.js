'use strict';

var assert = require('chai').assert;
var fs = require('fs');
var path = require('path');
var os = require('os');
var xlsx = require('xlsx');
var { filterCompleted, completedTaskStatuses, extractDeveloperReportData, buildReportMarkdown, buildWeekReportMarkdown } = require('../generate-report-kf');

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

describe('buildReportMarkdown 日报完成状态过滤（day）', function () {

  function makeReportData(overrides) {
    return Object.assign({
      startDate: new Date(2026, 6, 6),
      endDate: new Date(2026, 6, 6),
      demands: [], defectToDemands: [], ppDefects: [], nonPpDefects: [],
      ppInvalidDefects: [], nonPpInvalidDefects: [], noCommitDefects: [],
      commits: [], reviews: [], migrations: [], packs: [],
      achievedItems: [],
      nextPlanItems: [],
      inProgressDemands: [],
      monthlyDemandProgress: { month: 7, completedCount: 0, inProgressCount: 0 },
    }, overrides);
  }

  it('需求开发仅展示开发完成和任务完成', function () {
    var data = makeReportData({
      demands: [
        { key: 'd1', text: '需求A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'd2', text: '需求B', taskStatus: '任务完成', date: '2026年7月6日' },
        { key: 'd3', text: '需求C', taskStatus: '测试中', date: '2026年7月6日' },
      ],
    });
    var md = buildReportMarkdown('day', data, null);
    assert.include(md, '需求A');
    assert.include(md, '需求B');
    assert.notInclude(md, '需求C');
  });

  it('需求开发为空时取进行中需求前2条', function () {
    var data = makeReportData({
      demands: [],
      inProgressDemands: [
        { key: 'p1', text: '进行中需求1', taskStatus: '进行中', date: '2026年7月6日', plannedFinish: '2026年7月8日' },
      ],
    });
    var md = buildReportMarkdown('day', data, null);
    assert.include(md, '进行中需求1');
  });

  it('缺陷修复2.1/2.2仅展示开发完成和任务完成（含无效缺陷）', function () {
    var data = makeReportData({
      ppDefects: [
        { key: 'p1', text: 'PP缺陷A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'p2', text: 'PP缺陷B', taskStatus: '测试中', date: '2026年7月6日' },
      ],
      ppInvalidDefects: [
        { key: 'pi1', text: 'PP无效缺陷A', taskStatus: '任务完成', date: '2026年7月6日' },
      ],
      nonPpDefects: [
        { key: 'n1', text: '非PP缺陷A', taskStatus: '开发完成', date: '2026年7月6日' },
      ],
    });
    var md = buildReportMarkdown('day', data, null);
    assert.include(md, 'PP缺陷A');
    assert.notInclude(md, 'PP缺陷B');
    assert.include(md, 'PP无效缺陷A');
    assert.include(md, '非PP缺陷A');
  });

  it('其他板块仅展示开发完成和任务完成', function () {
    var data = makeReportData({
      noCommitDefects: [
        { key: 'n1', text: '无提交缺陷A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'n2', text: '无提交缺陷B', taskStatus: '进行中', date: '2026年7月6日' },
      ],
      migrations: [
        { key: 'm1', text: '迁移A', taskStatus: '任务完成', date: '2026年7月6日' },
      ],
      packs: [
        { key: 'p1', text: '打包A', taskStatus: '测试中', date: '2026年7月6日' },
      ],
    });
    var md = buildReportMarkdown('day', data, null);
    var otherSection = md.slice(md.indexOf('二、其他：'), md.indexOf('三、'));
    assert.include(otherSection, '无提交缺陷A');
    assert.notInclude(otherSection, '无提交缺陷B');
    assert.include(otherSection, '迁移A');
    assert.notInclude(otherSection, '打包A');
  });
});

describe('buildWeekReportMarkdown 完成状态过滤（week）', function () {

  function makeWeekData(overrides) {
    return Object.assign({
      month: 7,
      monthlyDemandProgress: { month: 7, completedCount: 0, inProgressCount: 0 },
      demands: [], defectToDemands: [], ppDefects: [], nonPpDefects: [],
      ppInvalidDefects: [], nonPpInvalidDefects: [],
      nextPlanItems: [],
    }, overrides);
  }

  it('需求仅展示开发完成和任务完成', function () {
    var data = makeWeekData({
      demands: [
        { key: 'd1', text: '需求A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'd2', text: '需求B', taskStatus: '测试中', date: '2026年7月6日' },
      ],
    });
    var md = buildWeekReportMarkdown(data, null);
    assert.include(md, '需求A');
    assert.notInclude(md, '需求B');
  });

  it('问题修复仅展示开发完成和任务完成', function () {
    var data = makeWeekData({
      ppDefects: [
        { key: 'p1', text: 'PP缺陷A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'p2', text: 'PP缺陷B', taskStatus: '测试中', date: '2026年7月6日' },
      ],
      nonPpDefects: [
        { key: 'n1', text: '非PP缺陷A', taskStatus: '任务完成', date: '2026年7月6日' },
      ],
    });
    var md = buildWeekReportMarkdown(data, null);
    assert.include(md, 'PP缺陷A');
    assert.notInclude(md, 'PP缺陷B');
    assert.include(md, '非PP缺陷A');
  });

  it('汇总计数为过滤后的数量', function () {
    var data = makeWeekData({
      demands: [
        { key: 'd1', text: '需求A', taskStatus: '开发完成', date: '2026年7月6日' },
        { key: 'd2', text: '需求B', taskStatus: '测试中', date: '2026年7月6日' },
      ],
      ppDefects: [
        { key: 'p1', text: 'PP缺陷A', taskStatus: '开发完成', date: '2026年7月6日' },
      ],
      nonPpDefects: [
        { key: 'n1', text: '非PP缺陷A', taskStatus: '测试中', date: '2026年7月6日' },
      ],
    });
    var md = buildWeekReportMarkdown(data, null);
    assert.include(md, '需求开发（共1个）');
    assert.include(md, '问题修复（共1个）');
  });
});

describe('连带变化：任务完成等效开发完成', function () {
  var tmpPath;

  afterEach(function () {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  });

  it('日报·目标达成包含任务完成条目', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({ 3: '需求', 4: '任务完成的需求条目', 11: '任务完成' }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);
    assert.lengthOf(data.achievedItems, 1);
    assert.equal(data.achievedItems[0].taskStatus, '任务完成');
    assert.include(data.achievedItems[0].text, '任务完成的需求条目');
  });

  it('日报·任务完成的缺陷附加来源信息', async function () {
    tmpPath = createMockWorkRecord([
      makeRow({
        3: '缺陷', 4: '任务完成的缺陷条目', 11: '任务完成',
        14: '张三', 15: '2026年7月2日', 16: '测试部',
      }),
    ]);
    var data = await extractDeveloperReportData('day', new Date(2026, 6, 2), tmpPath);
    assert.lengthOf(data.achievedItems, 1);
    assert.include(data.achievedItems[0].text, '缺陷引出人:张三');
  });
});
