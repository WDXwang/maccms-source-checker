#!/usr/bin/env node
/**
 * 准备 APK assets：从 LibreTV 前端源码组装适配后的 WebView 资源
 *
 * 用法：node android/prep-assets.mjs --src <LibreTV源码目录> --out <assets输出目录> --customer <customer_site.js>
 *
 * 适配内容：
 *  0. overrides 覆盖 —— 仓库维护的定制前端文件（重构版豆瓣推荐页 douban.js / index.html）
 *  1. {{PASSWORD}} 占位符置空 —— file:// 加载时无访问密码（个人应用无需密码）
 *  2. proxy-auth.js 改写为直连模式 —— 前端直连采集接口，配合 WebView UniversalAccess 免 CORS
 *  3. password.js 全量 no-op / pwa-register.js / version-check.js 禁用 —— APK 免验证直接进入
 *  4. customer_site.js 注入最新实测可用源（每日检测产物）
 *  5. app.js 数据源自愈补丁 —— 避免首次启动勾选失效旧源
 *  6. 排除服务端/部署平台文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : null;
}
const SRC = argOf('--src');
const OUT = argOf('--out');
const CUSTOMER = argOf('--customer');

if (!SRC || !OUT) {
  console.error('用法: node android/prep-assets.mjs --src <LibreTV源码目录> --out <assets目录> [--customer <customer_site.js>]');
  process.exit(1);
}
if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error(`错误: ${SRC} 下找不到 index.html`);
  process.exit(1);
}

const EXCLUDE_FILES = new Set([
  'server.mjs', 'package.json', 'package-lock.json', 'service-worker.js',
  '.env', '.env.example',
]);
const EXCLUDE_DIRS = new Set([
  'node_modules', '.github', 'api', 'functions', 'netlify', 'docs', 'vercel',
]);
const EXCLUDE_EXT = new Set(['.psd', '.md']);

const WWW = path.join(OUT, 'www');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

let copied = 0;
function copyDir(srcDir, outDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(outDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else {
      if (EXCLUDE_FILES.has(entry.name) || EXCLUDE_EXT.has(path.extname(entry.name))) continue;
      if (entry.name === 'nomedia.psd') continue;
      fs.copyFileSync(s, d);
      copied++;
    }
  }
}
copyDir(SRC, WWW);

// 0. overrides 覆盖：仓库维护的定制前端文件（重构版豆瓣推荐页 douban.js / index.html 等）
//    这些文件含部署版同款修复（推荐页双分区重构、封面防盗链加载链等）
const OVERRIDES_DIR = path.join(__dirname, 'overrides');
if (fs.existsSync(OVERRIDES_DIR)) {
  copyDir(OVERRIDES_DIR, WWW);
  console.log(`已应用 overrides 覆盖（${fs.readdirSync(OVERRIDES_DIR).length} 个定制文件）`);
}
console.log(`已复制 ${copied} 个文件到 ${WWW}`);

// ---- 适配修改 ----
let changes = 0;
function patch(rel, fn) {
  const p = path.join(WWW, rel);
  if (!fs.existsSync(p)) { console.warn(`警告: ${rel} 不存在，跳过`); return; }
  let t = fs.readFileSync(p, 'utf-8');
  const before = t;
  t = fn(t);
  if (t !== before) { fs.writeFileSync(p, t, 'utf-8'); changes++; console.log(`已适配: ${rel}`); }
}

// 1. 所有 HTML：{{PASSWORD}} 置空（无密码模式，与 server.mjs 空密码行为一致）
for (const f of fs.readdirSync(WWW)) {
  if (f.endsWith('.html')) {
    patch(f, t => t.replaceAll('{{PASSWORD}}', ''));
  }
}

// 2. 代理鉴权 → 直连模式：拦截 addAuthToProxyUrl，把 "/proxy/<编码URL>" 还原为直连地址
//    WebView(file:// + UniversalAccess) 环境无需服务端代理，前端直连采集接口；
//    所有请求层（api.js/search.js/douban.js）均经过此拦截点，一处改写全局生效
patch('js/proxy-auth.js', () =>
  '// APK 构建：代理鉴权已替换为直连模式\n' +
  '// 把 "/proxy/<编码URL>" 还原为直连采集接口地址，配合 WebView UniversalAccess 免 CORS\n' +
  'window.ProxyAuth = {\n' +
  '    addAuthToProxyUrl: async function (proxiedUrl) {\n' +
  '        const idx = String(proxiedUrl).search(/https?%3A%2F%2F/i);\n' +
  '        if (idx === -1) return proxiedUrl; // 不含编码URL则原样返回\n' +
  '        try {\n' +
  '            return decodeURIComponent(String(proxiedUrl).slice(idx));\n' +
  '        } catch (e) {\n' +
  '            return proxiedUrl;\n' +
  '        }\n' +
  '    },\n' +
  '    clearAuthCache: function () {},\n' +
  '    validateProxyAuth: function () { return true; },\n' +
  '    getPasswordHash: async function () { return null; },\n' +
  '};\n');

// 3. 密码验证 → 全量 no-op：保留全局函数签名兼容其他模块调用，APK 免验证直接进入
//    （原逻辑：密码为空时进入“强制设置密码”模式，弹窗隐藏输入框且无法关闭 —— 服务器部署专用设计，APK 不适用）
patch('js/password.js', () =>
  '// APK 构建：已禁用密码验证系统（本地个人应用无需密码）\n' +
  '// 保留全局函数签名，兼容 app.js/ui.js/api.js/player.js 的调用检查\n' +
  'window.isPasswordProtected = function () { return false; };\n' +
  'window.isPasswordRequired = function () { return false; };\n' +
  'window.isPasswordVerified = function () { return true; };\n' +
  'window.verifyPassword = async function () { return true; };\n' +
  'window.ensurePasswordProtection = function () { return true; };\n' +
  '// 不注册 initPasswordProtection / 弹窗逻辑：APK 启动直接进入主界面\n');

// 4. 禁用 PWA 注册（file:// 不适用，且避免缓存旧资源）
patch('js/pwa-register.js', () =>
  '// APK 构建：已禁用 Service Worker 注册\n');

// 5. 禁用版本检查（APK 无 GitHub 更新检查）
patch('js/version-check.js', () =>
  '// APK 构建：已禁用版本检查\n');

// 6. 注入最新实测可用源
if (CUSTOMER && fs.existsSync(CUSTOMER)) {
  const content = fs.readFileSync(CUSTOMER, 'utf-8');
  fs.writeFileSync(path.join(WWW, 'js/customer_site.js'), content, 'utf-8');
  changes++; console.log('已适配: js/customer_site.js ← 最新检测产物');
} else {
  console.warn('警告: 未提供 --customer，沿用源码自带数据源');
}

// 7. 豆瓣推荐保持默认开启（重构版 douban.js 直连 API + 封面回退链；
//    MainActivity.shouldInterceptRequest 对豆瓣域附加 Referer 解决 CDN 418 防盗链）

// 8. app.js 数据源自愈（与部署版同款补丁）：
//    上游默认硬编码勾选 4 个已失效旧源（tyyszy 等），会导致 APK 首次启动搜索 0 结果
patch('js/app.js', t => t
  .replace(
    /let selectedAPIs = JSON\.parse\(localStorage\.getItem\('selectedAPIs'\) \|\| '\[[^\]]*\]'\);([^\n]*)/,
    "let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]'); // APK: 默认勾选由自愈逻辑补全"
  )
  .replace(
    /(document\.addEventListener\('DOMContentLoaded', function \(\) \{\s*\n)(\s*)\/\/ 初始化API复选框\s*\n\s*initAPICheckboxes\(\);/,
    `$1$2// APK: 数据源自愈 —— 剔除失效源勾选；无有效勾选时默认全选普通源；新增源自动勾选
$2const availableKeys = Object.keys(API_SITES);
$2selectedAPIs = selectedAPIs.filter(k => availableKeys.includes(k));
$2if (selectedAPIs.length === 0) {
$2    selectedAPIs = availableKeys.filter(k => !API_SITES[k].adult);
$2}
$2const seenSources = JSON.parse(localStorage.getItem('_seenSources') || '[]');
$2const newlyAdded = availableKeys.filter(k => !API_SITES[k].adult && !seenSources.includes(k));
$2if (newlyAdded.length > 0) {
$2    selectedAPIs = Array.from(new Set(selectedAPIs.concat(newlyAdded)));
$2}
$2localStorage.setItem('_seenSources', JSON.stringify(availableKeys));
$2localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

$2// 初始化API复选框
$2initAPICheckboxes();`
  )
  .replace(
    /\/\/ 默认选中资源\s*\n\s*selectedAPIs = \[[^\]]*\];/,
    `// APK: 默认全选当前可用的普通资源
        selectedAPIs = Object.keys(API_SITES).filter(k => !API_SITES[k].adult);`
  ));

// 9. file:// 环境核心修复：
//    location.origin 在 file:// 下为字符串 "null"，所有 new URL(rel, location.origin) 均抛异常，
//    导致 watch.js 崩溃（选集后停在加载页、无法播放）。改为引用 __BASE_URL__（file:// 下为目录 URL）。
function patchJsFile(rel, fn) {
  const p = path.join(WWW, rel);
  if (!fs.existsSync(p)) return;
  let t = fs.readFileSync(p, 'utf-8');
  const before = t;
  t = fn(t);
  if (t !== before) { fs.writeFileSync(p, t, 'utf-8'); changes++; console.log(`已适配: ${rel}`); }
}
function walkJs(dir, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, fn);
    else if (entry.name.endsWith('.js')) patchJsFile(path.relative(WWW, full).replace(/\\/g, '/'), fn);
  }
}
// 全局：new URL(x, window.location.origin) → __BASE_URL__（http 下语义不变，file:// 下可用）
walkJs(WWW, t => t.replace(/new URL\(([^,()]+), window\.location\.origin\)/g, 'new URL($1, window.__BASE_URL__)'));
// ui.js 特例：currentPath 拼接在 file:// 下会重复路径，直接用 href
patchJsFile('js/ui.js', t => t.replace(/window\.location\.origin \+ window\.location\.pathname \+ window\.location\.search/g, 'window.location.href'));

// 10. APK 引导脚本：__BASE_URL__ 定义（注入到 index.html 与 player.html）
const BOOTSTRAP_JS =
`// APK 构建：file:// 环境下的 URL 基准
// file:// 的 location.origin 为 "null"（无效），这里提供以当前目录为基准的 URL base
Object.defineProperty(window, '__BASE_URL__', {
    get: function () {
        if (window.location.protocol === 'file:') {
            return window.location.href.replace(/[^/]*$/, '');
        }
        return window.location.origin;
    }
});
`;
fs.writeFileSync(path.join(WWW, 'js/apk-bootstrap.js'), BOOTSTRAP_JS, 'utf-8');
changes++;
// 注入到所有含外链脚本的 HTML 页面（index/player/watch/about 等）。
// 此前只注入 index.html 与 player.html，漏掉了 watch.html 中转页：
//   watch.html 上 __BASE_URL__ 未定义 → new URL("player.html", undefined) 抛异常 →
//   watch.js 崩溃，只剩上游无参 meta refresh 兜底 → player.html 收不到选集参数 →
//   “无效的视频链接”（用户报障“选集后无法播放”的完整根因链）
for (const htmlFile of fs.readdirSync(WWW)) {
  if (!htmlFile.endsWith('.html')) continue;
  const p = path.join(WWW, htmlFile);
  if (!fs.existsSync(p)) continue;
  let t = fs.readFileSync(p, 'utf-8');
  // 10a. 注入引导脚本（置于第一个带 src 的 script 之前）
  if (!t.includes('js/apk-bootstrap.js')) {
    t = t.replace(/(<script[^>]*src=)/i, '<script src="js/apk-bootstrap.js"></script>\n$1');
    changes++; console.log(`已适配: ${htmlFile} ← 注入 apk-bootstrap.js`);
  }
  // 10b. 移除 crossorigin="anonymous"（file:// 页面加载本地库脚本会因 CORS 检查失败，
  //      导致 hls.js/artplayer.min.js 无法加载 —— 选集后无法播放的关键原因之一）
  if (t.includes('crossorigin="anonymous"')) {
    t = t.replaceAll(' crossorigin="anonymous"', '');
    changes++; console.log(`已适配: ${htmlFile} ← 移除 crossorigin`);
  }
  fs.writeFileSync(p, t, 'utf-8');
}
// player.js：video 元素的 crossOrigin 在 file:// 拉流同样有 CORS 模式问题
patchJsFile('js/player.js', t => t.replace(/moreVideoAttr:\s*\{\s*crossOrigin:\s*'anonymous',?\s*\}/, 'moreVideoAttr: {}'));

// 11. player.html 返回逻辑：file:// 下 '/' 不是主界面，改用 history.back()
patch('player.html', t => t.replace(
  "window.location.href = '/';",
  "if (window.location.protocol === 'file:') { window.history.back(); } else { window.location.href = '/'; }"
));

// 12. app.js：播放改为整页导航（TVBox 式全屏播放，真实历史栈 → 物理返回键可返回主界面）
patch('js/app.js', t => t.replace(
  /\/\/ 临时隐藏搜索结果和豆瓣区域[\s\S]*?videoPlayerFrame\.focus\(\);/,
  "// APK: 导航方式打开播放页（真实历史栈，返回键可返回主界面）\n    window.location.href = url;"
));

// 13. APK 播放内核切换补丁（TVBox 式）：hls.js(MSE软解) / 原生video(系统HLS硬解) 可切换
const PLAYER_PATCH_JS =
`// APK 构建：播放内核切换（参照 TVBox 播放方式）
// 内核一：原生（video.src 直连 m3u8，交给 Android 系统 HLS 解码 —— TVBox 同款方式，默认）
//         注：file:// 页面上 hls.js 的 MSE（blob:null 不透明源）无法被 video 元素加载，
//         故 APK 默认原生内核（已在桌面 Chromium 实测复现该 file:// 限制）
// 内核二：hls.js（MSE 软解，http 部署或 MSE 可用环境可切换）
(function () {
    function currentKernel() { return localStorage.getItem('playKernel') || 'native'; }
    function kernelLabel() { return currentKernel() === 'native' ? '原生' : 'HLS'; }

    function mountNative(videoUrl) {
        try { currentHls && currentHls.destroy && currentHls.destroy(); } catch (e) {}
        currentHls = null;
        try { art && art.destroy && art.destroy(false); } catch (e) {}
        art = null;
        const container = document.getElementById('player');
        if (!container) return;
        // 幂等：同地址的原生 video 已挂载则跳过（避免重复挂载重启加载）
        const existing = container.querySelector('video[data-apk-native]');
        if (existing && existing.src === videoUrl) return;
        container.innerHTML = '';
        const video = document.createElement('video');
        video.setAttribute('data-apk-native', '1');
        video.src = videoUrl;
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain;';
        container.appendChild(video);
        const p = video.play();
        if (p && p.catch) p.catch(function () {});
    }

    // 包装全局 initPlayer：native 内核走原生播放，否则走原 hls.js 流程
    // （player.js 的 initPlayer 在 DOMContentLoaded 中调用，此时本补丁已完成包装，初次即生效）
    const origInitPlayer = window.initPlayer;
    window.initPlayer = function (videoUrl) {
        if ((localStorage.getItem('playKernel') || 'native') === 'native' && /m3u8/i.test(String(videoUrl))) {
            try { mountNative(videoUrl); return; } catch (e) { /* 失败回退 hls.js */ }
        }
        return origInitPlayer ? origInitPlayer.apply(this, arguments) : undefined;
    };

    // 挂载右上角内核切换按钮
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { try { mountKernelButton(); } catch (e) {} }, 300);
    });

    function mountKernelButton() {
        if (document.getElementById('apk-kernel-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'apk-kernel-btn';
        btn.style.cssText = 'position:fixed;top:70px;right:10px;z-index:9999;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:14px;padding:4px 10px;font-size:12px;backdrop-filter:blur(4px);cursor:pointer;'; // 顶部下方，避开头部"上一页"按钮
        btn.textContent = '内核：' + kernelLabel();
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const next = currentKernel() === 'native' ? 'hls' : 'native';
            localStorage.setItem('playKernel', next);
            btn.textContent = '内核：' + kernelLabel();
            try {
                if (typeof currentVideoUrl !== 'undefined' && currentVideoUrl) initPlayer(currentVideoUrl);
            } catch (err) {}
        });
        document.body.appendChild(btn);
    }
})();
`;
fs.writeFileSync(path.join(WWW, 'js/apk-player-patch.js'), PLAYER_PATCH_JS, 'utf-8');
changes++;
// 注入 player.html（player.js 之后）
patch('player.html', t => {
  if (t.includes('js/apk-player-patch.js')) return t;
  return t.replace('<script src="js/player.js"></script>', '<script src="js/player.js"></script>\n<script src="js/apk-player-patch.js"></script>');
});
// player.js 的 initPlayer 在 DOMContentLoaded 中调用，本补丁（在其后加载）于脚本求值阶段完成包装，初次调用即生效

// 14. watch.js 中转页重定向改为 location.replace：
//     用 player.html 替换 watch.html 的历史记录，物理返回键从播放页可直接回到主界面，
//     否则返回会落在中转页、2.8 秒后被再次重定向回播放页（返回弹跳死循环）
patch('js/watch.js', t => t.replace(
  'window.location.href = finalPlayerUrl;',
  'window.location.replace(finalPlayerUrl); // APK: replace 替换中转页历史记录，返回键直达主界面'
));

// 15. api.js fetch 拦截器：相对 /api/ 路径统一构造虚拟同源 URL
//     （file:// 下 new URL('/api/…', 基准) 的绝对路径解析受 WHATWG Windows 盘符怪癖影响：
//      Windows 得到 /D:/api/…（拦截器漏判、请求直发 file:// 失败），Android 得到 /api/…。
//      统一改为虚拟同源 URL，handleApiRequest 只取 pathname/searchParams，该 URL 不会真实发出）
patch('js/api.js', t => t.replace(
  'const requestUrl = typeof input === \'string\' ? new URL(input, window.__BASE_URL__) : input.url;',
  'let requestUrl;\n' +
  '        if (typeof input === \'string\' && input.indexOf(\'/api/\') === 0) {\n' +
  '            // APK: 相对 /api/ 路径统一构造虚拟同源 URL，规避 file:// 绝对路径解析的平台差异\n' +
  '            requestUrl = new URL(\'http://apk.internal\' + input);\n' +
  '        } else {\n' +
  '            requestUrl = typeof input === \'string\' ? new URL(input, window.__BASE_URL__) : input.url;\n' +
  '        }'
));

// 完成汇总（文件级排除已在复制时处理）

console.log(`完成：共应用 ${changes} 处适配，assets 就绪 → ${WWW}`);
