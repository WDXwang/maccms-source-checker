// 由 maccms-source-checker 自动生成于 2026-11-19T08:02:03.742Z
// 检测通过 21/53 个接口。仅用于个人学习研究。
const CUSTOMER_SITES = {
    juliang: {
        api: 'https://api.juliang.live/api/provide/vod',
        name: '巨量资源',
    },
    wujinapi: {
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        name: '无尽资源',
    },
    hongniuzy2: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        name: '红牛资源',
    },
    hhzyapi: {
        api: 'https://hhzyapi.com/api.php/provide/vod',
        name: '豪华资源',
    },
    jszyapi: {
        api: 'https://jszyapi.com/api.php/provide/vod',
        name: '极速资源',
    },
    moduapi: {
        api: 'https://caiji.moduapi.cc/api.php/provide/vod',
        name: '魔都资源',
    },
    apibdzy: {
        api: 'https://api.apibdzy.com/api.php/provide/vod',
        name: '百度资源',
    },
    360zy: {
        api: 'https://360zy.com/api.php/provide/vod',
        name: '360采集',
    },
    ckzy: {
        api: 'https://ckzy.me/api.php/provide/vod',
        name: 'ckzy采集',
    },
    qijiyun: {
        api: 'http://cmsyun2.qijiyun.vip/api.php/provide/vod',
        name: '新4K采集',
    },
    ffzyapi: {
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
        name: '非凡资源',
    },
    ffzy: {
        api: 'http://ffzy.tv/api.php/provide/vod',
        name: '影视 | 非凡[直连]',
    },
    ffzy5: {
        api: 'http://ffzy5.tv/api.php/provide/vod',
        name: '🍀┃非凡┃资源',
    },
    jyzyapi: {
        api: 'https://jyzyapi.com/provide/vod',
        name: '金鹰┃资源',
    },
    subocj: {
        api: 'https://subocj.com/api.php/provide/vod',
        name: '速播┃资源',
    },
    maoyanapi: {
        api: 'https://api.maoyanapi.top/api.php/provide/vod',
        name: '猫眼┃资源',
    },
    bfzy2: {
        api: 'https://bfzy2.tv/api.php/provide/vod',
        name: '暴风┃资源',
    },
    gqc4: {
        api: 'https://gqc4.top/api.php/provide/vod',
        name: '共共┃青春',
    },
    qlys: {
        api: 'https://www.qlys.cc/api.php/provide/vod',
        name: '麒麟┃影音',
    },
    mdzyapi: {
        api: 'https://www.mdzyapi.com/api.php/provide/vod',
        name: '🥬魔都资源',
    },
    zuidapi: {
        api: 'https://api.zuidapi.com/api.php/provide/vod',
        name: '🥬最大资源',
    }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
