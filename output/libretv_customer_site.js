// 由 maccms-source-checker 自动生成于 2026-11-19T08:40:02.515Z
// 检测通过 18/48 个接口。仅用于个人学习研究。
const CUSTOMER_SITES = {
    s360zy: {
        api: 'https://360zy.com/api.php/provide/vod',
        name: '360采集',
    },
    hongniuzy2: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        name: '红牛采集',
    },
    apibdzy: {
        api: 'https://api.apibdzy.com/api.php/provide/vod',
        name: '百度采集',
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
    wujinapi: {
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        name: '无尽┃资源',
    },
    jyzyapi: {
        api: 'https://jyzyapi.com/provide/vod',
        name: '金鹰┃资源',
    },
    subocj: {
        api: 'https://subocj.com/api.php/provide/vod',
        name: '速播┃资源',
    },
    hhzyapi: {
        api: 'https://hhzyapi.com/api.php/provide/vod',
        name: '豪华┃资源',
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
