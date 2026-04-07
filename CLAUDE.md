# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run download-work-record   # 从腾讯文档下载工作记录到 data/work-record.xlsx
npm run report:day             # 生成日报（自动先下载工作记录）
npm run report:week            # 生成周报
npm run send-email             # 发送日报邮件（会检查是否工作日）
npm run generate-performance   # 生成绩效评估表
npm run validate-performance   # 校验绩效数据
```

环境变量需先配置 `.env`（参考 `.env.example`）。

## Architecture

**数据流：** 腾讯文档 → Excel → 解析过滤 → 生成报告/绩效 → 发送邮件

### 核心模块

- [generate-report-kf.js](generate-report-kf.js) — 报告生成主逻辑。从 Excel 读取工作记录，按用户和日期范围过滤，将任务分类为需求、缺陷、提交、评审、迁移、打包，输出 Markdown 报告到 `dist/`。
- [download-work-record.js](download-work-record.js) — 调用腾讯文档导出 API，轮询等待导出完成后下载到 `data/work-record.xlsx`。
- [send-email.js](send-email.js) — 读取最新报告文件，转换 Markdown 为 HTML，通过腾讯企业邮 SMTP 发送。发送前调用 HolidayService 判断是否工作日。

### Service 层

- [service/email-service.js](service/email-service.js) — EmailService 类，封装 SMTP 发送和 IMAP 存入已发送文件夹，包含 Markdown→HTML 样式转换。
- [service/holiday-service.js](service/holiday-service.js) — HolidayService 类，查询 `timor.tech` API 判断中国节假日/调休，带缓存和降级（默认按周末规则）。
- [service/index.js](service/index.js) — 工具函数：文件路径管理、Excel 数据过滤、列名模糊匹配、哈希生成等。

### 配置

- [config/index.js](config/index.js) — 统一加载 `.env` 中的腾讯文档凭证、用户信息、邮件配置、绩效参数。
- `.env.example` — 所有可配置项的模板，包括腾讯文档 Cookie、SMTP/IMAP 设置、收件人、Server酱通知等。

### 部署场景

设计用于**青龙面板**定时任务调度，支持 Server酱微信通知。`ql-git-pull.sh` 用于在青龙面板中拉取最新代码。
