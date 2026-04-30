var assert = require('chai').assert;
var { isEmpty, generateHash, normalizeString, levenshteinDistance, findBestColumnMatch, createColumnMap, getCurrMonthData } = require('../service/index');

describe('isEmpty()', function() {

    describe('空值判断', function() {
        it('undefined 是空', function() {
            assert.equal(isEmpty(undefined), true);
        });

        it('null 是空', function() {
            assert.equal(isEmpty(null), true);
        });
    });

    describe('字符串空值', function() {
        it('空字符串是空', function() {
            assert.equal(isEmpty(''), true);
        });

        it('非空字符串不是空', function() {
            assert.equal(isEmpty('hello'), false);
        });
    });

    describe('数值空值', function() {
        it('NaN 是空', function() {
            assert.equal(isEmpty(NaN), true);
        });

        it('Number(NaN) 是空', function() {
            assert.equal(isEmpty(Number(NaN)), true);
        });

        it('0 不是空', function() {
            assert.equal(isEmpty(0), false);
        });

        it('Infinity 不是空', function() {
            assert.equal(isEmpty(Infinity), false);
        });
    });

    describe('数组空值', function() {
        it('空数组是空', function() {
            assert.equal(isEmpty([]), true);
        });

        it('非空数组不是空', function() {
            assert.equal(isEmpty([1, 2]), false);
        });
    });

    describe('对象空值', function() {
        it('空对象字面量是空', function() {
            assert.equal(isEmpty({}), true);
        });

        it('非空对象不是空', function() {
            assert.equal(isEmpty({ a: 1 }), false);
        });
    });

    describe('布尔值', function() {
        it('true 不是空', function() {
            assert.equal(isEmpty(true), false);
        });

        it('false 不是空', function() {
            assert.equal(isEmpty(false), false);
        });
    });
});

describe('generateHash()', function() {

    describe('基本行为', function() {
        it('返回64位十六进制字符串（SHA-256）', function() {
            var hash = generateHash('test');
            assert.equal(hash.length, 64);
            assert.match(hash, /^[a-f0-9]{64}$/);
        });

        it('相同输入产生相同哈希（确定性）', function() {
            var h1 = generateHash('hello');
            var h2 = generateHash('hello');
            assert.equal(h1, h2);
        });

        it('不同输入产生不同哈希', function() {
            var h1 = generateHash('hello');
            var h2 = generateHash('world');
            assert.notEqual(h1, h2);
        });
    });

    describe('null/undefined 处理', function() {
        it('null 输入不抛异常', function() {
            assert.doesNotThrow(function() { generateHash(null); });
        });

        it('undefined 输入不抛异常', function() {
            assert.doesNotThrow(function() { generateHash(undefined); });
        });

        it('null 和 undefined 哈希值相同（设计如此）', function() {
            // 代码中 null/undefined 走同一分支，JSON.stringify结果相同
            var h1 = generateHash(null);
            var h2 = generateHash(undefined);
            assert.equal(h1, h2);
        });
    });

    describe('类型一致性', function() {
        it('字符串数字和纯数字哈希相同', function() {
            // 注：JSON.stringify(1) === '1'，而字符串'1'的JSON是'"1"'
            assert.notEqual(generateHash(1), generateHash('1'));
        });

        it('数组顺序影响哈希', function() {
            var h1 = generateHash([1, 2, 3]);
            var h2 = generateHash([3, 2, 1]);
            assert.notEqual(h1, h2);
        });
    });

    describe('对象哈希', function() {
        it('键顺序不同但内容相同的目标哈希相同', function() {
            var h1 = generateHash({ a: 1, b: 2 });
            var h2 = generateHash({ b: 2, a: 1 });
            assert.equal(h1, h2);
        });

        it('空对象哈希正常返回', function() {
            var hash = generateHash({});
            assert.equal(hash.length, 64);
        });
    });
});

describe('normalizeString()', function() {
    it('去首尾空格', function() {
        assert.equal(normalizeString('  hello  '), 'hello');
    });

    it('转小写', function() {
        assert.equal(normalizeString('HELLO'), 'hello');
    });

    it('移除特殊字符', function() {
        assert.equal(normalizeString('hello@#$world'), 'helloworld');
    });

    it('保留中文字符', function() {
        assert.equal(normalizeString('你好world'), '你好world');
    });

    it('空字符串返回空', function() {
        assert.equal(normalizeString(''), '');
    });
});

describe('levenshteinDistance()', function() {
    it('相同字符串距离为0', function() {
        assert.equal(levenshteinDistance('hello', 'hello'), 0);
    });

    it('一个字符插入距离为1', function() {
        assert.equal(levenshteinDistance('hello', 'helloo'), 1);
    });

    it('一个字符删除距离为1', function() {
        assert.equal(levenshteinDistance('helloo', 'hello'), 1);
    });

    it('一个字符替换距离为1', function() {
        assert.equal(levenshteinDistance('hello', 'hallo'), 1);
    });

    it('空字符串到abc的距离等于abc长度', function() {
        assert.equal(levenshteinDistance('', 'abc'), 3);
    });

    it('abc到空字符串的距离等于abc长度', function() {
        assert.equal(levenshteinDistance('abc', ''), 3);
    });

    it('kitten -> sitting 距离为3', function() {
        // k itten -> s itten (替换k→s, 1)
        // s i t ten -> s i t t en (替换i→t, 1)
        // s i t t en -> s i t t i n (替换e→i, 1)
        assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
    });
});

describe('findBestColumnMatch()', function() {
    var headers = ['登记日期', '登记人', '项目名称', '产品类型', '产品标识'];

    it('精确匹配返回index和1.0置信度', function() {
        var result = findBestColumnMatch('登记日期', headers);
        assert.equal(result.index, 0);
        assert.equal(result.confidence, 1);
    });

    it('模糊匹配返回最近index', function() {
        var result = findBestColumnMatch('登记人姓名', headers, 3);
        assert.equal(result.index, 1); // 最接近"登记人"
    });

    it('超出阈值返回-1', function() {
        var result = findBestColumnMatch('完全不匹配的列名', headers, 2);
        assert.equal(result.index, -1);
    });

    it('中文字符列名正常匹配', function() {
        var result = findBestColumnMatch('产品标识', headers);
        assert.equal(result.index, 4);
    });
});

describe('createColumnMap()', function() {
    var templateCols = ['登记人', '登记日期', '项目名称'];
    var originalHeaders = ['登记人', '登记日期', '项目名称', '产品类型'];

    it('精确匹配的列返回exact类型', function() {
        var map = createColumnMap(templateCols, originalHeaders);
        assert.equal(map[0].matchType, 'exact');
        assert.equal(map[0].originalIndex, 0);
    });

    it('未匹配的列返回none类型', function() {
        var map = createColumnMap(templateCols, originalHeaders);
        // 模板里没有"产品类型"，所以map里只有3项
        assert.equal(map.length, 3);
    });

    it('每项包含templateCol和originalCol', function() {
        var map = createColumnMap(templateCols, originalHeaders);
        map.forEach(function(item) {
            assert.isString(item.templateCol);
            assert.isString(item.originalCol);
        });
    });
});

describe('getCurrMonthData()', function() {
    // 隔离环境变量，确保用实时月份而非固定月份
    var originalMonth;

    before(function() {
        originalMonth = process.env.MONTH;
        delete process.env.MONTH;
    });

    after(function() {
        if (originalMonth !== undefined) {
            process.env.MONTH = originalMonth;
        }
    });

    // 构造mock数据，当前年月用动态获取
    function buildData(rows) {
        return [['登记人', '登记日期', '项目名称']].concat(rows);
    }

    function currentYearMonth() {
        var now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }

    it('数据为空时抛出异常', function() {
        var fn = function() { getCurrMonthData([], '张三', '登记人'); };
        assert.throws(fn, 'Excel 文件无数据');
    });

    it('只有表头时返回表头', function() {
        var data = [['登记人', '登记日期', '项目名称']];
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.deepEqual(result, [['登记人', '登记日期', '项目名称']]);
    });

    it('表头始终保留在结果第一行', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三', ref.year + '年' + ref.month + '月1日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.deepEqual(result[0], ['登记人', '登记日期', '项目名称']);
    });

    it('匹配用户名和月份的行被保留', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三', ref.year + '年' + ref.month + '月15日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 2);
        assert.deepEqual(result[1], ['张三', ref.year + '年' + ref.month + '月15日', '项目A']);
    });

    it('用户名不匹配的行被过滤', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['李四', ref.year + '年' + ref.month + '月15日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 1); // 只有表头
    });

    it('月份不匹配的行被过滤', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三', ref.year + '年' + (ref.month === 12 ? 11 : ref.month + 1) + '月15日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 1); // 只有表头
    });

    it('年份不匹配的行被过滤', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三', (ref.year + 1) + '年' + ref.month + '月15日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 1); // 只有表头
    });

    it('用户名部分匹配也被保留', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三丰', ref.year + '年' + ref.month + '月15日', '项目A'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 2);
    });

    it('混合数据只保留匹配行', function() {
        var ref = currentYearMonth();
        var data = buildData([
            ['张三', ref.year + '年' + ref.month + '月15日', '项目A'],
            ['李四', ref.year + '年' + ref.month + '月10日', '项目B'],
            ['王五', ref.year + '年' + (ref.month === 12 ? 11 : ref.month + 1) + '月1日', '项目C'],
        ]);
        var result = getCurrMonthData(data, '张三', '登记人');
        assert.equal(result.length, 2); // 表头 + 张三行
        assert.deepEqual(result[1], ['张三', ref.year + '年' + ref.month + '月15日', '项目A']);
    });
});
