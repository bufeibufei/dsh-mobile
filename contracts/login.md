# B0 手机登录与连接合同 v1

B0 Host 固定使用 DSH `0.2.1-alpha.2`，手机以官方 Web UI、HTTP、WebSocket 和文件通道使用同一 Host。本合同只增加个人账号密码入口和手机连接体验，不建立第二套聊天、Session 或文件协议。
## 身份与凭据

- 单个由服务器管理员配置的 Jarvis App 账号；不提供公开注册。它不是 Linux `root` 账号，也不是火山方舟密钥。
- 服务端保存随机盐加密的密码校验值；原密码、模型密钥和 DSH 启动 token 不进入 APK、仓库、URL、访问日志或持久客户端配置。初始账号由部署工具在服务端私有配置中生成；首次密码通过单独的私有交付路径提供，用户登录后可修改。
- 登录成功后，B0 Host 插件仅在服务端把固定 DSH 的启动 token 构造成内部 `GET /?token=…` 请求，再调用 `connection.authorizeIndex()` 签发**官方 Cookie**；不能把客户端 `POST /jarvis-auth` 原样交给该方法。对话、设置、HTTP、WebSocket 和文件继续由 DSH 原生认证；手机不转发或保管启动 token。公网 HTTPS 代理必须给官方 Cookie 加 `Secure`，并保留 `HttpOnly`、`SameSite=Strict`。
- 官方 Cookie 的当前固定版本有效期为绝对 30 天，签名密钥由 DSH 持久化。普通 App 重开和服务重启时在有效期内复用 Cookie；到期后显示登录页。本文不承诺永久免登录。

## 同源路由

### `POST /jarvis-auth`

账号密码表单，`Content-Type: application/x-www-form-urlencoded`，UTF-8 字段 `username` 与 `password`。WebView 可用 `postUrl` 提交到当前选定的 HTTPS origin。Host 必须是当前受信 authority；显式 URL 形式的 `Origin` 必须同源，外站来源拒绝。原生 WebView 的主框架 `postUrl` 实测会带字面 `Origin: null`；**仅此登录路由**可在固定 Host、HTTPS 代理标记和 DSH `Sec-Fetch-Site` 检查仍通过时，把这个不透明来源标记按缺省 Origin 处理，且仍须正确账号密码。`Sec-Fetch-Site: cross-site` 仍拒绝；改密路由没有此例外。限制请求体和字段长度，拒绝重复字段，按远端地址及账号限制失败尝试。

成功：`303 See Other`、跳转至当前 origin 的 `/`、官方 `Set-Cookie`；固定 DSH 的 `Location: ./` 在精确路径 `/jarvis-auth` 上应解析为 `/`，需以实际请求核验。插件只用内部合成的原生 `GET /?token=…` 完成兑换，不得把内部 token URL 下发手机。失败：`400` 表单无效、`401` 账号或密码不正确、`403` Host/Origin/传输来源不被信任、`429` 尝试过多、`503` 认证服务暂不可用，均不签发 Cookie；账号不存在和密码错误使用同一对外信息。TLS、网络、HTTP 和认证错误由 App 分别呈现。所有响应 `Cache-Control: no-store`，不得记录请求正文或凭据。

### `POST /jarvis-auth/password`

已登录账号修改密码：同源、官方 Cookie 鉴权，表单字段 `oldPassword`、`newPassword`，有界 UTF-8 body。新密码至少 12 字符、最多 1024 UTF-8 字节；初始随机密码不少于 24 字符。成功 `204 No Content`，失败 `400` 新密码无效、`401` Cookie 失效、`403` 原密码不正确、`429` 尝试过多、`503` 服务暂不可用。原密码正确后原子更新服务端密码校验值；错误不改变配置。App 显示“其他已登录设备可能仍可使用，最长至原会话到期”，并提供本机退出登录。固定 DSH 没有公开的单 Cookie 撤销接口，改密码不宣称立即退出其他设备。

App 通过与当前 origin 同源的独立 HTTPS 请求提交改密，临时从 CookieManager 取当前 Cookie 随请求发送，不写日志或持久文件；主聊天 WebView 不导航到该接口，避免 `204` 空页面替换会话和草稿。服务端须用官方 `connection.requestRejection()` 或等价原生 admission 验证该 Cookie、Host 和来源。

## 手机状态与隔离

- 仅保存经过规范化的服务器 origin、可选显示名、当前选中项和非敏感账号名；远端地址必须 HTTPS，既有 `HostAddress` 允许的本机回环及模拟器映射 HTTP 只用于隔离开发验收。旧版已保存的 `b0-host` 地址迁入列表并保留其原本合法的本机地址；不迁移或保存一次性 token、密码、Cookie 明文。WebView Cookie 由 Android CookieManager 持久化。
- 同一时间只激活一个服务器。切换 origin（包括同 IP 不同端口）前停止旧页面、流及 WebSocket，清理 WebView Cookie，再打开目标登录页；已保存地址不等于目标服务器仍已登录。退出登录清理当前设备 Cookie、关闭页面连接并显示登录页。
- 启动时对已选服务器尝试认证读取：有效 Cookie 进入官方主页，`401` 转登录页；网络中断显示重试/离线状态，TLS 错误明确阻止连接。断网不清 Cookie、草稿或账号；恢复仅重连观察，不自动发送消息、调用模型或重试旧工具。
- 登录 POST 与它的 303 跳转以主页面 HTTP 状态和最终 `/` 的认证加载判定结果；不依赖 WebView 的 `shouldOverrideUrlLoading` 捕捉 POST。错误须由主框架 HTTP/网络/TLS 回调映射到可见登录状态，不能把 401 错页留在聊天区域或把单个重定向当成功。
- 原生顶部“连接设置”常驻行移除；连接和账号入口放入侧边栏/设置。原顶部承载的 TLS、HTTP、文件导出与保存失败反馈须移至登录状态、聊天内提示或设置中的连接状态，不得无声丢弃。官方 DSH 的模式、统计、轨迹、插件与文件入口保持可用。聊天画板是布局和状态参考，不替换官方 DSH 功能实现。
- 重新登录、切换服务器和返回聊天均不得自动提交输入框草稿。App 安装更新沿用现有签名并增加 versionCode，保留用户数据。

## 验收界限

先在隔离 Host 验证插件实际挂载、错密/限速、成功 `303` 与官方 Cookie，以及同 Cookie 的主页、HTTP、WebSocket、文件读取；再检查 Android 390/412 像素、软键盘、重开、服务重启、切服务器/端口、登出、断网、过期和证书错误。生产更新前保存可恢复的服务与 APK 检查点；部署后从手机实际走一遍登录和聊天读取，模型发送只在用户明确操作时进行。每项分清隔离验证、模拟器验证和真机验证；不以画板或编译结果代替实测。
