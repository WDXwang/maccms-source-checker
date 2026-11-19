#!/usr/bin/env node
/**
 * 准备 APK assets：从 LibreTV 前端源码组装适配后的 WebView 资源
 *
 * 用法：node android/prep-assets.mjs --src <LibreTV源码目录> --out <assets输出目录> --customer <customer_site.js>
 *
 * 适配内容：
 *  1. {{PASSWORD}} 占位符置空 —— file:// 加载时无访问密码（个人应用无需密码）
 *  2. proxy-auth.js 置空 —— 前端回退为直连采集接口，配合 WebView UniversalAccess 免 CORS
 *  3. pwa-register.js / version-check.js 禁用 —— APK 环境无 SW、无 GitHub 更新检查
 *  4. customer_site.js 注入最新实测可用源（每日检测产物）
 *  5. 豆瓣推荐默认关闭 —— 豆瓣 API 需服务端代理，APK 直连不可用
 *  6. 排除服务端/部署平台文件
 */
import fs from 'node:fs';
import path from 'node:path';

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

// 7. 豆瓣推荐默认关闭（豆瓣 API 需服务端代理签名，APK 直连不可用）
patch('js/app.js', t =>
  t.replace(/localStorage\.setItem\('doubanEnabled',\s*'true'\)/g, "localStorage.setItem('doubanEnabled', 'false')"));

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

// 完成汇总（文件级排除已在复制时处理）

console.log(`完成：共应用 ${changes} 处适配，assets 就绪 → ${WWW}`);
