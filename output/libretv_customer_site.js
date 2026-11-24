// 由 maccms-source-checker 自动生成于 2026-11-24T10:17:50.162Z
// 检测通过 31/48 个接口。仅用于个人学习研究。
const CUSTOMER_SITES = {
    juliang: {
        api: 'https://api.juliang.live/api/provide/vod',
        name: '巨量资源',
    },
    bfzyapi: {
        api: 'https://bfzyapi.com/api.php/provide/vod',
        name: '暴风资源',
    },
    lziapi: {
        api: 'https://cj.lziapi.com/api.php/provide/vod',
        name: '量子资源',
    },
    wujinapi: {
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        name: '无尽资源',
    },
    guangsuapi: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        name: '光速资源',
    },
    jyzyapi: {
        api: 'http://jyzyapi.com/api.php/provide/vod',
        name: '金鹰资源',
    },
    subocaiji: {
        api: 'https://subocaiji.com/api.php/provide/vod',
        name: '素博资源',
    },
    hongniuzy2: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        name: '红牛资源',
    },
    hhzyapi: {
        api: 'https://hhzyapi.com/api.php/provide/vod',
        name: '豪华资源',
    },
    huyaapi: {
        api: 'https://www.huyaapi.com/api.php/provide/vod',
        name: '虎牙资源',
    },
    jszyapi: {
        api: 'https://jszyapi.com/api.php/provide/vod',
        name: '极速资源',
    },
    ffzyapi: {
        api: 'https://cj.ffzyapi.com/api.php/provide/vod',
        name: '非凡资源',
    },
    moduapi: {
        api: 'https://caiji.moduapi.cc/api.php/provide/vod',
        name: '魔都资源',
    },
    rycjapi: {
        api: 'https://cj.rycjapi.com/api.php/provide/vod',
        name: '如意资源',
    },
    dyttzyapi: {
        api: 'https://caiji.dyttzyapi.com/api.php/provide/vod',
        name: '电影天堂资源',
    },
    ukuapi: {
        api: 'https://api.ukuapi.com/api.php/provide/vod',
        name: 'U酷资源',
    },
    s360zy: {
        api: 'https://360zy.com/api.php/provide/vod',
        name: '360采集',
    },
    wujinapi2: {
        api: 'https://api.wujinapi.net/api.php/provide/vod',
        name: '无尽采集',
    },
    wujinapi3: {
        api: 'https://api.wujinapi.me/api.php/provide/vod',
        name: '无尽采集2',
    },
    guangsuapi2: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        name: '光速采集',
    },
    xinlangapi: {
        api: 'https://api.xinlangapi.com/xinlangapi.php/provide//vod',
        name: '新浪采集',
    },
    ckzy: {
        api: 'https://ckzy.me/api.php/provide/vod',
        name: 'ckzy采集',
    },
    qijiyun: {
        api: 'http://cmsyun2.qijiyun.vip/api.php/provide/vod',
        name: '新4K采集',
    },
    ffzyapi2: {
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
        name: '非凡资源',
    },
    ffzy5: {
        api: 'http://ffzy5.tv/api.php/provide/vod',
        name: '🍀┃非凡┃资源',
    },
    jyzyapi2: {
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
