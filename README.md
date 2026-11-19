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

## 检测流程

每个接口依次验证（失败即停，标记原因）：

1. **连通性**：`GET ?ac=list`，要求 200 且返回 JSON 含 `list` 字段；
2. **搜索能力**：`GET ?ac=videolist&wd=测试词`（词池：三体 / 西游记 / 爱情 / 风云），要求返回非空结果；
3. **详情与播放地址**：取首条影片 `?ac=videolist&ids=`，要求 `vod_play_url` 中含 `m3u8` 或 `mp4`；
4. **播放流抽查**（`--full` 模式）：对第一个 `.m3u8` 地址发起请求，验证返回内容含 `#EXTM3U`。

支持多词回退：第一个测试词搜不到时自动换词，避免片库差异造成误判。

## 上游数据来源

在 `sources/upstreams.json` 中配置，可自行增删。当前包含：

| 上游 | 仓库 | 格式 |
|---|---|---|
| applecms-sources | andywe0921-ops/applecms-sources | maccms_list（每日实测更新的接口清单） |
| tvbox-config | muzheya/tvbox-config | tvbox_sites（纯API采集配置） |
| tvbox-sub | efefsdwd/tvbox-sub | tvbox_sites（TVBox 订阅） |
| gao-0825 | gaotianliuyun/gao | tvbox_sites（8.2k star TVBox 配置，提取 type=1） |

拉取顺序：优先 `raw.githubusercontent.com`，失败自动切换 GitHub Contents API（Actions 中自动携带内置 `GITHUB_TOKEN` 提升限额）。

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
