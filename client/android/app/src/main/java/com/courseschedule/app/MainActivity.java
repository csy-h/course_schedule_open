package com.courseschedule.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings webSettings = webView.getSettings();
            if (webSettings != null) {
                webSettings.setDomStorageEnabled(true);
                webSettings.setDatabaseEnabled(true);
                webSettings.setJavaScriptEnabled(true);
                webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            }
            webView.addJavascriptInterface(new AndroidWidgetBridge(this), "AndroidWidgetBridge");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        CourseWidgetProvider.updateAllWidgets(this);
    }

    @Override
    public void onBackPressed() {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().evaluateJavascript(
                "if (typeof window.handleSystemBackPress === 'function') { window.handleSystemBackPress(); } else { window.history.back(); }",
                null
            );
        } else {
            super.onBackPressed();
        }
    }
}
