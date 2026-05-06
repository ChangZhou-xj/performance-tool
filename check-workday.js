'use strict';

require('dotenv').config();
const HolidayService = require('./service/holiday-service');

(async () => {
  try {
    const holidayService = new HolidayService();
    const today = new Date();
    const dateInfo = await holidayService.getDateInfo(today);

    console.log(`日期: ${dateInfo.date}`);
    console.log(`类型: ${dateInfo.type}`);
    console.log(`说明: ${dateInfo.description}`);

    if (!dateInfo.isWorkday) {
      console.log('⏸️  今天不是工作日，跳过任务');
      process.exit(2);
    }

    console.log('✓ 今天是工作日，继续执行');
    process.exit(0);
  } catch (error) {
    console.error(`工作日检查失败: ${error.message}`);
    process.exit(1);
  }
})();
