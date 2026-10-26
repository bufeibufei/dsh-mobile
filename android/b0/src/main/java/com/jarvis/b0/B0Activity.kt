package com.jarvis.b0

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import javax.net.ssl.SSLException

/** Native identity surfaces around the unchanged Host-served DSH UI. */
class B0Activity : ComponentActivity() {
    private val ink = Color.rgb(23, 25, 31)
    private val muted = Color.rgb(116, 121, 132)
    private val line = Color.rgb(228, 230, 235)
    private val canvas = Color.rgb(246, 247, 249)
    private val accent = Color.rgb(55, 91, 206)
    private val accentSoft = Color.rgb(237, 241, 255)
    private val danger = Color.rgb(196, 71, 71)
    private val uiBlue = Color.rgb(78, 121, 234)
    private val uiMuted = Color.rgb(119, 126, 137)
    private val uiLine = Color.rgb(229, 232, 238)
    private val uiSoft = Color.rgb(237, 242, 255)
    private val uiGreen = Color.rgb(62, 141, 99)
    private lateinit var root: FrameLayout
    private lateinit var browser: WebView
    private lateinit var catalog: ServerCatalog
    private lateinit var connectionGate: BrowserConnectionGate
    private lateinit var fileExport: FileExportBridge
    private var address: HostAddress? = null
    private val scheduledNavigation = ScheduledNotifyNavigation(::showNotice)
    private val sessionNavigation = SessionNotifyNavigation(::showNotice)
    private val sessionNotify by lazy { SessionNotifyRuntime.get(this) }
    private val sessionBridge = SessionNotifyBridge(
        { sessionNotify.viewing(it) }, { sessionNotify.changed() },
        { view -> view === browser && loginLayer == null && !passwordChangeGate.isBlocked() })
    private val sessionPermissions = SessionNotifyPermissionController(this) { loginLayer == null && address != null }
    private val scheduledBridge = ScheduledNotifyBridge({
        ScheduledNotifySync.get(this).changed { snapshot -> sessionPermissions.considerSchedule(snapshot, explicit = true) }
    }) { view -> view === browser && loginLayer == null && address?.owns(view.url.orEmpty()) == true && !passwordChangeGate.isBlocked() }

    private val webPermissions = WebPermissionController(this, { address }, { view ->
        view === browser && loginLayer == null && settingsLayer == null
    }, ::showNotice)
    private var fileResult: ValueCallback<Array<Uri>>? = null
    private var loginLayer: View? = null
    private var entryScreen: EntryScreen? = null
    private var loginAction: Button? = null
    private var settingsPage: NativeSettingsPage? = null
    private var settingsLayer: View? = null
    private var settingsListenerOrigin: String? = null
    private var banner: View? = null
    private var mainFrameFailed = false
    private var loginPending = false
    private var authenticating = false
    private enum class AdmissionKind { RECOVERY, LOGIN }
    private class EntryAdmission(val generation: Long, val view: WebView, val kind: AdmissionKind) {
        var checking = false
    }
    private var entryAdmission: EntryAdmission? = null
    @Volatile private var activeAdmissionProbe: HttpURLConnection? = null
    private var passwordWaitDialog: Dialog? = null
    private val passwordWaitHandler = Handler(Looper.getMainLooper())
    private val passwordWaitPoll = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            if (passwordChangeGate.isRunning()) {
                passwordWaitHandler.postDelayed(this, 200)
                return
            }
            passwordWaitDialog?.dismiss(); passwordWaitDialog = null
            catalog.selected()?.let { connect(it.host) } ?: showEntry(EntryScreen.LOGIN)
            showStoredPasswordOutcome()
        }
    }
    private var webFailure: String? = null
    private var notice = ""
    private var lastFileNotice = ""
    private var lastConnectedAt: Long? = null
    private var loginUsername = ""
    private enum class ConnectionState { DISCONNECTED, CHECKING, AUTHENTICATING, CONNECTED, OFFLINE, SERVER_ERROR, TLS, EXPIRED }
    private var connectionState = ConnectionState.DISCONNECTED
    private val probeHandler = Handler(Looper.getMainLooper())
    private var probeInFlight = false
    private val backGate = BrowserBackGate()
    private val externalLinkGate = ExternalLinkGate()
    private var externalLinkDialog: AlertDialog? = null
    private val renderCrashGate = RenderCrashGate()
    private var recoveringBrowser: WebView? = null
    private var preservedLoginLayer: View? = null
    private var pendingRenderEntry: Pair<EntryScreen, String?>? = null
    private val backHandler = Handler(Looper.getMainLooper())
    private var backTimeout: Runnable? = null
    @Volatile private var connectionGeneration = 0L
    @Volatile private var activeProbe: HttpURLConnection? = null
    private val periodicProbe = object : Runnable {
        override fun run() {
            if (connectionState in setOf(ConnectionState.CONNECTED, ConnectionState.OFFLINE, ConnectionState.SERVER_ERROR)) {
                probeConnection()
            }
            probeHandler.postDelayed(this, 20000)
        }
    }
    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileResult
        fileResult = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + .5f).toInt()
    private fun shape(fill: Int, stroke: Int? = null, radius: Int = 12): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill); cornerRadius = dp(radius).toFloat()
            if (stroke != null) setStroke(dp(1), stroke)
        }
    private fun text(value: String, size: Float = 15f, color: Int = ink, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = value; textSize = size; setTextColor(color)
            if (bold) typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER_VERTICAL
        }
    private fun gap(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun primary(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label; textSize = 15f; isAllCaps = false; setTextColor(Color.WHITE)
        background = shape(accent); setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(-1, dp(50))
    }
    private fun field(label: String, hint: String, password: Boolean = false, initial: String = ""): EditText =
        EditText(this).apply {
            contentDescription = label; setSingleLine(); setText(initial); setTextColor(ink); textSize = 15f
            setHintTextColor(muted); this.hint = hint; background = null
            setPadding(0, 0, 0, 0)
            inputType = if (password) android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                else android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
    private fun addField(body: LinearLayout, input: EditText, label: String) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(7), dp(14), dp(7)); background = shape(Color.WHITE, line)
        }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(text(label, 12f, muted), LinearLayout.LayoutParams(0, dp(18), 1f))
        if (input.inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0) {
            top.addView(text("显示", 12f, accent, true).apply {
                setOnClickListener {
                    val cursor = input.selectionStart.coerceAtLeast(0)
                    val hidden = input.transformationMethod is PasswordTransformationMethod
                    input.transformationMethod = if (hidden) HideReturnsTransformationMethod.getInstance()
                        else PasswordTransformationMethod.getInstance()
                    text = if (hidden) "隐藏" else "显示"
                    input.setSelection(cursor.coerceAtMost(input.length()))
                }
            })
        }
        box.addView(top)
        box.addView(input, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(box, LinearLayout.LayoutParams(-1, dp(74)))
    }
    private fun formBody(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(28), dp(24), dp(24))
    }
    private fun wrap(body: LinearLayout): ScrollView = ScrollView(this).apply {
        isFillViewport = true; clipToPadding = false; addView(body)
        setBackgroundColor(Color.WHITE)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        scheduledNavigation.read(intent, savedInstanceState)
        sessionNavigation.read(intent, savedInstanceState)
        configureSystemBars()
        val preferences = getSharedPreferences("b0-host", MODE_PRIVATE)
        catalog = ServerCatalog(preferences)
        loginUsername = catalog.username()
        val previousOrigin = preferences.getString("cookie-origin", null)
            ?: preferences.getString("base", null)?.let { runCatching { HostAddress.parse(it).origin }.getOrNull() }
        connectionGate = BrowserConnectionGate(previousOrigin)
        root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
        browser = createBrowser()
        fileExport = FileExportBridge(this, browser, notice = { showNotice(it) }, result = {
            lastFileNotice = it
            if (settingsPage == NativeSettingsPage.CONNECTION) showNativeSettings(NativeSettingsPage.CONNECTION)
        })
        installWebViewClient(connectionGeneration, preferences)
        root.addView(browser, FrameLayout.LayoutParams(-1, -1))
        setContentView(root); ViewCompat.requestApplyInsets(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (settingsLayer != null) { closeNativeSettings(); return }
                if (loginLayer != null) { moveTaskToBack(true); return }
                val host = address ?: run { moveTaskToBack(true); return }
                val currentUrl = browser.url ?: run { moveTaskToBack(true); return }
                if (!host.owns(currentUrl)) { moveTaskToBack(true); return }
                val token = backGate.begin() ?: return
                val generation = connectionGeneration
                val timeout = Runnable { if (backGate.complete(token)) backTimeout = null }
                backTimeout = timeout
                backHandler.postDelayed(timeout, 2500)
                // A queued evaluation must not run against a different Host or page.
                val script = "(() => location.origin === ${JSONObject.quote(host.origin)} && " +
                    "location.href === ${JSONObject.quote(currentUrl)} && " +
                    "window.__JARVIS_B0_MOBILE__?.back() === true)()"
                browser.evaluateJavascript(script) { handled ->
                    if (!backGate.complete(token)) return@evaluateJavascript
                    backHandler.removeCallbacks(timeout); backTimeout = null
                    if (isFinishing || isDestroyed || generation != connectionGeneration ||
                        settingsLayer != null || loginLayer != null || browser.url != currentUrl) return@evaluateJavascript
                    if (handled != "true") {
                        // DSH panels do not create browser history. The previous entry may
                        // be an auth redirect that would reload and discard an unsent draft.
                        moveTaskToBack(true)
                    }
                }
            }
        })
        if (passwordChangeGate.isRunning()) {
            showEntry(EntryScreen.LOGIN, "正在等待密码修改结果…")
            showPasswordWait()
        } else {
            catalog.selected()?.let { connect(it.host) } ?: showEntry(EntryScreen.LOGIN)
            if (preferences.contains("password-change-outcome")) showStoredPasswordOutcome()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createBrowser(): WebView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            settings.mediaPlaybackRequiresUserGesture = true
            settings.setGeolocationEnabled(true)
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                WebView.setWebContentsDebuggingEnabled(true)
        }.also { view -> view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                webPermissions.audio(view, request)
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                webPermissions.cancelAudio(request)
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                webPermissions.location(view, origin, callback)
            }
            override fun onGeolocationPermissionsHidePrompt() {
                webPermissions.hideLocation(view)
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams): Boolean {
                if (view !== browser || address?.owns(view.url.orEmpty()) != true) return false
                fileResult?.onReceiveValue(null); fileResult = callback
                return try { picker.launch(params.createIntent()); true }
                catch (_: Exception) { fileResult = null; callback.onReceiveValue(null); showNotice("没有可用的文件选择器。"); true }
            }
        } }

    private fun replaceBrowser() {
        dismissExternalLink()
        webPermissions.invalidate()
        val previous = browser
        removeSettingsListener()
        previous.stopLoading()
        val next = createBrowser()
        fileExport.attachBrowser(next)
        root.removeView(previous)
        browser = next
        root.addView(next, 0, FrameLayout.LayoutParams(-1, -1))
        installWebViewClient(connectionGeneration, getSharedPreferences("b0-host", MODE_PRIVATE))
        previous.destroy()
    }

    private fun installWebViewClient(generation: Long, preferences: android.content.SharedPreferences) {
        browser.webViewClient = object : WebViewClient() {
            private fun current(view: WebView): Boolean = view === browser &&
                !isFinishing && !isDestroyed && generation == connectionGeneration
            private fun current(view: WebView, url: String): Boolean = current(view) &&
                acceptsConnectionCallback(generation, connectionGeneration, address, url)
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (current(view)) { sessionNotify.viewing(null); sessionNavigation.stop() }
                if (current(view)) webPermissions.invalidate()
                if (!current(view, url)) return
                invalidateBack()
                fileExport.invalidate()
                mainFrameFailed = false; webFailure = null
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                if (current(view)) webPermissions.invalidate()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!current(view)) return true
                if (!request.isForMainFrame) return false
                return when (val result = externalLinkGate.check(
                    address, request.url.toString(), SystemClock.elapsedRealtime()
                )) {
                    ExternalLinkGate.Result.Allow -> false
                    is ExternalLinkGate.Result.Ask -> {
                        askExternalLink(view, generation, request.url, result.host)
                        true
                    }
                    ExternalLinkGate.Result.Reject -> {
                        showNotice("外部页面未打开；请保留当前 DSH 连接。")
                        true
                    }
                }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (view !== browser || isFinishing || isDestroyed) return true
                recoverRenderer()
                return true
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                if (!current(view) || !acceptsSslFailure(generation, connectionGeneration, address,
                    error.url, view.url)) { handler.cancel(); return }
                handler.cancel(); mainFrameFailed = true
                connectionState = ConnectionState.TLS; authenticating = false; loginPending = false
                webFailure = "证书校验失败；请使用受信任的 HTTPS 服务器。"
                showBrowserEntry(EntryScreen.TLS)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!current(view, request.url.toString())) return
                if (!request.isForMainFrame) return
                if (connectionState == ConnectionState.TLS) return
                val onEntry = loginLayer != null || authenticating || loginPending ||
                    recoveringBrowser === browser && settingsLayer != null
                mainFrameFailed = true
                webFailure = if (recoveringBrowser === browser) "连接中断，请检查网络后手动重试。"
                    else "连接中断；草稿已保留，请检查网络后手动重试。"
                connectionState = ConnectionState.OFFLINE; authenticating = false; loginPending = false
                if (onEntry) showBrowserEntry(EntryScreen.OFFLINE, webFailure) else showBanner(webFailure!!)
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (!current(view, request.url.toString())) return
                if (!request.isForMainFrame) return
                val onEntry = loginLayer != null || authenticating || loginPending ||
                    recoveringBrowser === browser && settingsLayer != null
                mainFrameFailed = true
                val path = request.url.path.orEmpty()
                webFailure = when (response.statusCode) {
                    400 -> "表单无效，请检查账号与密码。"
                    401 -> if (path == "/jarvis-auth") "账号或密码不正确。" else "登录已失效；会话留在当前服务器，验证后继续。"
                    429 -> "尝试过多，请稍后重试。"
                    503 -> "认证服务暂不可用，请稍后重试。"
                    else -> "服务器请求失败（${response.statusCode}）。"
                }
                authenticating = false; loginPending = false
                when {
                    response.statusCode == 401 && path == "/jarvis-auth" -> {
                        connectionState = ConnectionState.EXPIRED
                        showBrowserEntry(EntryScreen.CREDENTIAL_ERROR)
                    }
                    response.statusCode == 401 -> {
                        connectionState = ConnectionState.EXPIRED
                        showBrowserEntry(EntryScreen.EXPIRED)
                    }
                    response.statusCode in listOf(400, 403, 429) && path == "/jarvis-auth" -> {
                        connectionState = ConnectionState.EXPIRED
                        showBrowserEntry(EntryScreen.CREDENTIAL_ERROR, webFailure)
                    }
                    else -> {
                        connectionState = ConnectionState.SERVER_ERROR
                        if (onEntry) showBrowserEntry(EntryScreen.SERVER_ERROR, webFailure) else showBanner(webFailure!!)
                    }
                }
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!current(view, url)) return
                // A background recovery must not dismiss or submit a native login form.
                if (preservedLoginLayer != null && loginLayer === preservedLoginLayer) return
                val host = address ?: return
                if (!host.owns(url) || mainFrameFailed || webFailure != null) return
                val completedPath = Uri.parse(url).path
                if (completedPath != "/" && completedPath != host.base.path) return
                if (Uri.parse(url).getQueryParameter("token") != null) return
                val admission = entryAdmission
                if (admission != null) {
                    if (admission.generation == generation && admission.view === view &&
                        ((admission.kind == AdmissionKind.RECOVERY && loginPending) ||
                         (admission.kind == AdmissionKind.LOGIN && authenticating)))
                        confirmHome(admission, host, url, preferences)
                    return
                }
                finishHomeLoad(view, host, url, preferences, generation)
            }
        }
    }

    private fun dismissExternalLink() {
        externalLinkDialog?.dismiss()
        externalLinkDialog = null
    }

    private fun askExternalLink(view: WebView, generation: Long, uri: Uri, host: String) {
        if (externalLinkDialog != null) return
        val dialog = AlertDialog.Builder(this)
            .setTitle("在浏览器中打开？")
            .setMessage(host)
            .setPositiveButton("打开") { _, _ ->
                if (isFinishing || isDestroyed || generation != connectionGeneration || view !== browser)
                    return@setPositiveButton
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (_: ActivityNotFoundException) {
                    showNotice("没有可用的浏览器")
                }
            }
            .setNegativeButton("取消", null)
            .create()
        dialog.setOnDismissListener { if (externalLinkDialog === dialog) externalLinkDialog = null }
        externalLinkDialog = dialog
        dialog.show()
    }

    private fun resetRenderRecovery() {
        renderCrashGate.reset()
        recoveringBrowser = null
        preservedLoginLayer = null
        pendingRenderEntry = null
    }

    private fun recoverRenderer() {
        val reload = renderCrashGate.shouldReload(SystemClock.elapsedRealtime())
        val host = address
        val needsAdmission = entryAdmission != null || loginPending || authenticating
        preservedLoginLayer = loginLayer?.takeIf {
            entryScreen?.let { screen -> entryCopy(screen).showsCredentials } == true
        }
        invalidateBack()
        connectionGeneration++
        connectionGate.invalidate()
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        activeProbe?.disconnect(); activeProbe = null
        fileResult?.onReceiveValue(null); fileResult = null
        authenticating = false; loginPending = false
        // Never replay a login POST after a renderer crash; let the user retry it.
        if (preservedLoginLayer != null) loginAction?.apply { text = "登录"; isEnabled = true }
        replaceBrowser()
        recoveringBrowser = browser
        browser.visibility = if (loginLayer == null) View.VISIBLE else View.INVISIBLE
        mainFrameFailed = false; webFailure = null
        if (!reload || host == null) {
            connectionState = ConnectionState.SERVER_ERROR
            val message = if (!reload) "页面多次意外关闭，请稍后重试" else "页面意外关闭，请重试连接"
            showBrowserEntry(EntryScreen.SERVER_ERROR, message)
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            return
        }
        fileExport.bind(host)
        bindSettingsListener(host, connectionGeneration)
        if (needsAdmission && preservedLoginLayer == null) {
            loginPending = true
            entryAdmission = EntryAdmission(connectionGeneration, browser, AdmissionKind.RECOVERY)
        }
        browser.loadUrl(host.base.toASCIIString())
        Toast.makeText(this, "页面意外关闭，已重新载入", Toast.LENGTH_LONG).show()
    }

    /** Keep native forms intact while the replacement WebView loads behind them. */
    private fun showBrowserEntry(screen: EntryScreen, detail: String? = null) {
        if (recoveringBrowser === browser &&
            (settingsLayer != null || preservedLoginLayer != null && loginLayer === preservedLoginLayer)) {
            pendingRenderEntry = screen to detail
            return
        }
        showEntry(screen, detail)
    }

    private fun finishHomeLoad(view: WebView, host: HostAddress, url: String,
        preferences: android.content.SharedPreferences, generation: Long) {
        if (recoveringBrowser === view) {
            recoveringBrowser = null
            pendingRenderEntry = null
        }
        CookieManager.getInstance().flush()
        scheduledBridge.loaded()
        sessionBridge.loaded()
        sessionNotify.activate(host, confirmedLogin = true)
        ScheduledNotifySync.get(this).activate(host) { snapshot ->
            if (generation == connectionGeneration && view === browser && address == host)
                sessionPermissions.considerSchedule(snapshot)
        }
        openScheduledNotification()
        openSessionNotification()
        view.evaluateJavascript("(() => { try { return new URL('dsh-resource://file/session/b0-probe/x').hostname === 'file'; } catch { return false; } })()") { compatible ->
            if (generation == connectionGeneration && address == host && view === browser && browser.url == url &&
                !isFinishing && !isDestroyed && compatible != "true")
                showNotice("文件预览需要更新 Android System WebView；更新后重新连接。")
        }
        preferences.edit().putString("base", host.base.toASCIIString()).apply()
        if (!fileExport.supported) showNotice("更新 WebView 后可保存文件。")
    }

    /** A completed WebView callback alone has no navigation ID or reliable HTTP status. */
    private fun confirmHome(ticket: EntryAdmission, host: HostAddress, url: String,
        preferences: android.content.SharedPreferences) {
        if (ticket.checking) return
        ticket.checking = true
        CookieManager.getInstance().flush()
        val cookie = CookieManager.getInstance().getCookie(url).orEmpty()
        Thread {
            var connection: HttpURLConnection? = null
            val result = if (connectionGeneration != ticket.generation) -3 else try {
                connection = HostHttp.open(url, cookie)
                activeAdmissionProbe = connection
                if (connectionGeneration != ticket.generation) -3 else connection!!.responseCode
            } catch (_: SSLException) { -2 }
            catch (_: Exception) { -1 }
            finally {
                connection?.disconnect()
                if (activeAdmissionProbe === connection) activeAdmissionProbe = null
            }
            runOnUiThread {
                if (isFinishing || isDestroyed || entryAdmission !== ticket ||
                    ticket.generation != connectionGeneration || ticket.view !== browser || address != host) return@runOnUiThread
                entryAdmission = null
                when (result) {
                    200 -> {
                        authenticating = false; loginPending = false
                        connectionState = ConnectionState.CONNECTED
                        browser.clearHistory(); showChat()
                        finishHomeLoad(ticket.view, host, url, preferences, ticket.generation)
                    }
                    401 -> { connectionState = ConnectionState.EXPIRED; showEntry(EntryScreen.EXPIRED) }
                    -2 -> { connectionState = ConnectionState.TLS; showEntry(EntryScreen.TLS) }
                    -3 -> Unit
                    -1 -> { connectionState = ConnectionState.OFFLINE; showEntry(EntryScreen.OFFLINE) }
                    else -> { connectionState = ConnectionState.SERVER_ERROR; showEntry(EntryScreen.SERVER_ERROR) }
                }
            }
        }.start()
    }

    private fun configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
    }

    private fun invalidateBack() {
        backGate.invalidate()
        backTimeout?.let(backHandler::removeCallbacks)
        backTimeout = null
    }

    private fun entryLogo(size: Int): TextView = text("J", if (size == 52) 29f else 27f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        background = shape(ink, radius = 14)
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
    }

    private fun loginField(body: LinearLayout, input: EditText, label: String, password: Boolean = false) {
        val box = FrameLayout(this).apply { background = shape(Color.WHITE, line) }
        box.addView(text(label, 12f, muted, true), FrameLayout.LayoutParams(-1, dp(18), Gravity.TOP).apply {
            leftMargin = dp(14); topMargin = dp(8)
        })
        box.addView(input, FrameLayout.LayoutParams(-1, dp(36), Gravity.BOTTOM).apply {
            leftMargin = dp(14); rightMargin = dp(if (password) 70 else 14); bottomMargin = dp(8)
        })
        if (password) box.addView(text("显示", 12f, accent, true).apply {
            gravity = Gravity.CENTER
            contentDescription = "显示密码"
            setOnClickListener {
                val cursor = input.selectionStart.coerceAtLeast(0)
                val hidden = input.transformationMethod is PasswordTransformationMethod
                input.transformationMethod = if (hidden) HideReturnsTransformationMethod.getInstance()
                    else PasswordTransformationMethod.getInstance()
                text = if (hidden) "隐藏" else "显示"
                contentDescription = if (hidden) "隐藏密码" else "显示密码"
                input.setSelection(cursor.coerceAtMost(input.length()))
            }
        }, FrameLayout.LayoutParams(dp(56), dp(44), Gravity.END or Gravity.CENTER_VERTICAL).apply {
            rightMargin = dp(8)
        })
        body.addView(box, LinearLayout.LayoutParams(-1, dp(74)))
    }

    private fun loginServerChooser(): View {
        val selected = catalog.selected()
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(6), dp(10), dp(6))
            background = shape(canvas)
            contentDescription = "选择服务器"
            isClickable = true
            setOnClickListener { showServers() }
        }
        card.addView(text("服务器", 11f, muted), LinearLayout.LayoutParams(-1, dp(18)))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(text(selected?.label ?: "选择服务器", 14f, ink, true).apply {
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, dp(28), 1f))
        row.addView(text(selected?.host?.base?.authority.orEmpty(), 12f, muted).apply {
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, dp(28), 1.5f))
        row.addView(text("›", 22f, muted), LinearLayout.LayoutParams(dp(20), dp(28)))
        card.addView(row)
        return card
    }

    private fun credentialEntry(screen: EntryScreen, copy: EntryCopy, detail: String?): View {
        val body = formBody().apply { setPadding(dp(24), 0, dp(24), dp(24)) }
        body.addView(gap(88)); body.addView(entryLogo(48)); body.addView(gap(28))
        body.addView(text(copy.title, 26f, ink, true), LinearLayout.LayoutParams(-1, dp(36)))
        body.addView(gap(4))
        body.addView(text(if (screen == EntryScreen.LOGIN && detail != null) detail else copy.subtitle, 14f, muted),
            LinearLayout.LayoutParams(-1, dp(20)))
        body.addView(gap(44))
        body.addView(loginServerChooser(), LinearLayout.LayoutParams(-1, dp(64)))
        body.addView(gap(24))
        val username = field("账号", "请输入账号", initial = loginUsername)
        loginField(body, username, "账号")
        body.addView(gap(16))
        val password = field("密码", "请输入密码", password = true)
        loginField(body, password, "密码", password = true)
        val error = if (screen == EntryScreen.CREDENTIAL_ERROR) detail ?: copy.error else null
        if (error != null) {
            body.addView(gap(8))
            body.addView(text(error, 12f, danger), LinearLayout.LayoutParams(-1, dp(20)))
            body.addView(gap(18))
        } else body.addView(gap(26))
        val action = primary(copy.primary ?: "登录") {
            if (authenticating) return@primary
            val selected = catalog.selected()
            val user = username.text.toString().trim()
            val secret = password.text.toString()
            if (selected == null) { showServers(); return@primary }
            if (user.isEmpty()) { username.error = "请输入账号"; return@primary }
            if (secret.isEmpty()) { password.error = "请输入密码"; return@primary }
            loginUsername = user; catalog.saveUsername(user)
            submitLogin(selected.host, user, secret)
        }.apply { isEnabled = screen != EntryScreen.AUTHENTICATING }
        loginAction = action
        body.addView(action)
        return wrap(body)
    }

    private fun statusEntry(screen: EntryScreen, copy: EntryCopy, detail: String?): View {
        val surface = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            minimumHeight = dp(700)
        }
        val brand = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        brand.addView(entryLogo(52)); brand.addView(gap(34))
        brand.addView(text(copy.title, 24f, ink, true).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(-1, -2))
        brand.addView(gap(6))
        val subtitle = if (screen in setOf(EntryScreen.SERVER_ERROR, EntryScreen.OFFLINE) && detail != null)
            detail else copy.subtitle
        brand.addView(text(subtitle,
            14f, muted).apply { gravity = Gravity.CENTER; maxLines = 2 },
            LinearLayout.LayoutParams(-1, -2))
        if (copy.showsProgress) {
            brand.addView(gap(22))
            brand.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(accent)
                progressBackgroundTintList = ColorStateList.valueOf(line)
            }, LinearLayout.LayoutParams(dp(100), dp(3)))
        }
        surface.addView(brand, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            leftMargin = dp(24); rightMargin = dp(24); topMargin = dp(212)
        })
        if (copy.primary != null) {
            val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
            actions.addView(primary(copy.primary) {
                when (screen) {
                    EntryScreen.TLS -> showServers()
                    EntryScreen.OFFLINE, EntryScreen.SERVER_ERROR -> catalog.selected()?.let { connect(it.host) }
                    else -> Unit
                }
            })
            copy.note?.let {
                actions.addView(gap(18))
                actions.addView(text(it, 12f, muted).apply { gravity = Gravity.CENTER },
                    LinearLayout.LayoutParams(-1, -2))
            }
            copy.secondary?.let {
                actions.addView(gap(28))
                actions.addView(text(it, 14f, accent, true).apply {
                    gravity = Gravity.CENTER; setOnClickListener { showServers() }
                }, LinearLayout.LayoutParams(-1, dp(44)))
            }
            surface.addView(actions, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
                leftMargin = dp(24); rightMargin = dp(24); topMargin = dp(486)
            })
        }
        return ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.WHITE)
            addView(surface)
        }
    }

    private fun showEntry(screen: EntryScreen, detail: String? = null) {
        pendingRenderEntry = null
        if (screen == EntryScreen.EXPIRED) sessionNotify.unauthorized()
        webPermissions.invalidate()
        invalidateBack()
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        browser.visibility = View.INVISIBLE
        closeNativeSettings()
        banner?.let { root.removeView(it) }; banner = null
        loginLayer?.let { root.removeView(it) }
        entryScreen = screen
        loginAction = null
        val copy = entryCopy(screen)
        val view = if (copy.showsCredentials) credentialEntry(screen, copy, detail)
            else statusEntry(screen, copy, detail)
        root.addView(view, FrameLayout.LayoutParams(-1, -1)); loginLayer = view
        sessionNotify.pageVisible = false
    }

    private fun showChat() {
        sessionNotify.pageVisible = settingsLayer == null
        connectionState = ConnectionState.CONNECTED
        lastConnectedAt = System.currentTimeMillis()
        notice = ""
        loginLayer?.let { root.removeView(it) }; loginLayer = null
        entryScreen = null; loginAction = null
        browser.visibility = View.VISIBLE
        if (notice.isNotBlank()) showBanner(notice)
    }

    private fun showNotice(value: String) {
        notice = value
        if (loginLayer == null) showBanner(value)
    }
    private fun showBanner(value: String) {
        banner?.let { root.removeView(it) }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(7), dp(7), dp(7)); background = shape(accentSoft)
        }
        val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        heading.addView(text(value, 13f, accent), LinearLayout.LayoutParams(0, -2, 1f))
        if (connectionState == ConnectionState.OFFLINE) {
            val retry = text("检查网络", 12f, accent, true).apply {
                setPadding(dp(8), dp(4), dp(4), dp(4)); setOnClickListener { probeConnection() }
            }
            heading.addView(retry)
        }
        container.addView(heading)
        if (connectionState == ConnectionState.OFFLINE)
            container.addView(text("草稿已保留，恢复后可手动发送。", 11f, ink))
        val params = FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            leftMargin = dp(15); rightMargin = dp(15); topMargin = dp(128)
        }
        root.addView(container, params); banner = container
    }

    private fun showServers() {
        if (passwordChangeGate.isBlocked()) return
        val body = formBody()
        body.addView(text("选择服务器", 20f, ink, true)); body.addView(gap(14))
        val dialog = Dialog(this)
        catalog.all().forEach { item ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; background = shape(accentSoft); setPadding(dp(12), dp(7), dp(8), dp(7)) }
            row.addView(text("${item.label}\n${item.address}", 13f), LinearLayout.LayoutParams(0, dp(60), 1f))
            row.addView(text("编辑", 13f, accent).apply { setOnClickListener { dialog.dismiss(); editServer(item) } })
            row.setOnClickListener { dialog.dismiss(); selectServer(item) }
            body.addView(row); body.addView(gap(8))
        }
        body.addView(gap(10)); body.addView(text("添加其他服务器", 14f, ink, true)); body.addView(gap(8))
        val endpoint = field("服务器地址", "https://IP 地址:端口").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeHintLocales = android.os.LocaleList(java.util.Locale.ENGLISH)
        }
        addField(body, endpoint, "服务器地址"); body.addView(gap(10))
        val name = field("显示名称", "我的服务器").apply { layoutParams = LinearLayout.LayoutParams(-1, dp(54)) }
        addField(body, name, "显示名称"); body.addView(gap(12))
        body.addView(text("切换服务器会结束当前连接并使用对应的登录状态。", 12f, muted)); body.addView(gap(12))
        body.addView(primary("使用这个服务器") {
            val host = runCatching { HostAddress.parse(endpoint.text.toString()) }.getOrElse {
                endpoint.error = it.message ?: "地址无效"; return@primary
            }
            val saved = SavedServer(host.base.toASCIIString(), name.text.toString().ifBlank { "我的服务器" })
            catalog.save(saved); dialog.dismiss(); selectServer(saved)
        })
        dialog.setContentView(wrap(body)); dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setLayout(-1, -2); dialog.window?.setGravity(Gravity.BOTTOM)
        dialog.show(); dialog.window?.setLayout(-1, -2)
    }

    private fun editServer(old: SavedServer) {
        if (passwordChangeGate.isBlocked()) return
        val body = formBody()
        body.addView(text("编辑服务器", 20f, ink, true)); body.addView(gap(16))
        val endpoint = field("服务器地址", "https://IP 地址:端口", initial = old.address).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeHintLocales = android.os.LocaleList(java.util.Locale.ENGLISH)
        }
        val name = field("显示名称", "我的服务器", initial = old.name)
        addField(body, endpoint, "服务器地址"); body.addView(gap(12))
        addField(body, name, "显示名称"); body.addView(gap(18))
        val dialog = Dialog(this)
        body.addView(primary("保存服务器") {
            val host = runCatching { HostAddress.parse(endpoint.text.toString()) }.getOrElse { endpoint.error = it.message; return@primary }
            val new = SavedServer(host.base.toASCIIString(), name.text.toString().ifBlank { "我的服务器" })
            catalog.replace(old, new); dialog.dismiss(); selectServer(new)
            if (settingsPage == NativeSettingsPage.SERVERS) showNativeSettings(NativeSettingsPage.SERVERS)
        })
        dialog.setContentView(wrap(body)); dialog.show(); dialog.window?.setLayout(-1, -2)
    }

    private fun selectServer(server: SavedServer) {
        if (passwordChangeGate.isBlocked()) return
        catalog.choose(server)
        if (address?.base == server.host.base && loginLayer == null) return
        connect(server.host)
    }

    private fun closeNativeSettings(revealPendingEntry: Boolean = true) {
        sessionNotify.pageVisible = loginLayer == null
        settingsLayer?.let { root.removeView(it) }
        settingsLayer = null; settingsPage = null
        val pending = pendingRenderEntry
        if (revealPendingEntry && pending != null && loginLayer == null) {
            pendingRenderEntry = null
            showEntry(pending.first, pending.second)
        }
    }

    private fun settingsSection(body: LinearLayout, label: String) {
        body.addView(text(label, 13f, uiMuted, true).apply {
            setPadding(dp(4), dp(18), 0, dp(12))
        })
    }

    private fun settingsCard(
        body: LinearLayout, title: String, subtitle: String? = null,
        highlighted: Boolean = false, onClick: (() -> Unit)? = null
    ): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(if (subtitle == null) 66 else 76)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = shape(if (highlighted) uiSoft else Color.WHITE, if (highlighted) null else uiLine)
            if (onClick != null) setOnClickListener { onClick() }
        }
        val labels = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL }
        labels.addView(text(title, 15f, ink, true))
        if (subtitle != null) labels.addView(text(subtitle, 12f, uiMuted).apply {
            setPadding(0, dp(5), 0, 0); maxLines = 2
        })
        card.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
        body.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        return card
    }

    private fun showNativeSettings(page: NativeSettingsPage) {
        if (loginLayer != null || passwordChangeGate.isBlocked()) return
        webPermissions.invalidate()
        invalidateBack()
        closeNativeSettings(revealPendingEntry = false)
        val surface = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE)
        }
        val title = when (page) {
            NativeSettingsPage.ACCOUNT -> "账号与安全"
            NativeSettingsPage.SERVERS -> "服务器"
            NativeSettingsPage.CONNECTION -> "连接状态与文件"
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(text("‹", 31f, ink).apply {
            gravity = Gravity.CENTER; contentDescription = "返回 DSH 设置"
            setOnClickListener { closeNativeSettings() }
        }, LinearLayout.LayoutParams(dp(58), dp(60)))
        header.addView(text(title, 17f, ink, true), LinearLayout.LayoutParams(0, dp(60), 1f))
        surface.addView(header)
        surface.addView(View(this).apply { setBackgroundColor(uiLine) }, LinearLayout.LayoutParams(-1, dp(1)))
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(5), dp(16), dp(18))
        }
        when (page) {
            NativeSettingsPage.ACCOUNT -> buildAccountSettings(body)
            NativeSettingsPage.SERVERS -> buildServerSettings(body)
            NativeSettingsPage.CONNECTION -> buildConnectionSettings(body)
        }
        surface.addView(ScrollView(this).apply {
            isFillViewport = true; addView(body)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(surface, FrameLayout.LayoutParams(-1, -1))
        settingsLayer = surface; settingsPage = page
        sessionNotify.pageVisible = false
    }

    private fun buildAccountSettings(body: LinearLayout) {
        settingsSection(body, "当前账号")
        val account = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(15), dp(14), dp(15)); background = shape(Color.WHITE, uiLine)
        }
        val username = catalog.username().ifBlank { "当前账号" }
        account.addView(text(username.take(1).uppercase(), 22f, uiBlue, true).apply {
            gravity = Gravity.CENTER; background = shape(uiSoft, radius = 22)
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, 0, 0) }
        info.addView(text(username, 16f, ink, true))
        info.addView(text("个人账号 · 当前服务器", 12f, uiMuted))
        account.addView(info)
        body.addView(account, LinearLayout.LayoutParams(-1, dp(114)))
        settingsSection(body, "安全")
        settingsCard(body, "修改密码", "使用当前密码验证后设置新密码") { showPassword() }
        val sessionNote = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(13), dp(14), dp(16))
            background = shape(uiSoft)
        }
        sessionNote.addView(text("其他设备的现有会话", 14f, ink, true))
        sessionNote.addView(text("修改密码后，其他设备可能仍保持登录，直至会话到期。", 12f, uiMuted).apply {
            setPadding(0, dp(10), 0, 0)
        })
        body.addView(sessionNote, LinearLayout.LayoutParams(-1, -2))
        body.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        body.addView(View(this).apply { setBackgroundColor(uiLine) }, LinearLayout.LayoutParams(-1, dp(1)))
        body.addView(text("退出当前设备", 15f, danger, true).apply {
            setPadding(dp(14), 0, 0, 0); setOnClickListener {
                AlertDialog.Builder(this@B0Activity).setMessage("退出当前设备的登录？")
                    .setNegativeButton("取消", null).setPositiveButton("退出") { _, _ -> logout() }.show()
            }
        }, LinearLayout.LayoutParams(-1, dp(64)))
    }

    private fun buildServerSettings(body: LinearLayout) {
        val selected = catalog.selected()
        settingsSection(body, "当前服务器")
        if (selected != null) addServerCard(body, selected, true)
        settingsSection(body, "已保存的服务器")
        catalog.all().filterNot { it.address == selected?.address }.forEach {
            addServerCard(body, it, false)
        }
        settingsCard(body, "＋  添加服务器", null) { showAddServerDialog() }
        body.addView(text("切换服务器后显示对应登录状态与会话。", 12f, uiMuted).apply {
            setPadding(dp(4), dp(18), 0, dp(18))
        })
        body.addView(text("仅连接可信 HTTPS；证书校验失败时停止加载。", 12f, uiMuted).apply {
            setPadding(dp(4), dp(8), 0, 0)
        })
    }

    private fun addServerCard(body: LinearLayout, server: SavedServer, selected: Boolean) {
        val card = settingsCard(body, server.label, server.address, selected) {
            if (address?.base == server.host.base && loginLayer == null) closeNativeSettings()
            else selectServer(server)
        }
        if (selected) card.addView(text("✓", 14f, uiBlue, true).apply {
            setPadding(dp(8), dp(12), dp(4), dp(12))
            contentDescription = "当前服务器"
        })
        card.addView(text("编辑", 14f, uiBlue, true).apply {
            setPadding(dp(8), dp(12), 0, dp(12))
            setOnClickListener { editServer(server) }
        })
    }

    private fun showAddServerDialog() {
        val body = formBody()
        body.addView(text("添加服务器", 20f, ink, true)); body.addView(gap(16))
        val endpoint = field("服务器地址", "https://IP 地址:端口").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI or
                android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeHintLocales = android.os.LocaleList(java.util.Locale.ENGLISH)
        }
        val name = field("显示名称", "我的服务器")
        addField(body, endpoint, "服务器地址"); body.addView(gap(12))
        addField(body, name, "显示名称"); body.addView(gap(18))
        val dialog = Dialog(this)
        body.addView(primary("保存服务器") {
            val host = runCatching { HostAddress.parse(endpoint.text.toString()) }
                .getOrElse { endpoint.error = it.message; return@primary }
            val saved = SavedServer(host.base.toASCIIString(), name.text.toString().ifBlank { "我的服务器" })
            catalog.save(saved); dialog.dismiss(); selectServer(saved)
        })
        dialog.setContentView(wrap(body)); dialog.show(); dialog.window?.setLayout(-1, -2)
    }

    private fun buildConnectionSettings(body: LinearLayout) {
        val selected = catalog.selected()
        val connected = connectionState == ConnectionState.CONNECTED
        val state = when (connectionState) {
            ConnectionState.CONNECTED -> "●  已连接"
            ConnectionState.OFFLINE -> "●  连接中断"
            ConnectionState.SERVER_ERROR -> "●  服务器暂不可用"
            ConnectionState.TLS -> "●  证书错误"
            ConnectionState.EXPIRED -> "●  登录已失效"
            else -> "●  正在连接"
        }
        val status = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = shape(if (connected) Color.rgb(234, 247, 239) else uiSoft)
        }
        status.addView(text(state, 17f, if (connected) uiGreen else danger, true))
        status.addView(text("${selected?.label ?: "未选择"} · ${selected?.host?.base?.authority ?: ""}", 13f, ink)
            .apply { setPadding(0, dp(10), 0, 0) })
        status.addView(text(
            if (selected?.host?.base?.scheme == "https" && connected) "HTTPS 证书已校验"
            else if (selected?.host?.base?.scheme == "http") "本机 HTTP 测试连接"
            else "请检查连接与证书状态", 12f, if (connected) uiGreen else uiMuted
        ).apply { setPadding(0, dp(8), 0, 0) })
        body.addView(status, LinearLayout.LayoutParams(-1, dp(130)))
        settingsSection(body, "连接诊断")
        val last = lastConnectedAt?.let {
            java.text.SimpleDateFormat("HH:mm", java.util.Locale.CHINA).format(java.util.Date(it))
        } ?: "尚无记录"
        settingsCard(body, "最近连接 · $last", "断网时保留当前草稿；恢复连接后手动发送。")
        if (connectionState in setOf(ConnectionState.CONNECTED, ConnectionState.OFFLINE, ConnectionState.SERVER_ERROR))
            body.addView(text("检查连接  ›", 13f, uiBlue, true).apply {
                setPadding(dp(14), dp(10), 0, dp(16)); setOnClickListener { probeConnection() }
            })
        settingsSection(body, "文件操作反馈")
        settingsCard(body, "最近一次保存", lastFileNotice.ifBlank { "暂无本次运行的文件操作反馈" })
    }

    private fun removeSettingsListener() {
        scheduledBridge.clear()
        sessionBridge.clear()
        sessionNotify.viewing(null)
        scheduledNavigation.stop()
        sessionNavigation.stop()
        if (settingsListenerOrigin != null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(browser, "JarvisB0Settings")
        }
        settingsListenerOrigin = null
    }

    private fun bindSettingsListener(host: HostAddress, generation: Long) {
        scheduledBridge.bind(browser, host)
        sessionBridge.bind(browser, host)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(browser, "JarvisB0Settings", setOf(host.origin),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView, message: WebMessageCompat, sourceOrigin: Uri,
                    isMainFrame: Boolean, replyProxy: androidx.webkit.JavaScriptReplyProxy
                ) {
                    runOnUiThread {
                        if (isFinishing || isDestroyed || settingsListenerOrigin != host.origin ||
                            address?.origin != host.origin) return@runOnUiThread
                        val isString = message.type == WebMessageCompat.TYPE_STRING
                        val page = NativeSettingsMessage.resolve(
                            if (isString) message.data else null, sourceOrigin.toString(), host, catalog.selected()?.host,
                            browser.url, isString, isMainFrame,
                            connectionGeneration == generation, loginLayer != null, passwordChangeGate.isBlocked()
                        ) ?: return@runOnUiThread
                        showNativeSettings(page)
                    }
                }
            })
        settingsListenerOrigin = host.origin
    }

    private fun showPasswordWait() {
        val dialog = AlertDialog.Builder(this)
            .setTitle("正在修改密码")
            .setMessage("正在等待服务器结果。请勿切换服务器或退出登录。")
            .create()
        dialog.setCancelable(false); dialog.setCanceledOnTouchOutside(false)
        dialog.show()
        passwordWaitDialog = dialog
        passwordWaitHandler.post(passwordWaitPoll)
    }

    private fun showStoredPasswordOutcome() {
        val preferences = getSharedPreferences("b0-host", MODE_PRIVATE)
        val message = preferences.getString("password-change-outcome", null) ?: return
        val origin = preferences.getString("password-change-origin", null) ?: "未知服务器"
        AlertDialog.Builder(this).setTitle("密码修改结果")
            .setMessage("服务器：$origin\n$message")
            .setPositiveButton("已核对") { _, _ ->
                preferences.edit().remove("password-change-outcome").remove("password-change-origin").apply()
                passwordChangeGate.clearResult()
            }
            .setCancelable(false)
            .show()
    }

    private fun showPassword() {
        if (passwordChangeGate.isBlocked()) return
        val current = address ?: return
        val body = formBody()
        body.addView(text("账号与安全", 17f, ink, true)); body.addView(gap(24))
        body.addView(text("修改密码", 25f, ink, true)); body.addView(gap(4))
        body.addView(text("使用当前服务器密码验证后，设置新密码。", 13f, muted)); body.addView(gap(26))
        val old = field("当前密码", "请输入当前密码", password = true)
        val fresh = field("新密码", "输入新密码", password = true)
        val repeat = field("确认新密码", "再次输入新密码", password = true)
        addField(body, old, "当前密码"); body.addView(gap(18))
        addField(body, fresh, "新密码"); body.addView(gap(18))
        addField(body, repeat, "确认新密码")
        body.addView(gap(28))
        body.addView(text("其他设备可能仍保持登录\n修改密码不会保证其他设备立即失效；它们可能在会话到期前继续可用。", 13f)
            .apply { setPadding(dp(14), dp(12), dp(14), dp(12)); background = shape(accentSoft) })
        body.addView(gap(34))
        val dialog = Dialog(this)
        val feedback = text("保存时禁用按钮，等待服务器确认。", 12f, muted)
        lateinit var save: Button
        save = primary("保存新密码") {
            val oldValue = old.text.toString(); val newValue = fresh.text.toString()
            if (newValue != repeat.text.toString()) { feedback.text = "两次新密码不一致。"; return@primary }
            if (newValue.length < 12 || newValue.toByteArray(StandardCharsets.UTF_8).size > 1024) {
                feedback.text = "新密码至少12字符且不超过1024字节。"; return@primary
            }
            old.text.clear(); fresh.text.clear(); repeat.text.clear()
            itPasswordChange(current, oldValue, newValue, feedback, save, dialog)
        }
        body.addView(save); body.addView(gap(12)); body.addView(feedback)
        dialog.setContentView(wrap(body)); dialog.show(); dialog.window?.setLayout(-1, -1)
    }

    private fun itPasswordChange(host: HostAddress, old: String, fresh: String, feedback: TextView, button: Button, dialog: Dialog) {
        val cookie = CookieManager.getInstance().getCookie(host.origin + "/").orEmpty()
        if (cookie.isEmpty()) { feedback.text = "登录已失效，请重新登录。"; return }
        if (!passwordChangeGate.begin()) return
        val origin = host.origin
        val preferences = getSharedPreferences("b0-host", MODE_PRIVATE)
        if (!preferences.edit()
                .putString("password-change-outcome", PasswordChangeOutcome.unknown.message)
                .putString("password-change-origin", origin)
                .commit()) {
            passwordChangeGate.abortBeforeSend()
            feedback.text = "无法保存请求状态；密码修改请求未发送。"
            return
        }
        dialog.setCancelable(false); dialog.setCanceledOnTouchOutside(false)
        button.isEnabled = false; feedback.text = "正在保存…请等待服务器返回结果。"
        Thread {
            val outcome = try {
                val connection = HostHttp.open("$origin/jarvis-auth/password", cookie, "POST", 10000).apply {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    setRequestProperty("Cookie", cookie); setRequestProperty("Origin", origin)
                    val payload = "oldPassword=${URLEncoder.encode(old, "UTF-8")}&newPassword=${URLEncoder.encode(fresh, "UTF-8")}"
                    outputStream.use { it.write(payload.toByteArray(StandardCharsets.UTF_8)) }
                }
                try { PasswordChangeOutcome.fromStatus(connection.responseCode) }
                finally { connection.disconnect() }
            } catch (_: SSLException) { PasswordChangeOutcome.unknown }
            catch (_: Exception) { PasswordChangeOutcome.unknown }
            val durableOutcome = if (preferences.edit()
                    .putString("password-change-outcome", outcome.message)
                    .commit()) outcome else PasswordChangeOutcome.unknown
            passwordChangeGate.complete(durableOutcome)
            runOnUiThread {
                if (isDestroyed || isChangingConfigurations || isFinishing) return@runOnUiThread
                if (dialog.isShowing) {
                    dialog.dismiss()
                }
                if (durableOutcome.loginExpired) {
                    connectionState = ConnectionState.EXPIRED; showEntry(EntryScreen.EXPIRED)
                }
                showStoredPasswordOutcome()
            }
        }.start()
    }

    private fun logout() {
        if (passwordChangeGate.isBlocked()) return
        ScheduledNotifySync.get(this).deactivate()
        scheduledNavigation.clear()
        sessionNotify.deactivate()
        sessionNavigation.clear()
        sessionPermissions.clear()
        webPermissions.invalidate()
        dismissExternalLink()
        resetRenderRecovery()
        connectionGeneration++
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        val generation = connectionGeneration
        val selectedOrigin = address?.origin
        installWebViewClient(generation, getSharedPreferences("b0-host", MODE_PRIVATE))
        removeSettingsListener()
        closeNativeSettings()
        activeProbe?.disconnect(); activeProbe = null
        connectionState = ConnectionState.DISCONNECTED; notice = ""
        connectionGate.invalidate(); fileExport.invalidate(); fileResult?.onReceiveValue(null); fileResult = null
        browser.stopLoading(); browser.loadUrl("about:blank"); browser.clearHistory()
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            runOnUiThread {
                if (!isFinishing && !isDestroyed && generation == connectionGeneration &&
                    address?.origin == selectedOrigin)
                    showEntry(EntryScreen.LOGIN, "已退出当前设备。")
            }
        }
    }

    private fun submitLogin(host: HostAddress, username: String, password: String) {
        if (address?.origin != host.origin) { connect(host) { postLogin(host, username, password) }; return }
        postLogin(host, username, password)
    }
    private fun postLogin(host: HostAddress, username: String, password: String) {
        if (address != host) return
        resetRenderRecovery()
        connectionGeneration++
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        replaceBrowser()
        fileExport.bind(host)
        bindSettingsListener(host, connectionGeneration)
        authenticating = true; connectionState = ConnectionState.AUTHENTICATING
        mainFrameFailed = false; webFailure = null
        val body = "username=${URLEncoder.encode(username, "UTF-8")}&password=${URLEncoder.encode(password, "UTF-8")}"
        entryScreen = EntryScreen.AUTHENTICATING
        if (loginAction == null) showEntry(EntryScreen.AUTHENTICATING)
        else loginAction?.apply { text = entryCopy(EntryScreen.AUTHENTICATING).primary; isEnabled = false }
        entryAdmission = EntryAdmission(connectionGeneration, browser, AdmissionKind.LOGIN)
        browser.postUrl(host.origin + "/jarvis-auth", body.toByteArray(StandardCharsets.UTF_8))
    }

    private fun connect(host: HostAddress, afterReady: (() -> Unit)? = null) {
        invalidateBack()
        if (passwordChangeGate.isRunning()) return
        resetRenderRecovery()
        ScheduledNotifySync.get(this).prepareHost(host)
        sessionNotify.prepareHost(host)
        sessionPermissions.clear()
        connectionGeneration++
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        replaceBrowser()
        closeNativeSettings()
        activeProbe?.disconnect(); activeProbe = null
        val attempt = connectionGate.begin(host.origin)
        notice = ""; connectionState = ConnectionState.CHECKING; authenticating = false
        fileExport.invalidate(); fileResult?.onReceiveValue(null); fileResult = null
        browser.stopLoading(); address = null; mainFrameFailed = false; webFailure = null
        loginPending = afterReady == null
        if (afterReady == null) showEntry(EntryScreen.RECOVERING)
        else if (loginAction == null) showEntry(EntryScreen.AUTHENTICATING)
        else {
            entryScreen = EntryScreen.AUTHENTICATING
            loginAction?.apply { text = entryCopy(EntryScreen.AUTHENTICATING).primary; isEnabled = false }
        }
        fun navigate() {
            if (isFinishing || isDestroyed || !connectionGate.ready(attempt)) return
            address = host; fileExport.bind(host)
            bindSettingsListener(host, connectionGeneration)
            getSharedPreferences("b0-host", MODE_PRIVATE).edit().putString("cookie-origin", host.origin).apply()
            if (afterReady != null) afterReady() else {
                entryAdmission = EntryAdmission(connectionGeneration, browser, AdmissionKind.RECOVERY)
                browser.loadUrl(host.base.toASCIIString())
            }
        }
        if (attempt.mustClearCookies) {
            browser.loadUrl("about:blank"); browser.clearHistory()
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush(); navigate()
            }
        } else navigate()
    }

    private fun openScheduledNotification() {
        val host = address ?: return
        if (loginLayer != null || connectionState != ConnectionState.CONNECTED) return
        val view = browser
        val generation = connectionGeneration
        scheduledNavigation.open(view, host) {
            !isDestroyed && !isFinishing && view === browser && generation == connectionGeneration &&
                loginLayer == null && address == host && host.owns(view.url.orEmpty())
        }
    }

    private fun openSessionNotification() {
        val host = address ?: return
        if (loginLayer != null || connectionState != ConnectionState.CONNECTED) return
        val view = browser
        val generation = connectionGeneration
        sessionNavigation.open(view, host) {
            !isDestroyed && !isFinishing && view === browser && generation == connectionGeneration &&
                loginLayer == null && address == host && host.owns(view.url.orEmpty())
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        scheduledNavigation.read(intent)
        sessionNavigation.read(intent)
        closeNativeSettings()
        openScheduledNotification()
        openSessionNotification()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        scheduledNavigation.save(outState)
        sessionNavigation.save(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        dismissExternalLink()
        pendingRenderEntry = null
        scheduledNavigation.stop()
        sessionNavigation.stop()
        sessionPermissions.clear()
        webPermissions.setForeground(false)
        invalidateBack()
        removeSettingsListener()
        closeNativeSettings()
        passwordWaitHandler.removeCallbacks(passwordWaitPoll)
        passwordWaitDialog?.dismiss(); passwordWaitDialog = null
        probeHandler.removeCallbacks(periodicProbe)
        connectionGeneration++
        entryAdmission = null
        activeAdmissionProbe?.disconnect(); activeAdmissionProbe = null
        activeProbe?.disconnect(); activeProbe = null
        connectionGate.invalidate(); fileExport.destroy()
        fileResult?.onReceiveValue(null); fileResult = null
        browser.destroy(); super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        webPermissions.setForeground(true)
        browser.settings.setGeolocationEnabled(true)
        browser.onResume()
    }

    override fun onStop() {
        // Permission dialogs may pause the Activity while it is still visible.
        // Cancel only when it is stopped, so an ordinary grant can complete.
        webPermissions.setForeground(false)
        browser.settings.setGeolocationEnabled(false)
        browser.onPause()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        sessionNotify.foreground = true
        sessionNotify.pageVisible = loginLayer == null && settingsLayer == null
        sessionNotify.onSettings = { sessionPermissions.consider(it) }
        if (sessionNotify.state.authenticated) sessionPermissions.consider(sessionNotify.state.settings)
        sessionPermissions.resume()
        openScheduledNotification()
        openSessionNotification()
        if (loginLayer == null) address?.let { host ->
            sessionNotify.activate(host)
            ScheduledNotifySync.get(this).activate(host) { snapshot -> sessionPermissions.considerSchedule(snapshot) }
        }
        probeHandler.removeCallbacks(periodicProbe)
        probeHandler.postDelayed(periodicProbe, 20000)
    }

    override fun onPause() {
        sessionNotify.foreground = false
        sessionNotify.onSettings = null
        scheduledNavigation.stop()
        sessionNavigation.stop()
        invalidateBack()
        probeHandler.removeCallbacks(periodicProbe)
        super.onPause()
    }

    /** Read-only authenticated probe; never navigates WebView or submits its draft. */
    private fun probeConnection() {
        val host = address ?: return
        if (recoveringBrowser === browser && (settingsLayer != null || loginLayer != null)) return
        if (probeInFlight || connectionState !in setOf(ConnectionState.CONNECTED, ConnectionState.OFFLINE, ConnectionState.SERVER_ERROR)) return
        probeInFlight = true
        val origin = host.origin
        val generation = connectionGeneration
        val cookie = CookieManager.getInstance().getCookie(host.base.toASCIIString()).orEmpty()
        Thread {
            var connection: HttpURLConnection? = null
            val result = if (connectionGeneration != generation) -3 else try {
                connection = HostHttp.open(host.base.toASCIIString(), cookie)
                activeProbe = connection
                if (connectionGeneration != generation) -3 else connection!!.responseCode
            } catch (_: SSLException) { -2 }
            catch (_: Exception) { -1 }
            finally {
                connection?.disconnect()
                if (activeProbe === connection) activeProbe = null
            }
            runOnUiThread {
                probeInFlight = false
                if (isDestroyed || connectionGeneration != generation || address?.origin != origin || loginLayer != null) return@runOnUiThread
                when (result) {
                    200 -> if (connectionState == ConnectionState.OFFLINE || connectionState == ConnectionState.SERVER_ERROR) {
                        connectionState = ConnectionState.CONNECTED
                        notice = "网络已恢复；草稿仍在当前页面，请手动继续。"; showBanner(notice)
                    }
                    401 -> { connectionState = ConnectionState.EXPIRED; showEntry(EntryScreen.EXPIRED) }
                    -2 -> { connectionState = ConnectionState.TLS; showEntry(EntryScreen.TLS) }
                    -1 -> { connectionState = ConnectionState.OFFLINE; notice = "连接中断，正在重连…"; showBanner(notice) }
                    else -> { connectionState = ConnectionState.SERVER_ERROR; notice = "服务器暂不可用（$result）；草稿已保留。"; showBanner(notice) }
                }
                if (settingsPage == NativeSettingsPage.CONNECTION) showNativeSettings(NativeSettingsPage.CONNECTION)
            }
        }.start()
    }
}
