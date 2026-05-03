打包win10命令

rm -rf dist && ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npx @electron/packager . "喝水提醒" --platform=win32 --arch=x64 --out=dist --overwrite