# 第三方源码与许可

项目的自有代码使用根目录 [MIT License](LICENSE)。为支持离线 Android 构建，仓库还包含 `client/android/capacitor-android/` 中的 Capacitor Android 源码。它及其中引用的第三方文件遵循各自的许可，根目录许可证不替代这些许可。

| 代码 | 许可与版权说明 | 许可文件 |
| --- | --- | --- |
| `client/android/capacitor-android/`（Capacitor Android） | Ionic Team / Drifty Co.，MIT | [`client/android/capacitor-android/LICENSE`](client/android/capacitor-android/LICENSE) |
| `AndroidProtocolHandler.java` 引用的 Chromium 代码 | The Chromium Authors，BSD 风格许可；保留原文件版权注释 | [`CHROMIUM-BSD-3-CLAUSE.txt`](client/android/capacitor-android/licenses/CHROMIUM-BSD-3-CLAUSE.txt) |
| `WebViewLocalServer.java` 引用的 Google 代码、`UriMatcher.java` 引用的 Android Open Source Project 代码 | Apache License 2.0；保留各文件版权注释 | [`APACHE-2.0.txt`](client/android/capacitor-android/licenses/APACHE-2.0.txt) |
| `FileUtils.java` 引用的 `react-native-image-crop-picker` 代码 | Ivan Pusic，MIT；许可全文保留在文件头 | 文件头 |

许可文本与来源可在 [Capacitor Android](https://github.com/ionic-team/capacitor/blob/main/android/LICENSE)、[Chromium](https://chromium.googlesource.com/chromium/src/+/main/LICENSE) 和 [Apache](https://www.apache.org/licenses/LICENSE-2.0.txt) 官方页面核对。应用图标和赞赏码图片是本项目发布资源；若替换这些资源，请确认新资源的使用权。
