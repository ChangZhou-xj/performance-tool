var assert = require('chai').assert;
var DataValidator = require('../service/data-validator');

describe('DataValidator', function() {
    it('should pass this canary test', function() {
        assert.equal(0, 0);
    });

    // ===== isEmail =====
    describe('isEmail()', function() {
        it('returns true for valid email', function() {
            assert.equal(DataValidator.isEmail('test@example.com'), true);
        });

        it('returns false for invalid email', function() {
            assert.equal(DataValidator.isEmail('not-an-email'), false);
        });
    });

    // ===== isPhone =====
    describe('isPhone()', function() {
        it('returns true for valid Chinese mobile', function() {
            assert.equal(DataValidator.isPhone('13812345678'), true);
        });

        it('returns true for international format', function() {
            assert.equal(DataValidator.isPhone('+86-138-1234-5678'), true);
        });

        it('returns false for invalid phone', function() {
            assert.equal(DataValidator.isPhone('123'), false);
        });
    });

    // ===== isUrl =====
    describe('isUrl()', function() {
        it('returns true for valid http url', function() {
            assert.equal(DataValidator.isUrl('http://example.com'), true);
        });

        it('returns true for https url with path', function() {
            assert.equal(DataValidator.isUrl('https://example.com/path?query=1'), true);
        });

        it('returns false for invalid url', function() {
            assert.equal(DataValidator.isUrl('not-a-url'), false);
        });
    });

    // ===== validate 组合验证 =====
    describe('validate()', function() {
        it('returns valid when all fields pass', function() {
            var result = DataValidator.validate(
                { email: 'a@b.com', phone: '13900001111', age: 30 },
                {
                    email: { required: true, type: 'email' },
                    phone: { required: false, type: 'phone' },
                    age: { type: 'integer', min: 0, max: 150 }
                }
            );
            assert.equal(result.valid, true);
            assert.deepEqual(result.errors, {});
        });

        it('returns errors when required field is missing', function() {
            var result = DataValidator.validate(
                { phone: '13900001111' },
                { email: { required: true, type: 'email' } }
            );
            assert.equal(result.valid, false);
            assert.deepEqual(result.errors, { email: 'required' });
        });

        it('returns errors when field type is wrong', function() {
            var result = DataValidator.validate(
                { email: 'not-an-email' },
                { email: { required: true, type: 'email' } }
            );
            assert.equal(result.valid, false);
            assert.deepEqual(result.errors, { email: 'invalid type' });
        });

        it('returns errors when field value out of range', function() {
            var result = DataValidator.validate(
                { age: -5 },
                { age: { type: 'integer', min: 0, max: 150 } }
            );
            assert.equal(result.valid, false);
            assert.deepEqual(result.errors, { age: 'out of range' });
        });
    });
});
