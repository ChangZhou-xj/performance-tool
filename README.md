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
npm run report:day -- 2026-02-06

# 生成2026-02-06所在周的周报
npm run report:week -- 2026-02-06