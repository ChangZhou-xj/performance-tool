# Setup

``` bash
# 1. 安装依赖
$ npm install --registry=https://registry.npmmirror.com

# 2. 查看 docId 和 cookie 图片教程修改 .env 文件

# 3. 下载工作记录excel数据
$ npm run download-work-record

# 4. 生成个人绩效
$ npm run generate-performance

# 5. 校验数据
$ npm run validate-performance



# 6. 生成日报（基于代码提交记录）
$ npm run report:day

# 7. 生成周报（基于代码提交记录）
$ npm run report:week

# 生成2026-02-06的日报
$ npm run report:day -- 2026-02-06

# 生成2026-02-06所在周的周报
$ npm run report:week -- 2026-02-06

# 8. 发送邮件（需先配置好环境变量）
$ npm run send-email
# 邮件功能使用说明（青龙面板）

## 快速开始

### 1. 环境变量配置

在青龙面板的"环境变量"页面添加以下配置：

```bash
# 腾讯企业邮箱配置
EMAIL_HOST=smtp.exmail.qq.com
EMAIL_PORT=465
EMAIL_USER=your_email@company.com
EMAIL_PASSWORD=your_auth_code
EMAIL_FROM=Your Name <your_email@company.com>

# IMAP配置 - 用于保存已发送邮件到发件箱
EMAIL_IMAP_HOST=imap.exmail.qq.com
EMAIL_IMAP_PORT=993
EMAIL_SENT_FOLDER=Sent Messages
EMAIL_SAVE_TO_SENT=true

# 工作日检查 - 自动排除节假日和周末（推荐开启）
EMAIL_CHECK_WORKDAY=true

# 收件人配置（多个用逗号分隔）
EMAIL_TO=recipient1@company.com,recipient2@company.com
EMAIL_CC=cc@company.com
```

### 2. 添加定时任务

在青龙面板的"定时任务"页面添加：

| 字段 | 值 |
|------|-----|
| **名称** | 发送日报邮件 |
| **命令** | `node send-email.js` |
| **定时规则** | `0 18 * * *` |

> 💡 **智能工作日判断**：设置 `EMAIL_CHECK_WORKDAY=true` 后，任务每天都会触发，但会自动识别节假日和周末并跳过发送
>
> 📅 定时规则 `0 18 * * *` 表示每天18:00触发，实际是否发送由工作日判断决定（自动跳过节假日、周末，包含调休工作日）

### 3. 测试运行

```bash
# 手动执行测试
npm run send-email

# 或直接运行
node send-email.js
```

## 腾讯企业邮箱授权码获取

1. 登录 [腾讯企业邮箱](https://exmail.qq.com/)
2. 点击右上角"设置" -> "客户端设置"
3. 开启"SMTP服务"
4. 点击"生成新密码"获取授权码
5. 将授权码填入 `EMAIL_PASSWORD` 环境变量

## 定时规则说明

### 推荐配置：智能工作日发送

```bash
# 方式一：智能工作日判断（推荐）⭐
0 18 * * *      # 每天18:00触发
                # 配合 EMAIL_CHECK_WORKDAY=true 自动排除节假日和周末
                # 支持识别调休工作日（如国庆前后补班日）

# 方式二：手动限定周一到周五
0 18 * * 1-5    # 周一至周五18:00触发
                # 不推荐：无法识别周末调休工作日
```

**推荐使用方式一**：
- 定时规则设置为 `0 18 * * *`（每天都触发）
- 环境变量设置 `EMAIL_CHECK_WORKDAY=true`
- 脚本自动通过节假日API判断是否为工作日
- 自动识别节假日、周末和调休，只在真正的工作日发送

### 更多Cron表达式示例

```bash
# Cron表达式格式: 分 时 日 月 周
# 周的表示：0=周日, 1=周一, 2=周二, ..., 6=周六

0 18 * * *      # 每天18:00执行（包括周末）
0 9 * * 1       # 每周一9:00执行
0 18 * * 1-5    # 工作日（周一到周五）18:00执行 ⭐推荐
0 17 * * 5      # 每周五17:00执行
0 9,18 * * 1-5  # 工作日9:00和18:00各执行一次
30 17 * * 1-5   # 工作日17:30执行
0 9 * * 1,3,5   # 每周一、三、五9:00执行
```

### 快速参考

| 场景 | Cron表达式 | 说明 |
|------|-----------|------|
| 工作日晚上发送（推荐）⭐ | `0 18 * * *` | 每天18:00，配合EMAIL_CHECK_WORKDAY=true |
| 工作日早晚各一次 | `0 9,18 * * *` | 每天9:00和18:00，配合EMAIL_CHECK_WORKDAY=true |
| 每周五下班前 | `0 17 * * 5` | 每周五17:00 |
| 每天发送 | `0 18 * * *` | 每天18:00（含周末） |
| 每周一早上 | `0 9 * * 1` | 每周一9:00 |

## 邮件模板说明

邮件内容自动读取 `data` 目录下的最新日报文件（Markdown格式），并转换为HTML格式发送。

邮件样式包括：
- 清晰的标题层级
- 统计数据高亮
- 列表项美化
- 响应式布局

## 工作日智能判断

系统集成了中国节假日API，可自动识别：
- ✅ **工作日**：正常工作日、调休上班日
- ❌ **非工作日**：周末、法定节假日、调休休息日

### 工作原理

1. 定时任务在指定时间触发
2. 脚本检查当天是否为工作日
3. 如果是工作日，发送邮件；否则跳过

### 节假日数据源

- 使用免费API：http://timor.tech/api/holiday
- 包含完整的中国节假日和调休数据
- API调用失败时，自动降级为周一至周五判断

### 禁用工作日检查

如需每天都发送（包括周末和节假日），设置：
```bash
EMAIL_CHECK_WORKDAY=false
```

## 常见问题

### Q: 节假日为什么没有发送邮件？

**A: 这是正常的**
- 如果设置了 `EMAIL_CHECK_WORKDAY=true`，系统会自动跳过节假日和周末
- 查看执行日志，会显示："今天不是工作日，跳过发送邮件"
- 这样可以避免在节假日打扰收件人

### Q: 调休上班日会发送吗？

**A: 会的**
- 系统会识别调休工作日（如国庆节前后的补班日）
- 调休工作日会正常发送邮件
- 日志会显示："因XX假期调休，需上班"

### Q: 为什么收件人收到邮件，但我的已发送文件夹没有记录？

**A: 解决方案**
1. 确保配置了IMAP相关环境变量：
   ```bash
   EMAIL_IMAP_HOST=imap.exmail.qq.com
   EMAIL_IMAP_PORT=993
   EMAIL_SENT_FOLDER=Sent Messages  # 或"已发送"
   EMAIL_SAVE_TO_SENT=true
   ```
2. 系统会自动通过IMAP将邮件保存到已发送文件夹
3. 如果保存失败，不影响邮件发送，但会在控制台显示警告信息
4. 注意：部分企业邮箱的已发送文件夹名称可能不同，常见的有：
   - `Sent Messages` (腾讯企业邮箱默认)
   - `已发送`
   - `Sent`
   - `Sent Items`

### Q: 邮件发送失败

**A: 检查以下几点**
- 环境变量是否配置正确
- 邮箱授权码是否有效
- 网络连接是否正常
- SMTP服务是否开启

### Q: 找不到日报文件

**A: 确认以下内容**
- `data` 目录下是否有日报文件
- 文件命名格式：`用户名-代码测试日报-日期.md`
- `USER_NAME` 环境变量是否设置正确

### Q: 收不到邮件

**A: 检查以下方面**
- 收件人邮箱地址是否正确
- 查看垃圾邮件箱
- 检查邮箱服务器日志
- 验证发件人邮箱配额

## 高级功能

### 自定义邮件样式

修改 [service/email-service.js](service/email-service.js) 中的CSS样式：

```javascript
generateHtmlFromMarkdown(markdownFilePath) {
  // ...
  const html = `
    <style>
      /* 自定义样式 */
      h1 { color: #your-color; }
    </style>
  `;
  // ...
}
```

### 添加附件

在 `send-email.js` 中添加附件配置：

```javascript
await emailService.sendDailyReport({
  reportFilePath: reportFilePath,
  to: recipientConfig.to,
  subject: subject,
  attachments: [
    {
      filename: 'report.pdf',
      path: '/path/to/report.pdf'
    }
  ]
});
```

### 批量发送不同内容

可以配置多个任务，针对不同的收件人发送不同的报告内容。

## 技术支持

如遇到问题，请查看：
1. 青龙面板任务日志
2. 邮件服务返回的错误信息
3. 参考完整配置文档：[setup-schedule.md](setup-schedule.md)
