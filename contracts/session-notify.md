# 会话通知：服务端、安卓壳、手机界面插件的接口约定

服务端、安卓壳与手机界面插件共同遵循本文。实现说明见[会话通知设计](../plugins/session-notify/DESIGN.md)。

## 鉴权

- 与现有接口相同（`connection.admit` 校验登录 Cookie），未登录返回 401。
- 安卓壳用 `CookieManager` 取 Cookie，沿用 `HostHttp` 的平台证书校验。

## 1. 事件流

`GET /api/session-notify/stream?after=<id>&epoch=<epoch>`

- 响应头：`Content-Type: text/event-stream`、`Cache-Control: no-store`。
- 每次连接的第一帧都是 `event: reset`，`data` 为 `{"epoch": "<服务进程启动标识>", "last": <本进程已分配的最大 id，没有时为 0>}`。
- 补发规则：
  - 不带 `after`：不补发，只推送新事件；
  - 带 `after`，且 `epoch` 与当前进程相同或省略：补发 `id > after` 的事件；
  - 带 `after`，且 `epoch` 与当前进程不同（服务重启过）：补发当前进程内存中的全部事件；
  - `epoch` 只能与 `after` 一起出现，否则返回 400。
- 补发后实时推送。
- 每个事件格式：

  ```
  id: <id>
  event: notify
  data: <JSON>

  ```

  `data` 的结构：

  ```json
  {
    "id": 128,
    "at": "2026-10-25T09:00:00.000Z",
    "sessionId": "string",
    "sessionTitle": "string 或 null",
    "kind": "reply | failed | approval | question",
    "preview": "最多 60 个字符的纯文本，可能为空字符串",
    "automated": false,
    "viewing": false
  }
  ```

  - `viewing` 表示事件生成时，服务端记录的"正在查看"是否就是这个会话（见第 2 节）。只供参考，手机以本地状态为准；

  - `id` 是正整数，严格递增，进程内唯一；服务重启后从 1 重新开始。

- 每 25 秒发送一行心跳注释：`: ping`。
- 补发范围：服务端在内存中保留最近 200 条或 24 小时以内的事件；更早的不补发。

## 1a. 客户端游标（安卓壳执行）

- 本地保存 `epoch` 和 `after`，重连时两个一起带上。
- 收到 `reset` 时：
  - `epoch` 与本地相同：保留 `after`；本地没有 `after` 时设为 `last`；
  - `epoch` 不同，且本地有 `after`：设为 `0`（服务端会补发新进程的全部事件）；
  - `epoch` 不同，且本地没有 `after`（首次连接）：设为 `last`，不补发旧事件；
  - 然后保存新的 `epoch`。
- 收到 `notify` 后把 `after` 更新为该事件的 `id`。

## 2. 正在查看

`POST /api/session-notify/viewing`，请求体 `{"sessionId": "string 或 null", "visible": true/false}`。

- 返回 `204`。
- 60 秒内没有再次上报，视为不在看。
- 服务端只用于给事件附加信息，不过滤事件。是否弹出通知由手机决定。

## 3. 设置

- `GET /api/session-notify/settings` 返回 `{"ok": true, "value": {"enabled": true, "notifyReplies": true, "lockScreenContent": true}}`。
- `PUT /api/session-notify/settings` 接受上述字段的部分更新，返回完整设置；字段必须是布尔值，否则返回 400。
- 设置保存在插件自己的数据目录，作为一个小 JSON 文件，原子写入。

## 4. 安卓桥接（安卓壳提供，页面调用）

- `window.JarvisB0Native?.viewingSession?.(sessionId 或 null)`：页面切换会话、页面可见性变化时调用，安卓壳据此在前台时不弹出正在查看的会话的通知。
- `window.JarvisB0Native?.notifySettingsChanged?.()`：页面保存会话通知设置后调用，安卓壳重新读取设置，开启或停止前台服务。
- 两个方法都没有返回值；方法不存在时，页面安静跳过。

## 5. 页面桥接（手机界面插件提供，安卓壳调用）

- `window.__JARVIS_B0_MOBILE__?.openSession?.(sessionId)`：打开并切换到该会话，返回布尔值表示是否成功。
- 安卓壳在点击通知后、页面加载完成时调用。页面还没加载好时，由安卓壳等待，最多 10 秒，与提醒通知打开安排的方式相同。

## 6. 通知规则（安卓壳执行）

| `kind` | 渠道 | 后台或锁屏 | 前台、正在看该会话 | 前台、看别的会话或页面 |
| --- | --- | --- | --- | --- |
| `approval` | 需要你确认（高） | 横幅 + 声音 | 不弹 | 横幅 + 声音 |
| `question` | 需要你确认（高） | 横幅 + 声音 | 不弹 | 横幅 + 声音 |
| `reply` | 对话消息（默认） | 弹出 | 不弹 | 弹出，不响铃 |
| `failed` | 对话消息（默认） | 弹出 | 不弹 | 弹出，不响铃 |

- `notifyReplies` 为 `false` 时，`reply` 不弹出。
- `lockScreenContent` 为 `false` 时，锁屏只显示"有新回复"。
- 同一会话 10 秒内的 `reply` 合并为一条，显示条数。同一会话的通知替换上一条，不堆积。
- 用户打开该会话（`viewingSession` 报告了这个会话）时，清除它的通知。
