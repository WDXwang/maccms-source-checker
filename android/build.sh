#!/usr/bin/env bash
# LibreTV APK 手工构建脚本（无 Gradle，依赖 GitHub runner 预装的 Android SDK）
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
BT=$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1 | sed 's:/$::')
PLATFORM=$(ls "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)
if [ -z "${BT:-}" ] || [ -z "${PLATFORM:-}" ]; then
  echo "错误: 未找到 Android build-tools 或 platform（ANDROID_HOME=$SDK）"; exit 1
fi
echo "build-tools: $BT"
echo "platform   : $PLATFORM"

[ -d assets/www ] || { echo "错误: assets/www 不存在，请先运行 prep-assets.mjs"; exit 1; }

rm -rf build && mkdir -p build/gen build/classes

echo "==> 1/5 编译资源"
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$PLATFORM" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 --java build/gen -A assets build/res.zip

echo "==> 2/5 编译 Java"
javac -source 1.8 -target 1.8 -nowarn -encoding UTF-8 \
  -bootclasspath "$PLATFORM" -d build/classes \
  java/com/libretv/app/MainActivity.java build/gen/com/libretv/app/R.java

echo "==> 3/5 生成 dex"
"$BT/d8" --release --min-api 24 --output build $(find build/classes -name '*.class')

echo "==> 4/5 组装 APK"
(cd build && zip -q -j base.apk classes.dex)

echo "==> 5/5 对齐与签名"
KS="keystore.jks"
if [ -f "$KS" ]; then
  echo "使用仓库内固定签名: $KS"
else
  echo "未找到 keystore.jks，生成临时签名（升级安装需卸载重装；建议把生成的 keystore 提交回仓库）"
  keytool -genkeypair -keystore build/debug.keystore -storepass android -keypass android \
    -alias libretv -dname "CN=LibreTV, OU=Personal" -keyalg RSA -keysize 2048 -validity 10000
  KS="build/debug.keystore"
fi
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out build/LibreTV.apk build/aligned.apk
"$BT/apksigner" verify --print-certs build/LibreTV.apk | head -5

echo "构建完成: android/build/LibreTV.apk ($(du -h build/LibreTV.apk | cut -f1))"
