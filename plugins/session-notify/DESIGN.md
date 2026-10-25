# 会话通知插件设计与官方接口依据

本实现遵循[会话通知接口约定](../../contracts/session-notify.md)，目标为未修改的
官方 DSH `0.2.1-alpha.2`。下表是该固定版本的接口依据，路径相对于
`@deepseek-ai/<包名>/`；升级版本时需重新核对。

| 用途 | 官方文件与行号 | 采用方式 |
| --- | --- | --- |
| 会话事件与销毁 | `dsh-session/lib/types/index.d.ts:50–61` | `ctx.on('session/event', (session, event))`；`session/disposed` 释放轮次状态 |
| 实时与种子边界 | `dsh-session/lib/types/index.d.ts:154–168` | 只订阅 append feed；官方种子事件不发布，不扫描或回放历史正文 |
| 轮次结束原因 | `dsh-session/lib/types/types.d.ts:165–210,262–276` | `completed` → reply；`error` → failed；包括 aborted/blocked 在内的其他原因都不生成 |
| 助手文本 | `dsh-session/lib/types/types.d.ts:330–338`；`dsh-llm/lib/types/message.d.ts:148–151` | `data.message.content` 仅 text 块；按 `data.turn` 保存最后一条消息的 60 字预览，忽略 reasoning、图片、stream |
| 工具请求 | `dsh-session/lib/types/types.d.ts:354–360` | `data.name === 'ask_user_question'`；`arguments` 是 JSON 字符串 |
| 问题字段 | `dsh-user-questions/lib/types/types.d.ts:31–36`；`dsh-user-questions/lib/index.js:18–25,98–120`；`dsh-tool-ask-user/lib/index.js:34–45` | `questions[].question` 按顺序连接；不取选项、工具输出或用户回答。无效 JSON/无问题文字不生成 |
| 批准摘要 | `dsh-user-approval/lib/types/types.d.ts:30–42,55–63` | `approval/asked.data.reason` 是人的可读批准解释；无 reason 时预览为空，不复制命令参数或其他消息 |
| 定时任务来源 | `dsh-schedule/lib/types/runtime.d.ts:1–7`；`dsh-schedule/lib/index.js:1583–1596` | 官方创建用户角色消息时设置 `source: {kind: 'schedule'}`，再调用 `agent.followup` |
| 会话标题 | `dsh-session-title/lib/types/index.d.ts:123–129`；`lib/types/types.d.ts:36` | 可选注入 `sessionTitle`，只调用官方只读 `get(session)?.title`，无值/无服务返回 null，不生成标题 |
| 注册与鉴权 | `dsh-client-connection/lib/types/rpc.d.ts:94–128`；`lib/index.js:634–647,681–694` | 官方 `connection.fetch.register`，每条路由先 `connection.admit`，沿用 Cookie 和 Host/Origin fence |
| 响应流与断开 | `dsh-client-connection/lib/index.js:34–38,69–81,82–107` | 官方 bridge 用 `for await (const chunk of response.body)` 写响应，处理背压；客户端断开触发 Request.signal |
| PUT 声明差异 | `dsh-client-connection/lib/types/rpc.d.ts:106–119`；`lib/index.js:664–694,814–818` | 类型只列 GET/HEAD/POST，但 JS runtime 直接使用注册 methods Set 分发，没有 PUT 限制。真实 `HostConnectionService` 无端口测试验证 GET/PUT，不需补丁 |

## 轮次和预览

`turn/start` 新建 `{number, preview, automated}`，`user/message` 没有 turn 字段，
归属当前打开轮次。只有实际接收到官方 `source.kind === 'schedule'` 才设 automated=true。
同轮若批量接纳了人工消息和定时消息，仍标记包含自动任务；不通过文本、工具名或会话标题猜测。
未观察到开始/来源（例如插件在半轮中装载）时保守为 false。轮次结束删除状态，下一轮不会继承。
使用 WeakMap，不持有会话正文副本；额外保存最近 256 个事件序号防重复回调；不假定其他监听器重入追加时回调仍严格按序。

reply 使用该轮最后一条助手消息的 text 内容；最后一条无 text 就为空，不回退旧回复。
failed 预览为空，绝不复制错误详情。预览去掉常见 Markdown 标记、图片、链接地址和多余空白，
按 Unicode code point 截前 60 字，不截断代理对。它是有限文本清洗器，不是完整 Markdown 渲染器。
生活安排追问仍是普通 reply，不订阅生活保存事件。插件不记录日志正文，也不写预览日志。

## 缓存、SSE 和生命周期

- 进程模块装载时生成随机 epoch，进程内共用正安全整数序号；重启进程从 1 开始。
  插件在同一进程热卸载/重装不复用序号，缓存不持久化。
- 每次建立流首先发送 `reset`，data 为 `{epoch, last}`；last 是本进程已分配的最大 id，
  没有分配时为 0，缓存过期和插件热重装不会降低 last。
  不带 `after` 不补发；带 `after` 且 `epoch` 相同或省略时只补发 `id > after`；
  带 `after` 且 `epoch` 不同时补发当前缓存全部事件，随后实时发送。
  `epoch` 只能与 `after` 一起出现，两个参数均只允许一次，否则返回 400。
- 客户端保存 epoch/after，重连时一起带上：reset 的 epoch 相同时保留已有 after，
  没有 after 则设为 last；epoch 不同时，已有 after 设为 0，首次连接没有 after 则设为 last。
  然后保存新 epoch，收到 notify 后把 after 更新为事件 id，详见接口约定第 1a 节。
- 缓存最多 200 条，生成/补发时清除过期项，另每 25 秒巡检一次，避免空闲无限保留；
  超过 24 小时的记录绝不补发。空闲内存清理粒度最多 25 秒。
- `Response(new ReadableStream(...))` 直接经官方 bridge 发出，不需要替代服务器或补丁。
  Content-Type=text/event-stream、Cache-Control=no-store；额外 X-Accel-Buffering=no 避免代理缓冲。
- 每个客户端 25 秒 `: ping`。AbortSignal、reader.cancel、Connection 卸载、插件卸载都会
  释放订阅和心跳。abort 使用独立回调，不将 Event 传作 close 参数；enqueue/close 捕获
  已关闭或出错流的异常，清理幂等，初始化发送失败后不再创建心跳。
  慢客户端流队列最多 256 块，超过即关闭，由客户端按游标重新连接。
- viewing 为个人 Host 的内存状态，60 秒边界失效。只附加生成时的 viewing 标志，不过滤事件。
  enabled/notifyReplies/lockScreenContent 均供客户端决策，服务端不会据此丢失缓存事件。

## 设置和装配

插件只强依赖 sessions。connection 和 sessionTitle 使用 Cordis `ctx.inject` 可选注入。
卸载时官方注册效果自动删除路由，额外关闭现存流；没有 life、tools、llm 依赖。

配置仅 `directory`，必须为绝对路径。目录权限 0700；settings.json 0600，缺文件采用全 true。
更新只接受已知布尔字段的部分对象，错误返回 400。串行执行更新；同目录 wx 临时文件 →
write → fsync → close → rename，rename 成功才更新内存，失败清理临时文件、保留旧设置，返回 503。
损坏配置拒绝插件启动，不静默覆盖。只支持单个插件实例拥有这个目录；不声称跨进程写锁。

通过 `bundle.patch.json` 注册插件，并在对应 profile 行设置 `config.directory`。
使用 `disabled: true` 或移除该条目关闭；详见 [README](README.md)。

## 验证范围

`runtime.test.mjs` 测事件、Unicode/Markdown、缓存容量和过期、reset 的 last、三种 epoch 补发、
心跳、查看过期、abort 后重复关闭及流出错清理。
`plugin.test.mjs` 用真实 Cordis 和真实官方 HostConnectionService，不监听端口，验证路由、
PUT、401、输入校验、可选服务和卸载；文件测试覆盖原子 rename 失败恢复、并发部分更新和重载。
Connection 的 browserAuth 以虚构 Cookie 检查替身注入，不等于完整登录链验收。

缺少固定版本 SDK 时，真实 Cordis/Connection 测试明确跳过。完整 Host HTTP、反向代理和 Android 通知需要另行集成验证。
