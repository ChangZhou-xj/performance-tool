"use strict";
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
/**
 * Server酱推送函数
 */
async function sendServerChan(sendKey, title, content, openids) {
	const url = `https://sctapi.ftqq.com/${sendKey}.send`;
	const params = { title, desp: content };
	if (openids) {
		params.openid = openids;
	}
	const response = await axios.post(
		url,
		new URLSearchParams(params).toString(),
		{
			timeout: 10000,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		},
	);

	if (response.status === 200 && response.data.code === 0) {
		console.log('【Server酱推送】消息发送成功 ✓');
		return;
	}

	console.log(`【Server酱推送】发送失败: ${JSON.stringify(response.data)}`);
}

function getServerChanConfig() {
	const keyNames = ['SERVERCHAN_KEY', 'SCTKEY', 'SCKEY'];

	for (const keyName of keyNames) {
		const value = (process.env[keyName] || '').trim();
		if (value) {
			return {
				sendKey: value,
				source: keyName,
			};
		}
	}

	return {
		sendKey: '',
		source: '',
	};
}

function buildTitle(status, titlePrefix) {
	const prefix = (titlePrefix || process.env.SERVERCHAN_TITLE_PREFIX || '').trim() || '青龙任务';
	return `${prefix}执行${status || '成功'}`;
}

function buildContent(status, logFilePath) {
	const now = new Date().toLocaleString('zh-CN');
	let content = `执行时间: ${now}\n状态: ${status || '成功'}`;

	if (logFilePath && fs.existsSync(logFilePath)) {
		let log = fs.readFileSync(logFilePath, 'utf-8');
		if (log.length > 6000) {
			log = log.slice(-6000);
		}
		content += `\n\n日志（末尾截取）：\n\n\
\`\`\`\n${log}\n\`\`\``;
	} else {
		content += '\n\n未找到日志文件';
	}

	return content;
}

/**
 * 发送 Server酱 推送通知（供其他模块复用）
 * @param {Object} [opts={}]
 * @param {string} [opts.status='成功'] 状态描述
 * @param {string} [opts.logFilePath] 日志文件绝对路径（通知中附带末尾内容）
 * @param {string} [opts.openids] 多个 openid，用 | 分隔
 * @param {string} [opts.titlePrefix] 通知标题前缀，默认取 SERVERCHAN_TITLE_PREFIX 或 '青龙任务'
 * @returns {Promise<void>}
 */
async function sendServerChanNotify(opts = {}) {
	const { sendKey, source } = getServerChanConfig();
	if (!sendKey) {
		throw new Error('未配置 Server酱密钥 (SERVERCHAN_KEY / SCTKEY / SCKEY)');
	}

	if (source !== 'SERVERCHAN_KEY') {
		console.log(`【Server酱推送】已使用兼容环境变量 ${source}`);
	}

	const openids = (opts.openids || process.env.SERVERCHAN_OPENIDS || '').trim();
	const title = buildTitle(opts.status, opts.titlePrefix);
	const content = buildContent(opts.status, opts.logFilePath ? path.resolve(opts.logFilePath) : '');

	await sendServerChan(sendKey, title, content, openids);
}

module.exports = {
	sendServerChan,
	getServerChanConfig,
	buildTitle,
	buildContent,
	sendServerChanNotify,
};

if (require.main === module) {
	(async () => {
		const [status = '成功', logFilePath, openidsArg] = process.argv.slice(2);
		const { sendKey } = getServerChanConfig();
		if (!sendKey) {
			console.log('未配置 Server酱密钥，已尝试读取 SERVERCHAN_KEY / SCTKEY / SCKEY，跳过通知');
			console.log('如果部署在青龙，请在“环境变量”页面配置上述任一变量，或在仓库根目录放置 .env');
			process.exit(0);
		}

		try {
			await sendServerChanNotify({
				status,
				logFilePath,
				openids: openidsArg,
			});
		} catch (error) {
			// 仅密钥缺失或网络异常时走到这里；HTTP 返回非 0 已在 sendServerChan 内打印但不抛错
			console.log(`【Server酱推送】发生错误: ${error.message}`);
			process.exit(1);
		}

		// 显式退出：通知脚本是一次性 CLI，成功后必须终止进程。
		// 否则若底层 socket（如 axios/TLS）在容器环境中未及时关闭，
		// 会阻止 Node 事件循环退出，导致青龙任务一直显示运行中。
		process.exit(0);
	})();
}