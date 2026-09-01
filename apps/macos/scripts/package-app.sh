#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$PACKAGE_DIR/../.." && pwd)
OUTPUT_DIR=${1:-"$PACKAGE_DIR/dist"}
APP_DIR="$OUTPUT_DIR/Worklog.app"

swift build --package-path "$PACKAGE_DIR" -c release
BIN_DIR=$(swift build --package-path "$PACKAGE_DIR" -c release --show-bin-path)

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/AgentDashboardMenuBar" "$APP_DIR/Contents/MacOS/AgentDashboardMenuBar"
cp "$PACKAGE_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :AgentDashboardProjectRoot $PROJECT_ROOT" "$APP_DIR/Contents/Info.plist"
chmod 755 "$APP_DIR/Contents/MacOS/AgentDashboardMenuBar"
codesign --force --sign - "$APP_DIR"

echo "Packaged $APP_DIR"
