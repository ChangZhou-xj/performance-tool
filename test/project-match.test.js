var assert = require('chai').assert;
var { matchProject } = require('../service/project-match');

describe('matchProject()', function () {

  it('福建电力项目名称命中', function () {
    var p = matchProject('福建电力职业技术学院2025年智慧财务软件实施项目');
    assert.isNotNull(p);
    assert.equal(p.displayName, '福建电力职业技术学院2025年智慧财务软件实施项目');
  });

  it('沈阳大学项目名称命中（displayName 为人工简称，Excel 实际值含 matchKeyword）', function () {
    var p = matchProject('辽宁省沈阳大学智慧财务一体化实施服务项目');
    assert.isNotNull(p);
    assert.equal(p.displayName, '辽宁沈阳大学项目');
  });

  it('个旧项目名称命中', function () {
    var p = matchProject('个旧市智能支出服务与监督管理平台实施项目');
    assert.isNotNull(p);
    assert.equal(p.displayName, '云南个旧项目');
  });

  it('反兴奋剂中心项目名称命中', function () {
    var p = matchProject('国家体育总局反兴奋剂中心电子凭证报销系统实施项目');
    assert.isNotNull(p);
    assert.equal(p.displayName, '国家体育总局反兴奋剂中心');
  });

  it('非对接项目返回 null', function () {
    assert.isNull(matchProject('内部开发'));
    assert.isNull(matchProject('自主优化'));
    assert.isNull(matchProject('一体化核算内部支持项目'));
  });

  it('空值/未填写返回 null', function () {
    assert.isNull(matchProject(''));
    assert.isNull(matchProject(null));
    assert.isNull(matchProject(undefined));
  });
});
