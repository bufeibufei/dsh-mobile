package com.jarvis.b0

import java.net.URI

/** Validated same-origin address; remote hosts require trusted HTTPS. */
internal data class HostAddress(val base: URI) {
    val origin: String = "${base.scheme}://${base.rawAuthority}"

    fun owns(url: String): Boolean = runCatching {
        val candidate = URI(url)
        candidate.scheme.equals(base.scheme, true) && candidate.host.equals(base.host, true) &&
            effectivePort(candidate) == effectivePort(base) && candidate.userInfo == null
    }.getOrDefault(false)

    companion object {
        private fun effectivePort(uri: URI) = if (uri.port >= 0) uri.port
            else if (uri.scheme.equals("https", true)) 443 else 80

        fun parse(value: String): HostAddress {
            val uri = URI(value.trim())
            require(uri.host != null && uri.userInfo == null && uri.fragment == null && uri.rawQuery == null) {
                "请输入不含令牌、账号或查询参数的 Host 地址。"
            }
            require(uri.scheme == "https" || uri.scheme == "http" &&
                uri.host in setOf("localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2")) {
                "远程 Host 使用 HTTPS；HTTP 仅用于本机模拟器验收。"
            }
            require(uri.port != 3080 && uri.port != 3081) { "B0 使用独立 Host，不连接现有正式服务。" }
            val path = uri.rawPath.ifEmpty { "/" }
            val local = uri.host in setOf("localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2")
            require(path == "/" || local && path.endsWith("/") &&
                uri.path.split('/').none { it == "." || it == ".." || it.contains('\\') } &&
                !path.contains("%2f", true) && !path.contains("%5c", true)) {
                "远程 Host 只填写服务器根地址；本机旧地址可保留以 / 结束的路径。"
            }
            return HostAddress(URI("${uri.scheme}://${uri.rawAuthority}$path"))
        }
    }
}
