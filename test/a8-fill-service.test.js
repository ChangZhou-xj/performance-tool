'use strict';

const { expect } = require('chai');
const { fillWorkHoursForAccount } = require('../service/a8-fill-service');

describe('a8-fill-service', () => {
  it('应成功调用 Python 脚本并解析 RESULT 输出', async () => {
    const result = await fillWorkHoursForAccount(
      { name: '张三', username: '1003854', password: 'xxx' },
      { url: 'http://example.com', dryRun: true },
    );

    expect(result).to.be.an('object');
    expect(result.success).to.equal(true);
    expect(result.account).to.equal('张三');
    expect(result.steps).to.be.an('array');
    expect(result.error).to.be.null;
    expect(result.screenshot).to.be.null;
  });

  it('缺少密码时应返回失败', async () => {
    const result = await fillWorkHoursForAccount(
      { name: '李四', username: '1003855' },
      { url: 'http://example.com' },
    );

    expect(result.success).to.equal(false);
    expect(result.error).to.equal('账号或密码缺失');
  });

  it('缺少账号和密码时应返回失败', async () => {
    const result = await fillWorkHoursForAccount({}, { url: 'http://example.com' });

    expect(result.success).to.equal(false);
    expect(result.error).to.equal('账号或密码缺失');
  });

  it('应正确传递日期参数', async () => {
    const result = await fillWorkHoursForAccount(
      { username: '1003854', password: 'xxx' },
      { url: 'http://example.com', date: '2026-08-01', dryRun: true },
    );

    expect(result.success).to.equal(true);
    expect(result.account).to.equal('1003854');
  });
});
