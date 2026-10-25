package com.jarvis.b0

internal data class PasswordChangeOutcome(val message: String, val loginExpired: Boolean = false) {
    companion object {
        val unknown = PasswordChangeOutcome("请求结果未确认，密码可能已修改。请先用新密码验证，再决定是否重试。")

        fun fromStatus(status: Int): PasswordChangeOutcome = when (status) {
            204 -> PasswordChangeOutcome("密码已更新。其他设备可能仍可使用，最长至原会话到期。")
            400 -> PasswordChangeOutcome("新密码无效。")
            401 -> PasswordChangeOutcome("登录已失效，请重新登录。", loginExpired = true)
            403 -> PasswordChangeOutcome("当前密码不正确。")
            429 -> PasswordChangeOutcome("尝试过多，请稍后重试。")
            503 -> PasswordChangeOutcome("认证服务暂不可用。")
            else -> unknown
        }
    }
}
