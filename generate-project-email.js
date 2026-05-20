'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const EmailService = require('./service/email-service');
const HolidayService = require('./service/holiday-service');
const { getWorkRecordPath } = require('./service/index');
const { USER_NAME, DEPARTMENT } = require('./config');
const { isEmpty } = require('./service');
const {
	getColumnIndexMap,
	buildRecord,
	parseDate,
	isDateInRange,
	getText,
	formatDateCN,
	allowedTaskStatuses,
} = require('./generate-report-kf');
const projectConfig = require('./config/project-config');

/**
 * 根据项目名称匹配到项目配置
 * @param {string} projectName - Excel 中的项目名称
 * @returns {object|null} 匹配到的项目配置
 */
function matchProject(projectName) {
	for (const project of projectConfig.projects) {
		if (project.matchKeywords.some((kw) => projectName.includes(kw))) {
			return project;
		}
	}
	return null;
}

/**
 * 从 Excel 提取数据并按项目分组
 * @param {Date} targetDate - 目标日期
 * @returns {object} 按项目分组的数据
 */
function extractProjectData(targetDate) {
	const workRecordPath = getWorkRecordPath();
	const workbook = xlsx.readFile(workRecordPath);
	const worksheet = workbook.Sheets['工作记录'];
	const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

	if (!data || data.length === 0) {
		return null;
	}

	const headers = data[0];
	const colIndex = getColumnIndexMap(headers);

	// 今日日期范围
	const todayStart = new Date(
		targetDate.getFullYear(),
		targetDate.getMonth(),
		targetDate.getDate(),
	);
	const todayEnd = new Date(
		targetDate.getFullYear(),
		targetDate.getMonth(),
		targetDate.getDate(),
		23,
		59,
		59,
		999,
	);

	// 按项目分组的数据结构
	const projectDataMap = new Map();
	for (const project of projectConfig.projects) {
		projectDataMap.set(project.displayName, {
			project,
			todayNewItems: [],      // 今日新增（登记日期=今天）
			todayProcessedItems: [], // 今日处理（开发完成日期=今天 且 任务状态为完成类）
			unresolvedItems: [],     // 剩余未解决（任务状态不是完成类，不限日期）
		});
	}

	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		const registrant = getText(row, colIndex.registrant);

		if (registrant !== USER_NAME) {
			continue;
		}

		const record = buildRecord(row, colIndex);
		if (
			isEmpty(record.category) &&
			isEmpty(record.taskContent) &&
			isEmpty(record.commitInfo)
		) {
			continue;
		}

		// 匹配项目
		const matchedProject = matchProject(record.projectName);
		if (!matchedProject) {
			continue;
		}

		const projectData = projectDataMap.get(matchedProject.displayName);

		// 今日新增：登记日期 = 今天
		if (isDateInRange(record.registerDate, todayStart, todayEnd)) {
			projectData.todayNewItems.push(record);
		}

		// 今日处理：开发完成日期 = 今天 且 任务状态为完成类
		if (
			isDateInRange(record.regDate, todayStart, todayEnd) &&
			allowedTaskStatuses.has(record.taskStatus)
		) {
			projectData.todayProcessedItems.push(record);
		}

		// 剩余未解决：任务状态不是完成类（不限日期）
		if (!allowedTaskStatuses.has(record.taskStatus)) {
			projectData.unresolvedItems.push(record);
		}
	}

	return projectDataMap;
}

/**
 * 格式化单据明细行
 * @param {object} record - 工作记录
 * @returns {string} 格式化后的文本
 */
function formatTicketLine(record) {
	const parts = [];
	if (record.taskContent) parts.push(record.taskContent);
	if (record.commitInfo && record.commitInfo !== record.taskContent) parts.push(record.commitInfo);
	const content = parts.length > 0 ? parts.join(' - ') : '暂无内容';
	const suffix = record.ticketNo ? `【${record.ticketNo}】` : '';
	return `${content}${suffix}`;
}

/**
 * 生成项目邮件 Markdown 内容
 * @param {Map} projectDataMap - 按项目分组的数据
 * @returns {string} Markdown 内容
 */
function buildProjectEmailMarkdown(projectDataMap) {
	const chineseNumerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

	const lines = [];
	lines.push('尊敬的领导、同事们：');
	lines.push('');

	let projectIndex = 0;
	for (const [displayName, projectData] of projectDataMap) {
		projectIndex++;
		const numeral = chineseNumerals[projectIndex - 1] || String(projectIndex);
		const project = projectData.project;
		const newCount = projectData.todayNewItems.length;
		const processedCount = projectData.todayProcessedItems.length;
		const unresolvedCount = projectData.unresolvedItems.length;
		const hasActivity = newCount > 0 || processedCount > 0;

		// 项目标题
		lines.push(`${numeral}、${displayName}`);

		// 在线文档
		if (project.onlineDocUrl && project.onlineDocUrl.url) {
			lines.push(`  问题单在线文档：[${project.onlineDocUrl.label}](${project.onlineDocUrl.url})`);
		} else {
			lines.push('  问题单在线文档：无');
		}

		// 分支信息
		lines.push(`  后端分支：${project.backendBranch}`);
		lines.push(`  前端分支：pc端：${project.frontendBranch.pc}；移动端：${project.frontendBranch.mobile}`);

		// 无数据项目：折叠为一行摘要
		if (!hasActivity && unresolvedCount === 0) {
			lines.push('  今日无新增/处理，无剩余未解决单据');
			lines.push('');
			continue;
		}

		// 数据摘要行
		lines.push(`  今日新增单据：${newCount} | 今日处理单据：${processedCount} | 剩余未解决单据（共计）：${unresolvedCount}`);

		// 今日新增明细
		if (newCount > 0) {
			projectData.todayNewItems.forEach((record, idx) => {
				lines.push(`    ${idx + 1}、${formatTicketLine(record)}`);
			});
		}

		// 今日处理明细
		if (processedCount > 0) {
			if (newCount > 0) lines.push('');
			projectData.todayProcessedItems.forEach((record, idx) => {
				lines.push(`    ${idx + 1}、${formatTicketLine(record)}`);
			});
		}

		// 剩余未解决明细（最多显示5条，避免过长）
		if (unresolvedCount > 0) {
			if (hasActivity) lines.push('');
			const showCount = Math.min(unresolvedCount, 5);
			for (let i = 0; i < showCount; i++) {
				lines.push(`    ${i + 1}、${formatTicketLine(projectData.unresolvedItems[i])}`);
			}
			if (unresolvedCount > 5) {
				lines.push(`    ...及其他 ${unresolvedCount - 5} 条`);
			}
		}

		lines.push('');
	}

	lines.push('后续我将持续跟进各工单处理进度，确保按时保质保量完成。如有问题，敬请各位领导、同事指正。');
	lines.push('');
	lines.push('祝：工作顺利，事业向上。');
	lines.push(`${DEPARTMENT}：${USER_NAME}`);

	return lines.join('\n');
}

/**
 * 生成输出文件路径
 * @param {Date} targetDate - 目标日期
 * @returns {string} 文件路径
 */
function buildOutputFilePath(targetDate) {
	const dataDir = path.join(process.cwd(), 'data');
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const pad = (value) => String(value).padStart(2, '0');
	const dateStr = `${targetDate.getFullYear()}${pad(targetDate.getMonth() + 1)}${pad(targetDate.getDate())}`;

	return path.join(dataDir, `项目问题汇报--${DEPARTMENT}--${USER_NAME}--${dateStr}.md`);
}

/**
 * 生成项目问题汇报
 * @param {Date} targetDate - 目标日期
 * @returns {string|null} 生成的文件路径
 */
function generateProjectReport(targetDate) {
	const projectDataMap = extractProjectData(targetDate);
	if (!projectDataMap) {
		console.warn('⚠️ 未找到工作记录数据');
		return null;
	}

	// 检查是否有任何项目有数据
	let hasData = false;
	for (const [, projectData] of projectDataMap) {
		if (
			projectData.todayNewItems.length > 0 ||
			projectData.todayProcessedItems.length > 0 ||
			projectData.unresolvedItems.length > 0
		) {
			hasData = true;
			break;
		}
	}

	if (!hasData) {
		console.warn('⚠️ 没有找到符合项目条件的工作记录');
		return null;
	}

	const markdown = buildProjectEmailMarkdown(projectDataMap);
	const filePath = buildOutputFilePath(targetDate);
	fs.writeFileSync(filePath, markdown, 'utf-8');

	console.log(`✅ 项目问题汇报生成成功: ${filePath}`);
	console.log(`📅 日期: ${formatDateCN(targetDate)}`);

	// 输出各项目统计
	for (const [displayName, projectData] of projectDataMap) {
		console.log(
			`📊 ${displayName}: 新增${projectData.todayNewItems.length}条，处理${projectData.todayProcessedItems.length}条，未解决${projectData.unresolvedItems.length}条`,
		);
	}

	return filePath;
}

/**
 * 发送项目问题汇报邮件
 * @param {string} reportFilePath - 报告文件路径
 * @param {Date} targetDate - 目标日期
 */
async function sendProjectEmail(reportFilePath, targetDate) {
	// 邮件配置
	const emailConfig = {
		host: process.env.EMAIL_HOST || 'smtp.exmail.qq.com',
		port: process.env.EMAIL_PORT || 465,
		secure: true,
		user: process.env.EMAIL_USER,
		password: process.env.EMAIL_PASSWORD,
		from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
		imapHost: process.env.EMAIL_IMAP_HOST || 'imap.exmail.qq.com',
		imapPort: process.env.EMAIL_IMAP_PORT || 993,
		sentFolder: process.env.EMAIL_SENT_FOLDER || 'Sent Messages',
		saveToSent: process.env.EMAIL_SAVE_TO_SENT !== 'false',
	};

	// 验证邮件配置
	if (!emailConfig.user || !emailConfig.password) {
		throw new Error('邮件配置不完整，请检查 EMAIL_USER 和 EMAIL_PASSWORD 环境变量');
	}

	// 收件人：所有项目 recipients 的并集
	const allRecipients = new Set();
	for (const project of projectConfig.projects) {
		for (const recipient of project.recipients) {
			allRecipients.add(recipient);
		}
	}
	const toList = Array.from(allRecipients);

	if (toList.length === 0) {
		throw new Error('未配置收件人，请在 config/project-config.js 中配置项目收件人');
	}

	// 创建邮件服务实例
	const emailService = new EmailService(emailConfig);

	// 生成邮件 HTML
	const html = emailService.generateHtmlFromMarkdown(reportFilePath);

	// 发送邮件
	console.log('正在发送项目问题汇报邮件...');
	await emailService.sendMail({
		to: toList,
		subject: projectConfig.emailSubject,
		html: html,
	});

	// 删除临时报告文件
	if (fs.existsSync(reportFilePath)) {
		fs.unlinkSync(reportFilePath);
		console.log(`🧹 已删除临时报告文件: ${reportFilePath}`);
	}

	console.log('\n====================================');
	console.log('✅ 项目问题汇报邮件发送成功！');
	console.log('====================================');
	console.log('收件人:', toList.join(', '));
	console.log('主题:', projectConfig.emailSubject);
	console.log('====================================\n');
}

/**
 * 主函数
 */
async function main() {
	const args = process.argv.slice(2);
	const shouldSend = args.includes('--send');
	const dateArg = args.find((a) => !a.startsWith('--'));

	let targetDate = new Date();
	if (dateArg) {
		const [year, month, day] = dateArg.split('-').map(Number);
		targetDate = new Date(year, month - 1, day);
		if (isNaN(targetDate.getTime())) {
			console.error('❌ 日期格式错误，请使用 YYYY-MM-DD 格式');
			process.exit(1);
		}
	}

	console.log('====================================');
	console.log('项目问题汇报邮件生成');
	console.log('执行时间:', new Date().toLocaleString('zh-CN'));
	console.log('====================================\n');

	if (shouldSend) {
		// 检查是否为工作日
		const checkWorkday = process.env.EMAIL_CHECK_WORKDAY !== 'false';
		if (checkWorkday) {
			console.log('检查今天是否为工作日...');
			const holidayService = new HolidayService();
			const dateInfo = await holidayService.getDateInfo(targetDate);

			console.log(`日期: ${dateInfo.date}`);
			console.log(`类型: ${dateInfo.type}`);
			console.log(`说明: ${dateInfo.description}`);

			if (!dateInfo.isWorkday) {
				console.log('\n⏸️  今天不是工作日，跳过发送邮件');
				console.log('====================================\n');
				return;
			}

			console.log('✓ 今天是工作日，继续执行\n');
		}
	}

	const reportFilePath = generateProjectReport(targetDate);
	if (!reportFilePath) {
		console.log('未生成报告，跳过邮件发送');
		return;
	}

	if (shouldSend) {
		await sendProjectEmail(reportFilePath, targetDate);
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error('❌ 执行失败:', err);
		process.exit(1);
	});
}

module.exports = {
	extractProjectData,
	buildProjectEmailMarkdown,
	generateProjectReport,
	matchProject,
};