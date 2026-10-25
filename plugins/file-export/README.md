# B0 Android file export client plugin

Extension for the official DSH `0.2.1-alpha.2` `sidebar.right.tab.document.actions` list slot. The original document viewer owns the displayed absolute path and supplies the current Session ID. The action calls the existing authenticated `workspaceFiles.readBytes` Remote; it sends only basename, MIME, byte count and bounded byte chunks to the frozen Android file-only channel. It does not expose file paths through that native bridge or add an HTTP/RPC endpoint.

The Host entry has no services. Its package metadata declares the client extension and existing SDK dependencies. Install this local package using the official DSH plugin manager and its `bundle.patch.json`, then reload the Android page. An ordinary browser has no Android file channel, so the plugin registers no save action there.

`Save to phone` / 保存到手机 opens Android CreateDocument after the file has been read. The chosen URI stays in Android. Chunks are sent after ready/ACK, and an explicit cancel command is available. No background retry or upload is performed. Maximum accepted export: 16 MiB; maximum filename: 128 characters.

Install and disable instructions: [root guide](../../README.md). The plugin can be turned
off independently of login, mobile UI and session notifications. Protocol details:
[file export contract](../../contracts/file-export.md).

Keep WebView updated for official `dsh-resource:` URLs. Do not globally polyfill URL or
replace the official resource viewer. Verify real CreateDocument save/cancel and byte
integrity on a device before distribution; unit tests cannot establish that result.
