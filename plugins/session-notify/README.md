# Jarvis 会话通知

独立 Cordis 插件，固定官方 DSH `0.2.1-alpha.2`。提供 reply、failed、approval、question
事件流；不调用模型、不读写会话正文、不依赖生活插件、不修改 SDK。
官方字段、定时任务来源、流式响应与验证限制见 [DESIGN.md](DESIGN.md)。

安装本地包后，将 `bundle.patch.json` 加入 DSH profile。在插件行增加
`config.directory`，例如 `/srv/dsh-private/session-notify`，必须为该实例独占的绝对私有目录。
完整安装步骤见[根目录说明](../../README.md)。设置该行 `disabled: true` 或从补丁中移除该行即可关闭；
通过 PluginManager 安装时可在管理器中关闭。其它插件不受影响，保留设置目录便于重新启用。

登录 Cookie 鉴权接口（冻结约定见 [接口约定](../../contracts/session-notify.md)）：

- `GET /api/session-notify/stream?after=<id>&epoch=<epoch>`：第一帧为 reset，data 为 `{epoch, last}`，
  last 是本进程已分配的最大 id（没有时为 0）。不带 after 不补发；带 after 时，epoch 相同或省略
  则补发 `id > after`，epoch 不同则补发当前缓存全部事件，之后实时 notify，25 秒心跳。
  epoch 必须与 after 一起出现，两个参数均只允许一次，否则 400。
- `POST /api/session-notify/viewing`：`{sessionId: string|null, visible: boolean}`，204，60 秒失效。
- `GET /api/session-notify/settings`：`{ok:true,value:{enabled,notifyReplies,lockScreenContent}}`，默认全 true。
- `PUT /api/session-notify/settings`：部分布尔更新，返回完整设置；非法 400，存储不可用 503。

客户端保存 epoch/after，重连时一起带上。收到 reset 时，epoch 相同则保留已有 after，
没有 after 则设为 last；epoch 不同则把已有 after 设为 0，首次连接没有 after 则设为 last。
然后保存新 epoch，每次 notify 更新 after。具体规则见接口约定第 1a 节。
流断开或出错时幂等清理监听器和心跳，abort/重复 close 不向监听器外抛流状态异常。

通知只在内存中保留最近 200 条/24 小时；设置写插件目录的 settings.json。
插件不根据开关或 viewing 过滤事件，通知判断和合并由安卓壳负责。

## 测试

```sh
node --test plugins/session-notify/*.test.mjs
```

事件与存储测试不需要 SDK。真实 Cordis/Connection 路由测试需要安装固定版本的官方 DSH，
缺少时明确跳过。无端口路由测试不等于真实 HTTP、反向代理、Android 或实体手机验证。
