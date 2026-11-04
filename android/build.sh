#!/usr/bin/env bash
# Usage: ./build.sh [gradle tasks...]   (default: tests, lint and a debug APK)
# Needs JAVA_HOME (JDK 17) and ANDROID_HOME (SDK 34) in the environment.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:?set ANDROID_HOME to your Android SDK}"
[ -f local.properties ] || echo "sdk.dir=$ANDROID_HOME" > local.properties
if [ $# -eq 0 ]; then set -- testDebugUnitTest lintDebug assembleDebug; fi
./gradlew "$@"
