package com.libretv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * LibreTV WebView 壳应用
 * 前端打包于 assets/www，以 file:// 方式加载，
 * 开启 UniversalAccess 后前端可直接请求采集接口（无需服务端代理）。
 *
 * 豆瓣资源（API 与海报 CDN）要求 Referer 为豆瓣域，WebView 直发会因空 Referer 被 418 拒绝；
 * shouldInterceptRequest 对豆瓣域名的请求以原生 HTTP 附加 Referer 拉取。
 */
public class MainActivity extends Activity {

    private WebView webView;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0f0f1a); // LibreTV 深色背景

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(UA);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 全部在应用内打开（播放页跳转、相对路径导航等）
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return interceptDouban(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    /**
     * 豆瓣域名的请求附加 Referer 原生拉取，其余交由 WebView 默认处理。
     * 注意：仅在 WebView 的 IO 线程调用，同步网络请求可用。
     */
    private WebResourceResponse interceptDouban(Uri uri) {
        try {
            String scheme = uri.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
            String host = uri.getHost();
            if (host == null) return null;
            if (!host.endsWith("douban.com") && !host.endsWith("doubanio.com")) return null;

            HttpURLConnection conn = (HttpURLConnection) new URL(uri.toString()).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Referer", "https://movie.douban.com/");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                String contentType = conn.getContentType();
                String mime = contentType, encoding = null;
                if (contentType != null) {
                    int semi = contentType.indexOf(';');
                    if (semi > -1) {
                        mime = contentType.substring(0, semi).trim();
                        String params = contentType.substring(semi + 1).trim().toLowerCase();
                        if (params.contains("charset=")) {
                            encoding = params.substring(params.indexOf("charset=") + 8).trim();
                        }
                    }
                }
                Map<String, String> respHeaders = new HashMap<>();
                respHeaders.put("Cache-Control", "public, max-age=86400");
                String cacheControl = conn.getHeaderField("Cache-Control");
                if (cacheControl != null) respHeaders.put("Cache-Control", cacheControl);
                return new WebResourceResponse(mime, encoding, conn.getInputStream());
            }
            conn.disconnect();
        } catch (Exception ignored) {
            // 拉取失败则回退 WebView 默认加载（触发前端 onerror 回退链）
        }
        return null;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
