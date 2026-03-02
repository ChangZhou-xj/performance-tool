'use strict';
const axios = require('axios');
const dayjs = require('dayjs');

/**
 * 节假日判断服务
 */
class HolidayService {
  constructor() {
    this.cache = new Map();
    this.dateInfoCache = new Map();
    this.apiTimeout = 8000;
    this.maxRetries = 2;
  }

  /**
   * 带重试的HTTP请求（支持 https/http 回退）
   * @param {string[]} urls - 可回退URL列表
   * @returns {Promise<Object>} 响应data
   */
  async requestWithRetry(urls) {
    let lastError = null;

    for (const url of urls) {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response = await axios.get(url, {
            timeout: this.apiTimeout,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
              'Referer': 'https://timor.tech/'
            }
          });
          return response.data;
        } catch (error) {
          lastError = error;
          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 300 * attempt));
          }
        }
      }
    }

    throw lastError;
  }

  /**
   * 构建错误摘要
   * @param {any} error - 错误对象
   * @returns {string}
   */
  getErrorSummary(error) {
    if (!error) return '未知错误';
    const status = error.response?.status ? `HTTP ${error.response.status}` : '';
    const code = error.code || '';
    const message = error.message || String(error);
    return [status, code, message].filter(Boolean).join(' | ');
  }

  /**
   * 判断是否为工作日
   * @param {string|Date} date - 日期（YYYY-MM-DD 或 Date对象）
   * @returns {Promise<boolean>} true=工作日, false=节假日/周末
   */
  async isWorkday(date) {
    const dateStr = dayjs(date).format('YYYY-MM-DD');

    // 检查缓存
    if (this.cache.has(dateStr)) {
      return this.cache.get(dateStr);
    }

    try {
      const year = dayjs(date).year();
      const data = await this.requestWithRetry([
        `https://timor.tech/api/holiday/year/${year}`,
        `http://timor.tech/api/holiday/year/${year}`
      ]);

      if (data && data.holiday) {
        const holidays = data.holiday;
        const dateInfo = holidays[dateStr];

        if (dateInfo) {
          // wage=1表示工作日, wage=2或3表示休息日
          const isWork = dateInfo.wage === 1;
          this.cache.set(dateStr, isWork);
          return isWork;
        }
      }

      // API无数据时，降级判断：周一到周五算工作日
      const dayOfWeek = dayjs(date).day();
      const isWork = dayOfWeek >= 1 && dayOfWeek <= 5;
      this.cache.set(dateStr, isWork);
      return isWork;

    } catch (error) {
      console.warn('节假日API调用失败，使用降级方案:', this.getErrorSummary(error));

      // 降级方案：周一到周五算工作日
      const dayOfWeek = dayjs(date).day();
      const isWork = dayOfWeek >= 1 && dayOfWeek <= 5;
      this.cache.set(dateStr, isWork);
      return isWork;
    }
  }

  /**
   * 获取指定日期的详细信息
   * @param {string|Date} date - 日期
   * @returns {Promise<Object>} 日期信息
   */
  async getDateInfo(date) {
    const dateStr = dayjs(date).format('YYYY-MM-DD');

    if (this.dateInfoCache.has(dateStr)) {
      return this.dateInfoCache.get(dateStr);
    }

    try {
      const data = await this.requestWithRetry([
        `https://timor.tech/api/holiday/info/${dateStr}`,
        `http://timor.tech/api/holiday/info/${dateStr}`
      ]);

      if (data && data.code === 0) {
        const info = data.type;
        const result = {
          date: dateStr,
          isWorkday: info.type === 0 || info.type === 3, // 0=工作日, 3=调休
          type: this.getTypeText(info.type),
          name: info.name || '',
          wage: info.wage,
          description: this.getDescription(info)
        };
        this.dateInfoCache.set(dateStr, result);
        this.cache.set(dateStr, result.isWorkday);
        return result;
      }
    } catch (error) {
      console.warn('获取日期信息失败:', this.getErrorSummary(error));
    }

    // 二级降级：使用年度接口判断，优先于简单周末判断
    try {
      const isWorkday = await this.isWorkday(date);
      const dayOfWeek = dayjs(date).day();
      const result = {
        date: dateStr,
        isWorkday,
        type: isWorkday ? '工作日(降级)' : this.getDayOfWeekText(dayOfWeek),
        name: '',
        wage: isWorkday ? 1 : 2,
        description: '使用年度接口降级判断'
      };
      this.dateInfoCache.set(dateStr, result);
      return result;
    } catch (error) {
      console.warn('年度节假日接口也失败，继续使用周规则:', this.getErrorSummary(error));
    }

    // 降级方案
    const dayOfWeek = dayjs(date).day();
    const result = {
      date: dateStr,
      isWorkday: dayOfWeek >= 1 && dayOfWeek <= 5,
      type: this.getDayOfWeekText(dayOfWeek),
      name: '',
      wage: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1 : 2,
      description: '降级方案判断'
    };
    this.dateInfoCache.set(dateStr, result);
    this.cache.set(dateStr, result.isWorkday);
    return result;
  }

  /**
   * 获取类型文本
   * @param {number} type - 类型代码
   * @returns {string}
   */
  getTypeText(type) {
    const types = {
      0: '工作日',
      1: '周末',
      2: '节假日',
      3: '调休'
    };
    return types[type] || '未知';
  }

  /**
   * 获取星期文本
   * @param {number} day - 星期（0-6）
   * @returns {string}
   */
  getDayOfWeekText(day) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[day];
  }

  /**
   * 获取描述信息
   * @param {Object} info - 日期信息
   * @returns {string}
   */
  getDescription(info) {
    if (info.type === 0) {
      return '正常工作日';
    } else if (info.type === 1) {
      return '周末休息';
    } else if (info.type === 2) {
      return `${info.name || ''}假期`;
    } else if (info.type === 3) {
      return `因${info.name || ''}调休，需上班`;
    }
    return '';
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    this.dateInfoCache.clear();
  }
}

module.exports = HolidayService;
