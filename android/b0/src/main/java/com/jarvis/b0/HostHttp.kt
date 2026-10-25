package com.jarvis.b0

import java.net.HttpURLConnection
import java.net.URL

/** Shared with the Activity probes: platform TLS trust, explicit Cookie, no redirects. */
internal object HostHttp {
    fun open(url: String, cookie: String, method: String = "GET", timeout: Int = 6000): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = false
            connectTimeout = timeout
            readTimeout = timeout
            if (cookie.isNotEmpty()) setRequestProperty("Cookie", cookie)
        }
}
