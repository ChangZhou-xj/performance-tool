'use strict';
require('dotenv').config();
const HolidayService = require('./service/holiday-service');
const dayjs = require('dayjs');

/**
 * 测试节假日判断功能
 */
async function testHoliday() {
  console.log('====================================');
  console.log('节假日判断测试');
  console.log('====================================\n');

  const holidayService = new HolidayService();

  // 测试今天
  console.log('【测试今天】');
  const today = new Date();
  const todayInfo = await holidayService.getDateInfo(today);
  console.log(`日期: ${todayInfo.date}`);
  console.log(`类型: ${todayInfo.type}`);
  console.log(`是否工作日: ${todayInfo.isWorkday ? '是' : '否'}`);
  console.log(`说明: ${todayInfo.description}`);
  console.log('');

  // 测试一些特定日期
  const testDates = [
    dayjs().format('YYYY-MM-DD'), // 今天
    '2026-01-01', // 元旦
    '2026-02-10', // 春节
    '2026-04-05', // 清明
    '2026-05-01', // 劳动节
    '2026-10-01', // 国庆
  ];

  console.log('【测试特定日期】');
  for (const date of testDates) {
    const info = await holidayService.getDateInfo(date);
    const status = info.isWorkday ? '✅ 工作日' : '❌ 休息日';
    console.log(`${info.date} - ${status} - ${info.type}${info.name ? ' - ' + info.name : ''}`);
  }

  console.log('\n====================================');
  console.log('测试完成');
  console.log('====================================');
}

// 执行测试
testHoliday().catch(error => {
  console.error('测试失败:', error);
  process.exit(1);
});
