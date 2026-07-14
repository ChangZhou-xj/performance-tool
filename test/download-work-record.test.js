var assert = require('chai').assert;

// 必须在 require('../download-work-record') 之前 mock service/index：
// download-work-record.js 顶层以解构方式导入 removeFile / getWorkRecordPath，
// 解构取的是 require('./service/index') 返回对象上的属性，
// 因此先改写该对象属性，解构即拿到 mock 值，避免删除真实 data/work-record.xlsx。
var service = require('../service/index');
var originalRemoveFile = service.removeFile;
var originalGetWorkRecordPath = service.getWorkRecordPath;
service.removeFile = async function () {}; // no-op
service.getWorkRecordPath = function () { return '/tmp/mock-work-record.xlsx'; };

var { DownloadWorkRecord } = require('../download-work-record');

// 立即恢复 service 对象，避免影响后续测试文件；
// download-work-record.js 内部已通过解构拿到 mock 值，不受恢复影响。
service.removeFile = originalRemoveFile;
service.getWorkRecordPath = originalGetWorkRecordPath;

describe('DownloadWorkRecord.main() 退出码', function () {
  var originalExit;
  var exitCode;
  var originals = {};

  beforeEach(function () {
    originalExit = process.exit;
    exitCode = undefined;
    process.exit = function (code) { exitCode = code; };

    originals.getOperationId = DownloadWorkRecord.getOperationId;
    originals.getDownloadUrl = DownloadWorkRecord.getDownloadUrl;
    originals.getDocsStream = DownloadWorkRecord.getDocsStream;
    originals.writeDocs = DownloadWorkRecord.writeDocs;
  });

  afterEach(function () {
    process.exit = originalExit;
    DownloadWorkRecord.getOperationId = originals.getOperationId;
    DownloadWorkRecord.getDownloadUrl = originals.getDownloadUrl;
    DownloadWorkRecord.getDocsStream = originals.getDocsStream;
    DownloadWorkRecord.writeDocs = originals.writeDocs;
  });

  it('认证失败（403）时以退出码 1 退出', async function () {
    DownloadWorkRecord.getOperationId = async function () {
      throw { msg: '用户身份认证失败', ret: 403 };
    };

    await DownloadWorkRecord.main();

    assert.equal(exitCode, 1, '认证失败应 process.exit(1)');
  });

  it('下载链接获取超时时以退出码 1 退出', async function () {
    DownloadWorkRecord.getOperationId = async function () { return 'op-id'; };
    DownloadWorkRecord.getDownloadUrl = async function () {
      throw new Error('获取腾讯在线文档下载链接超时');
    };

    await DownloadWorkRecord.main();

    assert.equal(exitCode, 1, '下载失败应 process.exit(1)');
  });

  it('全部成功时不调用 process.exit', async function () {
    DownloadWorkRecord.getOperationId = async function () { return 'op-id'; };
    DownloadWorkRecord.getDownloadUrl = async function () { return 'url'; };
    DownloadWorkRecord.getDocsStream = async function () { return {}; };
    DownloadWorkRecord.writeDocs = async function () {};

    await DownloadWorkRecord.main();

    assert.isUndefined(exitCode, '成功时不应 process.exit');
  });
});
