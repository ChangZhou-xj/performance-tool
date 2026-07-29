'use strict';

var assert = require('chai').assert;
var { filterCompleted, completedTaskStatuses } = require('../generate-report-kf');

describe('completedTaskStatuses', function () {

  it('包含开发完成和任务完成', function () {
    assert.isTrue(completedTaskStatuses.has('开发完成'));
    assert.isTrue(completedTaskStatuses.has('任务完成'));
  });

  it('不包含测试中和进行中', function () {
    assert.isFalse(completedTaskStatuses.has('测试中'));
    assert.isFalse(completedTaskStatuses.has('进行中'));
  });
});

describe('filterCompleted()', function () {

  it('保留开发完成和任务完成，排除其他状态', function () {
    var items = [
      { key: '1', taskStatus: '开发完成' },
      { key: '2', taskStatus: '任务完成' },
      { key: '3', taskStatus: '测试中' },
      { key: '4', taskStatus: '进行中' },
    ];
    var result = filterCompleted(items);
    assert.lengthOf(result, 2);
    assert.equal(result[0].key, '1');
    assert.equal(result[1].key, '2');
  });

  it('空数组返回空数组', function () {
    assert.lengthOf(filterCompleted([]), 0);
  });

  it('taskStatus 为空或缺失的条目被排除', function () {
    var items = [
      { key: '1', taskStatus: '开发完成' },
      { key: '2', taskStatus: '' },
      { key: '3' },
    ];
    assert.lengthOf(filterCompleted(items), 1);
  });
});
