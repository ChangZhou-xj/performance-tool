var assert = require('chai').assert;
var { formatNoCommitDefectLine } = require('../generate-report-kf');

describe('formatNoCommitDefectLine()', function () {
  it('应使用工作表类别列作为前缀，而非硬编码"问题："', function () {
    var record = {
      category: '程序缺陷（无提交）',
      taskContent: '添加票据按钮显示bug',
      commitInfo: '与现场沟通最新给过来的前端已修复',
    };

    var result = formatNoCommitDefectLine(record);

    assert.include(result, '程序缺陷（无提交）：添加票据按钮显示bug');
    assert.notInclude(result, '问题：');
  });

  it('不同类别应显示对应类型前缀', function () {
    var record = {
      category: '需求（无提交）',
      taskContent: '财务岗审批指标不能直接替换',
      commitInfo: '主要解决财务审核岗调整指标后不能自动填写本次使用金额需求',
    };

    var result = formatNoCommitDefectLine(record);

    assert.include(result, '需求（无提交）：财务岗审批指标不能直接替换');
    assert.notInclude(result, '问题：');
  });

  it('原因信息保留在输出中', function () {
    var record = {
      category: '程序缺陷（无提交）',
      taskContent: '差旅费报销界面城市识别出错',
      commitInfo: '票据识别需要电子凭证处理',
    };

    var result = formatNoCommitDefectLine(record);

    assert.include(result, '原因：票据识别需要电子凭证处理');
  });
});
