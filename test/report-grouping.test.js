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
