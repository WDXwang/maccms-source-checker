#!/usr/bin/env node
/**
 * patch-newtv2.mjs — 「星辰TV」补丁脚本（基于 ctowl2018/NewTV2 配套源码）
 *
 * 背景：上游 FongMi/TV 的私有 media3 AAR 与源码强绑定且不公开；
 *      NewTV2 是与自带 AAR 配套、验证可编译的社区分支（但已移除直播功能）。
 *      本脚本把上游 5.8.7 的直播功能整体回移到 NewTV2，并完成内置配置/改名/签名。
 *
 * 用法（CI 中）：
 *   node tvbox/patch-newtv2.mjs \
 *     --src  <NewTV2 解压根目录> \
 *     --up   <上游 FongMi/TV 5.8.7 解压根目录> \
 *     --keystore <tvbox.p12 路径> \
 *     --config-url <内置配置地址>
 *
 * 所有锚点替换均严格校验，找不到锚点立即抛错（fail-fast，避免静默生成坏源码）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const SRC = arg('src');
const UP = arg('up');
const KEYSTORE = arg('keystore');
const CONFIG_URL = arg('config-url', 'https://ghfast.top/https://raw.githubusercontent.com/WDXwang/maccms-source-checker/main/output/tvbox.json');
if (!SRC || !UP) { console.error('need --src and --up'); process.exit(1); }

const CLOSURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-closure.json');
const closure = JSON.parse(fs.readFileSync(CLOSURE, 'utf8'));

const log = (...a) => console.log('[patch]', ...a);
function mustReplace(file, content, find, replace, what) {
  if (!content.includes(find)) {
    throw new Error(`锚点缺失 @ ${path.relative(SRC, file)} :: ${what}\n  找不到: ${JSON.stringify(find.slice(0, 120))}`);
  }
  return content.replace(find, replace);
}
function readF(p) { return fs.readFileSync(p, 'utf8'); }
function writeF(p, c) { fs.writeFileSync(p, c, 'utf8'); }
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

const SRCSETS = ['main', 'leanback', 'mobile'];

// ============================================================
// 1) 复制直播 Java 闭包（38 个文件，main/leanback/mobile 变体）
//    按 包名+sourceSet 在上游目录中定位（闭包 json 里的 src 是生成机器的本地路径，仅作参考）
// ============================================================
let javaCount = 0;
for (const item of closure.javaCopy) {
  const rel = item.pkg.replace(/\./g, '/') + '.java';
  const srcFile = path.join(UP, 'app/src', item.ss, 'java', rel);
  if (!fs.existsSync(srcFile)) throw new Error(`上游闭包源文件缺失: ${item.ss} ${item.pkg}`);
  const dst = path.join(SRC, 'app/src', item.ss, 'java', rel);
  if (fs.existsSync(dst)) { log('skip(exists)', item.ss, item.pkg); continue; }
  ensureDir(dst);
  fs.copyFileSync(srcFile, dst);
  javaCount++;
}
log(`java copied: ${javaCount}`);

// ============================================================
// 2) 复制直播资源文件 —— 按上游 sourceSet 对应复制（不统一进 main）
//    原因：直播 layout 上游是 leanback/mobile 双版本（如 activity_live.xml），
//    leanback 版引用 CustomLiveListView 等 leanback-only 类；
//    若复制进 main 会让 mobile variant 编译失败（binding 生成引用不可见类）。
// ============================================================
let resCount = 0;
for (const rel of closure.fileRes) {
  for (const ss of SRCSETS) {
    const srcFile = path.join(UP, 'app/src', ss, 'res', rel);
    if (!fs.existsSync(srcFile)) continue;
    const dst = path.join(SRC, 'app/src', ss, 'res', rel);
    if (fs.existsSync(dst)) continue; // 同 sourceSet 已有（NT 自带同名），跳过
    ensureDir(dst);
    fs.copyFileSync(srcFile, dst);
    resCount++;
  }
}
log(`res copied: ${resCount}`);

// 2.1) NT main 的 DanmakuSearchAdapter / FilterChipAdapter 引用的 layout 只在
//      NT leanback/res/layout，mobile variant 缺 binding —— 复制到 main/res/layout（两 flavor 共用）
for (const lay of ['adapter_danmaku_search.xml', 'adapter_filter_chip.xml']) {
  const srcFile = path.join(SRC, 'app/src/leanback/res/layout', lay);
  const dst = path.join(SRC, 'app/src/main/res/layout', lay);
  if (fs.existsSync(srcFile) && !fs.existsSync(dst)) {
    ensureDir(dst);
    fs.copyFileSync(srcFile, dst);
    log('layout copied to main:', lay);
  }
}

// ============================================================
// 2.5) 协议 AAR 复制：闭包文件依赖上游协议库（如 Core -> com.fongmi.hook）
//      而 NewTV2 已裁掉这些协议 AAR，需从上游补回（同源 AAR 天然配套）
// ============================================================
{
  const PROTO_AARS = ['hook-release.aar', 'tvbus-release.aar']; // 上游 5.8.7 自带的协议库
  let copied = 0;
  for (const aar of PROTO_AARS) {
    const src = path.join(UP, 'app/libs', aar);
    if (!fs.existsSync(src)) { log('warn: upstream proto aar missing', aar); continue; }
    const dst = path.join(SRC, 'app/libs', aar);
    if (fs.existsSync(dst)) continue;
    fs.copyFileSync(src, dst);
    copied++;
    log('proto aar copied:', aar);
  }
  if (!copied) log('proto aars: nothing to copy');
}

// ============================================================
// 3) values 增量合并（string/color/style/array 条目）
// ============================================================
function extractEntries(xmlText, tagName, names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(`<${tagName}\\s+name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*>([\\s\\S]*?)</${tagName}>`, 'm');
    const m = xmlText.match(re);
    if (m) out.push(`<${tagName} name="${name}">${m[1]}</${tagName}>`);
  }
  return out;
}
function mergeValues(ntFile, upFile, tagName, names) {
  if (!fs.existsSync(upFile)) { log('warn: no upstream values', path.basename(upFile)); return; }
  const upXml = readF(upFile);
  const unique = [...new Set(names)]; // 同名重复注入会导致资源合并冲突（Found item more than one time）
  const entries = extractEntries(upXml, tagName, unique);
  if (!entries.length) return;
  let nt = fs.existsSync(ntFile) ? readF(ntFile) : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
  const add = [];
  for (const e of entries) {
    const name = e.match(/name="([^"]+)"/)[1];
    if (new RegExp(`<${tagName}\\s+name="${name}"`).test(nt)) continue;
    add.push(e);
  }
  if (!add.length) return;
  nt = mustReplace(ntFile, nt, '</resources>', `    ${add.join('\n    ')}\n</resources>`, `merge ${tagName} into ${path.basename(ntFile)}`);
  writeF(ntFile, nt);
  log(`values merged: ${path.basename(ntFile)} +${add.length} ${tagName}`);
}
const vItems = closure.valueItems || {};
mergeValues(path.join(SRC, 'app/src/main/res/values/strings.xml'), path.join(UP, 'app/src/main/res/values/strings.xml'), 'string', [...(vItems.string || []), 'home_live', 'setting_live', 'nav_live']);
mergeValues(path.join(SRC, 'app/src/main/res/values/colors.xml'), path.join(UP, 'app/src/main/res/values/colors.xml'), 'color', vItems.color || []);
mergeValues(path.join(SRC, 'app/src/main/res/values/styles.xml'), path.join(UP, 'app/src/main/res/values/styles.xml'), 'style', vItems.style || []);
mergeValues(path.join(SRC, 'app/src/main/res/values/arrays.xml'), path.join(UP, 'app/src/main/res/values/arrays.xml'), 'string-array', vItems.array || []);
// mobile 端直播 string（LiveDialog 引用，定义在上游 mobile values）：按 dialog_action_live 前缀整体合并
for (const vdir of ['values', 'values-zh-rCN', 'values-zh-rTW']) {
  const upMob = path.join(UP, 'app/src/mobile/res', vdir, 'strings.xml');
  if (!fs.existsSync(upMob)) continue;
  const upXml = readF(upMob);
  const names = [...upXml.matchAll(/<string\s+name="(dialog_action_live[^"]+)"/g)].map(m => m[1]);
  if (names.length) mergeValues(path.join(SRC, 'app/src/mobile/res', vdir, 'strings.xml'), upMob, 'string', names);
}
// PinchScaleFeedback 引用的 pinch_* string（上游 mobile 三语言各 4 条）
for (const vdir of ['values', 'values-zh-rCN', 'values-zh-rTW']) {
  const upMob = path.join(UP, 'app/src/mobile/res', vdir, 'strings.xml');
  if (!fs.existsSync(upMob)) continue;
  mergeValues(path.join(SRC, 'app/src/mobile/res', vdir, 'strings.xml'), upMob, 'string', ['pinch_zoom', 'pinch_width', 'pinch_height', 'pinch_size']);
}

// 兜底：关键 string 若上游没有则硬编码追加（中文）
{
  const st = path.join(SRC, 'app/src/main/res/values/strings.xml');
  let xml = readF(st);
  const need = [['home_live', '直播'], ['setting_live', '直播'], ['nav_live', '直播']];
  const add = [];
  for (const [k, v] of need) if (!new RegExp(`<string\\s+name="${k}"`).test(xml)) add.push(`<string name="${k}">${v}</string>`);
  if (add.length) { xml = mustReplace(st, xml, '</resources>', `    ${add.join('\n    ')}\n</resources>`, 'fallback strings'); writeF(st, xml); log('fallback strings added:', add.map(a => a.match(/name="([^"]+)"/)[1]).join(',')); }
}

// ============================================================
// 4) 顶部工具栏加「直播」导航键（navVod 与 navMine 之间）
// ============================================================
{
  const tb = path.join(SRC, 'app/src/leanback/res/layout/view_home_toolbar.xml');
  let xml = readF(tb);
  if (!xml.includes('navLive')) {
    const anchor = '<com.google.android.material.textview.MaterialTextView\n            android:id="@+id/navMine"';
    const navLive = [
      '<com.google.android.material.textview.MaterialTextView',
      '            android:id="@+id/navLive"',
      '            android:layout_width="wrap_content"',
      '            android:layout_height="36dp"',
      '            android:layout_marginEnd="8dp"',
      '            android:background="@drawable/selector_nav_button"',
      '            android:ellipsize="end"',
      '            android:focusable="true"',
      '            android:focusableInTouchMode="true"',
      '            android:gravity="center"',
      '            android:maxLines="1"',
      '            android:minWidth="64dp"',
      '            android:nextFocusDown="@id/recycler"',
      '            android:paddingStart="16dp"',
      '            android:paddingEnd="16dp"',
      '            android:text="@string/home_live"',
      '            android:textColor="@color/selector_nav_text"',
      '            android:textSize="16sp"',
      '            android:textStyle="bold" />',
      '',
      '        ',
    ].join('\n');
    xml = mustReplace(tb, xml, anchor, navLive + anchor, 'toolbar navLive button');
    writeF(tb, xml);
    log('toolbar: navLive added');
  } else log('toolbar: navLive already present');
}

// ============================================================
// 5) HomeActivity（leanback）：直播入口 + LiveConfig 初始化 + 内置配置
// ============================================================
{
  const f = path.join(SRC, 'app/src/leanback/java/com/fongmi/android/tv/ui/activity/HomeActivity.java');
  let c = readF(f);
  if (!c.includes('navLive')) {
    // import
    c = mustReplace(f, c, 'import com.fongmi.android.tv.ui.adapter.ConfigMenuAdapter;',
      'import com.fongmi.android.tv.api.config.LiveConfig;\nimport com.fongmi.android.tv.ui.activity.LiveActivity;\nimport com.fongmi.android.tv.ui.adapter.ConfigMenuAdapter;', 'HomeActivity imports');
    // navLive 点击绑定（navMine 前）
    c = mustReplace(f, c, 'mToolbar.navMine.setOnClickListener(v -> SettingActivity.start(this));',
      'mToolbar.navLive.setOnClickListener(v -> LiveActivity.start(this));\n        mToolbar.navMine.setOnClickListener(v -> SettingActivity.start(this));', 'HomeActivity navLive click');
    // navs 数组（6 → 7 项）
    c = mustReplace(f, c, 'View[] navs = {mToolbar.navHome, mToolbar.navMovie, mToolbar.navSeries, mToolbar.navVariety, mToolbar.navVod, mToolbar.navMine};',
      'View[] navs = {mToolbar.navHome, mToolbar.navMovie, mToolbar.navSeries, mToolbar.navVariety, mToolbar.navVod, mToolbar.navLive, mToolbar.navMine};', 'HomeActivity navs array');
    // LiveConfig init + 内置配置注入（mResult 初始化后）
    c = mustReplace(f, c, 'mResult = Result.empty();',
      'mResult = Result.empty();\n        ensureBuiltinConfig();\n        LiveConfig.get().init().load();', 'HomeActivity live init');
    // 常量字段
    c = mustReplace(f, c, 'private ConfigMenuAdapter mConfigMenuAdapter;',
      `private ConfigMenuAdapter mConfigMenuAdapter;\n    /** 内置配置地址：本仓库每日检测后产出的 TVBox 配置（点播 sites + 直播 lives 同源）。 */\n    private static final String BUILTIN_CONFIG_URL = "${CONFIG_URL}";`, 'HomeActivity builtin field');
    // ensureBuiltinConfig 方法（setViewModel 前插）
    c = mustReplace(f, c, 'private void setViewModel() {',
      `private void ensureBuiltinConfig() {
        if (Config.getAll(Config.VOD).isEmpty()) Config.create(Config.VOD, BUILTIN_CONFIG_URL);
        if (Config.getAll(1).isEmpty()) Config.create(1, BUILTIN_CONFIG_URL);
    }

    private void setViewModel() {`, 'HomeActivity ensureBuiltinConfig');
    writeF(f, c);
    log('HomeActivity(leanback): patched');
  } else log('HomeActivity(leanback): already patched');
}

// ============================================================
// 6) VodActivity（leanback）：同样加 navLive（与 HomeActivity 共用工具栏）
// ============================================================
{
  const f = path.join(SRC, 'app/src/leanback/java/com/fongmi/android/tv/ui/activity/VodActivity.java');
  let c = readF(f);
  if (!c.includes('navLive')) {
    c = mustReplace(f, c, 'mToolbar.navMine.setOnClickListener(v -> SettingActivity.start(this));',
      'mToolbar.navLive.setOnClickListener(v -> LiveActivity.start(this));\n        mToolbar.navMine.setOnClickListener(v -> SettingActivity.start(this));', 'VodActivity navLive click');
    c = mustReplace(f, c, 'View[] navs = {mToolbar.navHome, mToolbar.navMovie, mToolbar.navSeries, mToolbar.navVariety, mToolbar.navVod, mToolbar.navMine};',
      'View[] navs = {mToolbar.navHome, mToolbar.navMovie, mToolbar.navSeries, mToolbar.navVariety, mToolbar.navVod, mToolbar.navLive, mToolbar.navMine};', 'VodActivity navs array');
    // LiveActivity 与 VodActivity 同包（ui.activity），无需 import
    writeF(f, c);
    log('VodActivity(leanback): patched');
  } else log('VodActivity(leanback): already patched');
}

// ============================================================
// 7) SettingActivity（leanback）：设置页直播行（点击进直播 / 长按改地址）
// ============================================================
{
  // 7a. 布局：vodHistory 图标后插 live 行块
  const xmlF = path.join(SRC, 'app/src/leanback/res/layout/activity_setting.xml');
  let xml = readF(xmlF);
  if (!xml.includes('id/liveUrl')) {
    const anchor = '            <androidx.appcompat.widget.AppCompatImageView\n                android:id="@+id/vodHistory"';
    const liveBlock = [
      '            <androidx.appcompat.widget.LinearLayoutCompat',
      '                android:id="@+id/live"',
      '                android:layout_width="0dp"',
      '                android:layout_height="wrap_content"',
      '                android:layout_marginEnd="16dp"',
      '                android:layout_weight="1"',
      '                android:background="@drawable/selector_item"',
      '                android:focusable="true"',
      '                android:focusableInTouchMode="true"',
      '                android:orientation="horizontal">',
      '',
      '                <com.google.android.material.textview.MaterialTextView',
      '                    android:layout_width="0dp"',
      '                    android:layout_height="wrap_content"',
      '                    android:layout_marginEnd="16dp"',
      '                    android:layout_weight="0.3"',
      '                    android:text="@string/setting_live"',
      '                    android:textColor="@color/white"',
      '                    android:textSize="18sp" />',
      '',
      '                <com.google.android.material.textview.MaterialTextView',
      '                    android:id="@+id/liveUrl"',
      '                    android:layout_width="0dp"',
      '                    android:layout_height="wrap_content"',
      '                    android:layout_weight="0.7"',
      '                    android:ellipsize="middle"',
      '                    android:gravity="end"',
      '                    android:singleLine="true"',
      '                    android:textColor="@color/white"',
      '                    android:textSize="18sp"',
      '                    tools:ignore="NestedWeights"',
      '                    tools:text="https://" />',
      '',
      '            </androidx.appcompat.widget.LinearLayoutCompat>',
      '',
      '        </androidx.appcompat.widget.LinearLayoutCompat>',
      '',
      '        <androidx.appcompat.widget.LinearLayoutCompat',
      '            android:layout_width="match_parent"',
      '            android:layout_height="wrap_content"',
      '            android:layout_marginTop="16dp"',
      '            android:orientation="horizontal">',
      '',
    ].join('\n');
    // vod row 结束后开一个新 row：需要把 vodHistory 块前的结构收尾再开新行。
    // 简化：live 行放在 vod row 同一容器内（vodHistory 图标之后追加 live 块）。
    const simpleAnchor = 'android:id="@+id/vodHistory"';
    const idx = xml.indexOf(simpleAnchor);
    if (idx < 0) throw new Error('锚点缺失 @ activity_setting.xml :: vodHistory');
    // 找到该 imageView 块的结束 "/>"（从 vodHistory 起）
    const endIdx = xml.indexOf('/>', idx) + 2;
    const insertBlock = [
      '',
      '            <androidx.appcompat.widget.LinearLayoutCompat',
      '                android:id="@+id/live"',
      '                android:layout_width="0dp"',
      '                android:layout_height="wrap_content"',
      '                android:layout_marginStart="16dp"',
      '                android:layout_marginEnd="16dp"',
      '                android:layout_weight="1"',
      '                android:background="@drawable/selector_item"',
      '                android:focusable="true"',
      '                android:focusableInTouchMode="true"',
      '                android:orientation="horizontal">',
      '',
      '                <com.google.android.material.textview.MaterialTextView',
      '                    android:layout_width="0dp"',
      '                    android:layout_height="wrap_content"',
      '                    android:layout_marginEnd="16dp"',
      '                    android:layout_weight="0.3"',
      '                    android:text="@string/setting_live"',
      '                    android:textColor="@color/white"',
      '                    android:textSize="18sp" />',
      '',
      '                <com.google.android.material.textview.MaterialTextView',
      '                    android:id="@+id/liveUrl"',
      '                    android:layout_width="0dp"',
      '                    android:layout_height="wrap_content"',
      '                    android:layout_weight="0.7"',
      '                    android:ellipsize="middle"',
      '                    android:gravity="end"',
      '                    android:singleLine="true"',
      '                    android:textColor="@color/white"',
      '                    android:textSize="18sp"',
      '                    tools:ignore="NestedWeights"',
      '                    tools:text="https://" />',
      '',
      '            </androidx.appcompat.widget.LinearLayoutCompat>',
    ].join('\n');
    xml = xml.slice(0, endIdx) + insertBlock + xml.slice(endIdx);
    writeF(xmlF, xml);
    log('activity_setting.xml: live row inserted');
  } else log('activity_setting.xml: already has live');

  // 7b. SettingActivity Java
  const f = path.join(SRC, 'app/src/leanback/java/com/fongmi/android/tv/ui/activity/SettingActivity.java');
  let c = readF(f);
  if (!c.includes('mBinding.live')) {
    c = mustReplace(f, c, 'import com.fongmi.android.tv.api.config.VodConfig;',
      'import android.text.TextUtils;\nimport android.widget.EditText;\n\nimport com.fongmi.android.tv.api.config.LiveConfig;\nimport com.fongmi.android.tv.api.config.VodConfig;\nimport com.fongmi.android.tv.ui.activity.LiveActivity;\nimport com.google.android.material.dialog.MaterialAlertDialogBuilder;', 'SettingActivity imports');
    c = mustReplace(f, c, 'mBinding.vodUrl.setText(VodConfig.getDesc());',
      'mBinding.vodUrl.setText(VodConfig.getDesc());\n        mBinding.liveUrl.setText(LiveConfig.getDesc());', 'SettingActivity liveUrl text');
    c = mustReplace(f, c, 'mBinding.vod.setOnClickListener(this::onVod);',
      'mBinding.vod.setOnClickListener(this::onVod);\n        mBinding.live.setOnClickListener(this::onLive);\n        mBinding.live.setOnLongClickListener(this::onLiveEdit);', 'SettingActivity live click');
    c = mustReplace(f, c, 'private void onVod(View view) {',
      `private void onLive(View view) {
        LiveActivity.start(this);
    }

    private boolean onLiveEdit(View view) {
        EditText input = new EditText(this);
        input.setText(LiveConfig.getUrl());
        input.setSingleLine(true);
        new MaterialAlertDialogBuilder(this).setTitle(R.string.setting_live).setView(input)
                .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                    String url = input.getText().toString().trim();
                    if (TextUtils.isEmpty(url)) return;
                    Config.delete(url, 1);
                    Config.create(1, url);
                    LiveConfig.get().init().load();
                    mBinding.liveUrl.setText(LiveConfig.getDesc());
                }).setNegativeButton(android.R.string.cancel, null).show();
        return true;
    }

    private void onVod(View view) {`, 'SettingActivity onLive/onLiveEdit');
    writeF(f, c);
    log('SettingActivity(leanback): patched');
  } else log('SettingActivity(leanback): already patched');
}

// ============================================================
// 8) AndroidManifest：LiveActivity / BootReceiver 注册（leanback + mobile）
// ============================================================
{
  const mfL = path.join(SRC, 'app/src/leanback/AndroidManifest.xml');
  let c = readF(mfL);
  if (!c.includes('.ui.activity.LiveActivity')) {
    c = mustReplace(mfL, c, '<activity\n            android:name=".ui.activity.VideoActivity"',
      `<activity
            android:name=".ui.activity.LiveActivity"
            android:configChanges="screenSize|smallestScreenSize|screenLayout|uiMode|orientation"
            android:exported="true"
            android:launchMode="singleTop"
            android:parentActivityName=".ui.activity.HomeActivity"
            android:screenOrientation="sensorLandscape" />

        <activity
            android:name=".ui.activity.VideoActivity"`, 'leanback manifest LiveActivity');
    // BootReceiver 注册（</application> 前）
    c = mustReplace(mfL, c, '    </application>',
      `        <receiver
            android:name=".receiver.BootReceiver"
            android:exported="true"
            android:priority="999">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
            </intent-filter>
        </receiver>

    </application>`, 'leanback manifest BootReceiver');
    // 开机权限（application 标签前）
    c = mustReplace(mfL, c, '    <application android:banner="@mipmap/ic_banner">',
      '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n\n    <application android:banner="@mipmap/ic_banner">', 'leanback manifest boot permission');
    writeF(mfL, c);
    log('leanback manifest: patched');
  } else log('leanback manifest: already patched');

  const mfM = path.join(SRC, 'app/src/mobile/AndroidManifest.xml');
  let m = readF(mfM);
  if (!m.includes('.ui.activity.LiveActivity')) {
    m = mustReplace(mfM, m, '<activity\n            android:name=".ui.activity.VideoActivity"',
      `<activity
            android:name=".ui.activity.LiveActivity"
            android:configChanges="screenSize|smallestScreenSize|screenLayout|uiMode|orientation"
            android:exported="true"
            android:launchMode="singleTop"
            android:parentActivityName=".ui.activity.HomeActivity"
            android:screenOrientation="sensorLandscape"
            android:supportsPictureInPicture="true" />

        <activity
            android:name=".ui.activity.VideoActivity"`, 'mobile manifest LiveActivity');
    writeF(mfM, m);
    log('mobile manifest: patched');
  } else log('mobile manifest: already patched');
}

// ============================================================
// 9) AppDatabase：Live 实体 + LiveDao + VERSION 39 + MIGRATION_38_39
// ============================================================
{
  const db = path.join(SRC, 'app/src/main/java/com/fongmi/android/tv/db/AppDatabase.java');
  let c = readF(db);
  if (!c.includes('LiveDao')) {
    c = mustReplace(db, c, 'import com.fongmi.android.tv.bean.Keep;',
      'import com.fongmi.android.tv.bean.Keep;\nimport com.fongmi.android.tv.bean.Live;', 'AppDatabase import Live');
    c = mustReplace(db, c, 'import com.fongmi.android.tv.db.dao.KeepDao;',
      'import com.fongmi.android.tv.db.dao.KeepDao;\nimport com.fongmi.android.tv.db.dao.LiveDao;', 'AppDatabase import LiveDao');
    c = mustReplace(db, c, 'entities = {Keep.class, Site.class, Track.class,',
      'entities = {Keep.class, Site.class, Live.class, Track.class,', 'AppDatabase entities');
    c = mustReplace(db, c, 'public static final int VERSION = 38;', 'public static final int VERSION = 39;', 'AppDatabase VERSION');
    c = mustReplace(db, c, '    public abstract KeepDao getKeepDao();',
      '    public abstract LiveDao getLiveDao();\n\n    public abstract KeepDao getKeepDao();', 'AppDatabase getLiveDao');
    // 注册 MIGRATION_38_39（在 .build() 前追加）
    if (c.includes('.allowMainThreadQueries().build();')) {
      c = mustReplace(db, c, '.allowMainThreadQueries().build();',
        '.addMigrations(Migrations.MIGRATION_38_39)\n                .allowMainThreadQueries().build();', 'AppDatabase migration hook');
    } else {
      // 逐行 addMigrations 风格：找最后一个 addMigrations 行后插
      const lines = c.split('\n');
      let lastIdx = -1;
      lines.forEach((l, i) => { if (l.includes('.addMigrations(Migrations.')) lastIdx = i; });
      if (lastIdx < 0) throw new Error('锚点缺失 @ AppDatabase :: addMigrations chain');
      lines.splice(lastIdx + 1, 0, '                .addMigrations(Migrations.MIGRATION_38_39)');
      c = lines.join('\n');
    }
    writeF(db, c);
    log('AppDatabase: patched');
  } else log('AppDatabase: already patched');

  // Migrations.java：文件尾 class 结束 } 前插 MIGRATION_38_39
  const mg = path.join(SRC, 'app/src/main/java/com/fongmi/android/tv/db/Migrations.java');
  let g = readF(mg);
  if (!g.includes('MIGRATION_38_39')) {
    const trimmed = g.trimEnd();
    if (!trimmed.endsWith('}')) throw new Error('锚点缺失 @ Migrations.java :: tail }');
    const body = trimmed.slice(0, -1).trimEnd();
    const migration = [
      '',
      '    /**',
      '     * 直播功能回移：重建 Live 表（NewTV2 的 37→38 迁移曾删除它）。',
      '     * 建表语句与上游 schema 37.json 的 Live 定义一致。',
      '     */',
      '    public static final Migration MIGRATION_38_39 = new Migration(38, 39) {',
      '        @Override',
      '        public void migrate(@NonNull SupportSQLiteDatabase database) {',
      '            database.execSQL("CREATE TABLE IF NOT EXISTS `Live` (`name` TEXT NOT NULL, `keep` TEXT, `boot` INTEGER NOT NULL, `pass` INTEGER NOT NULL, PRIMARY KEY(`name`))");',
      '        }',
      '    };',
      '}',
      '',
    ].join('\n');
    writeF(mg, body + '\n' + migration);
    log('Migrations: MIGRATION_38_39 added');
  } else log('Migrations: already patched');
}

// ============================================================
// 10) mobile 端：底部导航加「直播」+ 初始化 + 内置配置
// ============================================================
{
  // menu_nav.xml 加 live item
  const menu = path.join(SRC, 'app/src/mobile/res/menu/menu_nav.xml');
  let x = readF(menu);
  if (!x.includes('id/live')) {
    x = mustReplace(menu, x, '</menu>',
      `    <item
        android:id="@+id/live"
        android:icon="@drawable/ic_nav_vod"
        android:title="@string/nav_live"
        android:visible="false" />

</menu>`, 'menu_nav live item');
    writeF(menu, x);
    log('menu_nav.xml: live item added');
  }

  // mobile HomeActivity
  const f = path.join(SRC, 'app/src/mobile/java/com/fongmi/android/tv/ui/activity/HomeActivity.java');
  let c = readF(f);
  if (!c.includes('LiveActivity')) {
    // import（找 VodConfig import 锚点）
    if (c.includes('import com.fongmi.android.tv.api.config.VodConfig;')) {
      c = mustReplace(f, c, 'import com.fongmi.android.tv.api.config.VodConfig;',
        'import com.fongmi.android.tv.api.config.LiveConfig;\nimport com.fongmi.android.tv.api.config.VodConfig;\nimport com.fongmi.android.tv.bean.Config;\nimport com.fongmi.android.tv.ui.activity.LiveActivity;', 'mobile HomeActivity imports');
    } else {
      throw new Error('锚点缺失 @ mobile HomeActivity :: VodConfig import');
    }
    // initConfig 里加直播 init + 内置配置
    c = mustReplace(f, c, 'VodConfig.get().init().load(getCallback());',
      `VodConfig.get().init().load(getCallback());
        ensureBuiltinConfig();
        LiveConfig.get().init().load();`, 'mobile HomeActivity live init');
    // 内置配置方法
    c = mustReplace(f, c, 'private Callback getCallback() {',
      `private void ensureBuiltinConfig() {
        String url = BUILTIN_CONFIG_URL;
        if (Config.getAll(Config.VOD).isEmpty()) Config.create(Config.VOD, url);
        if (Config.getAll(1).isEmpty()) Config.create(1, url);
    }

    private Callback getCallback() {`, 'mobile HomeActivity ensureBuiltinConfig');
    // 常量：找类体首个字段或直接在 initConfig 前插常量不行——Java 常量在字段区。
    // 用 class 声明行后插（public class HomeActivity ... {）
    const clsMatch = c.match(/public class HomeActivity[^\{]*\{/);
    if (!clsMatch) throw new Error('锚点缺失 @ mobile HomeActivity :: class decl');
    c = c.replace(clsMatch[0], clsMatch[0] + `\n    /** 内置配置地址（与本仓库每日检测产物同源）。 */\n    private static final String BUILTIN_CONFIG_URL = "${CONFIG_URL}";\n`);
    // setNavigation 显示 live
    c = mustReplace(f, c, 'mBinding.navigation.getMenu().findItem(R.id.setting).setVisible(true);',
      'mBinding.navigation.getMenu().findItem(R.id.setting).setVisible(true);\n        mBinding.navigation.getMenu().findItem(R.id.live).setVisible(true);', 'mobile setNavigation live');
    // 菜单点击
    c = mustReplace(f, c, 'if (item.getItemId() == R.id.vod) return mManager.change(0);',
      'if (item.getItemId() == R.id.live) { LiveActivity.start(this); return true; }\n        if (item.getItemId() == R.id.vod) return mManager.change(0);', 'mobile onNavigationItemSelected live');
    writeF(f, c);
    log('mobile HomeActivity: patched');
  }
}

// ============================================================
// 11) app_name → 星辰TV（所有存在的 values 变体）
// ============================================================
{
  const dirs = ['values', 'values-zh-rCN', 'values-zh-rTW', 'values-en'];
  for (const d of dirs) {
    const f = path.join(SRC, 'app/src/main/res', d, 'strings.xml');
    if (!fs.existsSync(f)) continue;
    let c = readF(f);
    if (!c.includes('name="app_name"')) continue;
    c = c.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">星辰TV</string>');
    writeF(f, c);
    log('app_name → 星辰TV @', d);
  }
}

// ============================================================
// 12) Github.java 更新检查指向自己的仓库（避免自动升级到上游版本）
// ============================================================
{
  const f = path.join(SRC, 'app/src/main/java/com/fongmi/android/tv/utils/Github.java');
  let c = readF(f);
  if (c.includes('FongMi/Release')) {
    c = mustReplace(f, c, 'private static final String REPO = "FongMi/Release";',
      'private static final String REPO = "WDXwang/maccms-source-checker";', 'Github REPO');
    writeF(f, c);
    log('Github.java: REPO → WDXwang/maccms-source-checker');
  }
}

// ============================================================
// 13) 签名：复制 keystore + 写 local.properties
// ============================================================
{
  if (KEYSTORE && fs.existsSync(KEYSTORE)) {
    // 注意：NewTV2 的 app/build.gradle 用 file(localProps['storeFile']) 解析路径，
    // 相对路径以 app/ 模块目录为基准，故 keystore 必须放在 app/keystore/ 下。
    const ksDir = path.join(SRC, 'app', 'keystore');
    ensureDir(path.join(ksDir, 'x.tmp'));
    const ksDst = path.join(ksDir, 'tvbox.p12');
    fs.copyFileSync(KEYSTORE, ksDst);
    log('keystore copied to', ksDst);
    const lp = path.join(SRC, 'local.properties');
    writeF(lp, [
      'storeFile=keystore/tvbox.p12',
      'keyAlias=xctv',
      'keyPassword=xctv2026',
      'storePassword=xctv2026',
      '',
    ].join('\n'));
    log('local.properties written');
  } else if (KEYSTORE) {
    throw new Error('keystore not found: ' + KEYSTORE);
  }
}

log('ALL PATCHES DONE ✔');

// ============================================================
// 5.5) API 回移：NewTV2 裁剪直播时删除的相关 API，逐个补回
//      （方法体取自上游 5.8.7 同源实现；纯文本锚点替换）
// ============================================================
function patchFile(rel, fn) {
  const f = path.join(SRC, rel);
  let c = readF(f);
  c = fn(f, c);
  writeF(f, c);
}

// A. Result：timeshift 字段 + getter/setter
patchFile('app/src/main/java/com/fongmi/android/tv/bean/Result.java', (f, c) => {
  if (c.includes('getTimeshift')) return c;
  c = mustReplace(f, c, '    @Path("class")\n    @ElementList(entry = "ty", required = false, inline = true)', '    @SerializedName("timeshift")\n    private Timeshift timeshift;\n\n    @Path("class")\n    @ElementList(entry = "ty", required = false, inline = true)', 'Result timeshift field');
  const tail = c.trimEnd();
  if (!tail.endsWith('}')) throw new Error('锚点缺失 @ Result :: tail }');
  c = tail.slice(0, -1).trimEnd() + '\n\n    public Timeshift getTimeshift() {\n        return timeshift;\n    }\n\n    public void setTimeshift(Timeshift timeshift) {\n        this.timeshift = timeshift;\n    }\n}\n';
  return c;
});

// B. MediaItemFactory：buildLiveMetadata
patchFile('app/src/main/java/com/fongmi/android/tv/player/media/MediaItemFactory.java', (f, c) => {
  if (c.includes('buildLiveMetadata')) return c;
  if (!c.includes('import com.fongmi.android.tv.bean.EpgData;')) {
    c = mustReplace(f, c, 'import com.fongmi.android.tv.bean.', 'import com.fongmi.android.tv.bean.EpgData;\nimport com.fongmi.android.tv.bean.', 'MediaItemFactory import EpgData');
  }
  return mustReplace(f, c, 'public static Uri getArtworkUri', `public static MediaMetadata buildLiveMetadata(String title, @Nullable EpgData data, String artUri) {
        String details = data == null ? "" : data.format();
        return buildMetadata(title, details, artUri).buildUpon().setStation(title).setDisplayTitle(title).setMediaType(MediaMetadata.MEDIA_TYPE_TV_CHANNEL).build();
    }

    public static Uri getArtworkUri`, 'MediaItemFactory buildLiveMetadata');
});

// C. PlayerSetting：scale 缩放 API（MIN/MAX_SCALE/getScaleMode NewTV2 已有，只补 getScale/putScale）
patchFile('app/src/main/java/com/fongmi/android/tv/setting/PlayerSetting.java', (f, c) => {
  if (c.includes('getScale()')) return c;
  return mustReplace(f, c, 'public static int getBackground() {', `public static int getScale() {
        return Math.clamp(Prefers.getInt("scale"), MIN_SCALE, MAX_SCALE);
    }

    public static void putScale(int scale) {
        Prefers.put("scale", Math.clamp(scale, MIN_SCALE, MAX_SCALE));
    }

    public static int getBackground() {`, 'PlayerSetting scale api');
});

// C2. BaseConfig：补 LIVE 类型常量（NewTV2 裁剪直播时删掉）
patchFile('app/src/main/java/com/fongmi/android/tv/api/config/BaseConfig.java', (f, c) => {
  if (c.includes('int LIVE = 1')) return c;
  return mustReplace(f, c, 'public static final int VOD = 0;', 'public static final int VOD = 0;\n    public static final int LIVE = 1;', 'BaseConfig LIVE const');
});

// D. Constant：直播超时常量
patchFile('app/src/main/java/com/fongmi/android/tv/Constant.java', (f, c) => {
  if (c.includes('TIMEOUT_LIVE')) return c;
  return mustReplace(f, c, 'public static final long TIMEOUT_VOD = TimeUnit.SECONDS.toMillis(30);', 'public static final long TIMEOUT_VOD = TimeUnit.SECONDS.toMillis(30);\n    public static final long TIMEOUT_LIVE = TimeUnit.SECONDS.toMillis(30);\n    public static final long TIMEOUT_EPG = TimeUnit.SECONDS.toMillis(5);\n    public static final long TIMEOUT_PARSE_LIVE = TimeUnit.SECONDS.toMillis(10);', 'Constant live timeouts');
});

// E. Config.live()：读取 type=1 直播配置
patchFile('app/src/main/java/com/fongmi/android/tv/bean/Config.java', (f, c) => {
  if (c.includes('public static Config live()')) return c;
  return mustReplace(f, c, 'public static List<Config> findUrls()', `public static Config live() {
        String url = Prefers.getString("config_1");
        Config item = TextUtils.isEmpty(url) ? null : AppDatabase.get().getConfigDao().find(url, 1);
        if (item == null) item = AppDatabase.get().getConfigDao().findOne(1);
        return item == null ? create(1) : item;
    }

    public static List<Config> findUrls()`, 'Config live()');
});

// F. ConfigEvent：LIVE/BOOT 事件
patchFile('app/src/main/java/com/fongmi/android/tv/event/ConfigEvent.java', (f, c) => {
  if (c.includes('Type.LIVE')) return c;
  c = mustReplace(f, c, 'import org.greenrobot.eventbus.EventBus;', 'import com.fongmi.android.tv.setting.LiveSetting;\n\nimport org.greenrobot.eventbus.EventBus;', 'ConfigEvent import LiveSetting');
  c = mustReplace(f, c, 'public static void vod() {\n        EventBus.getDefault().post(new ConfigEvent(Type.VOD));\n    }', `public static void vod() {
        EventBus.getDefault().post(new ConfigEvent(Type.VOD));
    }

    public static void live() {
        EventBus.getDefault().post(new ConfigEvent(Type.LIVE));
    }

    public static void boot() {
        EventBus.getDefault().post(new ConfigEvent(Type.BOOT));
        LiveSetting.putBoot(false);
    }

    public boolean isLive() {
        return type == Type.LIVE;
    }`, 'ConfigEvent live/boot');
  return mustReplace(f, c, 'enum Type {\n        COMMON, VOD\n    }', 'enum Type {\n        COMMON, VOD, LIVE, BOOT\n    }', 'ConfigEvent Type enum');
});

// G. Keep：直播收藏 API（type 字段 NT 已有）
patchFile('app/src/main/java/com/fongmi/android/tv/bean/Keep.java', (f, c) => {
  if (c.includes('public static boolean exist(String key)')) return c;
  const tail = c.trimEnd();
  if (!tail.endsWith('}')) throw new Error('锚点缺失 @ Keep :: tail }');
  const add = [];

  if (!c.includes('public void setType(int')) add.push('    public void setType(int type) {\n        this.type = type;\n    }');
  if (!c.includes('public int getType()')) add.push('    public int getType() {\n        return type;\n    }');
  add.push(`    public static boolean exist(String key) {
        return AppDatabase.get().getKeepDao().find(key) != null;
    }

    public static List<Keep> getLive() {
        return AppDatabase.get().getKeepDao().getLive();
    }

    public static void delete(String key) {
        AppDatabase.get().getKeepDao().delete(key);
    }`);
  return tail.slice(0, -1).trimEnd() + '\n\n' + add.join('\n\n') + '\n}\n';
});

// H. KeepDao：直播查询
patchFile('app/src/main/java/com/fongmi/android/tv/db/dao/KeepDao.java', (f, c) => {
  if (c.includes('List<Keep> getLive()')) return c;
  return mustReplace(f, c, 'public abstract Keep find(int cid, String key);', `public abstract Keep find(int cid, String key);

    @Query("SELECT * FROM Keep WHERE type = 1 AND \`key\` = :key")
    public abstract Keep find(String key);

    @Query("SELECT * FROM Keep WHERE type = 1 ORDER BY createTime DESC")
    public abstract List<Keep> getLive();

    @Query("DELETE FROM Keep WHERE type = 1 AND \`key\` = :key")
    public abstract void delete(String key);`, 'KeepDao live queries');
});

// I. PlayerEngineDialog：setText（NewTV2 无引擎文本概念，空实现保持兼容）
patchFile('app/src/main/java/com/fongmi/android/tv/ui/dialog/PlayerEngineDialog.java', (f, c) => {
  if (c.includes('public static void setText(TextView view)')) return c;
  c = mustReplace(f, c, 'import android.view.LayoutInflater;', 'import android.view.LayoutInflater;\nimport android.widget.TextView;', 'PlayerEngineDialog import TextView');
  return mustReplace(f, c, 'public static void show(FragmentActivity activity)', `public static void setText(TextView view) {
        if (view != null) view.setText("");
    }

    public static void setText(TextView view, PlayerManager player) {
        setText(view);
    }

    public static void show(FragmentActivity activity)`, 'PlayerEngineDialog setText');
});

// J. PlaybackAction：setPlaybackMode（空实现，引擎切换逻辑在 PlayerManager 内部）
patchFile('app/src/main/java/com/fongmi/android/tv/playback/PlaybackAction.java', (f, c) => {
  if (c.includes('setPlaybackMode')) return c;
  return mustReplace(f, c, 'public static float toggleSpeed(PlayerManager player, TextView view)', `public static void setPlaybackMode(PlayerManager player, TextView engine) {
        if (engine != null) engine.setText("");
    }

    public static float toggleSpeed(PlayerManager player, TextView view)`, 'PlaybackAction setPlaybackMode');
});

// K. HistoryDialog（leanback + mobile）：live()
for (const ss of ['leanback', 'mobile']) {
  const rel = `app/src/${ss}/java/com/fongmi/android/tv/ui/dialog/HistoryDialog.java`;
  if (!fs.existsSync(path.join(SRC, rel))) { log('warn: no HistoryDialog @', ss); continue; }
  patchFile(rel, (f, c) => {
    if (c.includes('public HistoryDialog live()')) return c;
    return mustReplace(f, c, 'public HistoryDialog vod()', `public HistoryDialog live() {
        type = 1;
        return this;
    }

    public HistoryDialog vod()`, `HistoryDialog live @ ${ss}`);
  });
}

// L. BrowseTree：直播媒体浏览分支 + LiveMetadata 支撑方法
patchFile('app/src/main/java/com/fongmi/android/tv/browse/BrowseTree.java', (f, c) => {
  if (c.includes('LIVE_KEEP')) return c;
  c = mustReplace(f, c, 'import com.fongmi.android.tv.player.media.MediaItemFactory;', 'import com.fongmi.android.tv.browse.LiveBrowse;\nimport com.fongmi.android.tv.player.media.MediaItemFactory;', 'BrowseTree import LiveBrowse');
  c = mustReplace(f, c, 'private static final String VOD = "VOD";', 'private static final String VOD = "VOD";\n    private static final String LIVE = "LIVE";\n    public static final String LIVE_KEEP = "LIVE_KEEP";', 'BrowseTree LIVE consts');
  // LIVE_FOLDER：VOD_FOLDER 行含繁简中文差异，按行定位后插入
  {
    const lines = c.split('\n');
    const idx = lines.findIndex(l => l.includes('VOD_FOLDER = build(VOD'));
    if (idx < 0) throw new Error('锚点缺失 @ BrowseTree :: VOD_FOLDER line');
    const block = [
      '    private static final MediaItem LIVE_FOLDER;',
      '',
      '    static {',
      '        Bundle extras = new Bundle();',
      '        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, CONTENT_STYLE_LIST);',
      '        MediaMetadata meta = new MediaMetadata.Builder().setTitle("直播").setArtworkUri(Uri.parse(icon(R.drawable.ic_nav_live))).setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).setExtras(extras).build();',
      '        LIVE_FOLDER = new MediaItem.Builder().setMediaId(LIVE).setMediaMetadata(meta).build();',
      '    }',
    ].join('\n');
    lines.splice(idx + 1, 0, block);
    c = lines.join('\n');
  }
  c = mustReplace(f, c, 'case ROOT -> ImmutableList.of(VOD_FOLDER);', 'case ROOT -> ImmutableList.of(VOD_FOLDER, LIVE_FOLDER);', 'BrowseTree ROOT case');
  c = mustReplace(f, c, 'case VOD_KEEP -> VodBrowse.getFavorites();', `case VOD_KEEP -> VodBrowse.getFavorites();
            case LIVE -> ImmutableList.<MediaItem>builder().add(getItem(LIVE_KEEP)).addAll(LiveBrowse.getGroups()).build();
            case LIVE_KEEP -> LiveBrowse.getFavorites();`, 'BrowseTree LIVE cases');
  c = mustReplace(f, c, 'if (parentId.startsWith(VodBrowse.VOD_DETAIL)) yield VodBrowse.getEpisodes(parentId);', `if (parentId.startsWith(LiveBrowse.LIVE_GROUP)) yield LiveBrowse.getChannels(parentId);
                if (parentId.startsWith(VodBrowse.VOD_DETAIL)) yield VodBrowse.getEpisodes(parentId);`, 'BrowseTree default LIVE');
  // LiveMetadata 支撑方法（文件尾追加）
  const tail = c.trimEnd();
  if (!tail.endsWith('}')) throw new Error('锚点缺失 @ BrowseTree :: tail }');
  c = tail.slice(0, -1).trimEnd() + `

    @Nullable
    public static MediaMetadata loadLiveMetadata(String mediaId) {
        return LiveBrowse.loadMetadata(mediaId);
    }

    @Nullable
    public static String getLiveGroupId(String mediaId) {
        int separator = mediaId.lastIndexOf('|');
        return mediaId.startsWith(LiveBrowse.LIVE_CH) && separator >= LiveBrowse.LIVE_CH.length()
                ? LiveBrowse.LIVE_GROUP + mediaId.substring(LiveBrowse.LIVE_CH.length(), separator) : null;
    }
}
`;
  return c;
});

// M. LiveActivity（leanback + mobile）：删除 customWall override（NewTV2 BaseActivity 无壁纸体系）
for (const ss of ['leanback', 'mobile']) {
  const rel = `app/src/${ss}/java/com/fongmi/android/tv/ui/activity/LiveActivity.java`;
  if (!fs.existsSync(path.join(SRC, rel))) continue;
  patchFile(rel, (f, c) => {
    if (!c.includes('customWall')) return c;
    return mustReplace(f, c, `    @Override
    protected boolean customWall() {
        return false;
    }

`, '', `LiveActivity customWall removal @ ${ss}`);
  });
}

// N. ic_nav_live 资源（上游有，闭包未覆盖——BrowseTree LIVE_FOLDER 引用）
{
  const srcIcon = path.join(UP, 'app/src/main/res/drawable/ic_nav_live.xml');
  const dstIcon = path.join(SRC, 'app/src/main/res/drawable/ic_nav_live.xml');
  if (fs.existsSync(srcIcon) && !fs.existsSync(dstIcon)) {
    fs.copyFileSync(srcIcon, dstIcon);
    log('res copied: drawable/ic_nav_live.xml');
  }
}

// O. BrowsePlayback：直播流 4 参构造器（channelName，上游 LiveBrowse 调用）
patchFile('app/src/main/java/com/fongmi/android/tv/browse/BrowsePlayback.java', (f, c) => {
  if (c.includes('String channelName')) return c;
  c = mustReplace(f, c, '    private final long resumePositionMs;', '    private final String channelName;\n    private final long resumePositionMs;', 'BrowsePlayback channelName field');
  c = mustReplace(f, c, `    BrowsePlayback(String mediaId, Result result, @Nullable History history) {
        this.mediaId = mediaId;
        this.result = result;
        this.history = history;
        this.resumePositionMs = history != null && history.getPosition() > 0 ? history.getPosition() : C.TIME_UNSET;
    }`, `    BrowsePlayback(String mediaId, Result result, @Nullable History history) {
        this(mediaId, result, history, null);
    }

    BrowsePlayback(String mediaId, Result result, @Nullable History history, @Nullable String channelName) {
        this.mediaId = mediaId;
        this.result = result;
        this.history = history;
        this.channelName = channelName;
        this.resumePositionMs = history != null && history.getPosition() > 0 ? history.getPosition() : C.TIME_UNSET;
    }`, 'BrowsePlayback 4-arg ctor');
  const tail = c.trimEnd();
  if (!tail.endsWith('}')) throw new Error('锚点缺失 @ BrowsePlayback :: tail }');
  return tail.slice(0, -1).trimEnd() + '\n\n    public String getChannelName() {\n        return channelName;\n    }\n}\n';
});

// P. RefreshEvent：LIVE 类型 + live()
patchFile('app/src/main/java/com/fongmi/android/tv/event/RefreshEvent.java', (f, c) => {
  if (c.includes('Type.LIVE')) return c;
  c = mustReplace(f, c, 'public static void theme() {', `public static void live() {
        EventBus.getDefault().post(new RefreshEvent(Type.LIVE));
    }

    public static void theme() {`, 'RefreshEvent live()');
  return mustReplace(f, c, 'SUBTITLE, DANMAKU', 'SUBTITLE, DANMAKU, LIVE', 'RefreshEvent Type LIVE');
});

// ============================================================
// Q. 手机端手势三件套：用上游版覆盖 NT 的（NT 的 PinchScale 是
//    package-private 且无 Axis 枚举，mobile LiveActivity 编译不过）
// ============================================================
for (const cls of ['PinchScale.java', 'PinchScaleFeedback.java', 'TouchInput.java']) {
  const srcFile = path.join(UP, 'app/src/mobile/java/com/fongmi/android/tv/ui/custom', cls);
  const dst = path.join(SRC, 'app/src/mobile/java/com/fongmi/android/tv/ui/custom', cls);
  if (!fs.existsSync(srcFile)) throw new Error(`上游手势类缺失: ${cls}`);
  fs.copyFileSync(srcFile, dst);
  log('mobile gesture class replaced:', cls);
}

// R. 自建 androidx.media3.common.VideoTransform（上游私有 AAR 才有此类，
//    NewTV2 配套 AAR 缺失；自建值对象保 TouchInput 编译）
{
  const vtDir = path.join(SRC, 'app/src/main/java/androidx/media3/common');
  const vtFile = path.join(vtDir, 'VideoTransform.java');
  if (!fs.existsSync(vtFile)) {
    ensureDir(vtFile);
    writeF(vtFile, `package androidx.media3.common;

/**
 * 本地自建值对象：上游 FongMi/TV 的私有 media3 AAR 内含 VideoTransform（画面缩放/平移），
 * NewTV2 配套 AAR 无此类。为使手机端 TouchInput 手势编译而重建，仅保留值语义，
 * 实际画面变换由 PlayerView 决定（本 AAR 不支持时手势反馈仍正常、画面不变换）。
 */
public final class VideoTransform {

    public static final VideoTransform DEFAULT = new VideoTransform(1f, 1f, 0f, 0f);

    public final float scaleX;
    public final float scaleY;
    public final float panX;
    public final float panY;

    public VideoTransform(float scaleX, float scaleY, float panX, float panY) {
        this.scaleX = scaleX;
        this.scaleY = scaleY;
        this.panX = panX;
        this.panY = panY;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof VideoTransform)) return false;
        VideoTransform that = (VideoTransform) o;
        return scaleX == that.scaleX && scaleY == that.scaleY && panX == that.panX && panY == that.panY;
    }

    @Override
    public int hashCode() {
        int result = Float.floatToIntBits(scaleX);
        result = 31 * result + Float.floatToIntBits(scaleY);
        result = 31 * result + Float.floatToIntBits(panX);
        result = 31 * result + Float.floatToIntBits(panY);
        return result;
    }
}
`);
    log('VideoTransform stub created');
  }
}

// S. TouchInput（上游版已覆盖）打补丁：AAR PlayerView 无 getVideoTransform /
//    animateVideoTransform / setVideoTransform / finishVideoTransformAnimation /
//    getVideoBounds —— 全部替换为本地 VideoTransform 状态 + view bounds
patchFile('app/src/mobile/java/com/fongmi/android/tv/ui/custom/TouchInput.java', (f, c) => {
  if (c.includes('private VideoTransform videoTransform = VideoTransform.DEFAULT;')) return c; // 已打补丁
  c = mustReplace(f, c, '    private final PlayerView videoView;', `    private final PlayerView videoView;
    /** 本地画面变换状态（AAR PlayerView 无该 API，仅维持值语义与手势反馈） */
    private VideoTransform videoTransform = VideoTransform.DEFAULT;`, 'TouchInput local transform field');
  c = mustReplace(f, c, '        if (!videoView.getVideoTransform().equals(VideoTransform.DEFAULT)) videoView.animateVideoTransform(VideoTransform.DEFAULT, 250);', '        if (!videoTransform.equals(VideoTransform.DEFAULT)) videoTransform = VideoTransform.DEFAULT;', 'TouchInput resetScale');
  c = mustReplace(f, c, '        return !videoView.getVideoTransform().equals(VideoTransform.DEFAULT);', '        return !videoTransform.equals(VideoTransform.DEFAULT);', 'TouchInput isScaled');
  c = mustReplace(f, c, '        videoView.finishVideoTransformAnimation();\n        VideoTransform transform = videoView.getVideoTransform();', '        VideoTransform transform = videoTransform;', 'TouchInput onScaleBegin');
  c = mustReplace(f, c, '        pinchContentBounds.set(videoView.getVideoBounds());', '        pinchContentBounds.set(0, 0, videoView.getWidth(), videoView.getHeight());', 'TouchInput pinchContentBounds');
  c = mustReplace(f, c, '            VideoTransform target = videoTransform(pinchScale.getScaleX(), pinchScale.getScaleY(), releasedX, releasedY);\n            if (!target.equals(videoView.getVideoTransform())) videoView.animateVideoTransform(target, 180);', '            videoTransform = videoTransform(pinchScale.getScaleX(), pinchScale.getScaleY(), releasedX, releasedY);', 'TouchInput onScaleEnd');
  c = mustReplace(f, c, '        videoView.setVideoTransform(videoTransform(pinchScale.getVisualScaleX(), pinchScale.getVisualScaleY(), translationX, translationY));', '        videoTransform = videoTransform(pinchScale.getVisualScaleX(), pinchScale.getVisualScaleY(), translationX, translationY);', 'TouchInput onScale');
  // 残余引用兜底检查
  if (c.includes('videoView.getVideoTransform') || c.includes('videoView.animateVideoTransform') || c.includes('videoView.setVideoTransform') || c.includes('videoView.finishVideoTransformAnimation') || c.includes('videoView.getVideoBounds')) {
    throw new Error('TouchInput 仍残留 AAR 缺失方法调用');
  }
  return c;
});

log('API BACKPORT DONE ✔');

// ============================================================
// T. mobile VideoActivity / CastDialog：适配上游手势接口与直播投屏
// ============================================================
// T1. VideoActivity：onPinchScale 旧签名改为上游 TouchInput.Listener 新签名（含 Axis）
patchFile('app/src/mobile/java/com/fongmi/android/tv/ui/activity/VideoActivity.java', (f, c) => {
  if (c.includes('onPinchScale(PinchScale.Axis axis')) return c;
  if (!c.includes('import com.fongmi.android.tv.ui.custom.PinchScale;')) {
    c = mustReplace(f, c, 'import com.fongmi.android.tv.ui.custom.PinchScaleFeedback;', 'import com.fongmi.android.tv.ui.custom.PinchScale;\nimport com.fongmi.android.tv.ui.custom.PinchScaleFeedback;', 'VideoActivity import PinchScale');
  }
  c = mustReplace(f, c, '    public void onPinchScale(float scaleX, float scaleY) {\n        if (!mScaleFeedback.isActive()) PlaybackAction.hideSpeedHint(mBinding.widget.message);\n        mScaleFeedback.show(scaleX, scaleY);\n    }', '    public void onPinchScale(PinchScale.Axis axis, float scaleX, float scaleY) {\n        if (!mScaleFeedback.isActive()) PlaybackAction.hideSpeedHint(mBinding.widget.message);\n        mScaleFeedback.show(axis, scaleX, scaleY);\n    }', 'VideoActivity onPinchScale signature');
  return c;
});

// T2. CastDialog：补 createLive（上游 LiveActivity 投屏入口调用）
patchFile('app/src/mobile/java/com/fongmi/android/tv/ui/dialog/CastDialog.java', (f, c) => {
  if (c.includes('public static CastDialog createLive(')) return c;
  return mustReplace(f, c, '    public static CastDialog create(PlayerManager player) {', `    public static CastDialog createLive(PlayerManager player) {
        return createInternal(player, false);
    }

    public static CastDialog create(PlayerManager player) {`, 'CastDialog createLive');
});

// ============================================================
// U. mobile variant 资源补齐（引用了 leanback-only / 两边都没有的资源）
//    递归闭合：补进 main 的资源引用其他资源时一并补齐
// ============================================================
{
  // 在 main res 中查找资源（文件型）；返回 true 若已存在
  const resInMain = (rel) => fs.existsSync(path.join(SRC, 'app/src/main/res', rel));
  // 从 NT leanback / 上游 mobile 找资源源文件（drawable/color 目录，xml 扩展）
  const findResAny = (type, name) => {
    const cands = [];
    if (type === 'color') cands.push(`color/${name}.xml`);
    for (const d of [`${type}/`, `${type}-nodpi/`]) cands.push(`${d}${name}.xml`);
    for (const rel of cands) {
      for (const ss of ['leanback', 'mobile']) {
        for (const root of [SRC, UP]) {
          const p = path.join(root, 'app/src', ss, 'res', rel);
          if (fs.existsSync(p)) return p;
        }
      }
      // main 里的上游资源
      const upMain = path.join(UP, 'app/src/main/res', rel);
      if (fs.existsSync(upMain)) return upMain;
    }
    return null;
  };
  // 解析资源文件的 @type/name 引用
  const parseRefs = (file) => {
    const code = fs.readFileSync(file, 'utf8');
    const refs = new Set();
    for (const m of code.matchAll(/@(drawable|color|string|dimen|style|anim|menu|xml|mipmap)\/([\w.]+)/g)) refs.add(`${m[1]}/${m[2]}`);
    return refs;
  };

  // U1. 初始种子（mobile variant 引用但 main/mobile 缺的资源）
  const seeds = [
    ['drawable', 'shape_live'],
    ['drawable', 'selector_sheet_chip'],
    ['drawable', 'selector_filter_chip'],
    ['color', 'selector_filter_chip_text'],
  ];
  let backfillCount = 0;
  const queue = [...seeds];
  const done = new Set();
  while (queue.length) {
    const [type, name] = queue.shift();
    const key = `${type}/${name}`;
    if (done.has(key)) continue;
    done.add(key);
    if (type === 'string' || type === 'dimen' || type === 'style' || type === 'anim' || type === 'menu' || type === 'xml' || type === 'mipmap') {
      // values/其他类型暂不递归（seed 均为 drawable/color）
      continue;
    }
    // string/dimen 引用走 values 合并；这里只处理 drawable/color 文件型
    const rel = type === 'color' ? `color/${name}.xml` : `drawable/${name}.xml`;
    if (resInMain(rel)) continue; // main 已有
    const srcFile = findResAny(type, name);
    if (!srcFile) { log('warn: backfill res not found', key); continue; }
    const dst = path.join(SRC, 'app/src/main/res', rel);
    ensureDir(dst);
    fs.copyFileSync(srcFile, dst);
    backfillCount++;
    log('res backfilled to main:', rel);
    // 递归：该资源引用的其他资源也需补齐（仅 drawable/color 文件型）
    for (const ref of parseRefs(dst)) {
      const [t, n] = ref.split('/');
      if (t === 'drawable' || t === 'color') queue.push([t, n]);
    }
  }
  log(`res backfilled total: ${backfillCount}`);

  // U2. grey_500：NT/上游都没有定义，但 mobile layout 引用（trackColor）→ 自建
  {
    const f = path.join(SRC, 'app/src/main/res/values/colors.xml');
    let c = readF(f);
    if (!new RegExp('name="grey_500"').test(c)) {
      c = mustReplace(f, c, '</resources>', '    <color name="grey_500">#8E8E93</color>\n</resources>', 'grey_500 color');
      writeF(f, c);
      log('res backfilled: color/grey_500 (values)');
    }
  }

  // U3. player_engine：上游 main values 有 → 合并（mobile view_control_live_action 引用）
  mergeValues(path.join(SRC, 'app/src/main/res/values/strings.xml'), path.join(UP, 'app/src/main/res/values/strings.xml'), 'string', ['player_engine']);
  mergeValues(path.join(SRC, 'app/src/main/res/values-zh-rCN/strings.xml'), path.join(UP, 'app/src/main/res/values-zh-rCN/strings.xml'), 'string', ['player_engine']);
  mergeValues(path.join(SRC, 'app/src/main/res/values-zh-rTW/strings.xml'), path.join(UP, 'app/src/main/res/values-zh-rTW/strings.xml'), 'string', ['player_engine']);
}
