'use strict';
const { clearDataFiles } = require('./service/index');

/**
 * 清理data目录中的日志和Markdown文件
 */
class Clear {
  /**
   * 开始运行
   */
  static async main() {
    try {
      const filePaths = await clearDataFiles();
      console.info(`----> 已清理 ${filePaths.length} 个文件`);
    } catch (err) {
      console.error(err);
    } finally {
      console.info(`----> 清理data目录结束`);
    }
  }
}

Clear.main();
