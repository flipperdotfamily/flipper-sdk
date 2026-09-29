package family.flipper.widget

/** What to do with a navigation inside the widget's WebView. */
enum class NavigationDecision {
    /** Let the WebView load it. */
    ALLOW,

    /** Cancel it and hand the URL to the system (browser, mail app, dialer). */
    OPEN_EXTERNAL,

    /** Cancel it and do nothing. */
    BLOCK,
}

/** Navigation policy (contract section 7). Pure JVM, unit-testable. */
object NavigationPolicy {
    /**
     * - Main frame: the embed origin loads; other http(s) URLs and `mailto:` / `tel:` open externally; every other
     *   scheme (`javascript:`, `file:`, `data:`, `content:`, `intent:`, custom) is blocked.
     * - Sub-frames: only `about:blank`, `about:srcdoc` and the embed origin load; everything else is blocked (never
     *   opened).
     */
    @JvmStatic
    fun decide(url: String, isMainFrame: Boolean, embedOrigin: String): NavigationDecision {
        val trimmed = url.trim()
        val lower = trimmed.lowercase()
        val origin = EmbedUrl.originOf(trimmed)
        val sameOrigin = origin != null && embedOrigin.isNotEmpty() && origin == embedOrigin
        if (!isMainFrame) {
            if (isAboutBlankOrSrcdoc(lower)) return NavigationDecision.ALLOW
            return if (sameOrigin) NavigationDecision.ALLOW else NavigationDecision.BLOCK
        }
        return when (lower.substringBefore(':', missingDelimiterValue = "")) {
            "http", "https" -> when {
                sameOrigin -> NavigationDecision.ALLOW
                origin != null -> NavigationDecision.OPEN_EXTERNAL
                else -> NavigationDecision.BLOCK
            }
            "mailto", "tel" -> NavigationDecision.OPEN_EXTERNAL
            else -> NavigationDecision.BLOCK
        }
    }

    private fun isAboutBlankOrSrcdoc(lower: String): Boolean {
        val base = lower.substringBefore('#').substringBefore('?')
        return base == "about:blank" || base == "about:srcdoc"
    }
}
