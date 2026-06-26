'use strict';

const projectConfig = require('../config/project-config');

/**
 * 根据项目名称匹配到项目配置
 * 与 generate-project-email.js 口径一致：命中任一 matchKeyword 即匹配
 * @param {string} projectName - Excel 中的项目名称
 * @returns {object|null} 匹配到的项目配置
 */
function matchProject(projectName) {
  const name = String(projectName || '');
  for (const project of projectConfig.projects) {
    if (project.matchKeywords.some((kw) => name.includes(kw))) {
      return project;
    }
  }
  return null;
}

module.exports = { matchProject };
