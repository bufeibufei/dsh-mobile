package com.jarvis.b0

/** Native entry states; the official DSH page remains the only connected screen. */
internal enum class EntryScreen {
    RECOVERING, LOGIN, AUTHENTICATING, EXPIRED, CREDENTIAL_ERROR, OFFLINE, SERVER_ERROR, TLS
}

internal data class EntryCopy(
    val title: String,
    val subtitle: String,
    val primary: String?,
    val showsCredentials: Boolean = false,
    val showsProgress: Boolean = false,
    val secondary: String? = null,
    val note: String? = null,
    val error: String? = null
)

internal fun entryCopy(screen: EntryScreen): EntryCopy = when (screen) {
    EntryScreen.RECOVERING -> EntryCopy("正在恢复会话", "正在连接我的服务器…", null, showsProgress = true)
    EntryScreen.LOGIN -> EntryCopy("登录 Jarvis", "继续你的对话", "登录", showsCredentials = true)
    EntryScreen.AUTHENTICATING -> EntryCopy("登录 Jarvis", "继续你的对话", "正在登录…", showsCredentials = true)
    EntryScreen.EXPIRED -> EntryCopy("登录已过期", "请重新登录，原会话仍会保留。", "重新登录", showsCredentials = true)
    EntryScreen.CREDENTIAL_ERROR -> EntryCopy(
        "登录 Jarvis", "继续你的对话", "登录", showsCredentials = true,
        error = "账号或密码不正确，请再试一次。"
    )
    EntryScreen.OFFLINE -> EntryCopy(
        "当前离线", "无法连接服务器，登录状态与草稿已保留。", "重试连接",
        secondary = "切换服务器", note = "网络恢复后可重试。"
    )
    EntryScreen.SERVER_ERROR -> EntryCopy(
        "服务器暂不可用", "登录状态与草稿已保留，请稍后重试。", "重试连接",
        secondary = "切换服务器", note = "服务器恢复后可重试。"
    )
    EntryScreen.TLS -> EntryCopy(
        "证书无法验证", "已停止连接，请检查服务器地址与证书。", "检查服务器",
        note = "不会忽略证书继续连接"
    )
}
