#!/usr/bin/env bash
# Compila o APK sem Gradle, usando apenas o Android SDK (build-tools 34 + platform 34).
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-/opt/android-sdk}
BT=$SDK/build-tools/36.0.0
JAR=$SDK/platforms/android-34/android.jar
OUT=build
rm -rf $OUT && mkdir -p $OUT/res $OUT/gen $OUT/classes

$BT/aapt2 compile --dir res -o $OUT/res.zip
$BT/aapt2 link -I $JAR --manifest AndroidManifest.xml -A assets \
  -o $OUT/base.apk --java $OUT/gen $OUT/res.zip
javac -nowarn --release 8 -classpath $JAR -d $OUT/classes \
  $(find src $OUT/gen -name '*.java')
$BT/d8 --release --min-api 24 --lib $JAR --output $OUT $(find $OUT/classes -name '*.class')
cp $OUT/base.apk $OUT/unsigned.apk
(cd $OUT && zip -q unsigned.apk classes.dex)
$BT/zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk

KS=${KEYSTORE:-chave-forja3d.jks}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias forja3d -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass forja3d -keypass forja3d -dname "CN=Forja 3D" >/dev/null 2>&1
fi
$BT/apksigner sign --ks "$KS" --ks-pass pass:forja3d --ks-key-alias forja3d \
  --out Forja3D.apk $OUT/aligned.apk
$BT/apksigner verify Forja3D.apk && echo "OK -> $(pwd)/Forja3D.apk"
