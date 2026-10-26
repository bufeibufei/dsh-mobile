# 定时本地通知（scheduled-notify）接口约定

固定官方 DSH `0.2.1-alpha.2`。Host 插件 `plugins/scheduled-notify` 汇总各提供方的定时条目；
Android 壳拉取这些条目，并用系统精确闹钟在本地发通知。离线也能按时提醒。
壳和本插件不认识任何业务概念，例如生活、安排、计划。

## 1. Host 服务 `mobileSchedule`（Cordis）

插件 `name = 'dsh-mobile-scheduled-notify'`，通过 Host 的 `ctx.provide('mobileSchedule', service)` 提供服务
`mobileSchedule`；插件自身不解析 SDK，因此不依赖安装位置。可以关闭；关闭后提供方的可选注入不生效，HTTP 路由也一起消失。

```js
const dispose = ctx.mobileSchedule.register({
  id: 'life',                       // /^[a-z][a-z0-9-]{0,31}$/，同一 id 重复注册抛错
  list({from, to, signal}),         // -> {items: Item[], daily: Daily[]}，可以是 async
  action({key, action, signal}),    // -> {status: 'done'}；抛错时 error.code 取 NOT_FOUND | NOT_ACTIVE
  content({key, date, signal}),     // -> {date?, shouldNotify, title, text, open}；date 为摘要实际所属日期，省略时按请求的 date
});
```

- 提供方返回的 `key` 是自己的本地键：`/^[A-Za-z0-9._:-]{1,128}$/`。
  服务对外暴露的键统一加前缀，格式为 `<id>/<key>`。
- 提供方在 `ctx.inject(['mobileSchedule'], exact => exact.effect(() => exact.mobileSchedule.register(p)))` 里注册。
  注册与卸载要跟随两个插件的生命周期。
- 任一提供方抛错或超时（3 秒）时，整个响应返回 503，不返回只含部分提供方的结果。
  原因是壳会按 `version` 撤销闹钟，部分结果会误撤。

## 2. HTTP（登录 Cookie，`connection.admit`；未登录 401）

返回格式与其他插件一致：成功是 `{ok: true, value}`，失败是 `{ok: false, error: {code}}`。
未知参数、重复参数或格式错误返回 400 `CONTRACT_MISMATCH`。所有响应都带 `cache-control: no-store`。

### `GET /api/mobile-schedule?from=<ISO>&to=<ISO>`

`from` 默认取当前时间；`to` 默认取 `from` 加 7 天；跨度最多 14 天。

```json
{"ok": true, "value": {
  "version": "sha256 hex",
  "items": [{
    "key": "life/2f…", "at": "2026-10-26T07:00:00.000Z",
    "title": "去理发", "text": "15:30 · 公司楼下",
    "open": "plan:P5",
    "actions": [{"id": "complete", "label": "完成"}],
    "snooze": true
  }],
  "daily": [{
    "key": "life/brief", "time": "08:00", "timezone": "Asia/Shanghai"
  }]
}}
```

- `items` 只含 `at` 落在 `[from, to]` 内的条目，按 `at` 升序、再按 `key` 排序。
  - `open` 可以为 `null`，否则是最多 256 字符的不透明字符串，只有该提供方的页面插件能理解，壳不解析。点通知后的处理见第 3 节。
  - `actions` 最多 2 个，`id` 满足 `/^[a-z][a-z0-9-]{0,15}$/`，`label` 最多 8 个字符。
  - `snooze` 为 `true` 时，壳在通知上加"稍后提醒"按钮：推迟 10 分钟，只在本地处理，不调用 Host。
- `daily` 是每天固定时间触发、内容到触发时才取的条目。
- `version` 由服务计算：对排好序的 `items` 和 `daily` 做规范 JSON（键按字典序），再取 sha256。
  内容不变则 `version` 不变，壳据此判断要不要重排闹钟。
  任一条目的内容（包括 `at`）变化时，提供方必须换一个新 `key`，这样已经送达的旧通知不会被当成新通知。

### `POST /api/mobile-schedule/action`

请求体：`{"key": "life/2f…", "action": "complete"}`。必须带 `Origin` 且与 Host 同源，否则返回 403（同源判断由官方 `connection.admit` 执行，插件只要求 `Origin` 存在）。

- 成功：200 `{ok: true, value: {key, action, status: "done"}}`。
- 找不到条目：404 `NOT_FOUND`；条目已失效：409 `NOT_ACTIVE`。
- 同一个 `key` 和 `action` 重复提交时，由提供方保证幂等，返回原来的结果。

### `GET /api/mobile-schedule/content?key=<daily key>&date=<YYYY-MM-DD>`

```json
{"ok": true, "value": {"key": "life/brief", "date": "2026-10-26",
  "shouldNotify": true, "title": "今天 1 个安排", "text": "15:30 去理发 · 公司楼下", "open": null}}
```

`date` 是该 `daily` 条目所在时区的当天日期。返回的 `date` 与请求不一致时，壳丢弃这次结果。

## 3. Android 壳

- 同步时机：打开页面、页面通知有变化、每小时一次后台任务、开机、时区或时间变化。
  同步窗口是 `[now - 1 天, now + 7 天]`，前一天也取，是为了让本地稍后提醒在普通同步后不丢。
- 精确闹钟权限、连续一天同步失败后的登录提醒、切换服务器或退出时清空：沿用原来提醒的行为。
- 点击通知：先打开或回到 App；登录成功、页面就绪后，在同源页面执行
  `window.__DSH_MOBILE_OPEN__?.[<提供方 id>]?.(open) === true`。
  返回 `true` 表示已处理；返回 `false` 时按旧版的节奏重试，直到超时或切换服务器。
  `open` 为 `null` 时只打开 App。页面插件自己负责注册这个对象：
  `(window.__DSH_MOBILE_OPEN__ ??= {})[id] = fn`。
- 通知渠道：每条 `items` 用渠道 `life-plans`，名称"定时提醒"；`daily` 用 `life-daily-brief`，名称"每日概况"；
  登录失效提醒用 `life-login`。渠道 ID 沿用旧版，只是不透明字符串，目的是保留用户已有的渠道设置；
  显示名称不含业务概念。
- 页面通知变化的通道：壳注入 `window.DshMobile.scheduleChanged()`，用 WebMessageListener 通道
  `DshMobileSchedule` 承载，只对当前 Host 同源生效。
- 已送达的 key 记在本地，`version` 变化时也不重复弹出；`daily` 按 `key + date` 去重。

## 4. 从旧版生活提醒升级（code ≤ 11 → 新版）

- 首次启动时读取旧的 `b0-reminders` 存储，按旧 key 加前缀 `life/` 导入：
  - 已送达的 key；
  - 未送达的稍后提醒，含原来的触发时间；
  - `lastBriefDate`，导入为 `life/brief` 的送达日期。
- 导入后删除旧存储，并取消旧的 JobScheduler 任务和旧闹钟。
- 通知渠道 ID 和已有的权限偏好保持不变，避免用户重新设置。
- 生活插件的适配器必须让新 key 等于 `life/` 加旧 key（旧 key 来自 `/api/life-reminders`），
  否则导入的去重记录对不上。

## 5. 不做

- 不在 Host 端定时推送，不经过会话通知流。
- 不提供壳内的提醒设置界面，设置归各提供方自己的页面。
