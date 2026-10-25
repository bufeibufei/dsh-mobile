package com.jarvis.b0

/** A WebView callback belongs to the current connection only while both its attempt and Host match. */
internal fun acceptsConnectionCallback(
    callbackGeneration: Long,
    activeGeneration: Long,
    activeHost: HostAddress?,
    callbackUrl: String
): Boolean = callbackGeneration == activeGeneration && activeHost?.owns(callbackUrl) == true

/** Prefer the failed resource URL; a current page URL cannot authenticate an old TLS callback. */
internal fun acceptsSslFailure(
    callbackGeneration: Long,
    activeGeneration: Long,
    activeHost: HostAddress?,
    errorUrl: String?,
    pageUrl: String?
): Boolean {
    val failedUrl = errorUrl?.takeIf { it.isNotBlank() }
    return acceptsConnectionCallback(callbackGeneration, activeGeneration, activeHost,
        failedUrl ?: pageUrl.orEmpty())
}
