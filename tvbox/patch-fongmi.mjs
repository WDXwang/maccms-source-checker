#!/usr/bin/env node
/**
 * FongMi/TV 源码定制补丁（构建个人 TVBox APK 用）：
 *   1. Constant.java 注入内置默认配置地址（每日实测源：点播 sites + 直播 lives）
 *   2. bean/Config.java vod() 空配置回退内置地址 —— 首次启动自动加载，无需手动输入
 *   3. 应用名改为「星辰TV」（含简繁中文资源）
 *   4. 写入 local.properties 签名信息（使用仓库内置 tvbox/keystore/tvbox.p12）
 *
 * 用法：node tvbox/patch-fongmi.mjs <FongMi源码根目录> [--repo-root <本仓库根>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2];
const repoIdx = process.argv.indexOf('--repo-root');
const REPO = repoIdx > -1 ? process.argv[repoIdx + 1] : path.resolve(__dirname, '..');

// 内置默认配置地址（每日 08:30 自动更新的实测源，GitHub 加速通道）
const DEFAULT_CONFIG = 'https://ghfast.top/https://raw.githubusercontent.com/WDXwang/maccms-source-checker/main/output/tvbox.json';
const APP_NAME = '星辰TV';
const KEYSTORE_PASS = 'xctv2026';
const KEY_ALIAS = 'xctv';

if (!SRC || !fs.existsSync(path.join(SRC, 'settings.gradle'))) {
  console.error('用法: node tvbox/patch-fongmi.mjs <FongMi源码根目录>');
  process.exit(1);
}

let changes = 0;
function patch(rel, fn) {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) { console.warn(`警告: ${rel} 不存在，跳过`); return; }
  const before = fs.readFileSync(p, 'utf-8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(p, after, 'utf-8');
    changes++;
    console.log(`已适配: ${rel}`);
  }
}

// 1. Constant.java：内置默认配置地址
patch('app/src/main/java/com/fongmi/android/tv/Constant.java', t => {
  if (t.includes('DEFAULT_CONFIG')) return t;
  return t.replace(
    'public class Constant {',
    'public class Constant {\n\n' +
    '    // 内置默认配置：每日实测源（点播 sites + 直播 lives），首次启动无配置时自动加载\n' +
    `    public static final String DEFAULT_CONFIG = "${DEFAULT_CONFIG}";`
  );
});

// 2. bean/Config.java：vod() 空配置时回退内置地址（create(0, url) 会入库，配置列表可见）
patch('app/src/main/java/com/fongmi/android/tv/bean/Config.java', t => {
  const from = 'return item == null ? create(0) : item;';
  if (!t.includes(from)) throw new Error('Config.vod() 未找到目标代码，上游可能已变更');
  return t.replace(
    from,
    'return item == null ? create(0, com.fongmi.android.tv.Constant.DEFAULT_CONFIG) : item; // 内置默认源'
  );
});

// 3. 应用名（含简繁中文资源）
for (const res of ['values', 'values-zh-rCN', 'values-zh-rTW']) {
  patch(`app/src/main/res/${res}/strings.xml`, t =>
    t.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${APP_NAME}</string>`)
  );
}

// 4. local.properties：签名信息（构建机上的绝对路径）
const keystore = path.join(REPO, 'tvbox', 'keystore', 'tvbox.p12');
if (!fs.existsSync(keystore)) throw new Error('签名文件不存在: ' + keystore);
fs.writeFileSync(
  path.join(SRC, 'local.properties'),
  `storeFile=${keystore}\nkeyAlias=${KEY_ALIAS}\nstorePassword=${KEYSTORE_PASS}\n`,
  'utf-8'
);
changes++;
console.log('已适配: local.properties（签名配置）');

console.log(`完成：共应用 ${changes} 处补丁 → ${SRC}`);
