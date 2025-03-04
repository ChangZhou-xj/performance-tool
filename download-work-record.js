'use strict';
const fs = require('fs');
const axios = require('axios');
const { removeFile, getWorkRecordPath } = require('./service/index');
const { TENCENT_DOCS_ID, TENCENT_DOCS_COOKIE } = require('./config/index');

/**
 * 下载工作记录excel数据
 */
class DownloadWorkRecord {
  /**
   * 获取腾讯在线文档操作id
   * @returns
   */
  static async getOperationId() {
    try {
      console.info('----> 开始获取腾讯在线文档操作id', TENCENT_DOCS_ID);
      let url = 'https://docs.qq.com/v1/export/export_office';
      let operationId = await axios
        .post(
          url,
          {
            docId: TENCENT_DOCS_ID,
            switches: {
              embedFonts: false,
            },
            exportType: 0,
            version: '2',
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              Cookie: TENCENT_DOCS_COOKIE,
            },
          },
        )
        .then(({ data }) => {
          if (data.ret === 0) {
            console.info(
              `----> 获取腾讯在线文档操作id成功：${data.operationId}`,
            );
            return data.operationId;
          } else {
            return Promise.reject(data);
          }
        });
      return operationId;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * 获取腾讯在线文档下载url
   * @returns
   */
  static getDownloadUrl(operationId) {
    return new Promise((resolve, reject) => {
      let timeout = 1000 * 100;
      let startTime = new Date().getTime();
      let timerId = setInterval(() => {
        console.info('----> 开始获取腾讯在线文档下载url');
        let url = 'https://docs.qq.com/v1/export/query_progress';
        axios
          .get(url, {
            headers: {
              'Content-Type': 'multipart/form-data;charset=UTF-8',
              Cookie: TENCENT_DOCS_COOKIE,
            },
            data: {
              operationId,
            },
          })
          .then(({ data }) => {
            if (data.progress === 100) {
              clearInterval(timerId);
              console.info(
                `----> 获取腾讯在线文档下载url成功：${data.file_url}`,
              );
              return resolve(data.file_url);
            }
            let currentTime = new Date().getTime();
            if (currentTime - startTime > timeout) {
              clearInterval(timerId);
              return reject(new Error('获取腾讯在线文档下载链接超时'));
            }
          })
          .catch((err) => {
            clearInterval(timerId);
            return reject(err);
          });
      }, 1000);
    });
  }

  /**
   * 获取腾讯在线文档文件流
   * @param {*} downloadUrl
   * @returns
   */
  static getDocsStream(downloadUrl) {
    return new Promise((resolve, reject) => {
      console.info('----> 开始获取腾讯在线文档文件流');
      axios
        .get(downloadUrl, {
          headers: {
            'Content-Type': 'application/octet-stream;charset=UTF-8',
            Cookie: TENCENT_DOCS_COOKIE,
          },
          responseType: 'stream',
        })
        .then(({ data }) => {
          console.info('----> 获取腾讯在线文档文件流成功');
          resolve(data);
        })
        .catch(reject);
    });
  }

  /**
   * 腾讯在线文档文件流写入本地
   * @param {*} repositoryPath
   * @param {*} docsStream
   * @returns
   */
  static writeDocs(repositoryPath, docsStream) {
    return new Promise((resolve, reject) => {
      console.info('----> 开始将腾讯在线文档文件流写入本地');
      const writeStream = fs.createWriteStream(repositoryPath);
      docsStream.pipe(writeStream);
      writeStream.on('finish', () => {
        console.info('----> 腾讯在线文档文件流写入本地成功');
        return resolve();
      });
      writeStream.on('error', reject);
    });
  }

  /**
   * 初始化
   * 1、清空源代码文件夹
   */
  static async main() {
    try {
      let repositoryPath = getWorkRecordPath();
      await removeFile(repositoryPath);
      let operationId = await DownloadWorkRecord.getOperationId();
      let downloadUrl = await DownloadWorkRecord.getDownloadUrl(operationId);
      let docsStream = await DownloadWorkRecord.getDocsStream(downloadUrl);
      await DownloadWorkRecord.writeDocs(repositoryPath, docsStream);
    } catch (err) {
      console.error(err);
    } finally {
      console.info('----> 下载仓库excel数据结束');
    }
  }
}

DownloadWorkRecord.main();
