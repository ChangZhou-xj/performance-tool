'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const EmailService = require('./service/email-service');
const HolidayService = require('./service/holiday-service');

console.log('====================================');
console.log('开始发送日报邮件');
console.log('执行时间:', new Date().toLocaleString('zh-CN'));
console.log('====================================\n');

// 邮件配置
const emailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.exmail.qq.com', // 腾讯企业邮箱SMTP服务器
  port: process.env.EMAIL_PORT || 465, // 端口
  secure: true, // 使用SSL
  user: process.env.EMAIL_USER, // 发件人邮箱
  password: process.env.EMAIL_PASSWORD, // 邮箱授权码或密码
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER, // 发件人名称
  // IMAP配置（用于保存已发送邮件）
  imapHost: process.env.EMAIL_IMAP_HOST || 'imap.exmail.qq.com',
  imapPort: process.env.EMAIL_IMAP_PORT || 993,
  sentFolder: process.env.EMAIL_SENT_FOLDER || 'Sent Messages', // 已发送文件夹名称
  saveToSent: process.env.EMAIL_SAVE_TO_SENT !== 'false', // 是否保存到已发送（默认true）
};

// 收件人配置
const recipientConfig = {
  to: process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',').map(e => e.trim()) : [], // 收件人列表
  cc: process.env.EMAIL_CC ? process.env.EMAIL_CC.split(',').map(e => e.trim()) : [], // 抄送列表
};

/**
 * 获取最新的日报文件
 * @param {string} userName - 用户名
 * @returns {string|null} 文件路径
 */
function getLatestReportFile(userName) {
  const dataDir = path.join(__dirname, 'data');
  const dateStr = dayjs().format('YYYYMMDD');

  // 如果指定了用户名，查找该用户的最新日报
  if (userName) {
    const files = fs.readdirSync(dataDir);
    const userFiles = files
      .filter(file => file.includes(`--${userName}--${dateStr}`) && file.endsWith('.md'))
      .sort()
      .reverse();

    if (userFiles.length > 0) {
      return path.join(dataDir, userFiles[0]);
    }
  }

  // 否则查找今天的日报
  const today = dayjs().format('YYYYMMDD');
  const files = fs.readdirSync(dataDir);
  const todayFiles = files.filter(file =>
    file.includes(today) && file.endsWith('.md')
  );

  if (todayFiles.length > 0) {
    return path.join(dataDir, todayFiles[0]);
  }

  return null;
}

/**
 * 发送日报邮件
 */
async function sendDailyReportEmail() {
  try {
    // 检查是否为工作日（如果启用）
    const checkWorkday = process.env.EMAIL_CHECK_WORKDAY !== 'false'; // 默认检查
    if (checkWorkday) {
      console.log('检查今天是否为工作日...');
      const holidayService = new HolidayService();
      const today = new Date();
      const dateInfo = await holidayService.getDateInfo(today);

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

    // 验证邮件配置
    if (!emailConfig.user || !emailConfig.password) {
      throw new Error('邮件配置不完整，请检查 EMAIL_USER 和 EMAIL_PASSWORD 环境变量');
    }

    if (recipientConfig.to.length === 0) {
      throw new Error('未配置收件人，请设置 EMAIL_TO 环境变量');
    }

    // 获取用户名和部门
    const userName = process.env.USER_NAME || '';
    const department = process.env.DEPARTMENT || '前端开发部';

    // 获取最新日报文件
    const reportFilePath = getLatestReportFile(userName);

    if (!reportFilePath) {
      console.log('未找到日报文件');
      return;
    }

    console.log('找到日报文件:', reportFilePath);

    // 创建邮件服务实例
    const emailService = new EmailService(emailConfig);

    // 生成邮件主题
    const dateStr = dayjs().format('YYYYMMDD');
    const subject = `Re：工作日报--${department}--${userName}--${dateStr}`;

    // 发送邮件
    console.log('正在发送邮件...');
    await emailService.sendDailyReport({
      reportFilePath: reportFilePath,
      to: recipientConfig.to,
      cc: recipientConfig.cc.length > 0 ? recipientConfig.cc : undefined,
      subject: subject,
    });

    console.log('\n====================================');
    console.log('✅ 邮件发送成功！');
    console.log('====================================');
    console.log('收件人:', recipientConfig.to.join(', '));
    if (recipientConfig.cc.length > 0) {
      console.log('抄送:', recipientConfig.cc.join(', '));
    }
    console.log('====================================\n');

  } catch (error) {
    console.error('\n====================================');
    console.error('❌ 发送邮件失败');
    console.error('====================================');
    console.error('错误信息:', error.message);
    console.error('====================================\n');
    process.exit(1);
  }
}

// 执行发送
sendDailyReportEmail();
