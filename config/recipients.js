'use strict';

/**
 * 抄送人配置
 * 所有人员邮箱映射，用于根据姓名查找邮箱
 */
const recipients = [
  { name: '范文林', email: 'fanwenlin@bosssoft.com.cn' },
  { name: '田磊', email: 'tianlei@bosssoft.com.cn' },
  { name: '单聪聪', email: 'shancongcong@bosssoft.com.cn' },
  { name: '陈鑫', email: 'chenxin_cx@bosssoft.com.cn', alias: '陈鑫（财信）' },
  { name: '程献帅', email: 'chengxianshuai@bosssoft.com.cn' },
  { name: '荀磊', email: 'xunlei@bosssoft.com.cn' },
  { name: '赵品强', email: 'zhaopinqiang@bosssoft.com.cn' },
  { name: '尹思娟', email: 'yinsijuan@bosssoft.com.cn' },
  { name: '李名玉', email: 'limingyu@bosssoft.com.cn' },
  { name: '刘鑫宇', email: 'liuxinyu@bosssoft.com.cn' },
  { name: '杨玲玲', email: 'yanglingling@bosssoft.com.cn' },
  { name: '张猛', email: 'zhangmeng_vc@bosssoft.com.cn', alias: '张猛（财信）' },
  { name: '苏政旭', email: 'suzhengxu@bosssoft.com.cn' },
  { name: '赵玉杰', email: 'zhaoyujie@bosssoft.com.cn' },
  { name: '闫晓飞', email: 'yanxiaofei@bosssoft.com.cn' },
  { name: '黄勃', email: 'huangbo@bosssoft.com.cn' },
  { name: '丁永勇', email: 'dingyongyong@bosssoft.com.cn' },
  { name: '赵雪冬', email: 'zhaoxuedong@bosssoft.com.cn' },
  { name: '刘学亮', email: 'liuxueliang@bosssoft.com.cn' },
  { name: '杨东', email: 'yangdong@bosssoft.com.cn', alias: '杨东(研发中心-杨东)' },
  { name: '何佳浩', email: 'hejiahao@bosssoft.com.cn' },
  { name: '温建栋', email: 'wenjiandong@bosssoft.com.cn' },
  { name: '翟雨欣', email: 'zhaiyuxin@bosssoft.com.cn' },
  { name: '刘波', email: 'liubo@bosssoft.com.cn' },
  { name: '刘鑫龙', email: 'liuxinlong@bosssoft.com.cn' },
  { name: '张家亮', email: 'zhangjialiang@bosssoft.com.cn' },
  { name: '韩曌', email: 'hanzhao@bosssoft.com.cn' },
  { name: '郝建宇', email: 'haojianyu@bosssoft.com.cn' },
  { name: '黄自立', email: 'huangzili@bosssoft.com.cn' },
  { name: '吕金德', email: 'lvjinde@bosssoft.com.cn' },
  { name: '廖俊闻', email: 'liaojunwen@bosssoft.com.cn' },
  { name: '赵志伟', email: 'zhaozhiwei@bosssoft.com.cn' },
  { name: '沈亚倩', email: 'shenyaqian@bosssoft.com.cn' },
  { name: '洪岩', email: 'hongyan@bosssoft.com.cn' },
  { name: '谢康', email: 'xiekang@bosssoft.com.cn' },
  { name: '许杨', email: 'xuyang@bosssoft.com.cn' },
  { name: '张岳松', email: 'zhangyuesong@bosssoft.com.cn' },
  { name: '石焱日', email: 'shiyanri@bosssoft.com.cn' },
  { name: '陈政伟', email: 'chenzhengwei@bosssoft.com.cn' },
  { name: '许达', email: 'xuda@bosssoft.com.cn' },
  { name: '刘绍玉', email: 'liushaoyu@bosssoft.com.cn' },
  { name: '智彬', email: 'zhibin@bosssoft.com.cn' },
  { name: '李杰', email: 'lijie@bosssoft.com.cn', alias: '李杰(Kevin)' },
  { name: '王云飞', email: 'wangyunfei@bosssoft.com.cn' },
  { name: '夏铭', email: 'xiaming@bosssoft.com.cn' },
  { name: '代吉盛', email: 'daijisheng@bosssoft.com.cn' },
  { name: '赵艳新', email: 'zhaoyanxin@bosssoft.com.cn' },
  { name: '宋宇', email: 'songyu@bosssoft.com.cn' },
  { name: '郝星耀', email: 'haoxingyao@bosssoft.com.cn' },
  { name: '安新龙', email: 'anxinlong@bosssoft.com.cn' },
  { name: '刘昊鹏', email: 'liuhaopeng@bosssoft.com.cn' },
  { name: '徐燕龙', email: 'xuyanlong1@bosssoft.com.cn' },
  { name: '乐章', email: 'lezhang@bosssoft.com.cn' },
  { name: '钟皓明', email: 'zhonghaoming@bosssoft.com.cn' },
  { name: '白国浩', email: 'baiguohao@bosssoft.com.cn' },
  { name: '邸东红', email: 'didonghong@bosssoft.com.cn' },
  { name: '徐镇昇', email: 'xuzhensheng@bosssoft.com.cn' },
  { name: '周妍', email: 'zhouyan1@bosssoft.com.cn' },
  { name: '石晓璐', email: 'shixiaolu@bosssoft.com.cn' },
  { name: '谢朝阳', email: 'xiezhaoyang@bosssoft.com.cn' },
  { name: '付康', email: 'fukang@bosssoft.com.cn' },
  { name: '易遥红', email: 'yiyaohong@bosssoft.com.cn' },
  { name: '孙博亮', email: 'sunboliang@bosssoft.com.cn' },
  { name: '胡瑶越', email: 'huyaoyue@bosssoft.com.cn' },
  { name: '段晗斌', email: 'duanhanbin@bosssoft.com.cn' },
  { name: '高若云', email: 'gaoruoyun@bosssoft.com.cn' },
  { name: '王文辉', email: 'wangwenhui@bosssoft.com.cn' },
  { name: '孙玉波', email: 'sunyubo@bosssoft.com.cn' },
  { name: '许晓飞', email: 'xuxiaofei@bosssoft.com.cn' },
  { name: '胡艳闯', email: 'huyanchuang@bosssoft.com.cn' },
  { name: '周兴杰', email: 'zhouxingjie@bosssoft.com.cn' },
  { name: '王帆', email: 'wangfan@bosssoft.com.cn' },
  { name: '毕泽生', email: 'bizesheng@bosssoft.com.cn' },
  { name: '史旭升', email: 'shixusheng@bosssoft.com.cn' },
  { name: '贾武先', email: 'jiawuxian@bosssoft.com.cn' },
  { name: '石玉青', email: 'shiyuqing@bosssoft.com.cn' },
  { name: '丁立平', email: 'dingliping@bosssoft.com.cn' },
  { name: '安雪', email: 'anxue@bosssoft.com.cn' },
  { name: '韩云', email: 'hanyun@bosssoft.com.cn' },
  { name: '徐旭男', email: 'xuxunan@bosssoft.com.cn' },
  { name: '刘洁', email: 'liujie1@bosssoft.com.cn' },
  { name: '谢正飞', email: 'xiezhengfei@bosssoft.com.cn' },
  { name: '穆策策', email: 'mucece@bosssoft.com.cn' },
  { name: '贾明稳', email: 'jiamingwen@bosssoft.com.cn' },
  { name: '姜立文', email: 'jiangliwen@bosssoft.com.cn' },
  { name: '宗婷婷', email: 'zongtingting@bosssoft.com.cn' },
  { name: '刘爽', email: 'liushuang1@bosssoft.com.cn' },
  { name: '彭义', email: 'pengyi@bosssoft.com.cn' },
  { name: '张翼鹏', email: 'zhangyipeng@bosssoft.com.cn' },
  { name: '薛庭杰', email: 'xuetingjie@bosssoft.com.cn' },
  { name: '丁亚涛', email: 'dingyatao@bosssoft.com.cn' },
  { name: '张卓', email: 'zhangzhuo@bosssoft.com.cn' },
  { name: '梁紫琼', email: 'liangziqiong@bosssoft.com.cn' },
  { name: '赵红娇', email: 'zhaohongjiao@bosssoft.com.cn' },
  { name: '冯子辉', email: 'fengzihui@bosssoft.com.cn' },
  { name: '申澳雪', email: 'shenaoxue@bosssoft.com.cn' },
  { name: '张磊', email: 'zhanglei2@bosssoft.com.cn' },
  { name: '霍晓森', email: 'huoxiaosen@bosssoft.com.cn' },
  { name: '谷光子', email: 'guguangzi@bosssoft.com.cn' },
  { name: '王永川', email: 'wangyongchuan@bosssoft.com.cn' },
  { name: '李林', email: 'lilin1@bosssoft.com.cn' },
  { name: '张海洋', email: 'zhanghaiyang@bosssoft.com.cn' },
  { name: '李志辉', email: 'lizhihui@bosssoft.com.cn' },
  { name: '马少杰', email: 'mashaojie@bosssoft.com.cn' },
  { name: '霍宇辰', email: 'huoyuchen@bosssoft.com.cn' },
  { name: '朱加航', email: 'zhujiahang1@bosssoft.com.cn' },
  { name: '陈倩', email: 'chenqian1@bosssoft.com.cn' },
  { name: '韩可', email: 'hanke@bosssoft.com.cn' },
  { name: '赵晓攻', email: 'zhaoxiaogong@bosssoft.com.cn' },
  { name: '王金阳', email: 'wangjinyang@bosssoft.com.cn', alias: '王金阳（平台开发部）' },
  { name: '杨海涛', email: 'yanghaitao@bosssoft.com.cn' },
  { name: '段晓帅', email: 'duanxiaoshuai@bosssoft.com.cn' },
  { name: '李四龙', email: 'lisilong@bosssoft.com.cn' },
  { name: '黄彦博', email: 'huangyanbo@bosssoft.com.cn' },
  { name: '李锴杰', email: 'likaijie@bosssoft.com.cn' },
  { name: '杨文员', email: 'yangwenyuan@bosssoft.com.cn' },
  { name: '姚锋', email: 'yaofeng@bosssoft.com.cn' },
  { name: '张伟东', email: 'zhangweidong@bosssoft.com.cn' },
  { name: '万义松', email: 'wanyisong@bosssoft.com.cn' },
  { name: '王鹏', email: 'wangpeng2@bosssoft.com.cn' },
  { name: '李佳宝', email: 'lijiabao@bosssoft.com.cn' },
  { name: '张慧', email: 'zhanghui1@bosssoft.com.cn' },
  { name: '牛强', email: 'niuqiang@bosssoft.com.cn' },
  { name: '占梦川', email: 'zhanmengchuan@bosssoft.com.cn' },
  { name: '田成全', email: 'tianchengquan@bosssoft.com.cn' },
  { name: '武显明', email: 'wuxianming@bosssoft.com.cn' },
  { name: '武鹏帅', email: 'wupengshuai@bosssoft.com.cn' },
  { name: '黄习恒', email: 'huangxiheng@bosssoft.com.cn' },
  { name: '邵纪伟', email: 'shaojiwei@bosssoft.com.cn' },
  { name: '张英伟', email: 'zhangyingwei@bosssoft.com.cn' },
];

/**
 * 构建姓名 → 邮箱的映射
 * 同时支持别名查找
 * @returns {Map<string, string>}
 */
function buildEmailMap() {
  const map = new Map();
  for (const recipient of recipients) {
    // 主名称
    map.set(recipient.name, recipient.email);
    // 别名（如有）
    if (recipient.alias) {
      map.set(recipient.alias, recipient.email);
    }
    // 去除括号后的短名（兼容旧逻辑）
    const shortName = recipient.name.replace(/[（(][^）)]*[）)]/g, '').trim();
    if (shortName !== recipient.name) {
      map.set(shortName, recipient.email);
    }
  }
  return map;
}

module.exports = {
  recipients,
  buildEmailMap,
};
