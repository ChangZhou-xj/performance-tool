'use strict';

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { getWorkRecordPath } = require('./service/index');
const { USER_NAME, DEPARTMENT } = require('./config');
const { isEmpty } = require('./service');

const REPORT_TYPE_MAP = {
	day: '日报',
	week: '周报',
	month: '月报',
};

const allowedTaskStatuses = new Set([
	'开发完成',
	'测试中',
	'测试完成',
	'任务完成',
]);

const completedTaskStatuses = new Set(['开发完成']);
const inProgressTaskStatuses = new Set(['进行中']);

function getDateRange(type, targetDate) {
	const date = targetDate || new Date();
	let startDate;
	let endDate;

	if (type === 'day') {
		startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		endDate = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
			23,
			59,
			59,
			999,
		);
	} else if (type === 'week') {
		const dayOfWeek = date.getDay();
		const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
		startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
		endDate = new Date(
			startDate.getFullYear(),
			startDate.getMonth(),
			startDate.getDate() + 6,
			23,
			59,
			59,
			999,
		);
	} else if (type === 'month') {
		startDate = new Date(date.getFullYear(), date.getMonth(), 1);
		endDate = new Date(
			date.getFullYear(),
			date.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);
	} else {
		throw new Error('类型错误，仅支持 day、week 或 month');
	}

	return { startDate, endDate };
}

function parseDate(dateStr) {
	const parts = String(dateStr || '').split(/[年月日]/).filter(Boolean);
	if (parts.length !== 3) return null;

	const year = parseInt(parts[0], 10);
	const month = parseInt(parts[1], 10) - 1;
	const day = parseInt(parts[2], 10);
	const date = new Date(year, month, day);

	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month ||
		date.getDate() !== day
	)
		return null;

	return date;
}

function isDateInRange(dateStr, startDate, endDate) {
	const date = parseDate(dateStr);
	if (!date) return false;
	return date >= startDate && date <= endDate;
}

function formatDateCN(date) {
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getChineseMonth(month) {
	const months = [
		'',
		'一',
		'二',
		'三',
		'四',
		'五',
		'六',
		'七',
		'八',
		'九',
		'十',
		'十一',
		'十二',
	];
	return months[month] || String(month);
}

function getText(row, index) {
	if (index === -1 || typeof index === 'undefined') return '';
	return String(row[index] || '').trim();
}

function getColumnIndexMap(headers) {
	return {
		registrant: headers.findIndex((h) => h === '登记人'),
		registerDate: headers.findIndex((h) => h === '登记日期'),
		regDate: headers.findIndex((h) => h === '开发完成日期'),
		category: headers.findIndex((h) => h === '类别'),
		taskContent: headers.findIndex((h) => h === '任务内容'),
		projectName: headers.findIndex((h) => h === '项目名称'),
		productType: headers.findIndex((h) => h === '产品类型'),
		productId: headers.findIndex((h) => h === '产品标识'),
		ticketNo: headers.findIndex((h) => h === 'A8单号、任务/问题列表编号'),
		commitNo: headers.findIndex((h) => h === '提交编号'),
		commitInfo: headers.findIndex((h) => h === '提交信息'),
		taskStatus: headers.findIndex((h) => h === '任务状态'),
		demandLevel: headers.findIndex((h) => h === '需求等级'),
		defectDetector: headers.findIndex((h) => h === '缺陷引出人员'),
		defectTime: headers.findIndex((h) => h === '缺陷引出日期'),
		defectDepartment: headers.findIndex((h) => h === '缺陷引出部门'),
		firstReviewer: headers.findIndex((h) => h === '初审人'),
		firstReviewDate: headers.findIndex((h) => h === '初审日期'),
		finalReviewer: headers.findIndex((h) => h === '终审人'),
		finalReviewDate: headers.findIndex((h) => h === '终审日期'),
		verifier: headers.findIndex((h) => h === '复核人'),
		verifyDate: headers.findIndex((h) => h === '复核日期'),
	};
}

function buildRecord(row, colIndex) {
	const registerDate = getText(row, colIndex.registerDate);
	const category = getText(row, colIndex.category);
	const taskContent = getText(row, colIndex.taskContent);
	const productType = getText(row, colIndex.productType);
	const projectName = getText(row, colIndex.projectName);
	const productId = getText(row, colIndex.productId);
	const regDate = getText(row, colIndex.regDate);
	const ticketNo = getText(row, colIndex.ticketNo);
	const commitNo = getText(row, colIndex.commitNo);
	const commitInfo = getText(row, colIndex.commitInfo);
	const taskStatus = getText(row, colIndex.taskStatus);
	const demandLevel = getText(row, colIndex.demandLevel);
	const defectDetector = getText(row, colIndex.defectDetector);
	const defectTime = getText(row, colIndex.defectTime);
	const defectDepartment = getText(row, colIndex.defectDepartment);

	return {
		registerDate,
		category,
		taskContent,
		productType,
		projectName,
		productId,
		regDate,
		ticketNo,
		commitNo,
		commitInfo,
		taskStatus,
		demandLevel,
		defectDetector,
		defectTime,
		defectDepartment,
		key: [regDate, category, taskContent, ticketNo, commitNo].join('|'),
	};
}

function isDefectCategory(category) {
	return category.includes('缺陷') && category !== '缺陷转需求';
}

function isDemandCategory(category) {
	return category.includes('需求') && category !== '缺陷转需求';
}

function formatDefectSourceInfo(record) {
	const parts = [
		`缺陷引出人:${record.defectDetector || '未填写'}`,
		`缺陷部门:${record.defectDepartment || '未填写'}`,
		`缺陷时间:${record.defectTime || '未填写'}`,
	];
	return `【${parts.join(' / ')}】`;
}

function formatBaseLine(record, options = {}) {
	const { includeDefectSourceInfo = false } = options;
	const tags = [];
	if (record.productId) tags.push(`【${record.productType}：${record.productId}】`);
	if (record.projectName) tags.push(`【${record.projectName}】`);
	tags.push(`【${record.category || '未分类'}】`);
	if (record.demandLevel && record.category.includes('需求')) {
		tags.push(`【${record.demandLevel}】`);
	}
	if (record.taskStatus && record.category.includes('需求')) {
		tags.push(`【${record.taskStatus}】`);
	}

	const content = record.taskContent || record.commitInfo || '暂无内容';
	const suffixParts = [];
	if (record.ticketNo) suffixParts.push(record.ticketNo);
	if (record.commitNo) suffixParts.push(`提交:${record.commitNo}`);
	if (!record.ticketNo && !record.commitNo && record.productId) {
		suffixParts.push(record.productId);
	}

	const suffix = suffixParts.length > 0 ? `【${suffixParts.join(' / ')}】` : '';
	const line = `${tags.join('')}${content}${suffix}`;
	if (includeDefectSourceInfo && isDefectCategory(record.category)) {
		return `${line}${formatDefectSourceInfo(record)}`;
	}

	return line;
}

function formatCommitLine(record) {
	const tags = ['【代码提交】'];
	if (record.productId) tags.unshift(`【${record.productType}：${record.productId}】`);
	if (record.projectName) tags.splice(1, 0, `【${record.projectName}】`);
	const content = record.commitInfo || record.taskContent || '暂无提交说明';
	const suffixParts = [];
	if (record.commitNo) suffixParts.push(record.commitNo);
	if (record.ticketNo) suffixParts.push(record.ticketNo);
	const suffix = suffixParts.length > 0 ? `【${suffixParts.join(' / ')}】` : '';
	return `${tags.join('')}${content}${suffix}`;
}

function formatReviewLine(record) {
	const tags = ['【代码评审】'];
	if (record.productId) tags.unshift(`【${record.productType}：${record.productId}】`);
	if (record.projectName) tags.splice(1, 0, `【${record.projectName}】`);
	const content = record.taskContent || record.commitInfo || '完成代码评审流程';
	const suffix = record.ticketNo ? `【${record.ticketNo}】` : '';
	return `${tags.join('')}${content}${suffix}`;
}

function formatOtherLine(record, label) {
	const tags = [`【${label}】`];
	if (record.productId) tags.unshift(`【${record.productType}：${record.productId}】`);
	if (record.projectName) tags.splice(1, 0, `【${record.projectName}】`);
	const content = record.taskContent || record.commitInfo || label;
	const suffixParts = [];
	if (record.ticketNo) suffixParts.push(record.ticketNo);
	if (record.commitNo) suffixParts.push(record.commitNo);
	const suffix = suffixParts.length > 0 ? `【${suffixParts.join(' / ')}】` : '';
	return `${tags.join('')}${content}${suffix}`;
}

function pushUnique(list, record, formatter) {
	list.push({
		key: record.key,
		date: record.regDate,
		text: formatter(record),
		projectName: record.projectName,
		productType: record.productType,
		productId: record.productId,
		category: record.category,
	});
}

function sortByDate(items) {
	return items.sort((a, b) => {
		const aDate = parseDate(a.date);
		const bDate = parseDate(b.date);
		if (!aDate || !bDate) return a.text.localeCompare(b.text, 'zh-CN');
		return aDate - bDate;
	});
}

function buildSectionList(items, indent = '    ') {
	if (!items.length) return `${indent}暂无\n`;
	return (
		sortByDate(items)
			.map((item, index) => `${indent}${index + 1}. ${item.text}`)
			.join('\n') + '\n'
	);
}

function collectUniqueItems(...groups) {
	const map = new Map();
	groups.flat().forEach((item) => {
		if (!map.has(item.key)) {
			map.set(item.key, item);
		}
	});
	return Array.from(map.values());
}


function formatPercentage(value) {
	if (!Number.isFinite(value)) {
		return '0%';
	}

	const rounded = Number(value.toFixed(2));
	return `${rounded}%`;
}

function buildWeekSummary(reportData) {
	const demandCount = reportData.demands.length;
	const defectCount = reportData.ppDefects.length + reportData.nonPpDefects.length;

	return `● 需求开发（共${demandCount}个）\n● 问题修复（共${defectCount}个）\n`;
}

function buildWeekFocus(reportData) {
	const {
		month,
		completedCount,
		inProgressCount,
	} = reportData.monthlyDemandProgress;
	const totalCount = completedCount + inProgressCount;
	const completedRatio = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
	const inProgressRatio = totalCount > 0 ? (inProgressCount / totalCount) * 100 : 0;

	return (
		`1. ${month}月份月度任务开发` +
		`（开发完成${completedCount}个，占比${formatPercentage(completedRatio)}；` +
		`进行中${inProgressCount}个，占比${formatPercentage(inProgressRatio)}）\n`
	);
}

function buildWeekReportMarkdown(reportData) {
	const defectItems = collectUniqueItems(
		reportData.ppDefects,
		reportData.nonPpDefects,
	);
	const nextPlanItems = collectUniqueItems(reportData.nextPlanItems);

	let markdown = '';
	markdown += '领导好，本周工作内容如下：\n\n';
	markdown += '本周内容\n';
	markdown += buildWeekSummary(reportData);
	markdown += '\n';
	markdown += '重点工作\n';
	markdown += buildWeekFocus(reportData);
	markdown += '\n';
	markdown += '需求\n';
	markdown += buildSectionList(reportData.demands, '');
	markdown += '\n';
	markdown += '问题修复\n';
	markdown += buildSectionList(defectItems, '');
	markdown += '\n';
	markdown += '未完成工作\n';
	markdown += buildSectionList(nextPlanItems, '');

	return markdown;
}

async function extractDeveloperReportData(type, targetDate) {
	const workRecordPath = getWorkRecordPath();
	const workbook = xlsx.readFile(workRecordPath);
	const worksheet = workbook.Sheets['工作记录'];
	const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

	if (!data || data.length === 0) {
		return null;
	}

	const headers = data[0];
	const colIndex = getColumnIndexMap(headers);
	const { startDate, endDate } = getDateRange(type, targetDate);
	const { startDate: monthStartDate, endDate: monthEndDate } = getDateRange(
		'month',
		targetDate,
	);

	const demands = [];
	const ppDefects = [];
	const nonPpDefects = [];
	const commits = [];
	const reviews = [];
	const migrations = [];
	const packs = [];
	const achievedItems = [];
	const nextPlanItems = [];
	const monthlyDemandProgress = {
		month: monthStartDate.getMonth() + 1,
		completedCount: 0,
		inProgressCount: 0,
	};
	const includeDefectSourceInfo = type === 'day';
	const formatBaseItem = (item) =>
		formatBaseLine(item, { includeDefectSourceInfo });

	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		const registrant = getText(row, colIndex.registrant);
		const regDate = getText(row, colIndex.regDate);

		if (registrant !== USER_NAME) {
			continue;
		}

		const record = buildRecord(row, colIndex);
		if (isEmpty(record.category) && isEmpty(record.taskContent) && isEmpty(record.commitInfo)) {
			continue;
		}

		const isDemand = isDemandCategory(record.category);
		const isMonthDemandCompleted =
			isDemand &&
			allowedTaskStatuses.has(record.taskStatus) &&
			isDateInRange(regDate, monthStartDate, monthEndDate);
		const isMonthDemandInProgress =
			isDemand &&
			inProgressTaskStatuses.has(record.taskStatus) &&
			isDateInRange(record.registerDate, monthStartDate, monthEndDate);

		if (isMonthDemandCompleted) {
			monthlyDemandProgress.completedCount += 1;
		}

		if (isMonthDemandInProgress) {
			monthlyDemandProgress.inProgressCount += 1;
		}

		if (inProgressTaskStatuses.has(record.taskStatus)) {
			pushUnique(nextPlanItems, record, formatBaseItem);
		}

		if (!isDateInRange(regDate, startDate, endDate)) {
			continue;
		}

		if (isDemand && allowedTaskStatuses.has(record.taskStatus)) {
			pushUnique(demands, record, formatBaseItem);
		}

		if (
			(isDemand || record.category.includes('缺陷')) &&
			record.category !== '缺陷转需求' &&
			completedTaskStatuses.has(record.taskStatus)
		) {
			pushUnique(achievedItems, record, formatBaseItem);
		}

		if (record.category.includes('缺陷') && record.category !== '缺陷转需求') {
			const targetList = /^QXWT-/i.test(record.ticketNo) ? ppDefects : nonPpDefects;
			pushUnique(targetList, record, formatBaseItem);
		}

		if (
			!isEmpty(record.commitNo) &&
			!isEmpty(record.commitInfo) &&
			record.category !== '项目打包（只作为打包登记）' &&
			record.category !== '代码迁移-一体化'
		) {
			pushUnique(commits, record, formatCommitLine);
		}

		const hasFullReviewFlow = [
			colIndex.firstReviewer,
			colIndex.firstReviewDate,
			colIndex.finalReviewer,
			colIndex.finalReviewDate,
			colIndex.verifier,
			colIndex.verifyDate,
		].every((index) => index !== -1 && !isEmpty(row[index]));

		if (hasFullReviewFlow) {
			pushUnique(reviews, record, formatReviewLine);
		}

		if (record.category === '代码迁移-一体化') {
			pushUnique(migrations, record, (item) => formatOtherLine(item, '代码迁移-一体化'));
		}

		if (record.category === '项目打包（只作为打包登记）') {
			pushUnique(packs, record, (item) => formatOtherLine(item, '项目打包'));
		}
	}

	return {
		startDate,
		endDate,
		demands,
		ppDefects,
		nonPpDefects,
		commits,
		reviews,
		migrations,
		packs,
		achievedItems,
		nextPlanItems,
		monthlyDemandProgress,
	};
}

function buildReportMarkdown(type, reportData) {
	if (type === 'week') {
		return buildWeekReportMarkdown(reportData);
	}

	const periodLabel = type === 'day' ? '今日' : type === 'week' ? '本周' : '本月';
	const nextPlanLabel = type === 'day' ? '明日' : type === 'week' ? '下周' : '下月';
	const achievedItems = collectUniqueItems(reportData.achievedItems);
	const nextPlanItems = collectUniqueItems(reportData.nextPlanItems);

	let markdown = '';
	markdown += `一、${periodLabel}工作内容：\n`;
	markdown += `    1、需求开发：\n`;
	markdown += buildSectionList(reportData.demands, '      ');
	markdown += `    2、缺陷修复\n`;
	markdown += `       2.1（pp缺陷）\n`;
	markdown += buildSectionList(reportData.ppDefects, '          ');
	markdown += `       2.2（非pp缺陷）\n`;
	markdown += buildSectionList(reportData.nonPpDefects, '          ');

	markdown += `二、其他：\n`;
	markdown += `    暂无\n`;

	markdown += `三、${getChineseMonth(reportData.startDate.getMonth() + 1)}月月度任务\n`;
	markdown += `    暂无。\n`;

	markdown += `四、风险预警：\n`;
	markdown += `    暂无。\n\n`;

	markdown += `五、Playwright：\n`;
	markdown += `    暂无。\n\n`;

	markdown += `六、${periodLabel}工作目标是否达成:\n`;
	markdown += buildSectionList(achievedItems, '    ');

	markdown += `七、${nextPlanLabel}工作计划：\n`;
	markdown += buildSectionList(nextPlanItems, '    ');

	return markdown;
}

function buildOutputFilePath(type, startDate, endDate) {
	const dataDir = path.join(process.cwd(), 'data');
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const pad = (value) => String(value).padStart(2, '0');
	const start = `${startDate.getFullYear()}${pad(startDate.getMonth() + 1)}${pad(startDate.getDate())}`;
	const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;
	const dateStr = type === 'day' ? start : `${start}-${end.slice(-2)}`;

	return path.join(
		dataDir,
		`工作${REPORT_TYPE_MAP[type]}--${DEPARTMENT}--${USER_NAME}--${dateStr}.md`,
	);
}

async function generateReport(type, targetDate) {
	if (!REPORT_TYPE_MAP[type]) {
		throw new Error('类型错误，请使用 day、week 或 month');
	}

	const reportData = await extractDeveloperReportData(type, targetDate);
	if (!reportData) {
		console.warn('⚠️ 未找到工作记录数据');
		return null;
	}

	const totalCount = [
		reportData.demands.length,
		reportData.ppDefects.length,
		reportData.nonPpDefects.length,
		reportData.commits.length,
		reportData.reviews.length,
		reportData.migrations.length,
		reportData.packs.length,
	].reduce((sum, value) => sum + value, 0);

	if (totalCount === 0) {
		console.warn('⚠️ 没有找到符合条件的开发记录');
		return null;
	}

	const markdown = buildReportMarkdown(type, reportData);
	const filePath = buildOutputFilePath(type, reportData.startDate, reportData.endDate);
	fs.writeFileSync(filePath, markdown, 'utf-8');

	console.log(`✅ ${REPORT_TYPE_MAP[type]}生成成功: ${filePath}`);
	console.log(`📅 统计周期: ${formatDateCN(reportData.startDate)} ~ ${formatDateCN(reportData.endDate)}`);
	console.log(
		`📊 统计结果: 需求${reportData.demands.length}条，PP缺陷${reportData.ppDefects.length}条，非PP缺陷${reportData.nonPpDefects.length}条，提交${reportData.commits.length}条，评审${reportData.reviews.length}条，迁移${reportData.migrations.length}条，打包${reportData.packs.length}条`,
	);

	return filePath;
}

async function generatePerformanceStats(type, targetDate) {
	if (!REPORT_TYPE_MAP[type]) {
		throw new Error('类型错误，请使用 day、week 或 month');
	}

	const reportData = await extractDeveloperReportData(type, targetDate);
	if (!reportData) {
		return null;
	}

	return {
		startDate: reportData.startDate,
		endDate: reportData.endDate,
		demandCount: reportData.demands.length,
		ppDefectCount: reportData.ppDefects.length,
		nonPpDefectCount: reportData.nonPpDefects.length,
		commitCount: reportData.commits.length,
		reviewCount: reportData.reviews.length,
		migrationCount: reportData.migrations.length,
		packCount: reportData.packs.length,
		totalCount:
			reportData.demands.length +
			reportData.ppDefects.length +
			reportData.nonPpDefects.length +
			reportData.commits.length +
			reportData.reviews.length +
			reportData.migrations.length +
			reportData.packs.length,
	};
}

if (require.main === module) {
	(async () => {
		const args = process.argv.slice(2);
		const type = args[0] || 'week';
		const dateArg = args[1];

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

module.exports = {
	generateReport,
	generatePerformanceStats,
	extractDeveloperReportData,
};
