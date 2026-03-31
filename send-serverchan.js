'use strict';
const axios = require('axios');
require('dotenv').config();

const DEFAULT_SERVERCHAN_KEY = 'SCT329594T3gNRBZBzsB0W6cJXadBA8qVY';
const DEFAULT_SERVERCHAN_CHANNEL = '9'; // 微信测试号通道

function resolveServerChanUrl(sendKey) {
	const matched = String(sendKey).match(/^sctp(\d+)t/i);
	if (matched) {
		return `https://${matched[1]}.push.ft07.com/send/${sendKey}.send`;
	}

	return `https://sctapi.ftqq.com/${sendKey}.send`;
}

function parseOpenids(openidInput) {
	if (!openidInput) {
		return [];
	}

	if (Array.isArray(openidInput)) {
		return openidInput
			.map((item) => String(item || '').trim())
			.filter(Boolean);
	}

	return String(openidInput)
		.split(/[，,]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/**
 * Server酱推送函数
 */
async function sendServerChan(sendKey, title, content, openids = []) {
	const url = resolveServerChanUrl(sendKey);
	const normalizedOpenids = parseOpenids(openids);
	// 根据浏览器实际请求，参数名是 title 而不是 text
	const params = { title, desp: content };

	if (normalizedOpenids.length > 0) {
		params.openid = normalizedOpenids.join(',');
	}

	// 添加 channel 参数
	params.channel = DEFAULT_SERVERCHAN_CHANNEL;

	const response = await axios.post(
		url,
		new URLSearchParams(params).toString(),
		{
			timeout: 10000,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			},
		},
	);

	if (response.status === 200 && response.data.code === 0) {
		const extraInfo = normalizedOpenids.length > 0
			? `，抄送 ${normalizedOpenids.length} 个 openid`
			: '';
		console.log(`【Server酱推送】消息发送成功 ✓${extraInfo}`);
		return;
	}

	console.log(`【Server酱推送】发送失败: ${JSON.stringify(response.data)}`);
}

function buildContent() {
	const now = new Date();
	const date_str = now.toLocaleDateString('zh-CN').replace(/\//g, '-');
	const time_str = now.toLocaleTimeString('zh-CN', { hour12: false });

	return `### 💞 佳佳，专属小提醒
---
**📅 日期：** ${date_str}
**⏰ 时间：** ${time_str}

**📢 提醒内容：**
> 宝儿，今天也要记得打卡呀，爱你~
> 记得按时好好吃饭、注意休息，我会每天陪伴你(๑•ᴗ•๑)

**🌹 惊喜链接：**
[点击打开 3D 玫瑰页面](http://39.105.221.218/rose-3d.html)

**💡 小贴士：**
* 要记住佳佳是这个世界上最好的人~
* 如果今天有点累，联系周兴杰亲亲抱抱你，当你需要我时，我会一直在你身边，成为你随时都可以依靠的人。`;
}


async function main() {
	const sendKey = DEFAULT_SERVERCHAN_KEY;
	if (!sendKey) {
		console.log('未配置 SERVERCHAN_KEY，跳过通知');
		process.exit(0);
	}

	const args = process.argv.slice(2);
	const openidArg = args[2];
	const openids = parseOpenids(openidArg || process.env.SERVERCHAN_OPENIDS);
	const title = '💗 佳佳，想你了，记得打卡';
	const content = buildContent();

	try {
		await sendServerChan(sendKey, title, content, openids);
	} catch (error) {
		console.log(`【Server酱推送】发生错误: ${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	buildContent,
	parseOpenids,
	resolveServerChanUrl,
	sendServerChan,
};

if (require.main === module) {
	main();
}
