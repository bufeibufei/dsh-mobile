# B0 手机文件保存 v1

仅 Android 客户端文件保存，不新增服务端 HTTP 路由、模型请求或生成协议。实际安装、文件写入与取消仍须验收。

## 入口与范围

客户端插件在固定 DSH 文件菜单提供“保存到手机”，复用 `workspaceFiles.readBytes` / `session.readAttachment` 已读取的文件或 Blob。显式点击后使用 AndroidX WebKit WebMessage listener `jarvisFileExport`；只接受当前精确 Host origin 的顶层页面。每次连接重新绑定，切 Host、页面离开或 Activity 销毁使旧请求失效；不降级为全域 `addJavascriptInterface`。

所有消息为 JSON，`v` 严格为整数 1、`requestId` 为随机 UUID、`method` 为下列固定值。字段类型不强制转换，拒绝未知字段/方法、无效 JSON 和超过 96 KiB UTF-8 的单消息。仅允许一个活动导出。

## 请求与响应

| method | 其它请求字段 | 正常响应 |
| --- | --- | --- |
| `begin` | `filename`、`mime` 为字符串；`byteLength` 为整数 | 用户在系统 CreateDocument 选择目标后 `ready` / `nextSeq:0`；取消为 `cancelled` |
| `chunk` | `seq` 为从 0 开始的连续整数；`base64` 为字符串 | 写入该块后 `ack` / `nextSeq` / `bytesWritten` |
| `commit` | 无 | 累计字节等于声明长度，flush/close 成功后 `success` / `bytesWritten` |
| `cancel` | 无 | 取消本页面同 ID 活动请求，关闭流，返回 `cancelled` |

文件上限 16 MiB；文件名最长 128 字符、仅 basename，拒绝路径分隔符、NUL、`.` 和 `..`；MIME 最长 128 字符且无换行。长度范围为 0 到 16 MiB。每块解码最多 64 KiB，每块 ACK 后才发送下一块；拒绝无效 Base64、跳序/重复序号、超长块及累计字节超出声明长度。不得依靠 commit 才拒绝超限。

原生只写系统选择的 URI，不向网页返回 URI 或手机路径；写入串行执行。请求关联除 UUID 外还绑定当前连接/页面代次，延迟 picker、写入与响应不得作用于新页面。ACK 未知不自动追加重复块，终止后可由用户重新选择保存；无后台重发或续传。

失败或取消关闭流并尽力删除本次新建文档；删除失败以 `partialFileMayRemain:true` 告知可能残留不完整文件，不能报成功。`error` 与 `cancelled` 均可携带这一 Boolean 标志，缺省 false。`success` 只表示完整写入已 flush/close，不表示其它 App 能打开内容。

所有响应由 WebMessage reply proxy 返回原发起顶层页面，保留 `v` 和同一 `requestId`。错误码最小集合为 `BUSY`、`INVALID_METADATA`、`INVALID_CHUNK`、`SIZE_MISMATCH`、`WRITE_FAILED`、`UNSUPPORTED_WEBVIEW`；无有效关联的输入拒绝而不操作文件。日志不记录文件内容、URI、凭据或原始消息。未支持安全 listener 的 WebView 显示升级提示。

## 虚构样例

UTF-8 `你好\n` 共 7 字节：

```json
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"begin","filename":"hello.txt","mime":"text/plain","byteLength":7}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"ready","nextSeq":0}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"chunk","seq":0,"base64":"5L2g5aW9Cg=="}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"ack","nextSeq":1,"bytesWritten":7}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"commit"}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"success","bytesWritten":7}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"cancelled","partialFileMayRemain":false}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"error","code":"SIZE_MISMATCH","partialFileMayRemain":false}
```

后两行为独立终态示例，不是 success 后继续取消或失败。

## 实际验收

前端核对官方文件菜单挂载点，验证 7 字节虚构文件、用户取消、长度/序号/大小拒绝及切 Host/销毁取消。模型调用不参与此验收；无需为下载新增运行账本。大于 16 MiB 时明确提示限制，不声称本版本支持任意大文件。
