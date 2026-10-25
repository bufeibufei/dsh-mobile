# B0 文件导出最小提案 v1

仅文件导出。官方客户端插件在已读取文件的菜单中增加“保存到手机”，沿用固定 DSH `0.2.1-alpha.2` `workspaceFiles.readBytes` 或 `session.readAttachment`；不增加服务器 HTTP 路由。使用 AndroidX WebKit 的带 origin/main-frame 校验的 WebMessage listener，名为 `jarvisFileExport`。当前精确 Host 的顶层页面可用；每次连接替换 listener，切 Host/页面离开/Activity 销毁使旧请求失效。不使用全域 `addJavascriptInterface`。

## 数据与流程

- 版本 `v:1`，最多同时1个请求；`requestId` 为客户端随机 UUID。
- 最大文件16 MiB；文件名最多128字符，只接受basename，拒绝路径分隔符/NUL/`.`/`..`；MIME最多128字符，无换行。
- 插件菜单为显式点击；`begin` 必须打开系统 CreateDocument，用户选定目标后才回复 ready。取消不读取/写入文件。
- ready 后按序传最多64 KiB原始字节的Base64块，每块ACK后再发下一块，避免整文件Base64和无界排队。块序号从0开始；拒绝跳序、超长、无效Base64和总长度超限。
- 原生只写系统选择的 URI，URI/手机路径不返回网页。写入串行后台执行；`commit` 核对累计字节等于声明长度，flush/close后success。失败/取消关闭流并尽力删除本次新建文档；删除失败仅报告可能保留不完整文件，不能报成功。
- 页变更/切Host/销毁取消请求并关闭流；延迟picker/写入回调携带连接generation校验。没有原生网络、模型、任意文件路径或命令入口。
- 所有响应由原生的 WebMessage reply proxy 返回发起顶层页面，关联同一 requestId；日志不记录文件内容、URI、凭据。

## 一组调用/响应样例

虚构 `hello.txt` 内容为 UTF-8 `你好\n`，7字节。

```json
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"begin","filename":"hello.txt","mime":"text/plain","byteLength":7}
```

用户选择手机保存位置后：

```json
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"ready","nextSeq":0}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"chunk","seq":0,"base64":"5L2g5aW9Cg=="}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"ack","nextSeq":1,"bytesWritten":7}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","method":"commit"}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"success","bytesWritten":7}
```

取消/失败分别为：

```json
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"cancelled"}
{"v":1,"requestId":"91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd","status":"error","code":"SIZE_MISMATCH","partialFileMayRemain":false}
```

允许网页用 `method:cancel` 终止自己的同ID导出；不能取消另一请求。错误码最小集合：BUSY、INVALID_METADATA、INVALID_CHUNK、SIZE_MISMATCH、WRITE_FAILED、UNSUPPORTED_WEBVIEW。用户取消是cancelled，不是错误。未支持安全WebMessage listener的WebView显示升级提示，不降级到无origin限制桥。

## 验证要求

接口以 [文件导出合同](../contracts/file-export.md) 为准；本文描述设计，不表示已安装插件或下载通过。实际接入位置需核固定官方文件菜单扩展点；先验证虚构文件保存的精确7字节、用户取消、错误长度/跳序/超限和跨Host/销毁取消，再声明可用。真实模型调用不在本协议内。
