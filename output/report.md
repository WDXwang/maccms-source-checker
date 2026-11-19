# 苹果CMS采集接口检测报告

- **检测时间**：2026-11-19T06:32:10.981Z
- **模式**：full（含播放流抽查）
- **结果**：20 个可用 / 共检测 32 个接口

| 状态 | 名称 | 接口地址 | 片库总数 | 搜索耗时 | 播放抽查 | 来源 |
|---|---|---|---|---|---|---|
| ✅ | 巨量资源 | `https://api.juliang.live/api/provide/vod` | 18 | 648ms | ❌ fail(HTTP 403) | applecms-sources |
| ✅ | 暴风资源 | `https://bfzyapi.com/api.php/provide/vod` | 1000 | 721ms | ❌ fail(HTTP 404) | applecms-sources |
| ✅ | 量子资源 | `https://cj.lziapi.com/api.php/provide/vod` | 1000 | 358ms | ❌ fail(HTTP 404) | applecms-sources |
| ⚠️ 搜索空 | 索尼资源 | `https://suoniapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ⚠️ 搜索空 | 闪电资源 | `http://sdzyapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ✅ | 无尽资源 | `https://api.wujinapi.com/api.php/provide/vod` | 6 | 238ms | ❌ fail(HTTP 403) | applecms-sources |
| ⚠️ 搜索空 | 光速资源 | `https://api.guangsuapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ❌ 不可达 | 金鹰资源 | `http://jyzyapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ✅ | 素博资源 | `https://subocaiji.com/api.php/provide/vod` | 10 | 259ms | ❌ fail(UND_ERR_CONNECT_TIMEOUT) | applecms-sources |
| ✅ | 红牛资源 | `https://www.hongniuzy2.com/api.php/provide/vod` | 10 | 173ms | ❌ fail(UND_ERR_CONNECT_TIMEOUT) | applecms-sources |
| ✅ | 豪华资源 | `https://hhzyapi.com/api.php/provide/vod` | 10 | 250ms | ❌ fail(UND_ERR_CONNECT_TIMEOUT) | applecms-sources |
| ⚠️ 搜索空 | 虎牙资源 | `https://www.huyaapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ✅ | 极速资源 | `https://jszyapi.com/api.php/provide/vod` | 7 | 142ms | ❌ fail(ENOTFOUND) | applecms-sources |
| ✅ | 非凡资源 | `https://cj.ffzyapi.com/api.php/provide/vod` | 3 | 84ms | ❌ fail(HTTP 403) | applecms-sources |
| ✅ | 魔都资源 | `https://caiji.moduapi.cc/api.php/provide/vod` | 3 | 170ms | ✅ | applecms-sources |
| ✅ | 如意资源 | `https://cj.rycjapi.com/api.php/provide/vod` | 7 | 399ms | ✅ | applecms-sources |
| ✅ | 电影天堂资源 | `https://caiji.dyttzyapi.com/api.php/provide/vod` | 2 | 81ms | ❌ fail(HTTP 403) | applecms-sources |
| ⚠️ 搜索空 | 天涯资源 | `https://tyyszyapi.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ✅ | U酷资源 | `https://api.ukuapi.com/api.php/provide/vod` | 5 | 117ms | ❌ fail(HTTP 403) | applecms-sources |
| ❌ 不可达 | 百度资源 | `https://api.apibdzy.com/api.php/provide/vod` | - | -ms | — | applecms-sources |
| ✅ | 360采集 | `https://360zy.com/api.php/provide/vod` | 6 | 448ms | ✅ | tvbox-config |
| ✅ | 无尽采集 | `https://api.wujinapi.net/api.php/provide/vod` | 6 | 131ms | ❌ fail(HTTP 403) | tvbox-config |
| ✅ | 无尽采集2 | `https://api.wujinapi.me/api.php/provide/vod` | 6 | 163ms | ❌ fail(HTTP 403) | tvbox-config |
| ⚠️ 搜索空 | 光速采集 | `https://api.guangsuapi.com/api.php/provide/vod` | - | -ms | — | tvbox-config |
| ✅ | 新浪采集 | `https://api.xinlangapi.com/xinlangapi.php/provide//vod` | 10 | 294ms | ❌ fail(UND_ERR_CONNECT_TIMEOUT) | tvbox-config |
| ✅ | ckzy采集 | `https://ckzy.me/api.php/provide/vod` | 2 | 148ms | ✅ | tvbox-config |
| ⚠️ 搜索空 | 纯净采集 | `https://api.wsyzy.net/api.php/provide/vod` | - | -ms | — | tvbox-config |
| ✅ | 新4K采集 | `http://cmsyun2.qijiyun.vip/api.php/provide/vod` | 1 | 278ms | ❌ no-m3u8(mp4) | tvbox-config |
| ✅ | 非凡资源 | `https://api.ffzyapi.com/api.php/provide/vod` | 3 | 67ms | ❌ fail(HTTP 403) | tvbox-sub |
| ❌ 不可达 | 海外看 | `https://haiwaikan.com/api.php/provide/vod` | - | -ms | — | gao-0825 |
| ❌ 不可达 | 快帆 | `https://api.kuaifan.tv/api.php/provide/vod` | - | -ms | — | gao-0825 |
| ❌ 不可达 | 乐视 | `https://leshiapi.com/api.php/provide/vod` | - | -ms | — | gao-0825 |

> 采集接口均来自公开社区分享，本工具仅做可用性检测，仅供学习研究，请勿用于商业用途。
