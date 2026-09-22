'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const { removeFile, getWorkRecordPath } = require('./service/index');
const { TENCENT_DOCS_ID, TENCENT_DOCS_TOKEN } = require('./config/index');

const MCP_API_URL = 'https://docs.qq.com/openapi/mcp';
const POLL_INTERVAL = 3000;
const MAX_POLL_RETRIES = 60;

/**
 * 下载工作记录excel数据
 */
class DownloadWorkRecord {
  /**
   * 校验腾讯文档 MCP 配置
   */
  static validateConfig() {
    const missingConfigs = [];
    if (!TENCENT_DOCS_ID) missingConfigs.push('TENCENT_DOCS_ID');
    if (!TENCENT_DOCS_TOKEN) missingConfigs.push('TENCENT_DOCS_TOKEN');

    if (missingConfigs.length > 0) {
      throw new Error(`缺少环境变量：${missingConfigs.join('、')}`);
    }
  }

  /**
   * 调用腾讯文档 MCP API
   * @param {string} toolName MCP 工具名
   * @param {object} args 工具参数
   * @returns {Promise<object>}
   */
  static async callMcpApi(toolName, args) {
    try {
      const response = await axios({
        method: 'POST',
        url: MCP_API_URL,
        headers: {
          Authorization: TENCENT_DOCS_TOKEN,
          'Content-Type': 'application/json;charset=UTF-8',
        },
        data: {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
          id: Date.now(),
        },
        timeout: 30000,
      });
      const rpcResponse = response.data;

      if (rpcResponse.error) {
        const message =
          rpcResponse.error.message || JSON.stringify(rpcResponse.error);
        throw new Error(
          `MCP API Error (${rpcResponse.error.code}): ${message}`,
        );
      }

      const result = rpcResponse.result;
      if (!result) return rpcResponse;
      if (result.structuredContent) return result.structuredContent;

      if (Array.isArray(result.content)) {
        const textContent = result.content.find((item) => item.type === 'text');
        if (textContent && textContent.text) {
          try {
            return JSON.parse(textContent.text);
          } catch {
            return { text: textContent.text };
          }
        }
      }

      return result;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `腾讯文档 MCP HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * 创建腾讯文档导出任务
   * @returns {Promise<string>} task_id
   */
  static async createExportTask() {
    console.info('----> 开始创建腾讯文档 MCP 导出任务');
    const result = await DownloadWorkRecord.callMcpApi('manage.export_file', {
      file_id: TENCENT_DOCS_ID,
    });

    if (!result.task_id) {
      throw new Error('腾讯文档 MCP 未返回 task_id');
    }

    console.info(`----> 腾讯文档 MCP 导出任务创建成功：${result.task_id}`);
    return result.task_id;
  }

  /**
   * 轮询腾讯文档导出进度并取得签名下载 URL
   * @param {string} taskId 导出任务 ID
   * @returns {Promise<string>}
   */
  static async getDownloadUrl(taskId) {
    for (let retry = 0; retry < MAX_POLL_RETRIES; retry++) {
      if (retry > 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }

      const result = await DownloadWorkRecord.callMcpApi(
        'manage.export_progress',
        { task_id: taskId },
      );
      const progress = Number(result.progress || 0);
      console.info(`----> 腾讯文档导出进度：${progress}%`);

      if (result.error) {
        throw new Error(`腾讯文档导出失败：${result.error}`);
      }

      if (progress >= 100) {
        if (!result.file_url) {
          throw new Error('腾讯文档导出完成，但未返回 file_url');
        }
        console.info('----> 腾讯文档签名下载 URL 获取成功');
        return result.file_url;
      }
    }

    throw new Error('获取腾讯文档下载链接超时（约 3 分钟）');
  }

  /**
   * 通过签名 URL 获取腾讯文档文件流
   * @param {string} downloadUrl 签名下载 URL
   * @returns {Promise<import('stream').Readable>}
   */
  static async getDocsStream(downloadUrl) {
    console.info('----> 开始获取腾讯文档文件流');
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
    });
    console.info('----> 获取腾讯文档文件流成功');
    return response.data;
  }

  /**
   * 腾讯文档文件流写入本地
   * @param {string} repositoryPath 本地文件路径
   * @param {import('stream').Readable} docsStream 文件流
   */
  static async writeDocs(repositoryPath, docsStream) {
    console.info('----> 开始将腾讯文档文件流写入本地');
    await fs.promises.mkdir(path.dirname(repositoryPath), { recursive: true });
    await pipeline(docsStream, fs.createWriteStream(repositoryPath));
    console.info('----> 腾讯文档文件流写入本地成功');
  }

  /**
   * 下载工作记录 Excel
   */
  static async main() {
    const repositoryPath = getWorkRecordPath();
    const temporaryPath = `${repositoryPath}.download`;

    try {
      DownloadWorkRecord.validateConfig();
      await removeFile(temporaryPath);
      const taskId = await DownloadWorkRecord.createExportTask();
      const downloadUrl = await DownloadWorkRecord.getDownloadUrl(taskId);
      const docsStream = await DownloadWorkRecord.getDocsStream(downloadUrl);
      await DownloadWorkRecord.writeDocs(temporaryPath, docsStream);
      await removeFile(repositoryPath);
      await fs.promises.rename(temporaryPath, repositoryPath);
      console.info(`----> 工作记录已保存：${repositoryPath}`);
    } catch (error) {
      await removeFile(temporaryPath);
      console.error(error);
      process.exitCode = 1;
    } finally {
      console.info('----> 下载工作记录 Excel 数据结束');
    }
  }
}

if (require.main === module) {
  DownloadWorkRecord.main();
}

module.exports = DownloadWorkRecord;
