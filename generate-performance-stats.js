'use strict';
const { generatePerformanceStats } = require('./generate-report');

/**
 * 绩效统计工具
 * 使用方法：
 * node generate-performance-stats.js [type] [date]
 * type: day(日报) | week(周报) | month(月报)，默认week
 * date: YYYY-MM-DD 格式的日期，可选
 * 
 * 示例：
 * node generate-performance-stats.js week
 * node generate-performance-stats.js day 2026-03-11
 * node generate-performance-stats.js month
 */

(async () => {
	try {
		const args = process.argv.slice(2);
		const type = args[0] || 'week'; // 默认周报
		const dateArg = args[1]; // 可选：指定日期 格式: YYYY-MM-DD

		let targetDate = null;
		if (dateArg) {
			const [year, month, day] = dateArg.split('-').map(Number);
			targetDate = new Date(year, month - 1, day);
			if (isNaN(targetDate.getTime())) {
				console.error('❌ 日期格式错误，请使用 YYYY-MM-DD 格式');
				process.exit(1);
			}
		}

		console.log(`开始生成绩效统计(${type})...`);
		const stats = await generatePerformanceStats(type, targetDate);

		if (stats) {
			console.log('✅ 绩效统计完成！');
		}
	} catch (err) {
		console.error('❌ 执行失败:', err);
		process.exit(1);
	}
})();
