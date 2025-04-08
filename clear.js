'use strict';
const { clearDist } = require('./service/index');

/**
 * 清理dist目录
 */
class Clear {
  /**
   * 开始运行
   */
  static main() {
    try {
      clearDist();
    } catch (err) {
      console.error(err);
    } finally {
      console.info(`----> 清理dist目录结束`);
    }
  }
}

Clear.main();
