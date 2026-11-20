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
// 2) 复制直播资源文件（仅 NewTV2 缺失的）
// ============================================================
let resCount = 0;
for (const rel of closure.fileRes) {
  // 找上游实际位置（优先 main，其次 leanback/mobile）
  let srcFile = null, ssUsed = 'main';
  for (const ss of SRCSETS) {
    const p = path.join(UP, 'app/src', ss, 'res', rel);
    if (fs.existsSync(p)) { srcFile = p; ssUsed = ss; break; }
  }
  if (!srcFile) { log('warn: upstream res not found', rel); continue; }
  // NewTV2 已有同名资源则跳过（用 NewTV2 版本，避免覆盖其定制）
  let ntHas = false;
  for (const ss of SRCSETS) if (fs.existsSync(path.join(SRC, 'app/src', ss, 'res', rel))) { ntHas = true; break; }
  if (ntHas) { log('skip(res exists)', rel); continue; }
  const dst = path.join(SRC, 'app/src/main/res', rel);
  ensureDir(dst);
  fs.copyFileSync(srcFile, dst);
  resCount++;
}
log(`res copied: ${resCount}`);

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
  const entries = extractEntries(upXml, tagName, names);
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
    const ksDir = path.join(SRC, 'keystore');
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
