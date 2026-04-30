'use strict';

var assert = require('chai').assert;

// ============================================================
// EmailService TDD — 使用依赖注入隔离外部模块
// ============================================================
// 测试策略：通过构造函数注入 mock 的 transporter 和 imapClient，
// 这样不需要真实发邮件，也不需要网络，就能完整测试所有逻辑分支。
// ============================================================

var EmailService = require('../service/email-service');

// ------------------------------------------------------------
// 构造一个被测的 EmailService，注入 fake 模块
// ------------------------------------------------------------
function makeService(overrides) {
    var transporter = {
        sendMail: function(opts) { return Promise.resolve({ messageId: 'fake-id' }); }
    };
    var imapClient = {
        once: function() {},
        openBox: function(name, mode, cb) { cb(null, {}); },
        append: function(buf, opts, cb) { cb(null); },
        end: function() {}
    };
    var config = {
        host: 'smtp.test.com',
        port: 465,
        secure: true,
        user: 'test@example.com',
        password: 'testpass',
        from: 'test@example.com',
        saveToSent: true,
        sentFolder: 'Sent Messages'
    };
    // 合并用户覆盖
    if (overrides) {
        if (overrides.transporter) transporter = overrides.transporter;
        if (overrides.imapClient) imapClient = overrides.imapClient;
        if (overrides.config) config = Object.assign({}, config, overrides.config);
    }
    var svc = new EmailService(config);
    svc.transporter = transporter;
    svc.imapClient = imapClient;
    return svc;
}

// ============================================================
// buildRFC822Message()
// ============================================================
describe('EmailService.buildRFC822Message()', function() {

    it('生成包含 From/To/Subject 的邮件头', function() {
        var svc = makeService();
        var buf = svc.buildRFC822Message({
            from: 'a@b.com',
            to: 'c@d.com',
            subject: 'Test Subject',
            html: '<p>hello</p>'
        });
        var str = buf.toString('utf8');
        assert.include(str, 'From: a@b.com');
        assert.include(str, 'To: c@d.com');
        assert.include(str, 'Subject: Test Subject');
    });

    it('to 是数组时展开为逗号分隔', function() {
        var svc = makeService();
        var buf = svc.buildRFC822Message({
            from: 'a@b.com',
            to: ['c@d.com', 'e@f.com'],
            subject: 'Test',
            html: '<p>x</p>'
        });
        var str = buf.toString('utf8');
        assert.include(str, 'c@d.com, e@f.com');
    });

    it('包含 CC 时输出 CC 头', function() {
        var svc = makeService();
        var buf = svc.buildRFC822Message({
            from: 'a@b.com',
            to: 'c@d.com',
            cc: 'e@f.com',
            subject: 'Test',
            html: '<p>x</p>'
        });
        var str = buf.toString('utf8');
        assert.include(str, 'Cc: e@f.com');
    });

    it('不包含 CC 时不输出 CC 头', function() {
        var svc = makeService();
        var buf = svc.buildRFC822Message({
            from: 'a@b.com',
            to: 'c@d.com',
            subject: 'Test',
            html: '<p>x</p>'
        });
        var str = buf.toString('utf8');
        assert.notInclude(str, 'Cc:');
    });

    it('返回 Buffer 类型', function() {
        var svc = makeService();
        var buf = svc.buildRFC822Message({
            from: 'a@b.com', to: 'c@d.com', subject: 'T', html: '<p>x</p>'
        });
        assert.instanceOf(buf, Buffer);
    });
});

// ============================================================
// escapeHtml()
// ============================================================
describe('EmailService.escapeHtml()', function() {

    it('转义 &', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('a&b'), 'a&amp;b');
    });

    it('转义 <', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('a<b'), 'a&lt;b');
    });

    it('转义 >', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('a>b'), 'a&gt;b');
    });

    it('转义双引号', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('a"b'), 'a&quot;b');
    });

    it('转义单引号', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml("a'b"), 'a&#039;b');
    });

    it('多个特殊字符同时转义', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('<a href="x">&copy;</a>'),
                     '&lt;a href=&quot;x&quot;&gt;&amp;copy;&lt;/a&gt;');
    });

    it('纯文本不变化', function() {
        var svc = makeService();
        assert.equal(svc.escapeHtml('hello world'), 'hello world');
    });
});

// ============================================================
// convertToHtml()
// ============================================================
describe('EmailService.convertToHtml()', function() {

    it('空行被跳过', function() {
        var svc = makeService();
        var html = svc.convertToHtml('hello\n\nworld');
        assert.notInclude(html, '<div></div>');
        assert.include(html, 'hello');
    });

    it('章节标题（一、二、三）包装为 section-title', function() {
        var svc = makeService();
        var html = svc.convertToHtml('一、基本情况');
        assert.include(html, 'section-title');
        assert.include(html, '一、基本情况');
    });

    it('数字编号行（一、1、2）包装为 normal-text', function() {
        var svc = makeService();
        var html = svc.convertToHtml('1、这是工作内容');
        assert.include(html, 'normal-text');
    });

    it('暂无 包装为 empty-text', function() {
        var svc = makeService();
        var html = svc.convertToHtml('暂无');
        assert.include(html, 'empty-text');
    });

    it('暂无。 也包装为 empty-text', function() {
        var svc = makeService();
        var html = svc.convertToHtml('暂无。');
        assert.include(html, 'empty-text');
    });

    it('普通文本包装为 normal-text', function() {
        var svc = makeService();
        var html = svc.convertToHtml('这是一段普通文本');
        assert.include(html, 'normal-text');
    });

    it('多行内容逐行处理', function() {
        var svc = makeService();
        var html = svc.convertToHtml('一、概况\n今天做了很多事\n暂无');
        assert.include(html, 'section-title');
        assert.include(html, 'normal-text');
        assert.include(html, 'empty-text');
    });
});

// ============================================================
// generateHtmlFromMarkdown()
// ============================================================
describe('EmailService.generateHtmlFromMarkdown()', function() {

    var fs = require('fs');
    var path = require('path');
    var os = require('os');

    var tmpFile;

    beforeEach(function() {
        // 每个测试前创建临时文件
        tmpFile = path.join(os.tmpdir(), 'test-email-' + Date.now() + '.md');
    });

    afterEach(function() {
        if (tmpFile && fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    });

    it('文件不存在时抛出异常', function() {
        var svc = makeService();
        assert.throws(function() {
            svc.generateHtmlFromMarkdown('/not/exist/file.md');
        }, '文件不存在');
    });

    it('返回完整 HTML 文档结构', function() {
        fs.writeFileSync(tmpFile, '一、测试报告\n1、完成XX功能');
        var svc = makeService();
        var html = svc.generateHtmlFromMarkdown(tmpFile);
        assert.include(html, '<!DOCTYPE html>');
        assert.include(html, '<html>');
        assert.include(html, '</html>');
        assert.include(html, 'charset="utf-8"');
    });

    it('包含邮件容器样式', function() {
        fs.writeFileSync(tmpFile, '一、测试报告');
        var svc = makeService();
        var html = svc.generateHtmlFromMarkdown(tmpFile);
        assert.include(html, 'email-container');
        assert.include(html, 'Microsoft YaHei');
    });

    it('内容被正确转换', function() {
        fs.writeFileSync(tmpFile, '一、测试报告\n暂无');
        var svc = makeService();
        var html = svc.generateHtmlFromMarkdown(tmpFile);
        assert.include(html, '一、测试报告');
        assert.include(html, '暂无');
    });
});

// ============================================================
// sendMail()
// ============================================================
describe('EmailService.sendMail()', function() {

    it('使用配置的 from 作为默认发件人', async function() {
        var capturedOpts = null;
        var svc = makeService({
            transporter: {
                sendMail: function(opts) { capturedOpts = opts; return Promise.resolve({ messageId: 'id' }); }
            }
        });

        await svc.sendMail({ to: 'c@d.com', subject: 'T', html: '<p>x</p>' });

        assert.equal(capturedOpts.from, 'test@example.com');
    });

    it('调用 transporter.sendMail 传入正确参数', async function() {
        var capturedOpts = null;
        var svc = makeService({
            transporter: {
                sendMail: function(opts) { capturedOpts = opts; return Promise.resolve({ messageId: 'id' }); }
            }
        });

        await svc.sendMail({
            from: 'custom@example.com',
            to: 'c@d.com',
            cc: 'e@f.com',
            subject: 'Test Subject',
            html: '<p>content</p>',
            attachments: [{ filename: 'a.txt' }]
        });

        assert.equal(capturedOpts.from, 'custom@example.com');
        assert.equal(capturedOpts.to, 'c@d.com');
        assert.equal(capturedOpts.cc, 'e@f.com');
        assert.equal(capturedOpts.subject, 'Test Subject');
        assert.equal(capturedOpts.html, '<p>content</p>');
        assert.lengthOf(capturedOpts.attachments, 1);
    });

    it('返回 success:true 和 messageId', async function() {
        var svc = makeService({
            transporter: {
                sendMail: function(opts) { return Promise.resolve({ messageId: 'msg-123' }); }
            }
        });

        var result = await svc.sendMail({ to: 'c@d.com', subject: 'T', html: '<p>x</p>' });

        assert.isTrue(result.success);
        assert.equal(result.messageId, 'msg-123');
    });

    it('transporter 抛异常时向上抛出', async function() {
        var svc = makeService({
            transporter: {
                sendMail: function(opts) { return Promise.reject(new Error('SMTP error')); }
            }
        });

        try {
            await svc.sendMail({ to: 'c@d.com', subject: 'T', html: '<p>x</p>' });
            assert.fail('should have thrown');
        } catch (e) {
            assert.include(e.message, 'SMTP error');
        }
    });

    it('saveToSent=false 时跳过保存', async function() {
        var saved = false;
        var svc = makeService({
            transporter: {
                sendMail: function(opts) { return Promise.resolve({ messageId: 'id' }); }
            },
            imapClient: {
                once: function() {},
                openBox: function(n, m, cb) { cb(null, {}); },
                append: function(b, o, cb) { saved = true; cb(null); },
                end: function() {}
            }
        });

        await svc.sendMail({
            to: 'c@d.com', subject: 'T', html: '<p>x</p>', saveToSent: false
        });

        assert.isFalse(saved);
    });
});

// ============================================================
// saveToSentFolder()
// ============================================================
describe('EmailService.saveToSentFolder()', function() {

    it('IMAP 连接失败时不抛异常（降级）', async function() {
        var svc = makeService({
            imapClient: {
                once: function(evt, cb) {
                    if (evt === 'error') cb(new Error('IMAP failed'));
                },
                connect: function() {}
            }
        });

        // 不应抛异常
        await svc.saveToSentFolder({ from: 'a@b.com', to: 'c@d.com', subject: 'T', html: '<p>x</p>' });
    });

    it('openBox 失败时降级不抛异常', async function() {
        var svc = makeService({
            imapClient: {
                once: function(evt, cb) {
                    if (evt === 'ready') cb();
                },
                openBox: function(name, mode, cb) { cb(new Error('box error')); },
                end: function() {}
            }
        });

        await svc.saveToSentFolder({ from: 'a@b.com', to: 'c@d.com', subject: 'T', html: '<p>x</p>' });
    });

    it('append 成功时打印日志', async function() {
        var ended = false;
        var svc = makeService({
            imapClient: {
                once: function(evt, cb) { if (evt === 'ready') cb(); },
                openBox: function(n, m, cb) { cb(null, {}); },
                append: function(b, o, cb) { cb(null); },
                end: function() { ended = true; }
            }
        });

        await svc.saveToSentFolder({ from: 'a@b.com', to: 'c@d.com', subject: 'T', html: '<p>x</p>' });
        assert.isTrue(ended);
    });
});
