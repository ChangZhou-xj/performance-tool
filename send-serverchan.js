'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Server酱推送函数
 */
async function sendServerChan(sendKey, title, content) {
	const url = `https://sctapi.ftqq.com/${sendKey}.send`;
	const params = { title, desp: content };
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
	const sendKey = process.env.SERVERCHAN_KEY;
	if (!sendKey) {
		console.log('未配置 SERVERCHAN_KEY，跳过通知');
		process.exit(0);
	}

	const [status = '成功', logFilePath] = process.argv.slice(2);
	const title = `青龙任务执行${status}`;
	const content = buildContent(status, logFilePath ? path.resolve(logFilePath) : '');

	try {
		await sendServerChan(sendKey, title, content);
	} catch (error) {
		console.log(`【Server酱推送】发生错误: ${error.message}`);
		process.exit(1);
	}
})();
