'use strict';

/**
 * 项目问题汇报邮件配置
 * 每个项目包含：显示名称、匹配关键词、在线文档链接、分支信息、收件人
 */
const commonRecipients = [
  '黄勃<huangbo@bosssoft.com.cn>',
  '单聪聪<shancongcong@bosssoft.com.cn>',
  '廖俊闻<liaojunwen@bosssoft.com.cn>',
  '何佳浩<hejiahao@bosssoft.com.cn>',
  '赵志伟<zhaozhiwei@bosssoft.com.cn>',
  '王金阳（平台开发部）<wangjinyang@bosssoft.com.cn>',
  '初朋朋<chupengpeng@bosssoft.com.cn>',
  '张英伟<zhangyingwei@bosssoft.com.cn>',
  '田磊<tianlei@bosssoft.com.cn>',
  '刘波<liubo@bosssoft.com.cn>',
  '王娜<wang_na@bosssoft.com.cn>',
  '田浩男<tianhaonan@bosssoft.com.cn>',
];

module.exports = {
  projects: [
    {
      displayName: '福建电力职业技术学院2025年智慧财务软件实施项目',
      matchKeywords: ['福建电力'],
      onlineDocUrl: {
        label: '福建电力在线问题单',
        url: 'https://doc.weixin.qq.com/sheet/e3_AdQAega3ACcCNlkuM1jKFSoKWsiq4?scode=ALQAbQdJAA81QsDVWWAdQAega3ACc&tab=BB08J2&clickStart=1779160621896&version=5.0.8.6009&platform=win',
      },
      backendBranch: 'Pcx_Feature_20260331_fjdl',
      frontendBranch: { pc: 'Release_20260330', mobile: 'Release_20260330' },
      recipients: commonRecipients,
    },
    {
      displayName: '国家体育总局反兴奋剂中心',
      matchKeywords: ['反兴奋剂', '体育总局'],
      onlineDocUrl: {
        label: '国家体育总局反兴奋剂中心在线问题单',
        url: '',
      },
      backendBranch: 'Pcx_Feature_20260202_tyj',
      frontendBranch: {
        pc: 'Pcx_Feature_20260202_guoJiaTiYuZongJu',
        mobile: 'Feature_20251204_tiZongFanXingFenJiZhongXin',
      },
      recipients: commonRecipients,
    },
    {
      displayName: '辽宁沈阳大学项目',
      matchKeywords: ['沈阳大学'],
      onlineDocUrl: {
        label: '沈阳大学在线问题单',
        url: 'https://doc.weixin.qq.com/sheet/e3_AdQAega3ACcCNlkuM1jKFSoKWsiq4?scode=ALQAbQdJAA81QsDVWWAdQAega3ACc&tab=BB08J2&clickStart=1779106855870&version=5.0.8.6009&platform=win',
      },
      backendBranch: 'Pcx_Feature_20260331_ShenYangDaXue',
      frontendBranch: { pc: 'Release_20260330', mobile: 'Release_20260330' },
      recipients: commonRecipients,
    },
    {
      displayName: '云南个旧项目',
      matchKeywords: ['个旧'],
      onlineDocUrl: {
        label: '个旧问题记录表',
        url: 'https://docs.qq.com/sheet/DTFVSWmtWQnd4bVVX?tab=000001',
      },
      backendBranch: 'czw-1204-QXWT-CX-2026012700180',
      frontendBranch: {
        pc: 'Feature_20260120_geJiuShiZhiNengZhiChu',
        mobile: '',
      },
      recipients: commonRecipients,
    },
  ],
  emailSubject:
    'Re:辽宁沈阳大学项目、国家体育局反兴奋剂中心项目、福建电力项目、云南个旧项目问题处理情况每日汇报',
};
