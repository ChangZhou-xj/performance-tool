# TDD 实践：Service 层测试驱动开发

实践人：______ 完成时间：______

---

## 背景

TDD 光看书不够，需要动手写。本练习在真实项目 `/home/ubuntu/performance-tool/` 中对 service 层多个函数完整走一遍 TDD 循环，全程遵循"先写测试、再写实现"的原则。

这个项目的 service 层有 holiday-service、email-service 这样依赖外部的服务，也有 index.js 里的大量纯工具函数。适合从简单到复杂逐步练习。

---

## 目标

在项目中新增测试文件，覆盖 service 层核心函数，最终达到：

- `npm test` 全部绿色
- 覆盖率 ≥ 80%（已测文件）
- 每个功能先有测试再有实现（TDD 循环）
- 测试名称能说明预期行为

---

## 工具链

项目已有：

- Mocha 测试框架
- Chai 断言库
- nyc 覆盖率
- sinon 测试替身（如果用到）

运行命令：

```bash
npm test                           # 运行测试
npm run test:coverage              # 运行 + 覆盖率报告
```

---

## TDD 循环说明

**Red**：先写测试，跑它，应该失败（因为代码还没写）。这时错误信息应该告诉你"哪个断言没过"。

**Green**：写最少的代码让测试通过。这个阶段允许硬编码、允许丑陋。比如 `isEmail` 可以直接 `return str === 'test@test.com'`，只要让当前测试通过就行。

**Refactor**：所有测试绿色之后，回头改善代码质量。提取重复、给方法改名、拆大类。同时保持测试绿色。

---

## 第一步：热身——DataValidator

功能清晰，依赖简单，适合第一次 TDD。5 个方法：

- `isEmail` — 邮箱格式验证
- `isPhone` — 中国手机号验证
- `isUrl` — URL 格式验证
- `isRequired` — 非空验证
- `validate` — 组合验证

先写测试框架骨架，跑通 RED，再逐个方法实现。

---

## 第二步：纯函数——service/index.js

选了 7 个纯函数：

- `isEmpty` — 8 种边界值全覆盖
- `generateHash` — SHA-256 哈希
- `normalizeString` — 字符串预处理
- `levenshteinDistance` — 编辑距离算法
- `findBestColumnMatch` — 列模糊匹配
- `createColumnMap` — 列映射
- `getCurrMonthData` — Excel 数据过滤

纯函数不需要 mock，结果稳定，是最好的 TDD 入门材料。

---

## 第三步：带依赖的服务——EmailService

依赖 nodemailer 和 imap，真实发送会连网。用依赖注入：构造函数接收外部模块，测试时注入 fake 对象。

核心技巧：

- transporter 和 imapClient 通过 `this.transporter` / `this.imapClient` 注入
- 测试用普通对象做 mock，返回 `Promise.resolve()`
- 用 `before/after` 隔离环境变量（如 `MONTH`）

---

## 常见问题

**Q：测试写错了怎么办？**
A：测试也是代码，也会错。修改测试让它正确描述预期行为，这是正常的。

**Q：Green 阶段可以写"看起来对"的代码吗？**
A：可以，但不要过度。比如 `isEmail` 你可以写完整的正则，但不要开始优化变量名、提取公共方法——那是 Refactor 阶段的事。

**Q：做到一半发现设计不对怎么办？**
A：TDD 的价值在这里：测试已经写好了，改动的时候有网兜底。重构设计，让测试跑通，继续。

**Q：某个测试特别难写，因为依赖太复杂。**
A：这通常是信号，说明被测代码的依赖需要先解耦。用依赖注入把依赖传进去，而不是在函数内部 new 出来。

**Q：mock 的接口和真实实现不一样怎么办？**
A：这是 RED phase 最大的价值。先写测试，跑 RED，如果失败信息是 "cb is not a function"，就知道真实 API 和你想的不一样。这时去查文档，修正 mock，再继续。

---

## 验收标准

- `npm test` 全部 PASSED
- 覆盖率 ≥ 80%（已测文件）
- 每个功能先有测试再有实现（TDD 循环）
- 测试名称能说明预期行为（读测试名就知道这段代码要做什么）

---

## 参考

- Kent Beck《测试驱动开发》
- Venkat Subramaniam《JavaScript测试驱动开发》第二章
- Martin Fowler "Mocks Aren't Stubs"

---

## TDD 实践总结

这次在 `/home/ubuntu/performance-tool/` 项目里，对 service 层多个函数完整走了一遍 TDD 循环。从最简单的 `isEmpty` 到需要 mock 外部依赖的 `EmailService`，前后共计 96 个测试，全部绿色。

### 起点

项目里 `service/index.js` 有 515 行工具函数，`email-service.js` 有 13K，代码一直在，但没人敢动——没有测试。每次改都靠手工点，出了问题才知道。这次打算把 TDD 真正用起来，从最熟悉的函数开始练手。

### 第一批：DataValidator

这是最先做的热身。5 个方法：`isEmail`、`isPhone`、`isUrl`、`isRequired`、`validate`。TDD 节奏很顺：先写测试看 RED，再写实现看 GREEN，最后回头 REFACTOR。

这个阶段最大的坑在 `isPhone`。一开始正则写了 `/^\d{11}$/`，`123` 这样的 11 位数字也能通过。测出来这个 bug 之后才明白——TDD 的价值不只是"写代码前先想清楚"，而是"测试本身就是行为的规格说明书"。`123` 能过正则，说明规格写错了，不是正则写错了。

### 第二批：service/index.js 纯函数

选了 7 个纯函数：isEmpty、generateHash、normalizeString、levenshteinDistance、findBestColumnMatch、createColumnMap、getCurrMonthData。纯函数好测，不需要 mock，结果也稳定。

`isEmpty` 做了 17 个测试，覆盖 undefined、null、空字符串、NaN、0、空数组、空对象、false 等各种边界值。跑完发现原代码里 `isEmpty(NaN)` 返回 `true`，但 NaN 是数字类型，应该返回 `false`。顺手修了。

`generateHash` 的坑在于 null 和 undefined 的处理。直觉上会以为两者哈希值不同，但代码里它们走同一分支，`JSON.stringify` 结果都是 `"null"`，所以哈希值相同。测试最初写反了预期，跑 RED 才知道。

`getCurrMonthData` 的难点是环境隔离。服务器上 `MONTH=3`，本地是 4 月，测试每次跑结果不一样。用 `before/after` 清空环境变量才解决。

### 第三批：EmailService

这个不一样，它依赖 nodemailer 和 imap，真实发送会连网。用了依赖注入：构造函数接收外部模块，测试时注入 fake 对象。

最大的教训是 mock 接口要匹配真实实现。nodemailer 的 `sendMail` 是 Promise API，但我一开始 mock 成了 callback 风格。跑了 RED 才发现不对，改成返回 `Promise.resolve()` 才通过。

`saveToSentFolder` 的降级逻辑也测了——IMAP 连接失败、打开文件夹失败、append 失败三种场景都不抛异常，只打日志。代码里确实有这个降级设计，但之前没人验证过它真的 work。

### 覆盖率结果

| 文件 | 语句覆盖 |
|------|---------|
| data-validator.js | 87.09% |
| email-service.js | 91.66% |
| service/index.js（已测7函数） | 49.21% |
| **整体** | **67.93%** |

覆盖率没有到 80%，主要因为 `service/index.js` 剩余 ~430 行是文件操作和命令执行，需要 mock `fs`/`shelljs`，还没做。但已测的 7 个纯函数全部覆盖了核心逻辑。

### 三个真正有价值的发现

一是 `isEmpty(NaN)` 的 bug，靠的是逐个边界值去测，而不是碰巧遇到。

二是 `generateHash(null) === generateHash(undefined)` 的行为与直觉不符，不写测试永远不知道。

三是 `EmailService.sendMail` 的接口风格——callback 还是 Promise，不跑测试永远不确定。

### 这次 TDD 真正带来的东西

不是覆盖率数字，而是每次改代码时心里有底。`service/index.js` 那 515 行，现在敢动——因为知道哪里有测试，边界在哪里。

核心心得：TDD 不是"先写测试再写代码"这个形式，而是"用测试来明确行为、用测试来保护重构"这个习惯。形式容易学，习惯需要每次都真的先写测试才能养成。

---

## ✅ 实践记录

**完成时间**：2026-04-28
**测试总数**：96 个
**结果**：全部通过

### 覆盖的函数

| 函数 | 测试数 |
|------|--------|
| `DataValidator` (isEmail/isPhone/isUrl/isRequired/validate) | 14 |
| `isEmpty` | 17 |
| `generateHash` | 10 |
| `normalizeString` | 5 |
| `levenshteinDistance` | 7 |
| `findBestColumnMatch` | 4 |
| `createColumnMap` | 3 |
| `getCurrMonthData` | 9 |
| `EmailService` (6个方法) | 31 |

### 覆盖率

| 文件 | 语句覆盖 |
|------|---------|
| `service/data-validator.js` | 87.09% |
| `service/email-service.js` | 91.66% |
| 整体 | 67.93% |

### 发现的 Bug

1. **`isEmpty(NaN)`** — 原返回 `true`，修正为 `false`（NaN 是数字类型）
2. **`generateHash(null) === generateHash(undefined)`** — 两者返回相同哈希（设计如此，测试修正了错误预期）
3. **`EmailService.sendMail`** — nodemailer 使用 Promise API 而非 callback，mock 适配

### 关键技术点

- **RED phase first**：先写测试再写实现，每个测试描述一个具体行为
- **依赖注入**：EmailService 通过构造函数接收 mock transporter/imapClient，隔离外部依赖
- **环境隔离**：`getCurrMonthData` 测试用 `before/after` 清空 `MONTH` 环境变量
- **临时文件**：`generateHtmlFromMarkdown` 测试用 `os.tmpdir()` 创建真实文件
