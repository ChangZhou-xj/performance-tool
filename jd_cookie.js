function extractCookieValues(cookieString) {
    // 用于存储提取到的值
    let ptKey = null;
    let ptPin = null;
    let ptToken = null;

    // 按分号分割每个 cookie 项
    const items = cookieString.split(';');

    for (let item of items) {
        // 去除首尾空格
        item = item.trim();
        if (!item) continue;

        // 找到第一个等号的位置
        const eqIdx = item.indexOf('=');
        if (eqIdx === -1) continue; // 无效的键值对

        const key = item.substring(0, eqIdx).trim();
        const value = item.substring(eqIdx + 1).trim();

        // 根据键名赋值
        if (key === 'pt_key') {
            ptKey = value;
        } else if (key === 'pt_pin') {
            ptPin = value;
        } else if (key === 'pt_token') {
            ptToken = value;
        }
    }

    // 如果三个值都找到了，拼接成目标格式；否则可酌情处理（这里假设都存在）
    if (ptKey && ptPin && ptToken) {
        return `pt_key=${ptKey};pt_pin=${ptPin};pt_token=${ptToken};`;
    } else {
        // 可根据实际需求返回错误信息或部分结果
        return '缺少必需的cookie值';
    }
}
// 使用示例
const cookie = "";

console.log(extractCookieValues(cookie));