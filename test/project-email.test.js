var assert = require('chai').assert;
var { dedupeByTicketNo } = require('../generate-project-email');

describe('dedupeByTicketNo()', function() {

    function makeRecord(ticketNo, content) {
        return { ticketNo: ticketNo, taskContent: content };
    }

    it('同 A8 单号只保留第一条', function() {
        var records = [
            makeRecord('KFXQ-CX-2026051300169', '前端迁移'),
            makeRecord('KFXQ-CX-2026051300169', '后端迁移'),
        ];
        var result = dedupeByTicketNo(records);
        assert.lengthOf(result, 1);
        assert.equal(result[0].taskContent, '前端迁移');
    });

    it('不同 A8 单号全部保留', function() {
        var records = [
            makeRecord('KFXQ-CX-2026051300169', '前端迁移'),
            makeRecord('KFXQ-CX-2026051300170', '后端迁移'),
        ];
        var result = dedupeByTicketNo(records);
        assert.lengthOf(result, 2);
    });

    it('无 A8 单号的记录全部保留', function() {
        var records = [
            makeRecord('', '提交1'),
            makeRecord(undefined, '提交2'),
            makeRecord(null, '提交3'),
        ];
        var result = dedupeByTicketNo(records);
        assert.lengthOf(result, 3);
    });

    it('混合场景：有单号去重，无单号全保留', function() {
        var records = [
            makeRecord('KFXQ-CX-2026051300169', '前端迁移'),
            makeRecord('', '纯提交1'),
            makeRecord('KFXQ-CX-2026051300169', '后端迁移'),
            makeRecord('', '纯提交2'),
            makeRecord('KFXQ-CX-2026051300170', '其他单据'),
        ];
        var result = dedupeByTicketNo(records);
        assert.lengthOf(result, 4);
        assert.equal(result[0].taskContent, '前端迁移');
        assert.equal(result[1].taskContent, '纯提交1');
        assert.equal(result[2].taskContent, '纯提交2');
        assert.equal(result[3].taskContent, '其他单据');
    });

    it('空列表返回空列表', function() {
        assert.lengthOf(dedupeByTicketNo([]), 0);
    });
});
