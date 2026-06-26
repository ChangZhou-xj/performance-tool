var assert = require('chai').assert;
var { groupNextPlanItems } = require('../generate-report-kf');

function makeItem(projectName) {
  return { key: projectName, text: projectName, projectName: projectName };
}

describe('groupNextPlanItems()', function () {

  it('项目对接与开发工作正确分组', function () {
    var items = [
      makeItem('辽宁省沈阳大学智慧财务一体化实施服务项目'), // 项目对接
      makeItem('内部开发'),                                   // 开发工作
      makeItem('个旧市智能支出服务与监督管理平台实施项目'),    // 项目对接
      makeItem('自主优化'),                                   // 开发工作
    ];
    var result = groupNextPlanItems(items);
    assert.lengthOf(result.dockingItems, 2);
    assert.lengthOf(result.devItems, 2);
    assert.equal(result.dockingItems[0].projectName, '辽宁省沈阳大学智慧财务一体化实施服务项目');
    assert.equal(result.dockingItems[1].projectName, '个旧市智能支出服务与监督管理平台实施项目');
  });

  it('projectName 为空归入开发工作', function () {
    var items = [makeItem(''), makeItem(undefined), makeItem(null)];
    var result = groupNextPlanItems(items);
    assert.lengthOf(result.dockingItems, 0);
    assert.lengthOf(result.devItems, 3);
  });

  it('全部为项目对接时开发工作组为空', function () {
    var items = [
      makeItem('福建电力职业技术学院2025年智慧财务软件实施项目'),
      makeItem('国家体育总局反兴奋剂中心电子凭证报销系统实施项目'),
    ];
    var result = groupNextPlanItems(items);
    assert.lengthOf(result.dockingItems, 2);
    assert.lengthOf(result.devItems, 0);
  });

  it('空列表返回两组都为空', function () {
    var result = groupNextPlanItems([]);
    assert.lengthOf(result.dockingItems, 0);
    assert.lengthOf(result.devItems, 0);
  });
});

var { buildReportMarkdown } = require('../generate-report-kf');

describe('buildReportMarkdown 未完成工作分组（day）', function () {

  function makeReportData(nextPlanItems) {
    return {
      startDate: new Date(2026, 5, 26),
      endDate: new Date(2026, 5, 26),
      demands: [], defectToDemands: [], ppDefects: [], nonPpDefects: [],
      ppInvalidDefects: [], nonPpInvalidDefects: [], noCommitDefects: [],
      commits: [], reviews: [], migrations: [], packs: [],
      achievedItems: [],
      nextPlanItems: nextPlanItems,
      inProgressDemands: [],
      monthlyDemandProgress: { month: 6, completedCount: 0, inProgressCount: 0 },
    };
  }

  function makePlanItem(key, projectName, plannedFinish) {
    return { key: key, text: key, projectName: projectName, plannedFinish: plannedFinish || '' };
  }

  it('项目对接在前、开发工作在后，各自从 1 编号', function () {
    var data = makeReportData([
      makePlanItem('A', '内部开发', ''),
      makePlanItem('B', '辽宁省沈阳大学智慧财务一体化实施服务项目', '2026年6月28日'),
    ]);
    var md = buildReportMarkdown('day', data, null);
    var dockingPos = md.indexOf('项目对接：');
    var devPos = md.indexOf('开发工作：');
    assert.isAbove(dockingPos, 0);
    assert.isAbove(devPos, 0);
    assert.isBelow(dockingPos, devPos, '项目对接应在开发工作之前');
    assert.ok(/项目对接：\n\s+1\./.test(md), '项目对接应从 1 开始编号');
    assert.ok(/开发工作：\n\s+1\./.test(md), '开发工作应从 1 开始编号');
  });

  it('只有开发工作时仅显示开发工作子标题', function () {
    var data = makeReportData([makePlanItem('A', '内部开发', '')]);
    var md = buildReportMarkdown('day', data, null);
    assert.equal(md.indexOf('项目对接：'), -1);
    assert.isAbove(md.indexOf('开发工作：'), 0);
  });

  it('无未完成工作时显示暂无', function () {
    var data = makeReportData([]);
    var md = buildReportMarkdown('day', data, null);
    assert.ok(/七、明日工作计划：\n\s+暂无/.test(md));
  });
});
