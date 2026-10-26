package com.jarvis.b0

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Same-origin main-frame WebMessage transport, matching the existing settings/file bridges. */
internal class ScheduledNotifyBridge(private val changed: () -> Unit, private val allowed: (WebView) -> Boolean) {
    private var view: WebView? = null
    private var host: HostAddress? = null
    private var script: ScriptHandler? = null

    fun bind(browser: WebView, address: HostAddress) {
        clear()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        view = browser; host = address
        WebViewCompat.addWebMessageListener(browser, CHANNEL, setOf(address.origin)) {
                source, message, origin: Uri, main, _ ->
            if (source === view && main && allowed(source) && host == address &&
                address.owns(origin.toString()) && address.owns(source.url.orEmpty()) &&
                message.type == WebMessageCompat.TYPE_STRING && message.data == "scheduleChanged") changed()
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            script = WebViewCompat.addDocumentStartJavaScript(browser, wrapper(address), setOf(address.origin))
    }
    fun loaded() { val address = host ?: return; view?.evaluateJavascript(wrapper(address), null) }
    private fun wrapper(address: HostAddress): String = """
        (() => {
          if (window !== window.top || location.origin !== ${JSONObject.quote(address.origin)}) return;
          window.DshMobile = Object.assign(window.DshMobile || {}, {
            scheduleChanged: () => window.$CHANNEL?.postMessage('scheduleChanged')
          });
        })();
    """.trimIndent()
    fun clear() {
        script?.remove(); script = null
        view?.let { WebViewCompat.removeWebMessageListener(it, CHANNEL) }
        view = null; host = null
    }
    companion object { private const val CHANNEL = "DshMobileSchedule" }
}
