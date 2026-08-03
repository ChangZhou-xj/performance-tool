# A8 工时填报功能设计文档

> 日期：2026-08-03  
> 背景：参考其他项目 `fill_work_hours.js` / `fill_work.md` 脚本，将 A8 个人工时报告自动化能力迁移到当前绩效工具项目。  
> 核心决策：使用 Python 版 Playwright 实现浏览器自动化，Node.js 负责配置、调度和日志汇总。

---

## 1. 总体架构

新增功能围绕 **A8 工时填报服务** 展开，保持与现有项目一致的分层结构。

```text
performance-tool
├── config/index.js                  ← 新增 A8 填报环境变量
├── .env.example                     ← 新增配置示例
├── scripts/
│   ├── fill-a8-work-hours.js        ← Node.js 入口：读取配置、批量调度、日志汇总
│   └── fill-a8-work-hours.py        ← Python 核心：Playwright 浏览器自动化
├── service/
│   ├── a8-service.js                ← 已有：A8 HTTP 查询（统计功能）
│   └── a8-fill-service.js           ← 新增：Node.js 调用 Python 的封装
├── logs/
│   └── 2026-08-03-a8-fill.log       ← 执行日志
├── test/
│   ├── a8-fill-service.test.js      ← Node.js 层：参数解析、子进程调用、日志解析
│   └── fill-a8-work-hours.test.py   ← 可选：Python 层单元测试
├── docs/superpowers/specs/
│   └── 2026-08-03-a8-fill-design.md ← 本设计文档
└── package.json                     ← 新增 npm scripts
```

### 新增/修改文件清单

| 类型 | 文件 | 说明 |
|---|---|---|
| 新增 | `service/a8-fill-service.js` | 封装 Python 子进程调用，解析 stdout，处理超时/错误 |
| 新增 | `scripts/fill-a8-work-hours.js` | Node.js CLI 入口，负责账号加载、批量调度、日志写入 |
| 新增 | `scripts/fill-a8-work-hours.py` | Python 核心自动化脚本，使用 Playwright 操作浏览器 |
| 新增 | `test/a8-fill-service.test.js` | Node.js 层单元测试 |
| 新增 | `test/fill-a8-work-hours.test.py` | Python 层可选单元测试 |
| 修改 | `config/index.js` | 新增 `A8_WORK_URL`、`A8_WORK_USERNAME`、`A8_WORK_PASSWORD` 等变量 |
| 修改 | `.env.example` | 补充上述配置示例 |
| 修改 | `package.json` | 新增 `fill:a8-hours`、`fill:a8-hours:all` scripts |

---

## 2. 数据流与模块职责

### 2.1 数据流

```text
.env / a8-accounts.json / CLI 参数
        ↓
scripts/fill-a8-work-hours.js
        ↓
加载账号 → 生成账号数组
        ↓
对每个账号调用 service/a8-fill-service.js
        ↓
service/a8-fill-service.js 生成临时 JSON 文件
        ↓
spawn python3 scripts/fill-a8-work-hours.py --file temp.json
        ↓
Python Playwright 操作 A8 系统
        ↓
Python 输出 RESULT: {success, account, steps, error, screenshot}
        ↓
Node.js 解析结果，写入 logs/YYYY-MM-DD-a8-fill.log
        ↓
控制台汇总
```

### 2.2 模块职责

| 模块 | 技术栈 | 职责 |
|---|---|---|
| `config/index.js` | Node.js | 统一从 `.env` 加载 A8 填报相关配置 |
| `scripts/fill-a8-work-hours.js` | Node.js | 解析 CLI 参数；读取 `.env` 单账号或 `a8-accounts.json` 批量账号；逐条调用 service；汇总结果并写日志 |
| `service/a8-fill-service.js` | Node.js | 将账号对象序列化为临时 JSON 文件；调用 Python 子进程；解析 `RESULT:` 输出；处理超时、非零退出码、异常结果；返回结构化对象 |
| `scripts/fill-a8-work-hours.py` | Python + Playwright | 读取 JSON 参数；执行登录、门户、项目管理、工时管理、个人工时报告、模板/复制、日期填写、发送；失败时截图 |
| `test/a8-fill-service.test.js` | Node.js + Mocha/Chai | 测试 Node.js 层的参数生成、子进程调用、stdout 解析、错误处理 |
| `test/fill-a8-work-hours.test.py` | Python | 可选，对 Python 层的独立工具函数做单元测试 |

### 2.3 与现有功能的关系

- 复用现有 `.env` 配置机制，不引入新的配置加载方式。
- Python 脚本的登录 URL 和账号可与 `service/a8-service.js` 中的 `A8_LOGIN_URL`、`A8_USERNAME`、`A8_PASSWORD` 共用。
- 不修改 `service/a8-service.js` 的现有 A8 统计/查询功能。
- 新增功能独立运行，不影响日报、周报、绩效生成、邮件发送等流程。

---

## 3. 账号配置

### 3.1 环境变量（单账号默认）

在 `.env` 中新增以下配置项：

```env
# A8 工时填报配置
A8_WORK_URL=http://120.35.0.66:19995/wui/index.html#/?_key=vrtmcx
A8_WORK_USERNAME=1003854
A8_WORK_PASSWORD=xxx
A8_WORK_FILL_METHOD=template   # template 或 copy
A8_WORK_HEADLESS=true          # 是否无头模式
A8_WORK_SLOWMO=300             # Playwright slowMo（毫秒）
```

### 3.2 批量账号文件（可选）

新增 `a8-accounts.json`（默认不提交到 git，用户按需创建）：

```json
[
  {
    "name": "张三",
    "username": "1003854",
    "password": "xxx",
    "fillMethod": "template",
    "enabled": true
  },
  {
    "name": "李四",
    "username": "1003855",
    "password": "xxx",
    "fillMethod": "copy",
    "enabled": false
  }
]
```

### 3.3 配置优先级

1. CLI 参数 `--user <username>` 优先级最高：在 `a8-accounts.json` 中查找该用户名；若未找到，则回退到 `.env` 单账号。
2. 无 `--user` 且存在 `a8-accounts.json` 时，仅当显式传入 `--all` 才读取所有 `enabled: true` 的账号批量处理；不传 `--all` 时默认使用 `.env` 单账号。
3. 无 `--user` 且无 `a8-accounts.json` 时，回退到 `.env` 单账号。

### 3.4 安全

- 密码仅在 `.env` 和 `a8-accounts.json` 中保存，由用户自行管理。
- Node.js 传递给 Python 的临时 JSON 文件在 Python 执行后立即删除。
- 日志中不记录密码。

---

## 4. Python 填报流程

`scripts/fill-a8-work-hours.py` 中的核心函数 `fill_work_hours(params)` 按以下步骤执行：

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | 启动浏览器 | `sync_playwright()` + `chromium.launch()` |
| 2 | 打开登录页 | `page.goto(params['url'])` |
| 3 | 登录 | 填充 `#loginid`、 `#userpassword`，点击 `#submit` |
| 4 | 等待首页加载 | 等待若干秒，确保弹窗和菜单已渲染 |
| 5 | 关闭弹窗 | 查找 `.ant-modal-close` 或 `[class*="close"]` 元素并点击 |
| 6 | 点击门户 | 通过页面 JS 查找文本为“门户”的元素并点击 |
| 7 | 点击项目管理 | 优先用 `page.click('text=项目管理')`，失败回退到坐标点击 |
| 8 | 切换新页面 | 监听 `context.pages()`，找到 URL 含 `seeyon` 的页面 |
| 9 | 点击工时管理 | 使用 `locator('text=工时管理').first()` |
| 10 | 点击个人工时报告 | 展开“工时管理”后点击“个人工时报告” |
| 11 | 选择填写方式 | `template`：调用模板并选择“工时报告”；`copy`：复制历史记录 |
| 12 | 填写日期 | 与参考脚本一致：滚动到日期输入框、清空、打开日历、点“今日”、选择今天、点击确定 |
| 13 | 填写总体内容 | 若为空，填入“无” |
| 14 | 发送 | 查找文本为“发送”的 span 并点击 |
| 15 | 截图/清理 | 成功时可选截图；失败时截图保存；最后关闭 context |

### 4.1 关键设计决策

- 复用参考脚本中验证过的日期选择逻辑（滚动到可视区域、清空、打开日历、点今日、选日期、点确定）。
- 将 `fill_work_hours.js` 中的 `page.evaluate` 逻辑翻译为 Python 等效代码。
- 使用 `page.mouse` 和 `page.evaluate` 处理坐标点击、跨 iframe 元素查找。
- 每个关键步骤增加短暂等待（参考脚本的 `waitForTimeout` 模式），确保页面状态稳定。

### 4.2 输出格式

Python 脚本在结束时输出一行 JSON：

```json
RESULT:{"success": true, "account": "张三", "steps": ["登录成功", "项目管理打开", "工时报告填写", "发送成功"], "screenshot": null}
RESULT:{"success": false, "account": "李四", "error": "未能打开项目管理系统", "screenshot": "logs/error_1003855_2026-08-03.png"}
```

`service/a8-fill-service.js` 从 stdout 中提取以 `RESULT:` 开头的行并解析。

---

## 5. 错误处理与日志

### 5.1 Python 层错误处理

`scripts/fill-a8-work-hours.py` 整体包裹 `try-except-finally`：

- 任意步骤抛异常时，立即保存截图到 `logs/error_${username}_${date}.png`。
- 最终输出 `RESULT: {success: false, error: str(e), screenshot: path}`。
- 截图路径使用绝对路径，便于 Node.js 直接展示和日志记录。

### 5.2 Node.js 层错误处理

`service/a8-fill-service.js` 处理以下情况：

- Python 进程退出码非 0 → 标记失败。
- Python 进程超时（默认 5 分钟） → 强制 kill，标记超时。
- stdout 中未解析到 `RESULT:` 行 → 标记异常。
- 单个账号失败不影响下一个账号继续执行。

### 5.3 日志记录

Node.js 入口每天生成日志文件：

```text
logs/2026-08-03-a8-fill.log
```

日志结构为 JSON 数组：

```json
[
  { "time": "09:00:01", "message": "开始处理账号: 张三" },
  { "date": "2026-08-03", "time": "09:00:45", "account": "张三", "success": true, "fillMethod": "template" },
  { "date": "2026-08-03", "time": "09:01:10", "account": "李四", "success": false, "error": "未能打开项目管理系统", "screenshot": "logs/error_1003855_2026-08-03.png" }
]
```

控制台同时输出汇总：

```text
========== A8 工时填报结果 ==========
张三: ✓ 成功
李四: ✗ 失败 - 未能打开项目管理系统
总计: 1/2 成功, 耗时: 75秒
```

### 5.4 临时文件清理

- Node.js 生成的临时 JSON 参数文件在 `finally` 块中删除，确保 Python 崩溃或超时也能清理。
- 一天内多次执行时，日志文件追加而非覆盖。
- Python 侧的截图保留到 `logs/` 目录，便于后续排查。

---

## 6. 测试策略

### 6.1 Node.js 层测试

`test/a8-fill-service.test.js` 测试：

- 临时 JSON 文件是否正确生成。
- 调用 Python 命令是否正确。
- 成功/失败的 stdout 解析是否正确。
- 超时处理是否正确。
- 失败时是否保留截图路径。

使用 `sinon` 或 Node.js 内置 `child_process.spawn` 的 mock 实现。

### 6.2 Python 层测试

`test/fill-a8-work-hours.test.py`（可选）：

- 对独立工具函数做单元测试：
  - `get_today()`、`get_now()`
  - 模板选择逻辑
  - 日期选择逻辑
  - 总体内容填写逻辑

由于 Playwright 需要真实浏览器和页面，核心流程测试以集成测试为主。

### 6.3 集成测试

- 使用真实 A8 测试账号在非工作时间跑一次端到端验证。
- 不纳入自动化 CI，避免误操作生产数据。

### 6.4 依赖

- Python 依赖：`playwright`（可能复用现有 Python 环境，已有 `requests`）。
- Node.js 依赖：项目已有 `mocha`、`chai`。
- 可选新增 `sinon` 用于子进程 mock。
- Python 测试框架使用标准库 `unittest`（不强制引入 pytest）。

---

## 7. 部署与运行方式

### 7.1 npm scripts

在 `package.json` 中新增：

```json
{
  "scripts": {
    "fill:a8-hours": "node scripts/fill-a8-work-hours.js",
    "fill:a8-hours:all": "node scripts/fill-a8-work-hours.js --all"
  }
}
```

### 7.2 CLI 用法

```bash
# 使用 .env 单账号
npm run fill:a8-hours

# 使用 a8-accounts.json 批量处理
npm run fill:a8-hours -- --all

# 指定某个用户
npm run fill:a8-hours -- --user 1003854

# 指定日期（用于补录）
npm run fill:a8-hours -- --date 2026-08-01
```

### 7.3 青龙面板定时任务

青龙面板定时任务示例：

```bash
# 每天 18:00 自动填报（青龙面板中建议直接使用 node 命令，避免 npm run 路径问题）
0 18 * * * cd /ql/data/scripts/performance-tool && node scripts/fill-a8-work-hours.js --all
```

或：

```bash
# 使用 npm run
0 18 * * * cd /ql/data/scripts/performance-tool && npm run fill:a8-hours -- --all
```

可配合 `check-workday.js` 或项目已有的节假日判断能力，仅在工作日触发。青龙面板中推荐显式在工作日定时任务中调用，或脚本内部增加 `check-workday.js` 前置判断。

### 7.4 环境准备

运行前需要安装 Python 依赖：

```bash
pip install playwright
playwright install chromium
```

### 7.5 目录权限

- 确保 `logs/` 目录存在或可自动创建。
- 截图文件写入 `logs/` 目录。

---

## 8. 接口定义

### 8.1 `service/a8-fill-service.js` 导出

```javascript
/**
 * 为单个账号执行 A8 工时填报
 * @param {Object} account
 * @param {string} account.name 显示名称
 * @param {string} account.username 账号
 * @param {string} account.password 密码
 * @param {string} [account.fillMethod='template'] 填写方式：template 或 copy
 * @param {Object} [options={}]
 * @param {string} [options.url] A8 登录页 URL
 * @param {boolean} [options.headless=true]
 * @param {number} [options.slowMo=300]
 * @param {number} [options.timeout=300000]
 * @returns {Promise<{success: boolean, account: string, error?: string, screenshot?: string, steps?: string[]}>}
 */
async function fillWorkHoursForAccount(account, options = {});
```

### 8.2 Python 脚本参数格式

临时 JSON 文件内容（`date` 可选，默认当天）：

```json
{
  "url": "http://120.35.0.66:19995/wui/index.html#/?_key=vrtmcx",
  "username": "1003854",
  "password": "xxx",
  "name": "张三",
  "fillMethod": "template",
  "headless": true,
  "slowMo": 300,
  "date": "2026-08-03"
}
```

### 8.3 Python 输出格式

```text
RESULT:{"success": true, "account": "张三", "steps": ["..."], "screenshot": null}
RESULT:{"success": false, "account": "李四", "error": "...", "screenshot": "logs/..."}
```

---

## 9. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| A8 页面结构变化 | 自动化步骤失效 | 关键步骤使用多种选择器回退（文本、坐标、JS 查找）；失败时截图便于人工排查 |
| Python 依赖安装失败 | 功能不可用 | 在 README 中明确安装步骤；使用 `pip install playwright && playwright install chromium` |
| 多账号并发互相干扰 | 并发问题 | 按顺序逐个账号执行，不并发 |
| 密码泄露 | 安全风险 | 密码不进入日志和临时文件；临时文件立即删除 |
| 非工作日运行 | 可能误填报 | 青龙面板定时任务可配合 `check-workday.js` 仅工作日触发 |

---

## 10. 后续可扩展点

1. **对接工作记录生成内容**：未来可从 `data/work-record.xlsx` 读取当天“开发完成/任务完成”的记录，自动填入“工时总体内容”。
2. **HTTP 登录优化**：复用 `service/a8-service.js` 的 HTTP 登录获取 cookie，注入 Playwright，减少浏览器登录步骤。
3. **Server酱通知**：执行完成后调用 `send-serverchan.js` 推送结果。
4. **失败重试**：单个账号失败后支持重试 1 次。

---

*备注：用户明确本次设计阶段不自动 commit，先由用户检查变更后再进入 writing-plans 实现计划。*
