'use strict';
const {
	getWorkRecordPath,
	getCurrMonthData,
	performanceUrl,
} = require('./service/index');
const xlsx = require('xlsx');
const { USER_NAME, MONTH, YEAR } = require('./config');
const { isEmpty, getTemplate } = require('./service');
const excelJS = require('exceljs');
const Big = require('big.js');

const demandLevelMap = {
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

function preciseAdd(num1, num2) {
	try {
		return new Big(num1).plus(new Big(num2)).toString();
	} catch (error) {
		throw new Error(`加法计算错误: ${error.message}`);
	}
}

function normalizeString(str) {
	return String(str)
		.trim()
		.toLowerCase()
		.replace(/[^\w\u4e00-\u9fa5]/g, '');
}

function isCurrentMonth(dateStr) {
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
	const now = new Date();
	const currMonth = !isEmpty(MONTH) ? Number(MONTH) : now.getMonth() + 1;
	const currYear = !isEmpty(YEAR) ? Number(YEAR) : now.getFullYear();
	return date.getFullYear() === currYear && date.getMonth() + 1 === currMonth;
}

function calculateDemandLevel(levelStr) {
	if (!levelStr || typeof levelStr !== 'string') return 0;
	return levelStr
		.split(',')
		.map((item) => {
			const cleaned = item.trim().replace(/[^0-9A类B类C类D类E类]/g, '');
			return demandLevelMap[cleaned] || 0;
		})
		.reduce((sum, val) => sum + val, 0);
}

async function extractData() {
	const workRecordPatch = getWorkRecordPath();
	const workbook = xlsx.readFile(workRecordPatch);
	const sheetName = '工作记录';
	const worksheet = workbook.Sheets[sheetName];
	const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
	if (!data || data.length === 0) return [];

	const headers = data[0];
	const colIndex = {
		registrant: headers.findIndex((h) => h === '登记人'),
		regDate: headers.findIndex((h) => h === '登记日期'),
		reviewer: headers.findIndex((h) => h === '初审人'),
		reviewDate: headers.findIndex((h) => h === '初审日期'),
		finalReviewer: headers.findIndex((h) => h === '终审人'),
		finalReviewDate: headers.findIndex((h) => h === '终审日期'),
		verifier: headers.findIndex((h) => h === '复核人'),
		verifyDate: headers.findIndex((h) => h === '复核日期'),
		defectDetector: headers.findIndex((h) => h === '缺陷引出人员'),
	};

	const filteredData = [headers];
	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		const cond1 =
			String(row[colIndex.registrant]).trim() === USER_NAME &&
			isCurrentMonth(row[colIndex.regDate] || '');
		const cond2 =
			colIndex.reviewer !== -1 &&
			colIndex.reviewDate !== -1 &&
			String(row[colIndex.reviewer]).trim() === USER_NAME &&
			isCurrentMonth(row[colIndex.reviewDate] || '');
		const cond3 =
			colIndex.finalReviewer !== -1 &&
			colIndex.finalReviewDate !== -1 &&
			String(row[colIndex.finalReviewer]).trim() === USER_NAME &&
			isCurrentMonth(row[colIndex.finalReviewDate] || '');
		const cond4 =
			colIndex.verifier !== -1 &&
			colIndex.verifyDate !== -1 &&
			String(row[colIndex.verifier]).trim() === USER_NAME &&
			isCurrentMonth(row[colIndex.verifyDate] || '');
		const cond5 =
			colIndex.defectDetector !== -1 &&
			String(row[colIndex.defectDetector]).trim() === USER_NAME &&
			isCurrentMonth(row[colIndex.regDate] || '');

		if (!(cond1 || cond2 || cond3 || cond4 || cond5)) continue;
		filteredData.push(row);
	}
	console.info(`当前导出数据符合规范的一共${filteredData.length}条`);
	return filteredData;
}

async function processData() {
	const filteredData = await extractData();
	if (!filteredData || filteredData.length === 0) {
		return {
			需求: [],
			缺陷: [],
			代码提交记录: [],
			代码评审: [],
			'代码迁移-一体化': [],
			'项目打包（只作为打包登记）': [],
			headers: [],
		};
	}

	const sheetConfig = {
		需求: { data: [] },
		缺陷: { data: [] },
		代码提交记录: { data: [] },
		代码评审: { data: [] },
		'代码迁移-一体化': { data: [] },
		'项目打包（只作为打包登记）': { data: [] },
	};

	const headers = filteredData[0];
	const typeIndex = headers.findIndex((e) => e === '类别');
	const currUserIndex = headers.findIndex((e) => e === '登记人');
	const registrationTimeIndex = headers.findIndex((e) => e === '登记日期');
	const commitSeq = headers.findIndex((e) => e === '提交编号');
	const commitContentSeq = headers.findIndex((e) => e === '提交信息');
	const taskStatusIndex = headers.findIndex((e) => e === '任务状态');
	const allowedTaskStatuses = new Set([
		'开发完成',
		'测试中',
		'测试完成',
		'任务完成',
	]);

	const reviewUserCols = {
		初审人: headers.findIndex((e) => e === '初审人'),
		初审日期: headers.findIndex((e) => e === '初审日期'),
		终审人: headers.findIndex((e) => e === '终审人'),
		终审日期: headers.findIndex((e) => e === '终审日期'),
		复核人: headers.findIndex((e) => e === '复核人'),
		复核日期: headers.findIndex((e) => e === '复核日期'),
	};

	filteredData.slice(1).forEach((row) => {
		const category = row[typeIndex];
		const categoryStr = String(category || '').trim();
		const currUser = row[currUserIndex];
		const currUserStr = String(currUser || '').trim();
		const registrationTime = row[registrationTimeIndex];

		const taskStatus =
			taskStatusIndex !== -1 ? String(row[taskStatusIndex] || '').trim() : '';
		const isAllowedTaskStatus =
			taskStatusIndex === -1 ? false : allowedTaskStatuses.has(taskStatus);

		if (
			categoryStr.includes('需求') &&
			currUserStr === USER_NAME &&
			isCurrentMonth(registrationTime) &&
			isAllowedTaskStatus
		)
			sheetConfig['需求'].data.push(row);

		if (
			categoryStr.includes('缺陷') &&
			categoryStr !== '缺陷转需求' &&
			currUserStr === USER_NAME &&
			isCurrentMonth(registrationTime)
		)
			sheetConfig['缺陷'].data.push(row);

		if (
			!isEmpty(row[commitSeq]) &&
			!isEmpty(row[commitContentSeq]) &&
			currUserStr === USER_NAME &&
			categoryStr !== '项目打包（只作为打包登记）' &&
			categoryStr !== '代码迁移-一体化' &&
			isCurrentMonth(registrationTime)
		)
			sheetConfig['代码提交记录'].data.push(row);

		const hasReviewByUser =
			(reviewUserCols['初审人'] !== -1 &&
				reviewUserCols['初审日期'] !== -1 &&
				String(row[reviewUserCols['初审人']] || '').trim() === USER_NAME &&
				isCurrentMonth(row[reviewUserCols['初审日期']] || '')) ||
			(reviewUserCols['终审人'] !== -1 &&
				reviewUserCols['终审日期'] !== -1 &&
				String(row[reviewUserCols['终审人']] || '').trim() === USER_NAME &&
				isCurrentMonth(row[reviewUserCols['终审日期']] || '')) ||
			(reviewUserCols['复核人'] !== -1 &&
				reviewUserCols['复核日期'] !== -1 &&
				String(row[reviewUserCols['复核人']] || '').trim() === USER_NAME &&
				isCurrentMonth(row[reviewUserCols['复核日期']] || ''));

		if (hasReviewByUser) sheetConfig['代码评审'].data.push(row);

		if (
			categoryStr === '项目打包（只作为打包登记）' &&
			currUserStr === USER_NAME &&
			isCurrentMonth(registrationTime)
		)
			sheetConfig['项目打包（只作为打包登记）'].data.push(row);

		if (
			categoryStr === '代码迁移-一体化' &&
			currUserStr === USER_NAME &&
			isCurrentMonth(registrationTime)
		)
			sheetConfig['代码迁移-一体化'].data.push(row);
	});

	console.info(`需求共${sheetConfig['需求'].data.length}条`);
	console.info(`缺陷共${sheetConfig['缺陷'].data.length}条`);
	console.info(`代码提交记录共${sheetConfig['代码提交记录'].data.length}条`);
	console.info(`代码评审共${sheetConfig['代码评审'].data.length}条`);
	console.info(
		`代码迁移-一体化共${sheetConfig['代码迁移-一体化'].data.length}条`,
	);
	console.info(
		`项目打包（只作为打包登记）共${sheetConfig['项目打包（只作为打包登记）'].data.length}条`,
	);

	return {
		需求: sheetConfig['需求'].data,
		缺陷: sheetConfig['缺陷'].data,
		代码提交记录: sheetConfig['代码提交记录'].data,
		代码评审: sheetConfig['代码评审'].data,
		'代码迁移-一体化': sheetConfig['代码迁移-一体化'].data,
		'项目打包（只作为打包登记）':
			sheetConfig['项目打包（只作为打包登记）'].data,
		headers,
	};
}

async function copyStylesWithData(templatePath, outputPath, data) {
	const workbook = new excelJS.Workbook();
	await workbook.xlsx.readFile(templatePath);

	async function processSheet(sheetName, dataRows) {
		const sheet = workbook.getWorksheet(sheetName);
		if (!sheet) return;

		const headerRow = sheet.getRow(1);
		const templateDataRow = sheet.getRow(2);
		const templateMerges = sheet.model && sheet.model.merges ? [...sheet.model.merges] : [];
		const templateColumnWidths = sheet.columns.map((col) => col.width);
		const templateHeaderHeight = headerRow.height;
		sheet.spliceRows(2, sheet.rowCount);

		const templateColumns = headerRow.values.slice(1);
		const columnMap = templateColumns.map((templateCol) =>
			data.headers.findIndex(
				(h) => normalizeString(h) === normalizeString(templateCol),
			),
		);

		dataRows.forEach((rowData, rowIndex) => {
			const newRow = sheet.getRow(rowIndex + 2);
			templateColumns.forEach((_, colIndex) => {
				const cell = newRow.getCell(colIndex + 1);
				const dataIndex = columnMap[colIndex];
				cell.value = dataIndex !== -1 ? rowData[dataIndex] : null;

				const templateCell = templateDataRow.getCell(colIndex + 1);
				if (templateCell) {
					cell.font = templateCell.font
						? JSON.parse(JSON.stringify(templateCell.font))
						: undefined;
					cell.alignment = templateCell.alignment
						? JSON.parse(JSON.stringify(templateCell.alignment))
						: undefined;
					cell.border = templateCell.border
						? JSON.parse(JSON.stringify(templateCell.border))
						: undefined;
					cell.fill = templateCell.fill
						? JSON.parse(JSON.stringify(templateCell.fill))
						: undefined;
				}
			});
			if (templateDataRow.height) newRow.height = templateDataRow.height;
		});

		sheet.columns.forEach((col, idx) => {
			if (templateColumnWidths[idx] !== undefined) {
				col.width = templateColumnWidths[idx];
			}
		});

		if (templateHeaderHeight) headerRow.height = templateHeaderHeight;
		if (templateMerges.length > 0) sheet.model.merges = templateMerges;
	}

	await processSheet('需求', data['需求']);
	await processSheet('缺陷', data['缺陷']);
	await processSheet('代码提交记录', data['代码提交记录']);
	await processSheet('代码评审', data['代码评审']);
	await processSheet('代码迁移-一体化', data['代码迁移-一体化']);
	await processSheet(
		'项目打包（只作为打包登记）',
		data['项目打包（只作为打包登记）'],
	);

	await workbook.xlsx.writeFile(outputPath);
}

async function processWorkbook(inputPath) {
	const workbook = new excelJS.Workbook();
	await workbook.xlsx.readFile(inputPath);

	const sheetName = [
		'需求',
		'缺陷',
		'代码提交记录',
		'代码评审',
		'项目打包（只作为打包登记）',
		'代码迁移-一体化',
	];
	let demandSum = 0;
	let bugSum = 0;
	let commit = 0;
	let reviewSum = 0;
	let migrate = 0;
	let pack = 0;

	for (const item in sheetName) {
		const worksheet = workbook.getWorksheet(sheetName[item]);
		if (!worksheet) continue;
		if (sheetName[item] === '需求') {
			let demandLevelCol = -1;
			let devEffortCol = -1;
			let taskStatusCol = -1;
			const headerRow = worksheet.getRow(1);
			headerRow.eachCell((cell, colNumber) => {
				const header = cell.text.trim();
				if (header === '需求等级') demandLevelCol = colNumber;
				if (header === '工作量') devEffortCol = colNumber;
				if (header === '任务状态') taskStatusCol = colNumber;
			});
			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				if (rowNumber === 1) return;
				const taskStatus =
					taskStatusCol !== -1
						? String(row.getCell(taskStatusCol).text || '').trim()
						: '';
				const isAllowedTaskStatus =
					taskStatusCol === -1 ||
					['开发完成', '测试中', '测试完成', '任务完成'].includes(taskStatus);
				if (!isAllowedTaskStatus) return;
				const levelCell = row.getCell(demandLevelCol);
				const calculatedValue = calculateDemandLevel(levelCell.text);
				demandSum += calculatedValue;
				const targetCell = row.getCell(devEffortCol);
				if (devEffortCol !== -1) targetCell.value = calculatedValue;
			});
		} else {
			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				let devEffortCol = -1;
				if (rowNumber === 1) return;
				const headerRow = worksheet.getRow(1);
				headerRow.eachCell((cell, colNumber) => {
					const header = cell.text.trim();
					if (header === '工作量') devEffortCol = colNumber;
				});
				if (devEffortCol === -1) return;
				const targetCell = row.getCell(devEffortCol);
				const cellValue = {
					缺陷: 1,
					代码提交记录: 0.2,
					代码评审: 0.2,
					'代码迁移-一体化': 0.2,
					'项目打包（只作为打包登记）': 0.2,
				};
				targetCell.value = cellValue[sheetName[item]];
				if (sheetName[item] === '缺陷') bugSum = preciseAdd(bugSum, 1);
				if (sheetName[item] === '代码提交记录')
					commit = preciseAdd(commit, 0.2);
				if (sheetName[item] === '代码评审') reviewSum = preciseAdd(reviewSum, 0.2);
			});
		}
	}

	{
		const worksheet = workbook.getWorksheet('代码迁移-一体化');
		if (worksheet) {
			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				if (rowNumber === 1) return;
				migrate += 1;
			});
		}
	}
	{
		const worksheet = workbook.getWorksheet('项目打包（只作为打包登记）');
		if (worksheet) {
			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				if (rowNumber === 1) return;
				pack += 1;
			});
		}
	}

	let leadingOutDefects = 0;
	let reviewerData = [];
	let verifierData = [];
	{
		const workRecordPatch = getWorkRecordPath();
		const workbook = xlsx.readFile(workRecordPatch);
		const sheetName = '工作记录';
		const worksheet = workbook.Sheets[sheetName];
		const data = xlsx.utils.sheet_to_json(worksheet, {
			header: 1,
			defval: null,
			blankrows: false,
		});
		const leadingOutDefectsData = getCurrMonthData(
			data,
			USER_NAME,
			'缺陷引出人员',
		);
		leadingOutDefects = Math.max(0, leadingOutDefectsData.length - 1);
		reviewerData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码评审人');
		verifierData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码监督人');
	}

	const reviewLeadCount = Math.max(0, reviewerData.length - 1);
	const superviseLeadCount = Math.max(0, verifierData.length - 1);
	const reviewLeadPenalty = (reviewLeadCount + superviseLeadCount) * 0.5;

	{
		const worksheet = workbook.getWorksheet('考核表');
		if (worksheet) {
			const headerRow = worksheet.getRow(1);
			let score = -1;
			let assessmentIndicators = -1;
			headerRow.eachCell((cell, colNumber) => {
				const header = cell.text.trim();
				if (header === '自评分') score = colNumber;
				if (header === '考核指标') assessmentIndicators = colNumber;
			});
			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				if (rowNumber === 1) return;
				const targetCell = row.getCell(assessmentIndicators);
				if (targetCell.value === '缺陷工作量') {
					row.getCell(score).value = Number(bugSum);
				}
				if (targetCell.value === '开发需求工作量') {
					row.getCell(score).value = Number(demandSum);
				}
				if (targetCell.value === '代码提交') {
					row.getCell(score).value = Number(commit);
				}
				if (targetCell.value === '引出缺陷') {
					row.getCell(score).value = -Number(leadingOutDefects * 10);
				}
				if (targetCell.value === '代码评审') {
					row.getCell(score).value = Number(reviewSum);
				}
				if (targetCell.value === '减分项') {
					row.getCell(score).value = -Number(reviewLeadPenalty);
				}
				if (targetCell.value === '代码迁移（一体化）') {
					row.getCell(score).value = Number(migrate * 0.2);
				}
				if (targetCell.value === '项目打包（只做打包登记）') {
					row.getCell(score).value = Number(pack * 0.2);
				}
			});
		}
	}

	workbook.calcProperties.fullCalcOnLoad = true;
	await workbook.xlsx.writeFile(inputPath);
	console.log(`处理完成，文件已保存至：${inputPath}`);
}

class GeneratePerformance2026 {
	static async main() {
		try {
			console.info('----> 生成绩效(2026)开始');
			const templatePath = getTemplate();
			const outputFile = performanceUrl();

			console.time('数据处理耗时');
			const processedData = await processData();
			console.timeEnd('数据处理耗时');

			console.time('样式导出耗时');
			await copyStylesWithData(templatePath, outputFile, {
				需求: processedData['需求'],
				缺陷: processedData['缺陷'],
				代码提交记录: processedData['代码提交记录'],
				代码评审: processedData['代码评审'],
				'代码迁移-一体化': processedData['代码迁移-一体化'],
				'项目打包（只作为打包登记）':
					processedData['项目打包（只作为打包登记）'],
				headers: processedData.headers,
			});
			console.timeEnd('样式导出耗时');

			console.time('分值计算耗时');
			await processWorkbook(outputFile);
			console.timeEnd('分值计算耗时');
		} catch (err) {
			console.error(err);
		} finally {
			console.info('----> 生成绩效(2026)结束');
		}
	}
}

GeneratePerformance2026.main();
