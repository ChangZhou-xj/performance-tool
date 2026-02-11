'use strict';
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

/**
 * 腾讯企业邮箱邮件服务
 */
class EmailService {
  constructor(config) {
    this.config = config;
    this.transporter = null;
    this.imapClient = null;
  }

  /**
   * 初始化邮件传输器
   */
  initTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure, // true for 465, false for other ports
        auth: {
          user: this.config.user,
          pass: this.config.password,
        },
      });
    }
    return this.transporter;
  }

  /**
   * 初始化IMAP客户端（用于保存已发送邮件）
   */
  initImapClient() {
    if (!this.imapClient) {
      this.imapClient = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.imapHost || 'imap.exmail.qq.com',
        port: this.config.imapPort || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });
    }
    return this.imapClient;
  }

  /**
   * 将邮件保存到已发送文件夹
   * @param {Object} mailOptions - 邮件选项
   * @returns {Promise}
   */
  async saveToSentFolder(mailOptions) {
    return new Promise((resolve, reject) => {
      try {
        const imap = this.initImapClient();

        // 构造完整的邮件内容（RFC 822格式）
        const emailContent = this.buildRFC822Message(mailOptions);

        imap.once('ready', () => {
          // 打开已发送文件夹（不同邮箱可能名称不同）
          // 腾讯企业邮箱通常是 "Sent Messages" 或 "已发送"
          const sentFolder = this.config.sentFolder || 'Sent Messages';

          imap.openBox(sentFolder, false, (err, box) => {
            if (err) {
              console.warn('无法打开已发送文件夹:', err.message);
              imap.end();
              resolve(); // 不影响主流程
              return;
            }

            // 追加邮件到已发送文件夹
            imap.append(emailContent, { mailbox: sentFolder, flags: ['\\Seen'] }, (err) => {
              imap.end();
              if (err) {
                console.warn('保存到已发送文件夹失败:', err.message);
                resolve(); // 不影响主流程
              } else {
                console.log('✓ 已保存到已发送文件夹');
                resolve();
              }
            });
          });
        });

        imap.once('error', (err) => {
          console.warn('IMAP连接错误:', err.message);
          resolve(); // 不影响主流程
        });

        imap.connect();
      } catch (error) {
        console.warn('保存到已发送文件夹时出错:', error.message);
        resolve(); // 不影响主流程
      }
    });
  }

  /**
   * 构造RFC 822格式的邮件内容
   * @param {Object} mailOptions
   * @returns {Buffer}
   */
  buildRFC822Message(mailOptions) {
    const boundary = '----=_Part_' + Date.now();
    const date = new Date().toUTCString();

    let message = '';
    message += `From: ${mailOptions.from}\r\n`;
    message += `To: ${Array.isArray(mailOptions.to) ? mailOptions.to.join(', ') : mailOptions.to}\r\n`;
    if (mailOptions.cc) {
      message += `Cc: ${Array.isArray(mailOptions.cc) ? mailOptions.cc.join(', ') : mailOptions.cc}\r\n`;
    }
    message += `Subject: ${mailOptions.subject}\r\n`;
    message += `Date: ${date}\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
    message += `\r\n`;

    // HTML部分
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/html; charset=UTF-8\r\n`;
    message += `Content-Transfer-Encoding: quoted-printable\r\n`;
    message += `\r\n`;
    message += `${mailOptions.html}\r\n`;
    message += `\r\n`;
    message += `--${boundary}--\r\n`;

    return Buffer.from(message);
  }

  /**
   * 发送邮件
   * @param {Object} mailOptions - 邮件选项
   * @param {string} mailOptions.from - 发件人
   * @param {string|Array} mailOptions.to - 收件人
   * @param {string|Array} mailOptions.cc - 抄送
   * @param {string} mailOptions.subject - 邮件主题
   * @param {string} mailOptions.html - 邮件HTML内容
   * @param {Array} mailOptions.attachments - 附件列表
   * @param {boolean} mailOptions.saveToSent - 是否保存到已发送（默认true）
   * @returns {Promise}
   */
  async sendMail(mailOptions) {
    try {
      const transporter = this.initTransporter();

      const options = {
        from: mailOptions.from || this.config.from,
        to: mailOptions.to,
        cc: mailOptions.cc,
        subject: mailOptions.subject,
        html: mailOptions.html,
        attachments: mailOptions.attachments || [],
      };

      // 发送邮件
      const info = await transporter.sendMail(options);
      console.log('✓ 邮件发送成功:', info.messageId);

      // 保存到已发送文件夹（如果启用）
      const saveToSent = mailOptions.saveToSent !== false; // 默认为true
      if (saveToSent && this.config.saveToSent !== false) {
        console.log('正在保存到已发送文件夹...');
        await this.saveToSentFolder(options);
      }

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('邮件发送失败:', error);
      throw error;
    }
  }

  /**
   * 根据Markdown文件生成HTML邮件内容
   * @param {string} markdownFilePath - Markdown文件路径
   * @returns {string} HTML内容
   */
  generateHtmlFromMarkdown(markdownFilePath) {
    if (!fs.existsSync(markdownFilePath)) {
      throw new Error(`文件不存在: ${markdownFilePath}`);
    }

    const content = fs.readFileSync(markdownFilePath, 'utf-8');

    // 转换内容为HTML
    let html = this.convertToHtml(content);

    // 包装在样式中
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif;
            line-height: 1.8;
            color: #333;
            margin: 0;
            padding: 20px;
            background-color: #f5f7fa;
          }
          .email-container {
            background-color: #ffffff;
            max-width: 900px;
            margin: 0 auto;
            padding: 30px 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          }
          .section-title {
            color: #1a1a1a;
            font-size: 15px;
            font-weight: 600;
            margin: 20px 0 10px 0;
            padding-left: 10px;
            border-left: 4px solid #409eff;
          }
          .normal-text {
            color: #606266;
            font-size: 14px;
            line-height: 1.8;
            margin: 6px 0 6px 25px;
          }
          .work-item {
            margin: 10px 0 10px 25px;
            padding: 12px 15px;
            background-color: #f9fafb;
            border-left: 3px solid #e4e7ed;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1.8;
          }
          .empty-text {
            color: #909399;
            font-size: 14px;
            font-style: italic;
            margin: 6px 0 6px 25px;
          }
          .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #e4e7ed;
            color: #909399;
            font-size: 12px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          ${html}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * 将文本内容转换为HTML
   * @param {string} content - 文本内容
   * @returns {string} HTML内容
   */
  convertToHtml(content) {
    const lines = content.split('\n');
    let html = '';
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 跳过空行
      if (!trimmedLine) {
        continue;
      }

      // 处理章节标题（一、二、三等）
      if (/^[一二三四五六七八九十]、/.test(trimmedLine)) {
        currentSection = trimmedLine;
        html += `<div class="section-title">${this.escapeHtml(trimmedLine)}</div>`;
        continue;
      }

      // 处理数字编号的工作项（1、2、3、等）
      if (/^\d+[、\.]/.test(trimmedLine)) {
        // 判断当前是否在"二、其他"或"六、今日工作目标是否达成"章节
        const inTargetSection = currentSection.includes('二、其他') ||
                                currentSection.includes('六、今日工作目标是否达成');

        if (inTargetSection && trimmedLine.includes('【')) {
          // 对包含标签的工作项进行美化处理
          const processedLine = this.processTagsInLine(trimmedLine);
          html += `<div class="work-item">${processedLine}</div>`;
        } else {
          // 普通文本
          html += `<div class="normal-text">${this.escapeHtml(trimmedLine)}</div>`;
        }
        continue;
      }

      // 处理"暂无"
      if (trimmedLine === '暂无' || trimmedLine === '暂无。') {
        html += `<div class="empty-text">${this.escapeHtml(trimmedLine)}</div>`;
        continue;
      }

      // 处理其他普通文本（包括缩进的文本）
      html += `<div class="normal-text">${this.escapeHtml(trimmedLine)}</div>`;
    }

    return html;
  }

  /**
   * 处理行中的标签
   * @param {string} line - 文本行
   * @returns {string} 处理后的HTML
   */
  processTagsInLine(line) {
    // 直接返回转义后的文本，不做标签处理
    return this.escapeHtml(line);
  }

  /**
   * HTML转义
   * @param {string} text - 文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * 发送日报邮件
   * @param {Object} options
   * @param {string} options.reportFilePath - 日报文件路径
   * @param {string|Array} options.to - 收件人
   * @param {string|Array} options.cc - 抄送
   * @param {string} options.subject - 邮件主题
   * @param {Array} options.attachments - 附件列表
   * @param {boolean} options.saveToSent - 是否保存到已发送（默认true）
   * @returns {Promise}
   */
  async sendDailyReport(options) {
    const html = this.generateHtmlFromMarkdown(options.reportFilePath);

    return await this.sendMail({
      to: options.to,
      cc: options.cc,
      subject: options.subject,
      html: html,
      attachments: options.attachments || [],
      saveToSent: options.saveToSent,
    });
  }
}

module.exports = EmailService;
