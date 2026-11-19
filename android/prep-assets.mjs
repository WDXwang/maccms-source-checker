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

// 2. 禁用代理鉴权：window.ProxyAuth = null → api.js/search.js 等回退为直连第三方接口
patch('js/proxy-auth.js', () =>
  '// APK 构建：已禁用服务端代理鉴权\n// WebView 开启 file:// UniversalAccess 后，前端直接请求采集接口\nwindow.ProxyAuth = null;\n');

// 3. 禁用 PWA 注册（file:// 不适用，且避免缓存旧资源）
patch('js/pwa-register.js', () =>
  '// APK 构建：已禁用 Service Worker 注册\n');

// 4. 禁用版本检查（APK 无 GitHub 更新检查）
patch('js/version-check.js', () =>
  '// APK 构建：已禁用版本检查\n');

// 5. 注入最新实测可用源
if (CUSTOMER && fs.existsSync(CUSTOMER)) {
  const content = fs.readFileSync(CUSTOMER, 'utf-8');
  fs.writeFileSync(path.join(WWW, 'js/customer_site.js'), content, 'utf-8');
  changes++; console.log('已适配: js/customer_site.js ← 最新检测产物');
} else {
  console.warn('警告: 未提供 --customer，沿用源码自带数据源');
}

// 6. 豆瓣推荐默认关闭（豆瓣 API 需服务端代理签名，APK 直连不可用）
patch('js/app.js', t =>
  t.replace(/localStorage\.setItem\('doubanEnabled',\s*'true'\)/g, "localStorage.setItem('doubanEnabled', 'false')"));

// 7. 清理体积：排除项已在复制时处理

console.log(`完成：共应用 ${changes} 处适配，assets 就绪 → ${WWW}`);
