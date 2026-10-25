package com.jarvis.b0

import android.Manifest
import android.content.pm.PackageManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/** Android adapter; all requests and results stay on the Activity's UI thread. */
internal class WebPermissionController(
    private val activity: ComponentActivity,
    private val host: () -> HostAddress?,
    private val current: (WebView) -> Boolean,
    private val notice: (String) -> Unit
) {
    private val gate = WebPermissionGate()
    private var foreground = false
    private var generation = 0L
    private var audioToken: Long? = null
    private var locationToken: Long? = null
    private val audioLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        val token = audioToken
        audioToken = null
        token?.let(::complete)
    }
    private val locationLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val token = locationToken
        locationToken = null
        token?.let(::complete)
    }

    private fun permissions() = WebPermissionGate.Permissions(
        audio = granted(Manifest.permission.RECORD_AUDIO),
        coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION),
        fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    )

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

    private fun validation(view: WebView, origin: String): () -> Boolean {
        val page = view.url
        val epoch = generation
        return {
            epoch == generation && page == view.url && !activity.isFinishing && !activity.isDestroyed &&
                WebPermissionGate.trusted(host(), origin, view.url, current(view), foreground)
        }
    }

    fun audio(view: WebView, request: PermissionRequest) {
        val token = gate.request(request, WebPermissionGate.Kind.AUDIO, request.resources.toSet(),
            permissions(), validation(view, request.origin.toString())) { result ->
            if (result.allow) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
        } ?: return
        audioToken = token
        try {
            audioLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } catch (_: RuntimeException) {
            audioToken = null
            gate.cancel()
            gate.complete(token, permissions())
            notice("无法申请麦克风权限，请稍后重试")
        }
    }

    fun location(view: WebView, origin: String, callback: GeolocationPermissions.Callback) {
        val token = gate.request(view, WebPermissionGate.Kind.LOCATION, emptySet(),
            permissions(), validation(view, origin)) { result ->
            callback.invoke(origin, result.allow, result.retain)
        } ?: return
        locationToken = token
        try {
            locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        } catch (_: RuntimeException) {
            locationToken = null
            gate.cancel()
            gate.complete(token, permissions())
            notice("无法申请定位权限，请稍后重试")
        }
    }

    fun cancelAudio(request: PermissionRequest) = gate.cancel(request, WebPermissionGate.Kind.AUDIO)
    fun hideLocation(view: WebView) = gate.cancel(view, WebPermissionGate.Kind.LOCATION)

    fun invalidate() {
        generation++
        gate.cancel()
    }

    fun setForeground(value: Boolean) {
        foreground = value
        if (!value) invalidate()
    }

    private fun complete(token: Long) {
        when (gate.complete(token, permissions())) {
            WebPermissionGate.Kind.AUDIO -> notice("未授予麦克风权限，无法使用语音输入；可在系统设置中开启")
            WebPermissionGate.Kind.LOCATION -> notice("未授予定位权限，无法读取当前位置；可在系统设置中开启")
            null -> Unit
        }
    }
}
