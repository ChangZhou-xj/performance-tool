var assert = require('chai').assert;
var { buildReportMarkdown } = require('../generate-report-kf');

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

// 截取「二、其他：」到「三、」之间的内容，用于断言该板块输出
function extractOtherSection(md) {
  var otherPos = md.indexOf('二、其他：');
  var monthPos = md.indexOf('三、');
  assert.isAbove(otherPos, 0, '应存在「二、其他：」板块');
  assert.isAbove(monthPos, otherPos, '「三、」应在「二、其他：」之后');
  return md.slice(otherPos, monthPos);
}

describe('buildReportMarkdown 二、其他：板块（day）', function () {

  it('代码迁移记录应显示在「二、其他：」中', function () {
    var data = makeReportData({
      migrations: [
        { key: 'm1', text: '【代码迁移-需求】迁移代码【KFXQ-CX-001】', date: '2026年7月6日', ticketNo: 'KFXQ-CX-001' },
      ],
    });
    var section = extractOtherSection(buildReportMarkdown('day', data, null));
    assert.include(section, '代码迁移');
    assert.notInclude(section, '暂无');
  });

  it('项目打包记录应显示在「二、其他：」中', function () {
    var data = makeReportData({
      packs: [
        { key: 'p1', text: '【项目打包】打包发布【TJ001】', date: '2026年7月6日', ticketNo: 'TJ001' },
      ],
    });
    var section = extractOtherSection(buildReportMarkdown('day', data, null));
    assert.include(section, '项目打包');
    assert.notInclude(section, '暂无');
  });

  it('无提交缺陷、代码迁移、项目打包应同时显示在「二、其他：」中', function () {
    var data = makeReportData({
      noCommitDefects: [
        { key: 'n1', text: '程序缺陷（无提交）：问题A  原因：原因A', date: '2026年7月6日' },
      ],
      migrations: [
        { key: 'm1', text: '【代码迁移-需求】迁移代码【KFXQ-CX-001】', date: '2026年7月6日' },
      ],
      packs: [
        { key: 'p1', text: '【项目打包】打包发布【TJ001】', date: '2026年7月6日' },
      ],
    });
    var section = extractOtherSection(buildReportMarkdown('day', data, null));
    assert.include(section, '问题A');
    assert.include(section, '代码迁移');
    assert.include(section, '项目打包');
    assert.notInclude(section, '暂无');
  });

  it('无任何其他项时显示「暂无」', function () {
    var data = makeReportData({});
    var section = extractOtherSection(buildReportMarkdown('day', data, null));
    assert.include(section, '暂无');
  });
});
