'use strict';

/**
 * 日报生成逻辑测试脚本
 * 运行方式：node test-report.js
 *
 * 直接 mock xlsx 读取，不依赖真实 Excel 文件和环境变量
 */

// ── mock 依赖 ──────────────────────────────────────────────────────────────────

// mock config：固定用户名
process.env.USER_NAME = '测试用户';
process.env.DEPARTMENT = '测试部门';

// mock xlsx：返回构造好的二维数组
const xlsx = require('xlsx');
const originalReadFile = xlsx.readFile;
const originalSheetToJson = xlsx.utils.sheet_to_json;

let mockSheetData = [];

xlsx.readFile = () => ({ Sheets: { '工作记录': '__mock__' } });
xlsx.utils.sheet_to_json = (sheet, opts) => {
  if (sheet === '__mock__') return mockSheetData;
  return originalSheetToJson(sheet, opts);
};

const { extractDeveloperReportData } = require('./generate-report-kf');

// ── 工具函数 ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

/**
 * 构造表头行（与 generate-report-kf.js 中 getColumnIndexMap 对应）
 */
const HEADERS = [
  '登记人', '登记日期', '开发完成日期', '类别', '任务内容',
  '项目名称', '产品类型', '产品标识', 'A8单号、任务/问题列表编号',
  '提交编号', '提交信息', '任务状态', '需求等级',
  '缺陷引出人员', '缺陷引出日期', '缺陷引出部门',
  '初审人', '初审日期', '终审人', '终审日期', '复核人', '复核日期',
];

const H = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

/**
 * 构造一行数据，只需传入关心的字段
 */
function makeRow(fields) {
  const row = new Array(HEADERS.length).fill('');
  row[H['登记人']] = '测试用户';
  row[H['登记日期']] = '2026年4月6日';
  row[H['开发完成日期']] = '2026年4月6日';
  row[H['任务状态']] = '开发完成';
  Object.entries(fields).forEach(([key, val]) => {
    if (H[key] !== undefined) row[H[key]] = val;
  });
  return row;
}

/**
 * 设置 mock 数据并执行提取，固定日期为 2026-04-06（周日）
 */
async function run(rows) {
  mockSheetData = [HEADERS, ...rows];
  // 2026-04-06 是周日，day 报告取当天
  return extractDeveloperReportData('day', new Date(2026, 3, 6));
}

// ── 测试用例 ───────────────────────────────────────────────────────────────────

async function testDemand() {
  console.log('\n【需求类别】');
  const data = await run([
    makeRow({ '类别': '需求', '任务内容': '普通需求A', '任务状态': '开发完成' }),
    makeRow({ '类别': '需求', '任务内容': '进行中需求B', '任务状态': '进行中' }),
    makeRow({ '类别': '需求', '任务内容': '测试中需求C', '任务状态': '测试中' }),
  ]);
  assert(data.demands.length === 2, '开发完成+测试中的需求进入 demands（共2条）');
  assert(data.demands.some(d => d.text.includes('普通需求A')), '普通需求A 在 demands 中');
  assert(data.demands.some(d => d.text.includes('测试中需求C')), '测试中需求C 在 demands 中');
  assert(data.nextPlanItems.some(d => d.text.includes('进行中需求B')), '进行中需求B 进入 nextPlanItems');
  assert(data.defectToDemands.length === 0, '无缺陷转需求');
}

async function testDefectToDemand() {
  console.log('\n【缺陷转需求 — 排在需求后面】');
  const data = await run([
    makeRow({ '类别': '需求', '任务内容': '普通需求A', '任务状态': '开发完成' }),
    makeRow({ '类别': '缺陷转需求', '任务内容': '缺陷转需求X', '任务状态': '开发完成' }),
  ]);
  assert(data.demands.length === 1, '普通需求进 demands');
  assert(data.defectToDemands.length === 1, '缺陷转需求进 defectToDemands');
  assert(data.defectToDemands[0].text.includes('缺陷转需求X'), '缺陷转需求X 在 defectToDemands 中');
  assert(data.ppDefects.length === 0, '缺陷转需求不进 ppDefects');
  assert(data.nonPpDefects.length === 0, '缺陷转需求不进 nonPpDefects');
}

async function testDefect() {
  console.log('\n【缺陷类别 — PP / 非PP 区分】');
  const data = await run([
    makeRow({ '类别': '缺陷', '任务内容': 'PP缺陷', 'A8单号、任务/问题列表编号': 'QXWT-001' }),
    makeRow({ '类别': '缺陷', '任务内容': '非PP缺陷', 'A8单号、任务/问题列表编号': 'BUG-999' }),
    makeRow({ '类别': '缺陷转需求', '任务内容': '不应进缺陷桶' }),
  ]);
  assert(data.ppDefects.length === 1, 'QXWT- 前缀进 ppDefects');
  assert(data.nonPpDefects.length === 1, '非QXWT- 进 nonPpDefects');
  assert(data.ppDefects[0].text.includes('PP缺陷'), 'ppDefects 内容正确');
  assert(data.nonPpDefects[0].text.includes('非PP缺陷'), 'nonPpDefects 内容正确');
}

async function testMigration() {
  console.log('\n【代码迁移 — 一体化/缺陷/需求 均进 migrations】');
  const data = await run([
    makeRow({ '类别': '代码迁移-一体化', '任务内容': '迁移A' }),
    makeRow({ '类别': '代码迁移-缺陷', '任务内容': '迁移B', '提交编号': 'abc123', '提交信息': '修复迁移缺陷' }),
    makeRow({ '类别': '代码迁移-需求', '任务内容': '迁移C', '提交编号': 'def456', '提交信息': '迁移需求' }),
  ]);
  assert(data.migrations.length === 3, '三种代码迁移类别都进 migrations');
  assert(data.migrations.some(m => m.text.includes('代码迁移-一体化')), '代码迁移-一体化 标签正确');
  assert(data.migrations.some(m => m.text.includes('代码迁移-缺陷')), '代码迁移-缺陷 标签正确');
  assert(data.migrations.some(m => m.text.includes('代码迁移-需求')), '代码迁移-需求 标签正确');
  assert(data.commits.length === 0, '代码迁移不进 commits');
}

async function testCommitAndReview() {
  console.log('\n【代码提交 & 代码评审】');
  const data = await run([
    makeRow({
      '类别': '需求', '任务内容': '提交需求',
      '提交编号': 'abc001', '提交信息': '修复登录bug',
    }),
    makeRow({
      '类别': '需求', '任务内容': '评审需求',
      '初审人': '张三', '初审日期': '2026年4月6日',
      '终审人': '李四', '终审日期': '2026年4月6日',
      '复核人': '王五', '复核日期': '2026年4月6日',
    }),
    makeRow({
      '类别': '项目打包（只作为打包登记）', '任务内容': '打包',
      '提交编号': 'pkg001', '提交信息': '打包v1.0',
    }),
  ]);
  assert(data.commits.length === 1, '有提交编号+提交信息的需求进 commits');
  assert(data.commits[0].text.includes('代码提交'), 'commits 标签为【代码提交】');
  assert(data.reviews.length === 1, '审核流程完整的进 reviews');
  assert(data.reviews[0].text.includes('代码评审'), 'reviews 标签为【代码评审】');
  assert(data.packs.length === 1, '打包类别进 packs');
  assert(data.packs[0].text.includes('项目打包'), 'packs 标签为【项目打包】');
}

async function testDateFilter() {
  console.log('\n【日期过滤 — 只取当天记录】');
  const data = await run([
    makeRow({ '类别': '需求', '任务内容': '今天的需求', '开发完成日期': '2026年4月6日' }),
    makeRow({ '类别': '需求', '任务内容': '昨天的需求', '开发完成日期': '2026年4月5日' }),
  ]);
  assert(data.demands.length === 1, '只有今天的需求进 demands');
  assert(data.demands[0].text.includes('今天的需求'), '今天的需求内容正确');
}

async function testOtherUserFiltered() {
  console.log('\n【其他人的记录被过滤】');
  mockSheetData = [
    HEADERS,
    (() => {
      const row = makeRow({ '类别': '需求', '任务内容': '他人需求' });
      row[H['登记人']] = '其他用户';
      return row;
    })(),
  ];
  const data = await extractDeveloperReportData('day', new Date(2026, 3, 6));
  assert(data === null || data.demands.length === 0, '其他用户的记录不进 demands');
}

// ── 执行所有测试 ───────────────────────────────────────────────────────────────

(async () => {
  console.log('=== generate-report-kf.js 单元测试 ===');
  await testDemand();
  await testDefectToDemand();
  await testDefect();
  await testMigration();
  await testCommitAndReview();
  await testDateFilter();
  await testOtherUserFiltered();

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
})();
