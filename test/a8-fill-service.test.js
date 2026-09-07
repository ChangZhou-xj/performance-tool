'use strict';

const EventEmitter = require('events');
const { expect } = require('chai');
const { fillWorkHoursForAccount } = require('../service/a8-fill-service');

/**
 * 构造一个假的 child_process.spawn，用于在不启动真实 Python/浏览器的情况下
 * 验证重试逻辑。按 responses 顺序，每次调用返回一个预设结果。
 * @param {Array<{stdout?:string, stderr?:string, code?:number, error?:Error}>} responses
 * @returns {{spawn: Function, calls: number}}
 */
function makeFakeSpawn(responses) {
  const state = { calls: 0 };
  const queue = responses.slice();
  state.spawn = function fakeSpawn() {
    state.calls += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const resp = queue.length ? queue.shift() : { code: 1, stdout: '' };
    setImmediate(() => {
      if (resp.error) {
        child.emit('error', resp.error);
        return;
      }
      if (resp.stdout) child.stdout.emit('data', Buffer.from(resp.stdout, 'utf-8'));
      if (resp.stderr) child.stderr.emit('data', Buffer.from(resp.stderr, 'utf-8'));
      child.emit('close', resp.code === undefined ? 0 : resp.code);
    });
    return child;
  };
  return state;
}

function resultLine(obj) {
  return `RESULT:${JSON.stringify(obj)}\n`;
}

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

describe('a8-fill-service 重试（应对 A8 服务端间歇性慢导致历史记录加载失败）', () => {
  const account = { name: '张三', username: '1003854', password: 'xxx' };

  it('发送前的失败（如未找到历史记录）应重试，第二次成功即返回成功', async () => {
    const fake = makeFakeSpawn([
      {
        stdout: resultLine({
          success: false,
          account: '张三',
          error: '未找到历史记录(htmlLen=27)',
          steps: ['打开登录页', '登录成功', '点击个人工时报告'],
        }),
      },
      {
        stdout: resultLine({
          success: true,
          account: '张三',
          steps: ['打开登录页', '发送成功'],
        }),
      },
    ]);

    const result = await fillWorkHoursForAccount(account, {
      url: 'http://example.com',
      attempts: 2,
      spawnFn: fake.spawn,
    });

    expect(fake.calls).to.equal(2);
    expect(result.success).to.equal(true);
  });

  it('已到达「发送成功」的失败不得重试，避免重复提交工时', async () => {
    const fake = makeFakeSpawn([
      {
        stdout: resultLine({
          success: false,
          account: '张三',
          error: '发送后页面异常',
          steps: ['打开登录页', '发送成功'],
        }),
      },
      { stdout: resultLine({ success: true, account: '张三', steps: ['发送成功'] }) },
    ]);

    const result = await fillWorkHoursForAccount(account, {
      url: 'http://example.com',
      attempts: 3,
      spawnFn: fake.spawn,
    });

    expect(fake.calls).to.equal(1);
    expect(result.success).to.equal(false);
  });

  it('Python 无法启动（环境缺依赖）不应重试，立即返回', async () => {
    const fake = makeFakeSpawn([
      { error: new Error('spawn python3 ENOENT') },
      { stdout: resultLine({ success: true, account: '张三' }) },
    ]);

    const result = await fillWorkHoursForAccount(account, {
      url: 'http://example.com',
      attempts: 3,
      spawnFn: fake.spawn,
    });

    expect(fake.calls).to.equal(1);
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/启动 Python 失败/);
  });

  it('attempts=1 时不重试（保持旧行为）', async () => {
    const fake = makeFakeSpawn([
      {
        stdout: resultLine({
          success: false,
          account: '张三',
          error: '未找到历史记录',
          steps: ['打开登录页'],
        }),
      },
      { stdout: resultLine({ success: true, account: '张三' }) },
    ]);

    const result = await fillWorkHoursForAccount(account, {
      url: 'http://example.com',
      attempts: 1,
      spawnFn: fake.spawn,
    });

    expect(fake.calls).to.equal(1);
    expect(result.success).to.equal(false);
  });

  it('多次均失败时返回最后一次结果，并标注重试次数', async () => {
    const fake = makeFakeSpawn([
      {
        stdout: resultLine({ success: false, account: '张三', error: '未找到历史记录', steps: ['打开登录页'] }),
      },
      {
        stdout: resultLine({ success: false, account: '张三', error: '未找到历史记录', steps: ['打开登录页'] }),
      },
    ]);

    const result = await fillWorkHoursForAccount(account, {
      url: 'http://example.com',
      attempts: 2,
      spawnFn: fake.spawn,
    });

    expect(fake.calls).to.equal(2);
    expect(result.success).to.equal(false);
    expect(result.error).to.match(/重试/);
  });
});
