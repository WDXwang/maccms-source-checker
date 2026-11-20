#!/usr/bin/env node
/**
 * 苹果CMS采集接口每日检测器
 *
 * 功能：
 *   1. 从上游开源项目（GitHub 仓库）拉取社区维护的采集接口列表
 *   2. 对每个接口实测：连通性 → 关键词搜索 → 详情/播放地址 → （--full 模式）播放流抽查
 *   3. 生成：
 *      - output/tvbox.json                TVBox / FongMi 影视可直接导入的配置
 *      - output/libretv_apis.json         LibreTV「自定义API」清单（name + api）
 *      - output/libretv_customer_site.js  LibreTV 部署可直接替换的 js/customer_site.js
 *      - output/report.md                 人类可读的检测报告
 *      - output/checked_sources.json      机器可读的全量检测结果
 *      - output/history/<日期>.json       每日快照，便于追溯源失效时间
 *
 * 用法：
 *   node sources/checker.mjs            # 标准模式：连通+搜索+详情
 *   node sources/checker.mjs --full     # 增加播放流（m3u8）抽查
 *   node sources/checker.mjs --timeout 8000   # 自定义单请求超时（毫秒）
 *
 * 仅依赖 Node.js 内置模块（>=18，需支持全局 fetch）。
 * 本工具仅用于学习与个人技术研究，采集接口均来自公开社区分享。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const HISTORY_DIR = path.join(OUTPUT_DIR, 'history');
const UPSTREAMS_FILE = path.join(__dirname, 'upstreams.json');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const FULL_MODE = argv.includes('--full');
const timeoutIdx = argv.indexOf('--timeout');
const REQ_TIMEOUT = timeoutIdx > -1 ? Number(argv[timeoutIdx + 1]) || 10000 : 10000;
const CONCURRENCY = 8;
const SEARCH_WORDS = ['三体', '西游记', '爱情', '风云']; // 依次尝试，命中即通过
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// 直播源检测参数
const ACCEL_PREFIX = 'https://ghfast.top/'; // 国内加速前缀（GitHub 托管地址专用）
const LIVE_PROBE_TIMEOUT = 5000;  // 频道探测超时
const LIVE_PROBE_SAMPLE = 8;      // 每个直播源抽样探测的频道数（按分组取首频道）
const LIVE_MIN_HTTP_CHANNELS = 10; // 低于此数的 http 频道视为组播为主、不可公网播放

// ---------- 工具 ----------
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function fetchWithTimeout(url, { timeout = REQ_TIMEOUT, headers = {}, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
        ...headers,
      },
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function tryJson(url, opts) {
  try {
    const { ok, status, text } = await fetchWithTimeout(url, opts);
    if (!ok) return { fail: `HTTP ${status}` };
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return { fail: '非JSON对象' };
    return { data };
  } catch (e) {
    const reason = e.name === 'AbortError' ? '超时' : (e.cause && e.cause.code) || e.message;
    return { fail: String(reason).slice(0, 60) };
  }
}

// 规范化接口地址：去掉 /from/<线路>/ 段与末尾斜杠（LibreTV/TVBox 均以 ?ac= 拼接）
function normalizeApi(url) {
  let u = url.trim();
  u = u.replace(/\/from\/[^/?#]+\/?/g, '/');
  u = u.replace(/\/+$/, '');
  return u;
}

function dedupeKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, '') + parsed.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function makeKey(url, used) {
  let base = 'src';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const seg = host.split('.').filter(p => /[a-z0-9]/i.test(p)).slice(-2, -1)[0] || host.split('.')[0];
    base = seg.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'src';
  } catch { /* keep base */ }
  // key 必须是合法 JS 标识符（customer_site.js 直接用于对象字面量）：不能以数字开头
  if (/^[0-9]/.test(base)) base = 's' + base;
  let key = base;
  let i = 2;
  while (used.has(key)) key = `${base}${i++}`;
  used.add(key);
  return key;
}

// ---------- 上游拉取 ----------
async function fetchUpstreamRaw(up) {
    // 直接 URL 上游：任意 HTTP(S) 配置地址（如 TVBox 接口），中文域名自动转 punycode
    if (up.url) {
        const url = new URL(up.url).href; // WHATWG URL 自动处理 IDN→punycode
        // 部分接口站按 UA 鉴别客户端：仅对 TVBox(okhttp) UA 返回 JSON，浏览器 UA 得到 HTML 入口页
        const headers = up.ua ? { 'User-Agent': up.ua } : {};
        const { ok, status, text } = await fetchWithTimeout(url, { timeout: 20000, headers });
        if (ok && text) return text;
        throw new Error(`URL 获取失败 HTTP ${status}: ${up.url}`);
    }

    const { repo, branch, file } = up;
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
    try {
        const { ok, status, text } = await fetchWithTimeout(url, { timeout: 20000 });
        if (ok && text) return text;
        log(`  raw 获取失败(${status})，改用 GitHub API: ${repo}/${file}`);
    } catch (e) {
        log(`  raw 请求异常，改用 GitHub API: ${e.message}`);
    }
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${file}?ref=${branch}`;
    const headers = {};
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const { ok, status, text } = await fetchWithTimeout(apiUrl, { timeout: 20000, headers });
    if (!ok) throw new Error(`GitHub API 获取失败 HTTP ${status}: ${repo}/${file}`);
    const data = JSON.parse(text);
    if (data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    throw new Error(`GitHub API 返回格式异常: ${repo}/${file}`);
}

function parseUpstream(name, format, rawText) {
  let data;
  try {
    data = JSON.parse(rawText.replace(/^\uFEFF/, ''));
  } catch (e) {
    log(`  [${name}] 解析失败：${e.message}`);
    return [];
  }
  const out = [];
  if (format === 'maccms_list' && Array.isArray(data.sources)) {
    for (const s of data.sources) {
      if (s && s.url && /provide\/vod/i.test(s.url)) {
        out.push({ name: s.name || '未命名源', api: s.url, from: s.from || null, upstream: name });
      }
    }
  } else if (format === 'tvbox_sites' && Array.isArray(data.sites)) {
    for (const s of data.sites) {
      if (s && typeof s.api === 'string' && /^https?:\/\//.test(s.api)) {
        if (/xml/i.test(s.api)) continue; // 跳过XML接口，LibreTV仅支持JSON
        // 标准苹果CMS JSON 接口：type=1；部分仓库（如 tvbox-sub）误标为 type=3 但 api 实为 provide/vod，一并兼容
        const isMaccms = Number(s.type) === 1 || /provide\/vod|inc\/apijson/i.test(s.api);
        if (!isMaccms) continue;
        out.push({ name: s.name || s.key || '未命名源', api: s.api, from: null, upstream: name });
      }
    }
  }
  return out;
}

// ---------- 接口验证 ----------
async function validateSource(src) {
  const api = normalizeApi(src.api);
  const result = {
    name: src.name,
    api,
    upstream: src.upstream,
    status: 'unknown',
    reason: '',
    total: null,
    sampleName: '',
    searchMs: null,
    playCheck: 'skipped',
    insecure: api.startsWith('http://'),
    checkedAt: new Date().toISOString(),
  };

  // 1) 连通 + 列表
  const list1 = await tryJson(`${api}?ac=list`);
  if (list1.fail) {
    // 部分源路径大小写/写法差异，再原样试一次
    const list2 = await tryJson(`${src.api}?ac=list`);
    if (list2.fail) {
      result.status = 'unreachable';
      result.reason = `列表接口失败(${list1.fail})`;
      return result;
    }
  }
  if (!result.reason) {
    const listData = list1.data;
    if (!Array.isArray(listData.list)) {
      result.status = 'invalid';
      result.reason = '返回缺少 list 字段';
      return result;
    }
  }

  // 2) 关键词搜索
  let searchData = null;
  for (const word of SEARCH_WORDS.slice(0, 2)) {
    const t0 = Date.now();
    const res = await tryJson(`${api}?ac=videolist&wd=${encodeURIComponent(word)}`);
    if (res.fail) {
      result.reason = `搜索失败(${res.fail})`;
      continue;
    }
    if (Array.isArray(res.data.list) && res.data.list.length > 0) {
      searchData = res.data;
      result.searchMs = Date.now() - t0;
      result.total = res.data.total ?? res.data.list.length;
      result.sampleName = res.data.list[0].vod_name || '';
      result.reason = '';
      break;
    } else {
      result.reason = `搜索"${word}"无结果`;
    }
  }
  if (!searchData) {
    result.status = 'search_empty';
    if (!result.reason) result.reason = '所有测试词均无结果';
    return result;
  }

  // 3) 详情 + 播放地址格式
  const first = searchData.list[0];
  const detail = await tryJson(`${api}?ac=videolist&ids=${first.vod_id}`);
  let playUrl = '';
  if (!detail.fail && Array.isArray(detail.data.list) && detail.data.list.length > 0) {
    playUrl = String(detail.data.list[0].vod_play_url || '');
  }
  if (!playUrl) {
    // 有些源 videolist 即含播放地址
    playUrl = String(first.vod_play_url || '');
  }
  if (/m3u8|mp4/i.test(playUrl)) {
    result.status = 'ok';
    result.reason = '搜索/详情/播放地址均正常';
  } else {
    result.status = 'no_play_url';
    result.reason = '详情未返回可播放地址';
    return result;
  }

  // 4)（--full）播放流抽查：取第一个 m3u8 验证返回内容
  if (FULL_MODE) {
    const m3u8Match = playUrl.match(/https?:\/\/[^\s#$]+\.m3u8/i);
    if (m3u8Match) {
      try {
        const { ok, status, text } = await fetchWithTimeout(m3u8Match[0], { timeout: REQ_TIMEOUT });
        if (ok && text.includes('#EXTM3U')) {
          result.playCheck = 'ok';
        } else {
          result.playCheck = `fail(HTTP ${status})`;
        }
      } catch (e) {
        result.playCheck = `fail(${e.name === 'AbortError' ? '超时' : e.cause?.code || e.message})`;
      }
    } else {
      result.playCheck = 'no-m3u8(mp4)';
    }
  }
  return result;
}

async function runPool(tasks, limit) {
  const ret = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const my = idx++;
      ret[my] = await tasks[my]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return ret;
}

// ---------- 直播（TV）源检测 ----------
// GitHub 托管的地址加上国内加速前缀（应用端实际使用加速地址，检测也针对加速地址）
function isGithubHosted(url) {
  return /^https?:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)\//i.test(url)
    || /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(raw|releases\/download)\//i.test(url);
}

function accelerate(url) {
  return isGithubHosted(url) ? ACCEL_PREFIX + url : url;
}

function guessLiveKind(url) {
  return /\.m3u8?($|\?)/i.test(url) ? 'm3u' : 'txt';
}

// 解析直播列表（m3u / tvbox txt 两种格式），返回 http(s) 可公网播放的频道
function parseLiveList(text, kind) {
  const channels = [];
  const groups = new Set();
  if (kind === 'txt') {
    let group = '其他';
    for (const raw of String(text).split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      if (t.endsWith('#genre#')) { group = t.split(',')[0].trim() || group; groups.add(group); continue; }
      const cIdx = t.indexOf(',');
      if (cIdx > 0) {
        const name = t.slice(0, cIdx).trim();
        const url = t.slice(cIdx + 1).trim();
        if (name && /^https?:\/\//i.test(url)) channels.push({ name, url, group });
      }
    }
  } else {
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('#EXTINF')) continue;
      const gm = t.match(/group-title="([^"]*)"/);
      const group = gm ? gm[1].trim() : '其他';
      const name = t.slice(t.lastIndexOf(',') + 1).trim();
      let url = '';
      for (let j = i + 1; j < lines.length; j++) {
        const n = lines[j].trim();
        if (!n) continue;
        if (n.startsWith('#')) continue; // 跳过 EXTVLCOPT 等附加指令
        url = n;
        i = j;
        break;
      }
      if (name && /^https?:\/\//i.test(url)) { groups.add(group); channels.push({ name, url, group }); }
    }
  }
  return { channels, groups: Array.from(groups) };
}

// 频道可达性探测：拿到 2xx/3xx 响应即视为可达（不下载完整流）
async function probeChannel(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVE_PROBE_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'okhttp/4.9.3' },
      redirect: 'follow',
    });
    if (res.status < 400) {
      try { await res.body?.cancel(); } catch {}
      return true;
    }
    try { await res.body?.cancel(); } catch {}
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyLive(up) {
  const target = accelerate(up.url);
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(target, { timeout: 30000 });
    if (!res.ok) return { name: up.name, rawUrl: up.url, status: 'unreachable', fail: `HTTP ${res.status}` };
    const kind = up.kind || guessLiveKind(up.url);
    const list = parseLiveList(res.text, kind);
    if (list.channels.length < LIVE_MIN_HTTP_CHANNELS) {
      return { name: up.name, rawUrl: up.url, status: 'no_http_channels', fail: `仅 ${list.channels.length} 个 http 频道（多为组播/特殊协议，公网不可播）` };
    }
    // 抽样探测：每个分组取首个频道，最多 LIVE_PROBE_SAMPLE 个
    const picked = [];
    const seenGroups = new Set();
    for (const ch of list.channels) {
      if (!seenGroups.has(ch.group)) { seenGroups.add(ch.group); picked.push(ch); if (picked.length >= LIVE_PROBE_SAMPLE) break; }
    }
    for (const ch of list.channels) {
      if (picked.length >= LIVE_PROBE_SAMPLE) break;
      if (!picked.includes(ch)) picked.push(ch);
    }
    const probe = await runPool(picked.map(ch => () => probeChannel(ch.url)), 6);
    const probeOk = probe.filter(Boolean).length;
    return {
      name: up.name,
      url: target,
      rawUrl: up.url,
      kind,
      epg: up.epg || '',
      channels: list.channels.length,
      groups: list.groups.length,
      probeOk,
      probeTotal: picked.length,
      probeRatio: picked.length ? Math.round((probeOk / picked.length) * 100) : 0,
      status: 'ok',
      ms: Date.now() - started,
      comment: up.comment || '',
    };
  } catch (e) {
    return { name: up.name, rawUrl: up.url, status: 'unreachable', fail: String(e.message || e).slice(0, 60) };
  }
}

// ---------- 输出 ----------
function buildOutputs(results, liveResults = []) {
  const now = new Date().toISOString();
  const okList = results.filter(r => r.status === 'ok');
  const liveOk = liveResults
    .filter(r => r.status === 'ok')
    .sort((a, b) => (b.probeRatio - a.probeRatio) || (b.channels - a.channels));

  // TVBox / FongMi 影视TV 配置（点播 sites + 直播 lives）
  const tvbox = {
    name: '星辰TVBox 每日实测源（点播+直播）',
    notes: `检测时间 ${now}；点播 ${okList.length} 个实测可用接口，直播 ${liveOk.length} 个可用源。仅供学习研究，请勿商用。`,
    updated: now,
    sites: okList.map((r, i) => ({
      key: r.key || `s${i + 1}`,
      name: r.name,
      type: 1,
      api: r.api,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
    })),
    lives: liveOk.map(r => {
      const item = { name: `${r.name}（${r.channels}台）`, type: 0, url: r.url };
      if (r.epg) item.epg = r.epg;
      return item;
    }),
    notice: `配置每日 08:30 自动更新；如当前地址失效，可依次尝试：${ACCEL_PREFIX.slice(0, -1)} / gh-proxy.com / cdn.jsdelivr.net 加速的同一仓库路径`,
  };

  // LibreTV 自定义API清单（页面设置 → 自定义API 中逐个添加时的 name + api）
  const libretvApis = {
    updated: now,
    count: okList.length,
    apis: okList.map(r => ({ name: r.name, api: r.api })),
  };

  // LibreTV customer_site.js（可直接替换部署目录中的 js/customer_site.js）
  const used = new Set();
  const jsEntries = okList
    .map(r => {
      const key = makeKey(r.api, used);
      r.key = key; // 回填，供 tvbox 使用同一 key
      return `    ${key}: {\n        api: '${r.api}',\n        name: '${r.name.replace(/'/g, "\\'")}',\n    }`;
    })
    .join(',\n');
  const customerSiteJs =
    `// 由 maccms-source-checker 自动生成于 ${now}\n` +
    `// 检测通过 ${okList.length}/${results.length} 个接口。仅用于个人学习研究。\n` +
    `const CUSTOMER_SITES = {\n${jsEntries}\n};\n\n` +
    `// 调用全局方法合并\n` +
    `if (window.extendAPISites) {\n    window.extendAPISites(CUSTOMER_SITES);\n} else {\n    console.error("错误：请先加载 config.js！");\n}\n`;

  // 检测报告
  const rows = results
    .map(r => {
      const badge =
        r.status === 'ok' ? '✅' :
        r.status === 'search_empty' ? '⚠️ 搜索空' :
        r.status === 'no_play_url' ? '⚠️ 无播放地址' :
        r.status === 'invalid' ? '❌ 格式异常' : '❌ 不可达';
      const play = r.playCheck === 'ok' ? '✅' : r.playCheck === 'skipped' ? '—' : `❌ ${r.playCheck}`;
      // 转义名称/字段中的 | 与换行，避免破坏 Markdown 表格
      const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
      return `| ${badge} | ${esc(r.name)} | \`${esc(r.api)}\` | ${r.total ?? '-'} | ${r.searchMs ?? '-'}ms | ${play} | ${esc(r.upstream)} |`;
    })
    .join('\n');

  // 直播源报告
  const liveRows = liveResults
    .map(r => {
      const badge = r.status === 'ok' ? '✅' : r.status === 'no_http_channels' ? '⚠️ 组播为主' : '❌ 不可达';
      const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
      const info = r.status === 'ok' ? `${r.channels} 台 / ${r.groups} 组 / 抽样 ${r.probeOk}/${r.probeTotal}` : esc(r.fail || r.status);
      return `| ${badge} | ${esc(r.name)} | ${info} | ${r.status === 'ok' ? `${r.probeRatio}%` : '—'} | ${esc(r.rawUrl || r.url || '')} |`;
    })
    .join('\n');
  const liveSection = liveResults.length
    ? `\n## 直播（TV）源检测\n\n| 状态 | 名称 | 频道/分组/抽样 | 频道可达率 | 原始地址 |\n|---|---|---|---|---|\n${liveRows}\n\n> 抽样探测仅验证频道 HTTP 可达性，不等于实际可播放（部分源有地区/网络限制）。GitHub 托管的直播列表在配置中已替换为国内加速地址。\n`
    : '';

  const report =
    `# 采集接口与直播源检测报告\n\n` +
    `- **检测时间**：${now}\n` +
    `- **模式**：${FULL_MODE ? 'full（含播放流抽查）' : 'standard（连通+搜索+详情）'}\n` +
    `- **点播结果**：${okList.length} 个可用 / 共检测 ${results.length} 个接口\n` +
    (liveResults.length ? `- **直播结果**：${liveOk.length} 个可用 / 共检测 ${liveResults.length} 个源\n` : '') +
    `\n| 状态 | 名称 | 接口地址 | 片库总数 | 搜索耗时 | 播放抽查 | 来源 |\n|---|---|---|---|---|---|---|\n${rows}\n${liveSection}\n` +
    `> 采集接口与直播列表均来自公开社区分享，本工具仅做可用性检测，仅供学习研究，请勿用于商业用途。\n`;

  const machine = {
    updated: now,
    mode: FULL_MODE ? 'full' : 'standard',
    summary: {
      total: results.length,
      ok: okList.length,
      searchEmpty: results.filter(r => r.status === 'search_empty').length,
      noPlayUrl: results.filter(r => r.status === 'no_play_url').length,
      invalid: results.filter(r => r.status === 'invalid').length,
      unreachable: results.filter(r => r.status === 'unreachable').length,
      liveTotal: liveResults.length,
      liveOk: liveOk.length,
    },
    results,
    liveResults,
  };

  return { tvbox, libretvApis, customerSiteJs, report, machine };
}

function writeOutputs(out) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'tvbox.json'), JSON.stringify(out.tvbox, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'libretv_apis.json'), JSON.stringify(out.libretvApis, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'libretv_customer_site.js'), out.customerSiteJs);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), out.report);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'checked_sources.json'), JSON.stringify(out.machine, null, 2));
  const dateStamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(HISTORY_DIR, `${dateStamp}.json`), JSON.stringify(out.machine, null, 2));
}

// ---------- 主流程 ----------
async function main() {
  log(`开始检测（模式：${FULL_MODE ? 'full' : 'standard'}，单请求超时 ${REQ_TIMEOUT}ms）`);

  // 1. 拉取上游
  const cfg = JSON.parse(fs.readFileSync(UPSTREAMS_FILE, 'utf-8'));
  const collected = [];
  for (const up of cfg.upstreams) {
    log(`拉取上游 ${up.name} (${up.url || `${up.repo}/${up.file}`}) ...`);
    try {
      const raw = await fetchUpstreamRaw(up);
      const parsed = parseUpstream(up.name, up.format, raw);
      log(`  解析到 ${parsed.length} 个接口`);
      collected.push(...parsed);
    } catch (e) {
      log(`  ⚠️ 上游获取失败：${e.message}`);
    }
  }

  // 2. 去重
  const seen = new Set();
  const sources = [];
  for (const s of collected) {
    const k = dedupeKey(s.api);
    if (!seen.has(k)) {
      seen.add(k);
      s.api = normalizeApi(s.api);
      sources.push(s);
    }
  }
  log(`合并去重后共 ${sources.length} 个待检测接口`);

  // 3. 并发验证
  const results = await runPool(sources.map(s => () => validateSource(s)), CONCURRENCY);

  // 3.5 直播（TV）源检测
  let liveResults = [];
  if (cfg.liveUpstreams && cfg.liveUpstreams.length) {
    log(`开始直播（TV）源检测：${cfg.liveUpstreams.length} 个上游（GitHub 地址经 ${ACCEL_PREFIX} 加速后实测）`);
    liveResults = await runPool(cfg.liveUpstreams.map(up => () => verifyLive(up)), 4);
    const liveOk = liveResults.filter(r => r.status === 'ok');
    for (const r of liveResults) {
      log(r.status === 'ok'
        ? `  ✅ ${r.name}：${r.channels} 台 / ${r.groups} 组 / 抽样可达 ${r.probeOk}/${r.probeTotal}`
        : `  ❌ ${r.name}：${r.fail || r.status}`);
    }
    log(`直播源检测完成：${liveOk.length}/${liveResults.length} 个可用`);
  }

  // 4. 生成并写盘
  const out = buildOutputs(results, liveResults);
  writeOutputs(out);

  const okCount = results.filter(r => r.status === 'ok').length;
  log(`检测完成：${okCount}/${results.length} 个接口可用`);
  log(`输出文件：output/tvbox.json | output/libretv_apis.json | output/libretv_customer_site.js | output/report.md | output/checked_sources.json | output/history/`);
  if (results.filter(r => r.status === 'ok').length === 0) {
    process.exitCode = 1; // 全部失效时让 CI 报警
  }
}

main().catch(e => {
  console.error('检测流程异常：', e);
  process.exit(1);
});
