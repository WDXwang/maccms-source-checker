# 苹果CMS采集源每日检测器 (maccms-source-checker)

每天自动从社区维护的开源项目中收集「苹果CMS V10 采集接口」（`api.php/provide/vod` 类），**逐个实测验证可用性**，并生成两类可直接使用的产物：

| 产物 | 用途 |
|---|---|
| `output/tvbox.json` | TVBox / FongMi 影视 直接导入的配置（`sites` + `type:1`） |
| `output/libretv_apis.json` | LibreTV「设置 → 自定义API」可用清单（`name + api`） |
| `output/libretv_customer_site.js` | LibreTV 本地部署可直接替换 `js/customer_site.js` 的文件 |
| `output/report.md` | 人类可读检测报告（状态 / 片库量 / 搜索耗时 / 播放抽查） |
| `output/checked_sources.json` | 机器可读全量结果 |
| `output/history/日期.json` | 每日快照，追溯某个源从哪天开始失效 |

## 推荐 TVBox 聚合配置（爬虫源类，直接导入使用）

以下配置为社区分享的 **type=3 爬虫类**聚合配置（依赖 jar 运行，收录网盘/4K等资源），适合直接在 TVBox / FongMi 影视中导入使用。它们不是苹果CMS JSON 接口，**无法进入每日验证流程，LibreTV 不支持**，故仅作收藏推荐：

| 配置 | 地址 | 实测状态 |
|---|---|---|
| newwex 爬虫聚合（100 站：豆瓣推荐/网盘/玩偶4K/蜡笔/闪电等） | `https://9280.kstore.vip/newwex.json` | ✅ 2026-11-19 实测：配置可达、spider jar 有效（伪装 jpg，PK头验证通过） |
| wex 爬虫聚合（100 站） | `https://9280.kstore.vip/wex.json` | ✅ 2026-11-19 实测：配置可达、jar 有效 |
| 凯速 fish 爬虫聚合（111 站） | `https://6800.kstore.vip/fish.json` | ✅ 2026-11-19 实测：配置可达、jar 有效 |
| 王二小放牛娃（100 站） | `http://tvbox.王二小放牛娃.top` | ✅ 2026-11-19 实测：需 okhttp UA |
| 王二小备用（100 站） | `http://tv.999888987.xyz/` | ✅ 2026-11-19 实测：需 okhttp UA |
| iyouhun 影魂（100 站） | `https://www.iyouhun.com/tv/wex` | ✅ 2026-11-19 实测：需 okhttp UA |
| 动漫专用聚合（27 站） | `https://www.yingm.cc/dm/dm.json` | ✅ 2026-11-19 实测：配置可达、jar 有效 |
| 俊佬 top98（24 站） | `http://home.jundie.top:81/top98.json` | ✅ 2026-11-19 实测：配置可达、jar 有效 |

> 收录标准：配置 JSON 可拉取、jar 可下载。爬虫源的实际可用性随 jar 与上游网站变化，无法逐个 HTTP 探测。

## 检测流程

每个接口依次验证（失败即停，标记原因）：

1. **连通性**：`GET ?ac=list`，要求 200 且返回 JSON 含 `list` 字段；
2. **搜索能力**：`GET ?ac=videolist&wd=测试词`（词池：三体 / 西游记 / 爱情 / 风云），要求返回非空结果；
3. **详情与播放地址**：取首条影片 `?ac=videolist&ids=`，要求 `vod_play_url` 中含 `m3u8` 或 `mp4`；
4. **播放流抽查**（`--full` 模式）：对第一个 `.m3u8` 地址发起请求，验证返回内容含 `#EXTM3U`。

支持多词回退：第一个测试词搜不到时自动换词，避免片库差异造成误判。

## 上游数据来源

在 `sources/upstreams.json` 中配置，可自行增删。当前包含：

| 上游 | 地址 | 格式 |
|---|---|---|
| applecms-sources | andywe0921-ops/applecms-sources（GitHub 仓库） | maccms_list（每日实测更新的接口清单） |
| tvbox-config | muzheya/tvbox-config（GitHub 仓库） | tvbox_sites（纯API采集配置） |
| tvbox-sub | efefsdwd/tvbox-sub（GitHub 仓库） | tvbox_sites（TVBox 订阅） |
| gao-0825 | gaotianliuyun/gao（GitHub 仓库） | tvbox_sites（8.2k star TVBox 配置，提取 type=1） |
| xiaoma | `https://szyyds.cn/tv/x.json`（直接 URL） | tvbox_sites（62 站，含 15 个苹果CMS接口） |
| eryuehong | `https://700sjro44343.vicp.fun/eggp/0211/tv.json`（直接 URL） | tvbox_sites（31 站） |
| qiezi | `https://700sjro44343.vicp.fun/eggp/qzku/tv.json`（直接 URL） | tvbox_sites（31 站） |
| canglan | `http://苍蓝.top`（直接 URL，`ua: okhttp/4.9.3`） | tvbox_sites（77 站，含 28 个苹果CMS接口） |
| fengdou | `http://枫斗.top/tv`（直接 URL，`ua: okhttp/4.9.3`） | tvbox_sites（198 站，含 12 个苹果CMS接口） |
| uuccc | UUCCC 接口（直接 URL，`ua: okhttp/4.9.3`） | tvbox_sites（31 站） |
| yingshicang | `http://影视仓.com/`（直接 URL，`ua: okhttp/4.9.3`） | tvbox_sites（31 站） |
| cainisi | `https://tv.菜妮丝.top`（直接 URL，`ua: okhttp/4.9.3`） | tvbox_sites（37 站） |
| moyu-er-top | `http://我不是.摸鱼儿.top`（直接 URL） | tvbox_sites（摸鱼儿聚合配置，域名失效中，恢复后自动纳入） |
| moyu-er-com | `http://我不是.摸鱼儿.com`（直接 URL） | tvbox_sites（摸鱼儿备用域名，同上） |

> 部分接口站按 User-Agent 鉴别客户端：仅对 TVBox(okhttp) UA 返回 JSON，浏览器 UA 只得到 HTML 入口页。此类上游在配置中加 `"ua": "okhttp/4.9.3"` 即可。

上游支持两种类型：

- **GitHub 仓库上游**：填 `repo` / `branch` / `file`，自动从 raw（失败转 Contents API）拉取；
- **直接 URL 上游**：填 `url` 即可，适用于任意 TVBox 配置接口地址（中文域名自动转 punycode，如 `http://我不是.摸鱼儿.top`）；上游失效时仅记日志跳过，不影响其他上游检测，因此也适合加入"曾经可用、当前失效"的接口做每日自动探测——一旦域名恢复，其中的采集源会自动进入验证流程。

上游失败、URL 失效等均优雅降级：每日运行日志会记录原因，其余上游照常检测。

解析时自动完成：合并去重（按域名+路径）、剥离 `/from/<线路>/` 路径段、剔除 XML 接口（LibreTV 仅支持 JSON）。

## 使用方式

### GitHub Actions（推荐，全自动）

推送本仓库到 GitHub 后，`.github/workflows/daily-check.yml` 会：

- 每天 **UTC 00:30（北京时间 08:30）** 自动运行，`--full` 全量检测；
- 把最新的 `output/` 提交回仓库，此后永远可以通过下面地址拿到最新产物：

```
https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/output/tvbox.json
https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/output/libretv_customer_site.js
```

- 也可在仓库 Actions 页面点击 **Run workflow** 手动触发。

### 本地运行

```bash
node sources/checker.mjs           # 标准模式
node sources/checker.mjs --full    # 含播放流抽查
node sources/checker.mjs --timeout 15000   # 网络较差时调大单请求超时
```

零第三方依赖，要求 Node.js >= 18（内置 fetch）。

### 输出接入 LibreTV / TVBox

- **LibreTV（自部署）**：把 `output/libretv_customer_site.js` 覆盖到部署目录 `js/customer_site.js`，浏览器 Ctrl+F5 强刷后新源自动勾选启用；
- **LibreTV（不改文件）**：打开 `output/libretv_apis.json`，在页面右上角「设置 → 自定义API」按 `name + api` 逐个添加；
- **TVBox / FongMi**：应用内「配置」粘贴 `output/tvbox.json` 的 raw 地址即可导入。

## 免责声明

本项目仅做**采集接口的可用性检测与格式转换**，不存储、不分发任何影视内容；所有接口均来自公开社区仓库分享。项目仅供学习与个人技术研究，请勿用于商业用途；使用者须遵守所在地法律法规，因使用本项目产生的一切后果由使用者自行承担。

## 目录结构

```
├── sources/
│   ├── checker.mjs          # 检测主脚本（零依赖，Node >= 18）
│   └── upstreams.json       # 上游项目配置（可自行增删）
├── .github/workflows/
│   └── daily-check.yml      # 每日定时任务
└── output/                  # 检测产物（Actions 自动提交）
```

> AI生成
