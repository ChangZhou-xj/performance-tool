# 绩效工具使用手册

## 环境要求

- **Node.js**: >= 16.0.0（推荐 18.x 或更高版本）
- **操作系统**: Windows / macOS / Linux
- **网络**: 需要能访问腾讯文档和邮件服务器

## 快速开始

### 1. 安装依赖

``` bash
npm install --registry=https://registry.npmmirror.com
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并根据实际情况修改配置：

```bash
cp .env.example .env
```

查看 [docId.png](docId.png) 和 [cookie.png](cookie.png) 图片教程，配置腾讯文档相关信息。

**必填配置项：**
- `TENCENT_DOCS_ID`: 腾讯文档ID
- `TENCENT_DOCS_COOKIE`: 腾讯文档Cookie
- `USER_NAME`: 用户姓名
- `DEPARTMENT`: 部门名称

**邮件功能必填项：**
- `EMAIL_USER`: 发件人邮箱
- `EMAIL_PASSWORD`: 邮箱授权码
- `EMAIL_TO`: 收件人邮箱

详细配置说明请参考 [环境变量配置](#环境变量配置完整说明) 章节。

### 3. 准备数据文件

确保 `data` 目录下有以下文件：
- `work-record.xlsx`: 工作记录文件（通过命令自动下载）
- `performance-template.xlsx`: 绩效模板文件（需手动准备）

### 4. 下载工作记录excel数据

```bash
npm run download-work-record
```

### 5. 生成个人绩效

```bash
npm run generate-performance
```

### 6. 校验数据

```bash
npm run validate-performance
```

### 7. 生成日报（基于工作记录）

```bash
# 生成今天的日报
npm run report:day

# 生成指定日期的日报（格式：YYYY-MM-DD）
npm run report:day -- 2026-02-06
```

### 8. 生成周报（基于工作记录）

```bash
# 生成本周的周报
npm run report:week

# 生成指定日期所在周的周报
npm run report:week -- 2026-02-06
```

### 9. 发送邮件（需先配置好环境变量）

```bash
npm run send-email
```

---

## npm scripts 详细说明

| 命令 | 说明 | 参数 |
|------|------|------|
| `npm run clear` | 清理 dist 目录 | 无 |
| `npm run download-work-record` | 从腾讯文档下载工作记录到 `data/work-record.xlsx` | 无 |
| `npm run generate-performance` | 生成个人绩效考核表到 `data/` 目录 | 需配置 `MONTH`、`YEAR` |
| `npm run validate-performance` | 校验绩效数据并生成校验报告 | 无 |
| `npm run report:day` | 生成日报（Markdown格式） | 可选：日期 `YYYY-MM-DD` |
| `npm run report:week` | 生成周报（Markdown格式） | 可选：日期 `YYYY-MM-DD` |
| `npm run send-email` | 发送日报邮件 | 需先配置邮件相关环境变量 |
| `npm run test-holiday` | 测试节假日API | 无 |

---

## 数据文件说明

### 输入文件

#### 1. work-record.xlsx
- **位置**: `data/work-record.xlsx`
- **来源**: 通过 `npm run download-work-record` 从腾讯文档自动下载
- **用途**: 工作记录数据，用于生成绩效、日报、周报
- **必需字段**: 
  - 工作表名: `工作记录`
  - 列名: `登记人`、`登记日期`、`开发完成日期`、`类别`、`任务内容`、`产品标识`、`项目名称`等

#### 2. performance-template.xlsx
- **位置**: `data/performance-template.xlsx`
- **来源**: 需手动准备的绩效模板文件
- **用途**: 作为生成个人绩效考核表的模板
- **说明**: 根据单位绩效考核格式准备

### 输出文件

#### 1. 绩效考核表
- **命名规则**: `{USER_NAME}-{YYYY}{MM}绩效考核.xlsx`
- **示例**: `张三-202601绩效考核.xlsx`
- **位置**: `data/` 目录

#### 2. 数据校验报告
- **命名规则**: `数据校验_{DEPARTMENT}_{YYYYMMDDHHmmss}.xlsx`
- **示例**: `数据校验_前端开发部_20260211153045.xlsx`
- **位置**: `data/` 目录

#### 3. 日报/周报文件
- **命名规则**: `工作日报--{USER_NAME}--{YYYYMMDD}.md`（日报）
- **示例**: `工作日报--张三--20260211.md`
- **位置**: `data/` 目录
- **说明**: 发送邮件后会自动删除

---

## 环境变量配置完整说明

所有环境变量配置在项目根目录的 `.env` 文件中，可参考 `.env.example` 模板。

### 腾讯文档配置

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `TENCENT_DOCS_ID` | ✅ | 腾讯在线文档ID | `300000000$AxnretFMZGkj` |
| `TENCENT_DOCS_COOKIE` | ✅ | 腾讯文档Cookie | 见 cookie.png 获取方式 |

### 用户信息配置

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `USER_NAME` | ✅ | 用户姓名（用于筛选工作记录） | `张三` |
| `DEPARTMENT` | ✅ | 部门名称 | `前端开发部` |

### 绩效配置

| 变量名 | 必填 | 说明 | 默认值 |
|--------|------|------|--------|
| `YEAR` | ❌ | 绩效年份 | 当前年份 |
| `MONTH` | ❌ | 绩效月份 | 当前月份 |
| `EXCLUDE_MEMBER` | ❌ | 排除成员（逗号分隔） | 无 |

### 邮件配置

| 变量名 | 必填 | 说明 | 默认值 |
|--------|------|------|--------|
| `EMAIL_HOST` | ❌ | SMTP服务器 | `smtp.exmail.qq.com` |
| `EMAIL_PORT` | ❌ | SMTP端口 | `465` |
| `EMAIL_USER` | ✅ | 发件人邮箱 | - |
| `EMAIL_PASSWORD` | ✅ | 邮箱授权码 | - |
| `EMAIL_FROM` | ❌ | 发件人显示名称 | 使用 `EMAIL_USER` |
| `EMAIL_TO` | ✅ | 收件人（逗号分隔） | - |
| `EMAIL_CC` | ❌ | 抄送人（逗号分隔） | - |
| `EMAIL_IMAP_HOST` | ❌ | IMAP服务器 | `imap.exmail.qq.com` |
| `EMAIL_IMAP_PORT` | ❌ | IMAP端口 | `993` |
| `EMAIL_SENT_FOLDER` | ❌ | 已发送文件夹名称 | `Sent Messages` |
| `EMAIL_SAVE_TO_SENT` | ❌ | 是否保存到已发送 | `true` |
| `EMAIL_CHECK_WORKDAY` | ❌ | 是否检查工作日 | `true` |

### Server酱通知配置（可选）

| 变量名 | 必填 | 说明 | 获取地址 |
|--------|------|------|----------|
| `SERVERCHAN_KEY` | ❌ | Server酱SendKey | https://sct.ftqq.com/ |

---

## Server酱通知配置说明

Server酱用于青龙面板任务执行结果通知（微信推送）。

### 1. 获取SendKey

1. 访问 [Server酱官网](https://sct.ftqq.com/)
2. 使用微信登录
3. 复制你的 SendKey

### 2. 配置环境变量

在 `.env` 文件中添加：

```bash
SERVERCHAN_KEY=your_sendkey_here
```

### 3. 使用方式

Server酱会在以下场景自动推送通知：
- 青龙面板任务执行成功/失败（通过 `ql-task.sh` 脚本）
- 推送内容包括：任务状态、执行时间、日志摘要

**手动调用：**
```bash
node send-serverchan.js "成功" "./data/ql-task-20260211.log"
```

参数说明：
- 第一个参数：任务状态（成功/失败）
- 第二个参数：日志文件路径（可选）

---

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

## Docker 操作青龙面板指南

### 1. 准备环境

- 已安装 Docker（Windows/Mac 推荐使用 Docker Desktop）
- 服务器需开放青龙面板端口（默认 5700）

### 2. 拉取并启动青龙面板

```bash
# 拉取镜像
docker pull whyour/qinglong:latest

# 创建并启动容器（示例映射端口 5700）
docker run -dit \
  --name qinglong \
  -p 5700:5700 \
  -v /ql/data:/ql/data \
  --restart unless-stopped \
  whyour/qinglong:latest
```

### 3. 初始化并登录面板

1. 浏览器访问：`http://服务器IP:5700`
2. 按提示完成初始化（设置用户名/密码）
3. 进入「依赖管理」安装 Node 依赖（如需）

### 4. 拉取本项目到青龙面板

方式一：面板中「订阅管理」

1. 进入「订阅管理」
2. 添加订阅，填写你的仓库地址
3. 勾选「自动拉取」或手动执行

方式二：容器内手动拉取

```bash
# 进入容器
docker exec -it qinglong bash

# 进入脚本目录
cd /ql/data/scripts

# 克隆仓库
git clone <你的仓库地址>
```

### 5. 配置环境变量

在青龙面板「环境变量」中添加邮件配置（见上文“邮件功能使用说明”）。

### 6. 添加定时任务

在「定时任务」中新增：

| 字段 | 值 |
|------|-----|
| **名称** | 生成日报并发送 |
| **命令** | `npm run download-work-record && node generate-report.js day && node send-email.js` |
| **定时规则** | `0 18 * * *` |

### 7. 日志与排障

- 「定时任务」中查看执行日志
- 常见问题优先检查：环境变量、网络、邮箱授权码

### 8. 升级与维护

```bash
# 停止并删除旧容器
docker stop qinglong
docker rm qinglong

# 拉取新镜像并重新启动
docker pull whyour/qinglong:latest
docker run -dit \
  --name qinglong \
  -p 5700:5700 \
  -v /ql/data:/ql/data \
  --restart unless-stopped \
  whyour/qinglong:latest
```

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


