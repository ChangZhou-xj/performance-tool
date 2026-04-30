/**
 * DataValidator - 数据验证器
 * 遵循 TDD 流程：先写测试，再写实现
 */

var DataValidator = {
    isEmail: function(str) {
        var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(str);
    },

    isPhone: function(str) {
        var cnMobile = /^1[3-9]\d{9}$/;
        var intl = /^\+\d{1,3}-\d{2,4}(-\d{2,4}){1,3}$/;
        return cnMobile.test(str) || intl.test(str);
    },

    isUrl: function(str) {
        var re = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
        return re.test(str);
    },

    validate: function(data, rules) {
        var errors = {};

        for (var field in rules) {
            var rule = rules[field];
            var value = data[field];

            // required 检查
            if (rule.required && (value === undefined || value === null || value === '')) {
                errors[field] = 'required';
                continue;
            }

            if (value === undefined || value === null) {
                continue; // 非必填且无值，跳过后续检查
            }

            // type 检查
            if (rule.type === 'email' && !this.isEmail(value)) {
                errors[field] = 'invalid type';
            } else if (rule.type === 'phone' && !this.isPhone(value)) {
                errors[field] = 'invalid type';
            } else if (rule.type === 'integer') {
                var num = parseInt(value, 10);
                if (isNaN(num)) {
                    errors[field] = 'invalid type';
                } else if (rule.min !== undefined && num < rule.min) {
                    errors[field] = 'out of range';
                } else if (rule.max !== undefined && num > rule.max) {
                    errors[field] = 'out of range';
                }
            }
        }

        return {
            valid: Object.keys(errors).length === 0,
            errors: errors
        };
    }
};

module.exports = DataValidator;
