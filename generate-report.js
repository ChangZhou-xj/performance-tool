'use strict';
const { getWorkRecordPath } = require('./service/index');
const xlsx = require('xlsx');
const { USER_NAME, MONTH, YEAR, DEPARTMENT } = require('./config');
const { isEmpty } = require('./service');
const excelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const Big = require('big.js');

// 测试等级分值映射表
const testLevelMap = {
	A类: 15,
	'2A类': 30,
	B类: 9,
	'2B类': 18,
	C类: 3,
	'2C类': 6,
	D类: 1,
	'2D类': 2,
	E类: 0.2,
	'2E类': 0.4,
};

/**
 * 标准化字符串
 */
function normalizeString(str) {
	return String(str)
		.trim()
		.toLowerCase()
		.replace(/[^\w\u4e00-\u9fa5]/g, '');
}

/**
 * 计算测试等级分值（使用Big.js避免精度问题）
 */
function calculateTestLevel(levelStr) {
	if (!levelStr || typeof levelStr !== 'string') return 0;
	const scores = levelStr
		.split(',')
		.map((item) => {
			const trimmed = item.trim();
			// 先尝试直接匹配
			if (testLevelMap[trimmed]) {
				return testLevelMap[trimmed];
			}
			// 如果不匹配，尝试添加"类"后缀
			const withSuffix = trimmed.includes('类') ? trimmed : trimmed + '类';
			if (testLevelMap[withSuffix]) {
				return testLevelMap[withSuffix];
			}
			// 兼容处理：提取数字+字母组合
			const cleaned = trimmed.replace(/[^0-9A-E]/gi, '');
			if (cleaned) {
				const withClass = cleaned + '类';
				return testLevelMap[withClass] || 0;
			}
			return 0;
		});

	// 使用Big.js进行精确累加
	let total = new Big(0);
	for (const score of scores) {
		if (score > 0) {
			total = total.plus(new Big(score));
		}
	}
	return parseFloat(total.toString());
}

/**
 * 判断日期是否在指定范围内
 */
function isDateInRange(dateStr, startDate, endDate) {
	const parts = String(dateStr || '').split(/[年月日]/).filter(Boolean);
	if (parts.length !== 3) return false;
	const year = parseInt(parts[0], 10);
	const month = parseInt(parts[1], 10) - 1;
	const day = parseInt(parts[2], 10);
	const date = new Date(year, month, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month ||
		date.getDate() !== day
	)
		return false;
	return date >= startDate && date <= endDate;
}

/**
 * 获取日期范围
 */
function getDateRange(type, targetDate) {
	const date = targetDate || new Date();
	let startDate, endDate;

	if (type === 'day') {
		// 日报：当天
		startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		endDate = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
			23,
			59,
			59,
		);
	} else if (type === 'week') {
		// 周报：本周一到周日
		const dayOfWeek = date.getDay();
		const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周日特殊处理
		startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
		endDate = new Date(
			startDate.getFullYear(),
			startDate.getMonth(),
			startDate.getDate() + 6,
			23,
			59,
			59,
		);
	} else if (type === 'month') {
		// 月报：整个月
		startDate = new Date(date.getFullYear(), date.getMonth(), 1);
		endDate = new Date(
			date.getFullYear(),
			date.getMonth() + 1,
			0,
			23,
			59,
			59,
		);
	} else {
		throw new Error('类型错误，仅支持 day, week 或 month');
	}

	return { startDate, endDate };
}

/**
 * 格式化日期为中文格式
 */
function formatDateCN(date) {
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 数字转中文月份
 */
function getChineseMonth(month) {
	const months = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
	return months[month];
}

/**
 * 提取指定范围内的代码测试记录
 */
async function extractCommitData(type, targetDate) {
	const workRecordPath = getWorkRecordPath();
	const workbook = xlsx.readFile(workRecordPath);
	const sheetName = '工作记录';
	const worksheet = workbook.Sheets[sheetName];
	const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

	if (!data || data.length === 0) return [];

	const headers = data[0];

	const colIndex = {
		registrant: headers.findIndex((h) => h === '登记人'),
		regDate: headers.findIndex((h) => h === '登记日期'),
		taskContent: headers.findIndex((h) => h === '任务内容'),
		productId: headers.findIndex((h) => h === '产品标识'),
		category: headers.findIndex((h) => h === '类别'),
		projectName: headers.findIndex((h) => h === '项目名称'),
		productType: headers.findIndex((h) => h === '产品类型'),
		a8Number: headers.findIndex((h) => h === 'A8单号、任务/问题列表编号'),
		testLevel: headers.findIndex((h) => h === '测试等级'),
	};

	const { startDate, endDate } = getDateRange(type, targetDate);
	const filteredData = [headers];

	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		const registrant = String(row[colIndex.registrant] || '').trim();
		const regDate = row[colIndex.regDate];

		// 条件：登记人是当前用户、日期在范围内
		if (
			registrant === USER_NAME &&
			isDateInRange(regDate, startDate, endDate)
		) {
			filteredData.push(row);
		}
	}

	return { data: filteredData, startDate, endDate };
}

/**
 * 按项目分组统计
 */
function groupByProject(data, headers) {
	const colIndex = {
		registrant: headers.findIndex((h) => h === '登记人'),
		regDate: headers.findIndex((h) => h === '登记日期'),
		taskContent: headers.findIndex((h) => h === '任务内容'),
		productId: headers.findIndex((h) => h === '产品标识'),
		category: headers.findIndex((h) => h === '类别'),
		projectName: headers.findIndex((h) => h === '项目名称'),
		productType: headers.findIndex((h) => h === '产品类型'),
		a8Number: headers.findIndex((h) => h === 'A8单号、任务/问题列表编号'),
		testLevel: headers.findIndex((h) => h === '测试等级'),
	};

	const projectMap = {};

	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		const projectName = String(row[colIndex.projectName] || '未知项目').trim();
		const category = String(row[colIndex.category] || '').trim();
		const taskContent = String(row[colIndex.taskContent] || '').trim();
		const productId = String(row[colIndex.productId] || '').trim();
		const productType = String(row[colIndex.productType] || '').trim();
		const regDate = String(row[colIndex.regDate] || '').trim();
		const a8Number = String(row[colIndex.a8Number] || '').trim();
		const testLevel = String(row[colIndex.testLevel] || '').trim();

		if (!projectMap[projectName]) {
			projectMap[projectName] = {
				commits: [],
				demandTestCount: 0,
				submitCount: 0,
				bugTestCount: 0,
				performanceScore: 0, // 绩效分数
			};
		}

		// 计算测试等级分数
		const levelScore = calculateTestLevel(testLevel);

		projectMap[projectName].commits.push({
			date: regDate,
			category,
			taskContent,
			productId,
			productType,
			a8Number,
			testLevel,
			levelScore,
		});

		// 累加绩效分数（使用Big.js避免精度问题）
		const currentScore = new Big(projectMap[projectName].performanceScore || 0);
		projectMap[projectName].performanceScore = parseFloat(
			currentScore.plus(new Big(levelScore)).toString()
		);

		// 统计类别
		if (category.includes('提单')) {
			projectMap[projectName].submitCount++;
		} else if (category.includes('需求')) {
			projectMap[projectName].demandTestCount++;
		} else if (category.includes('缺陷')) {
			projectMap[projectName].bugTestCount++;
		}
	}

	return projectMap;
}

/**
 * 生成Markdown报告
 */
async function generateReportMarkdown(type, projectMap, startDate, endDate) {
	const reportType = type === 'day' ? '日报' : '周报';
	const dateRange =
		type === 'day'
			? formatDateCN(startDate)
			: `${formatDateCN(startDate)} ~ ${formatDateCN(endDate)}`;

	// 收集所有提交记录
	const allCommits = [];
	Object.values(projectMap).forEach((project) => {
		allCommits.push(...project.commits);
	});

	// 汇总统计
	const totalCommits = Object.values(projectMap).reduce(
		(sum, p) => sum + p.commits.length,
		0,
	);
	const totalDemandTest = Object.values(projectMap).reduce(
		(sum, p) => sum + p.demandTestCount,
		0,
	);
	const totalSubmit = Object.values(projectMap).reduce(
		(sum, p) => sum + p.submitCount,
		0,
	);
	const totalBugTest = Object.values(projectMap).reduce(
		(sum, p) => sum + p.bugTestCount,
		0,
	);
	const totalPerformanceScore = Object.values(projectMap).reduce(
		(sum, p) => sum + p.performanceScore,
		0,
	);

	// 按邮件示例格式构建Markdown内容
	let markdown = '';

	// 一、今日工作内容
	markdown += `一、今日工作内容：\n`;
	markdown += `    1、需求开发：\n`;
	markdown += `      暂无\n`;
	markdown += `    2、缺陷\n`;
	markdown += `       2.1（pp缺陷）\n`;
	markdown += `       2.2（非pp缺陷）\n`;
	markdown += `          暂无\n`;

	// 二、其他（放置测试记录）
	markdown += `二、其他：\n`;
	if (allCommits.length > 0) {
		allCommits.forEach((commit, index) => {
			const productType = commit.productType || '未标注';
			const category = commit.category || '未分类';
			const taskContent = commit.taskContent || '无内容';
			const a8Number = commit.a8Number || '无';
			markdown += `    ${index + 1}. 【${productType}】【${category}】${taskContent}【${a8Number}】\n`;
		});
	} else {
		markdown += `    暂无\n`;
	}

	// 三、月度任务
	const monthName = getChineseMonth(startDate.getMonth() + 1);
	markdown += `三、${monthName}月月度任务\n`;
	markdown += `    暂无。\n`;

	// 四、风险预警
	markdown += `四、风险预警：\n`;
	markdown += `    暂无。\n\n`;

	// 五、Playwright
	markdown += `五、Playwright：\n`;
	markdown += `    暂无。\n\n`;

	// 六、今日工作目标是否达成（放置测试记录）
	markdown += `六、今日工作目标是否达成:\n`;
	if (allCommits.length > 0) {
		allCommits.forEach((commit, index) => {
			const productType = commit.productType || '未标注';
			const category = commit.category || '未分类';
			const taskContent = commit.taskContent || '无内容';
			const a8Number = commit.a8Number || '无';
			markdown += `    ${index + 1}. 【${productType}】【${category}】${taskContent}【${a8Number}】\n`;
		});
	} else {
		markdown += `    暂无\n`;
	}

	// 七、明日工作计划
	markdown += `七、明日工作计划：\n`;
	markdown += `    1、继续测试\n`;

	// 保存文件
	const dataDir = path.join(process.cwd(), 'data');
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const dateStr =
		type === 'day'
			? `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}`
			: `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

	const fileName = path.join(
		dataDir,
		`工作${reportType}--${DEPARTMENT}--${USER_NAME}--${dateStr}.md`,
	);

	fs.writeFileSync(fileName, markdown, 'utf-8');

	console.log(`✅ ${reportType}生成成功: ${fileName}`);
	console.log(`📊 统计信息:`);
	console.log(`   - 总测试次数: ${totalCommits}`);
	console.log(`   - 需求测试: ${totalDemandTest}`);
	console.log(`   - 提单: ${totalSubmit}`);
	console.log(`   - 缺陷测试: ${totalBugTest}`);
	console.log(`   - 绩效分数: ${totalPerformanceScore.toFixed(2)}`);

	return fileName;
}

/**
 * 主函数
 */
async function generateReport(type, targetDate) {
	try {
		if (!['day', 'week', 'month'].includes(type)) {
			throw new Error('类型错误，请使用 day, week 或 month');
		}

		const { data, startDate, endDate } = await extractCommitData(type, targetDate);

		if (data.length <= 1) {
			console.warn('⚠️  没有找到符合条件的代码测试记录');
			return;
		}

		const projectMap = groupByProject(data, data[0]);
		return await generateReportMarkdown(type, projectMap, startDate, endDate);
	} catch (err) {
		console.error('❌ 生成报告失败:', err);
		throw err;
	}
}

/**
 * 生成绩效统计报告
 */
async function generatePerformanceStats(type, targetDate) {
	try {
		if (!['day', 'week', 'month'].includes(type)) {
			throw new Error('类型错误，请使用 day, week 或 month');
		}

		const { data, startDate, endDate } = await extractCommitData(type, targetDate);

		if (data.length <= 1) {
			console.warn('⚠️  没有找到符合条件的测试记录');
			return null;
		}

		const projectMap = groupByProject(data, data[0]);

		// 统计各等级的数量和分数
		const levelStats = {
			'A类': { count: 0, score: 0 },
			'2A类': { count: 0, score: 0 },
			'B类': { count: 0, score: 0 },
			'2B类': { count: 0, score: 0 },
			'C类': { count: 0, score: 0 },
			'2C类': { count: 0, score: 0 },
			'D类': { count: 0, score: 0 },
			'2D类': { count: 0, score: 0 },
			'E类': { count: 0, score: 0 },
			'2E类': { count: 0, score: 0 },
		};

		// 收集所有提交记录
		const allCommits = [];
		Object.values(projectMap).forEach((project) => {
			allCommits.push(...project.commits);
		});

		// 统计各等级
		console.log('\n正在分析测试等级数据...');
		let hasTestLevelData = false;
		allCommits.forEach((commit, index) => {
			if (commit.testLevel) {
				hasTestLevelData = true;
				// 调试输出前5条记录的测试等级
				if (index < 5) {
					console.log(`记录${index + 1} - 测试等级原始值: "${commit.testLevel}"`);
				}
				commit.testLevel.split(',').forEach((level) => {
					const trimmed = level.trim();
					// 兼容处理：提取数字+字母组合，然后加"类"
					const cleaned = trimmed.replace(/[^0-9A-E]/gi, '');
					if (cleaned) {
						const levelKey = cleaned + '类';
						if (levelStats[levelKey]) {
							levelStats[levelKey].count++;
							// 使用Big.js精确计算分数
							const currentScore = new Big(levelStats[levelKey].score);
							const addScore = new Big(testLevelMap[levelKey] || 0);
							levelStats[levelKey].score = parseFloat(currentScore.plus(addScore).toString());
							if (index < 5) {
								console.log(`  → 识别为: ${levelKey} (${testLevelMap[levelKey]}分)`);
							}
						}
					}
				});
			}
		});
		if (!hasTestLevelData) {
			console.log('⚠️  警告: 未找到任何测试等级数据！');
		}

		// 汇总统计
		const totalPerformanceScore = Object.values(projectMap).reduce(
			(sum, p) => sum + p.performanceScore,
			0,
		);
		const totalCommits = allCommits.length;
		const totalDemandTest = Object.values(projectMap).reduce(
			(sum, p) => sum + p.demandTestCount,
			0,
		);
		const totalSubmit = Object.values(projectMap).reduce(
			(sum, p) => sum + p.submitCount,
			0,
		);
		const totalBugTest = Object.values(projectMap).reduce(
			(sum, p) => sum + p.bugTestCount,
			0,
		);

		// 输出详细统计
		console.log('\n======== 绩效统计报告 ========');
		console.log(`统计周期: ${formatDateCN(startDate)} ~ ${formatDateCN(endDate)}`);
		console.log(`用户名称: ${USER_NAME}`);
		console.log(`部门: ${DEPARTMENT}`);
		console.log('\n基础统计:');
		console.log(`  总测试次数: ${totalCommits}`);
		console.log(`  需求测试: ${totalDemandTest}`);
		console.log(`  提单: ${totalSubmit}`);
		console.log(`  缺陷测试: ${totalBugTest}`);
		console.log('\n等级分布:');
		Object.keys(levelStats).forEach((level) => {
			if (levelStats[level].count > 0) {
				console.log(`  ${level}: ${levelStats[level].count}次 (${levelStats[level].score}分)`);
			}
		});
		console.log(`\n总绩效分数: ${totalPerformanceScore.toFixed(2)}`);
		console.log('============================\n');

		return {
			startDate,
			endDate,
			totalCommits,
			totalDemandTest,
			totalSubmit,
			totalBugTest,
			totalPerformanceScore,
			levelStats,
			projectMap,
		};
	} catch (err) {
		console.error('❌ 生成绩效统计失败:', err);
		throw err;
	}
}

// 命令行参数解析
if (require.main === module) {
	(async () => {
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

		await generateReport(type, targetDate);
	})().catch((err) => {
		console.error('❌ 执行失败:', err);
		process.exit(1);
	});
}

module.exports = { generateReport, generatePerformanceStats };
