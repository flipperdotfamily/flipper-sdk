# Rules applied to apps that depend on family.flipper:widget (shipped inside the AAR).

# WebView looks up @JavascriptInterface methods reflectively (FlipperWidgetView.JsChannel.postMessage, the
# window.FlipperHost fallback used on WebViews without WebMessageListener). Keep them and their annotation.
-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class family.flipper.widget.** {
    @android.webkit.JavascriptInterface <methods>;
}
