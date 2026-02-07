'use strict';
const { getWorkRecordPath } = require('./service/index');
const xlsx = require('xlsx');
const { USER_NAME, MONTH, YEAR } = require('./config');
const { isEmpty } = require('./service');
const excelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

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
	} else {
		throw new Error('类型错误，仅支持 day 或 week');
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
		a8Number: headers.findIndex((h) => h === 'A8单号、任务/问题列表编号'),
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

		if (!projectMap[projectName]) {
			projectMap[projectName] = {
				commits: [],
				demandTestCount: 0,
				submitCount: 0,
				bugTestCount: 0,
			};
		}

		projectMap[projectName].commits.push({
			date: regDate,
			category,
			taskContent,
			productId,
			productType,
			a8Number,
		});

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

	// 构建Markdown内容
	let markdown = '';
	markdown += `# ${USER_NAME} - 代码测试${reportType}\n\n`;
	markdown += `**时间范围:** ${dateRange}\n\n`;
	markdown += `---\n\n`;

	// 收集所有提交记录
	const allCommits = [];
	Object.values(projectMap).forEach((project) => {
		allCommits.push(...project.commits);
	});

	// 汇总统计（放在前面）
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

	markdown += `## 总计\n\n`;
	markdown += `- **总测试次数:** ${totalCommits}\n`;
	markdown += `- **需求测试:** ${totalDemandTest}\n`;
	markdown += `- **提单:** ${totalSubmit}\n`;
	markdown += `- **缺陷测试:** ${totalBugTest}\n\n`;
	markdown += `---\n\n`;

	let serialNo = 1;

	// 直接输出所有记录（按指定格式）
	allCommits.forEach((commit) => {
		const productType = commit.productType || '未标注';
		const category = commit.category || '未分类';
		const taskContent = commit.taskContent || '无内容';
		const a8Number = commit.a8Number || '无';

		markdown += `${serialNo}. 【${productType}】【${category}】${taskContent}【${a8Number}】\n`;
		serialNo++;
	});

	markdown += `\n`;

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
		`${USER_NAME}-代码测试${reportType}-${dateStr}.md`,
	);

	fs.writeFileSync(fileName, markdown, 'utf-8');
	return fileName;
}

/**
 * 主函数
 */
async function generateReport(type, targetDate) {
	try {
		if (!['day', 'week'].includes(type)) {
			throw new Error('类型错误，请使用 day 或 week');
		}

		const { data, startDate, endDate } = await extractCommitData(type, targetDate);

		if (data.length <= 1) {
			console.warn('⚠️  没有找到符合条件的代码测试记录');
			return;
		}

		const projectMap = groupByProject(data, data[0]);
		await generateReportMarkdown(type, projectMap, startDate, endDate);
	} catch (err) {
		console.error('❌ 生成报告失败:', err);
		throw err;
	}
}

// 命令行参数解析
if (require.main === module) {
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

	generateReport(type, targetDate);
}

module.exports = { generateReport };
