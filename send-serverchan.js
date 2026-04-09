"use strict";
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

function buildContent(status, logFilePath) {
	const now = new Date().toLocaleString('zh-CN');
	let content = `执行时间: ${now}\n状态: ${status}`;

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

(async () => {
	const { sendKey, source } = getServerChanConfig();
	if (!sendKey) {
		console.log('未配置 Server酱密钥，已尝试读取 SERVERCHAN_KEY / SCTKEY / SCKEY，跳过通知');
		console.log('如果部署在青龙，请在“环境变量”页面配置上述任一变量，或在仓库根目录放置 .env');
		process.exit(0);
	}

	if (source !== 'SERVERCHAN_KEY') {
		console.log(`【Server酱推送】已使用兼容环境变量 ${source}`);
	}

	const [status = '成功', logFilePath, openidsArg] = process.argv.slice(2);
	const openids = (openidsArg || process.env.SERVERCHAN_OPENIDS || '').trim();
	const title = `青龙任务执行${status}`;
	const content = buildContent(status, logFilePath ? path.resolve(logFilePath) : '');

	try {
		await sendServerChan(sendKey, title, content, openids);
	} catch (error) {
		console.log(`【Server酱推送】发生错误: ${error.message}`);
		process.exit(1);
	}
})();
