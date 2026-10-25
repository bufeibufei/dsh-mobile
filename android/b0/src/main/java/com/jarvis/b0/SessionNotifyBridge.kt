package com.jarvis.b0

import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Contract methods on JarvisB0Native; no unrestricted JavascriptInterface or credential payload. */
internal class SessionNotifyBridge(private val viewing: (String?) -> Unit, private val changed: () -> Unit,
    private val allowed: (WebView) -> Boolean) {
    private var view: WebView? = null
    private var host: HostAddress? = null
    private var script: ScriptHandler? = null
    fun bind(browser: WebView, address: HostAddress) {
        clear()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        view = browser; host = address
        WebViewCompat.addWebMessageListener(browser, CHANNEL, setOf(address.origin)) { source, message, origin, main, _ ->
            if (source === view && main && allowed(source) && host == address &&
                address.owns(origin.toString()) && address.owns(source.url.orEmpty()) &&
                message.type == WebMessageCompat.TYPE_STRING) {
                val json = message.data?.let(StrictExportJson::parse)
                when (json?.let { StrictExportJson.string(it, "method") }) {
                    "viewingSession" -> {
                        val id = json.get("sessionId")
                        if (id?.isJsonNull == true) viewing(null)
                        else StrictExportJson.string(json, "sessionId")?.takeIf { it.isNotBlank() }?.let(viewing)
                    }
                    "notifySettingsChanged" -> changed()
                }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            script = WebViewCompat.addDocumentStartJavaScript(browser, wrapper(address), setOf(address.origin))
    }
    private fun wrapper(address: HostAddress) = """
        (() => {
          if (window !== window.top || location.origin !== ${JSONObject.quote(address.origin)}) return;
          window.JarvisB0Native = Object.assign(window.JarvisB0Native || {}, {
            viewingSession: sessionId => {
              if (sessionId === null || typeof sessionId === 'string')
                window.$CHANNEL?.postMessage(JSON.stringify({method:'viewingSession', sessionId}));
            },
            notifySettingsChanged: () => window.$CHANNEL?.postMessage(JSON.stringify({method:'notifySettingsChanged'}))
          });
        })();
    """.trimIndent()
    fun loaded() { val address = host ?: return; view?.evaluateJavascript(wrapper(address), null) }
    fun clear() {
        script?.remove(); script = null
        view?.let { WebViewCompat.removeWebMessageListener(it, CHANNEL) }
        view = null; host = null
    }
    companion object { private const val CHANNEL = "JarvisB0SessionNotify" }
}
