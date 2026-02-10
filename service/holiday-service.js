'use strict';
const axios = require('axios');
const dayjs = require('dayjs');

/**
 * 节假日判断服务
 */
class HolidayService {
  constructor() {
    this.cache = new Map();
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
      // 使用免费节假日API
      // API文档: http://timor.tech/api/holiday
      const year = dayjs(date).year();
      const response = await axios.get(`http://timor.tech/api/holiday/year/${year}`, {
        timeout: 5000
      });

      if (response.data && response.data.holiday) {
        const holidays = response.data.holiday;
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
      console.warn('节假日API调用失败，使用降级方案:', error.message);
      
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
    
    try {
      const response = await axios.get(`http://timor.tech/api/holiday/info/${dateStr}`, {
        timeout: 5000
      });

      if (response.data && response.data.code === 0) {
        const info = response.data.type;
        return {
          date: dateStr,
          isWorkday: info.type === 0 || info.type === 3, // 0=工作日, 3=调休
          type: this.getTypeText(info.type),
          name: info.name || '',
          wage: info.wage,
          description: this.getDescription(info)
        };
      }
    } catch (error) {
      console.warn('获取日期信息失败:', error.message);
    }

    // 降级方案
    const dayOfWeek = dayjs(date).day();
    return {
      date: dateStr,
      isWorkday: dayOfWeek >= 1 && dayOfWeek <= 5,
      type: this.getDayOfWeekText(dayOfWeek),
      name: '',
      wage: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1 : 2,
      description: '降级方案判断'
    };
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
  }
}

module.exports = HolidayService;
