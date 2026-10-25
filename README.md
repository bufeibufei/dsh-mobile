# dsh-mobile

从 Android 手机使用官方 DeepSeek Harness（DSH）Host：Android WebView 壳与四个可独立安装的插件，保留官方会话、模型、工具、文件与认证协议。固定 Host 版本为 **`@deepseek-ai/dsh@0.2.1-alpha.2`**，不修改 SDK。

| 组件 | 用途 | 文档 |
| --- | --- | --- |
| `android/` | 登录、改密、服务器选择、系统返回、会话通知和文件保存 | [Android](android/b0/README.md) |
| `plugins/login/` | 个人账号密码兑换官方 Cookie | [登录插件](plugins/login/README.md) |
| `plugins/session-notify/` | 会话事件 SSE 与通知设置持久化 | [会话通知](plugins/session-notify/README.md) |
| `plugins/mobile-ui/` | 手机布局、分层返回、原生设置入口与通知设置 | [移动界面](plugins/mobile-ui/README.md) |
| `plugins/file-export/` | 官方文件预览中的“保存到手机” | [文件导出](plugins/file-export/README.md) |
| `contracts/` | 四项接口约定 | [登录](contracts/login.md)、[通知](contracts/session-notify.md)、[界面](contracts/mobile-ui.md)、[导出](contracts/file-export.md) |

不包含生活记录服务或生活客户端，也不包含生活定时通知。移动界面保留可选的 `window.__JARVIS_B0_LIFE__?.back()` 集成点，外部客户端未注册时无作用。

## 构建 APK

需要 JDK 17、Android SDK 35（含 Build Tools 35.0.0）和可用的 Gradle 依赖。设置 `JAVA_HOME`、`ANDROID_HOME`，或在不入库的 `android/local.properties` 中设置 SDK 路径。

```sh
cd android
./gradlew :b0:testDebugUnitTest :b0:assembleDebug
```

输出：`android/b0/build/outputs/apk/debug/b0-debug.apk`。最低 Android API 26；使用更新的系统 WebView。保留 applicationId `com.jarvis.life.b0`、Kotlin 包 `com.jarvis.b0` 和现有版本标识，以兼容已有安装。覆盖已签名安装需要同一签名密钥及合适的 versionCode；debug APK 不等于正式签名发布包。

## 安装 Host 插件

先在你管理的独立 Host 应用目录安装固定版本（依赖安装和 Host 启动不属于 APK 构建）：

```sh
npm install --save-exact @deepseek-ai/dsh@0.2.1-alpha.2
```

四个插件互相独立，均可单独关闭；按需要选择，不要求同时安装。登录插件关闭后不再提供账号密码入口，官方认证仍由 DSH 管理；通知插件关闭时通知设置入口隐藏；文件导出插件只在有 Android 文件桥时显示动作。

每个目录的 `bundle.patch.json` 是插件注册入口。给自己的 DSH Web profile 追加所选补丁（使用官方 `--patch`），不要替换已有模型或其它插件配置：

1. `login`：复制其 `bundle.patch.json` 为你的私有 profile patch，将 `name: "./index.mjs"` 改为该插件 `index.mjs` 的**绝对路径**；在同一插件行加入 `config.authorities` 数组，例如 `["dsh.example.com"]`，非默认端口需包含端口。按[登录说明](plugins/login/README.md)初始化私有账号。
2. `session-notify`：在 Host 应用中安装本地包，复制其补丁；在插件行加入 `config.directory`，值为该实例独占的绝对私有目录，如 `/srv/dsh-private/session-notify`。
3. `mobile-ui`：运行其 `npm run build`，在 Host 应用中安装本地包，追加该目录的 `bundle.patch.json`。
4. `file-export`：在 Host 应用中安装本地包，追加该目录的 `bundle.patch.json`。

对于后三个 npm 包，可在各插件目录运行 `npm pack`，然后在 Host 应用目录执行 `npm install /absolute/path/to/package.tgz`。补丁中的包名必须能从 Host 解析。也可使用官方 PluginManager 安装本地归档，它会读取包元数据中 `dsh.bundle.patch` 指向的同一补丁；通知插件仍须配置私有目录。

例如，把选择的补丁条目合并为一个 JSON 数组并保存为 `/absolute/private/mobile.patch.json` 后，在 Host 应用目录启动：

```sh
npx --no-install dsh web --patch /absolute/private/mobile.patch.json --no-open
```

将公开 HTTPS authority 加入 DSH 自身的受信 Host 配置；登录插件的 allowlist 不替代官方信任配置。Cookie 应保留 `Secure`、`HttpOnly`、`SameSite=Strict`。示例域名 `dsh.example.com` 和 IP `203.0.113.10` 仅供文档使用。

关闭一个插件：在其 profile 行设置 `disabled: true`（或从你的补丁中移除该行），重启相应 Host 并刷新客户端；由 PluginManager 管理的包则在管理器中关闭，避免重复注册。保留私有数据目录，便于重新启用。

## 测试

需要 Node.js 24 或更新版本；在仓库根目录运行：

```sh
npm test
```

普通行为测试无 npm 依赖。依赖真实 DSH SDK 的用例在缺少固定版本时带原因跳过；真实官方 Switch 用例还需要 `esbuild`；沙箱禁止 loopback 监听时，真实 HTTP 登录测试带权限错误原因跳过。可在本仓库临时安装固定 SDK 和 `esbuild` 后运行这些测试；不提交生成的依赖或私有配置。可选浏览器脚本需要自行安装 Playwright 和浏览器，参见各插件文档。

单元测试和 APK 编译不代表真实 Host、HTTPS、Android WebView 或实体手机验收。

## English summary

An Android shell and four independent plugins for the official DeepSeek Harness Host, pinned to `0.2.1-alpha.2`. Includes password login, mobile navigation, session notifications and native file export. Life-recording features are excluded; an optional external life-client Back hook remains. Build with JDK 17 / Android SDK 35 and run `npm test` with Node.js 24+. Licensed under MIT.
