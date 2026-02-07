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
		regDate: headers.findIndex((h) => h === '开发完成日期'),
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
	const registrationTimeIndex = headers.findIndex((e) => e === '开发完成日期');
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

		// 代码评审判定规则：
		// 当登记人为当前用户时，且初审人/初审日期、终审人/终审日期、复核人/复核日期
		// 这三组字段都存在且非空，则视为一次完整的代码评审记录，记入「代码评审」。
		const isRegistrantUser = currUserStr === USER_NAME;
		const allReviewFieldsPresent = [
			'初审人',
			'初审日期',
			'终审人',
			'终审日期',
			'复核人',
			'复核日期',
		].every((key) => {
			const idx = reviewUserCols[key];
			return idx !== -1 && !isEmpty(row[idx]);
		});

		// 额外规则：如果初审人/终审人/复核人中任意一人是当前用户，且对应的日期在目标月（isCurrentMonth），也计入代码评审
		const anyReviewByUser = (
			(reviewUserCols['初审人'] !== -1 && String(row[reviewUserCols['初审人']] || '').trim() === USER_NAME && reviewUserCols['初审日期'] !== -1 && isCurrentMonth(row[reviewUserCols['初审日期']] || '')) ||
			(reviewUserCols['终审人'] !== -1 && String(row[reviewUserCols['终审人']] || '').trim() === USER_NAME && reviewUserCols['终审日期'] !== -1 && isCurrentMonth(row[reviewUserCols['终审日期']] || '')) ||
			(reviewUserCols['复核人'] !== -1 && String(row[reviewUserCols['复核人']] || '').trim() === USER_NAME && reviewUserCols['复核日期'] !== -1 && isCurrentMonth(row[reviewUserCols['复核日期']] || ''))
		);

		if ((isRegistrantUser && allReviewFieldsPresent) || anyReviewByUser) {
			sheetConfig['代码评审'].data.push(row);
		}

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
	let leadingOutDefectsData = [];
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
		leadingOutDefectsData = getCurrMonthData(
			data,
			USER_NAME,
			'缺陷引出人员',
		);
		leadingOutDefects = Math.max(0, leadingOutDefectsData.length - 1);
		reviewerData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码评审人');
		verifierData = getCurrMonthData(data, USER_NAME, '缺陷引出时的代码监督人');
	}

	// 构建“加减分类别”页签的数据（参考 generate-performance.js 的实现）
	{
 		// 先计算评审扣分（移除 AI 加分相关逻辑）
 		let reviewDeductionPoints = 0; // 代码评审扣分
 		const reviewWorksheet = workbook.getWorksheet('代码评审');
		if (reviewWorksheet) {
			const headerRow = reviewWorksheet.getRow(1);
			let currUserIndex = -1;
			let firstTrial = -1; // 初审意见
			let finalOpinion = -1; // 终审意见
			let reviewOpinion = -1; // 复核意见

			headerRow.eachCell((cell, colNumber) => {
				const header = cell.text.trim();
				if (header.includes('AI使用截图')) aiCol = colNumber;
				if (header === '登记人') currUserIndex = colNumber;
				if (header === '初审意见') firstTrial = colNumber;
				if (header === '终审意见') finalOpinion = colNumber;
				if (header === '复核意见') reviewOpinion = colNumber;
			});

			reviewWorksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				if (rowNumber === 1) return;
				// 安全读取单元格，避免传入-1导致 exceljs 抛错
				function safeCellValue(colIndex) {
					if (!colIndex || colIndex === -1) return null;
					try {
						const c = row.getCell(colIndex);
						return c ? c.value : null;
					} catch (e) {
						return null;
					}
				}

 				const currUserName = safeCellValue(currUserIndex);
				if (currUserName === USER_NAME) {
					const firstTrialValue = safeCellValue(firstTrial);
					if (firstTrialValue) {
						if (firstTrialValue === '二次评审通过') reviewDeductionPoints += 0.5;
						if (firstTrialValue === '二次及以上评审通过') reviewDeductionPoints += 1;
					}
					const finalOpinionValue = safeCellValue(finalOpinion);
					if (finalOpinionValue) {
						if (finalOpinionValue === '二次评审通过') reviewDeductionPoints += 0.5;
						if (finalOpinionValue === '二次及以上评审通过') reviewDeductionPoints += 1;
					}
					const reviewOpinionValue = safeCellValue(reviewOpinion);
					if (reviewOpinionValue) {
						if (reviewOpinionValue === '二次评审通过') reviewDeductionPoints += 0.5;
						if (reviewOpinionValue === '二次及以上评审通过') reviewDeductionPoints += 1;
					}
				}
			});
		}

		// 将 AI 优化和引出缺陷等写入到 '加减分类别' 页签
		const worksheet = workbook.getWorksheet('加减分类别');
		if (worksheet) {
			const headerRow = worksheet.getRow(1);
			let type = -1;
			let typeValueIndex = -1;
			let leaderIndex = -1;
			let describeIndex = -1;
			let dateIndex = -1;
			headerRow.eachCell((cell, colNumber) => {
				const header = cell.text.trim();
				if (header === '加减类别') type = colNumber;
				if (header === '自评分') typeValueIndex = colNumber;
				if (header === '直接上级评分') leaderIndex = colNumber;
				if (header === '描述') describeIndex = colNumber;
				if (header === '时间') dateIndex = colNumber;
			});

			// 已移除 AI 相关加分行

			// 引出缺陷（来自 leadingOutDefectsData）
			if (leadingOutDefectsData && leadingOutDefectsData.length > 1) {
				const reasonIndex = leadingOutDefectsData[0].findIndex(
					(e) => e === '缺陷描述及原因',
				);
				const commitDateIndex = leadingOutDefectsData[0].findIndex(
					(e) => e === '登记日期' || e === '缺陷引出时间',
				);
				for (let i = 1; i < leadingOutDefectsData.length; i++) {
					const rowValues = [];
					rowValues[type] = '引出缺陷';
					rowValues[typeValueIndex] = -10;
					rowValues[leaderIndex] = -10;
					rowValues[describeIndex] = leadingOutDefectsData[i][reasonIndex];
					rowValues[dateIndex] = leadingOutDefectsData[i][commitDateIndex];
					const insertedRow = worksheet.insertRow(2, rowValues, 'o');
					insertedRow.eachCell((cell) => {
						cell.border = {
							top: { style: 'thin', color: { argb: 'FF000000' } },
							left: { style: 'thin', color: { argb: 'FF000000' } },
							bottom: { style: 'thin', color: { argb: 'FF000000' } },
							right: { style: 'thin', color: { argb: 'FF000000' } },
						};
						cell.alignment = cell.alignment || {};
						cell.alignment.wrapText = true;
					});
				}
			}

			// 评审/督查引出缺陷（来自 reviewerData/verifierData）
			const reasonIndex = leadingOutDefectsData[0]
				? leadingOutDefectsData[0].findIndex((e) => e === '缺陷描述及原因')
				: -1;
			const commitDateIndex = leadingOutDefectsData[0]
				? leadingOutDefectsData[0].findIndex((e) => e === '登记日期' || e === '缺陷引出时间')
				: -1;
			for (let i = 1; i < reviewerData.length; i++) {
				const rowValues = [];
				rowValues[type] = '评审引出缺陷';
				rowValues[typeValueIndex] = -0.5;
				rowValues[leaderIndex] = -0.5;
				rowValues[
					describeIndex
				] = `登记人:${reviewerData[i][0]}\n登记时间：${reviewerData[i][1]}\n${reviewerData[i][reasonIndex]}`;
				rowValues[dateIndex] = reviewerData[i][commitDateIndex];
				const insertedRow = worksheet.insertRow(2, rowValues, 'o');
				insertedRow.eachCell((cell) => {
					cell.border = {
						top: { style: 'thin', color: { argb: 'FF000000' } },
						left: { style: 'thin', color: { argb: 'FF000000' } },
						bottom: { style: 'thin', color: { argb: 'FF000000' } },
						right: { style: 'thin', color: { argb: 'FF000000' } },
					};
					cell.alignment = cell.alignment || {};
					cell.alignment.wrapText = true;
				});
			}
			for (let i = 1; i < verifierData.length; i++) {
				const rowValues = [];
				rowValues[type] = '督查引出缺陷';
				rowValues[typeValueIndex] = -0.5;
				rowValues[leaderIndex] = -0.5;
				rowValues[
					describeIndex
				] = `登记人:${verifierData[i][0]}\n登记时间：${verifierData[i][1]}\n${verifierData[i][reasonIndex]}`;
				rowValues[dateIndex] = verifierData[i][commitDateIndex];
				const insertedRow = worksheet.insertRow(2, rowValues, 'o');
				insertedRow.eachCell((cell) => {
					cell.border = {
						top: { style: 'thin', color: { argb: 'FF000000' } },
						left: { style: 'thin', color: { argb: 'FF000000' } },
						bottom: { style: 'thin', color: { argb: 'FF000000' } },
						right: { style: 'thin', color: { argb: 'FF000000' } },
					};
					cell.alignment = cell.alignment || {};
					cell.alignment.wrapText = true;
				});
			}

			// 插入评审不通过汇总行
			const rowValues2 = [];
			rowValues2[type] = '评审不通过';
			rowValues2[typeValueIndex] = -reviewDeductionPoints;
			rowValues2[leaderIndex] = -reviewDeductionPoints;
			rowValues2[describeIndex] = `评审不通过共扣${reviewDeductionPoints}分`;
			const insertedRow = worksheet.insertRow(2, rowValues2, 'o');
			insertedRow.eachCell((cell) => {
				cell.border = {
					top: { style: 'thin', color: { argb: 'FF000000' } },
					left: { style: 'thin', color: { argb: 'FF000000' } },
					bottom: { style: 'thin', color: { argb: 'FF000000' } },
					right: { style: 'thin', color: { argb: 'FF000000' } },
				};
				cell.alignment = cell.alignment || {};
				cell.alignment.wrapText = true;
			});
		}
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
