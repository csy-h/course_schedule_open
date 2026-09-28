package com.courseschedule.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.widget.Toast;


import android.app.Dialog;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import org.json.JSONObject;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class AndroidWidgetBridge {
    private final Activity activity;
    private final Context context;
    public static final String PREFS_NAME = "CourseWidgetPrefs";
    public static final String KEY_COURSES = "courses_json";
    public static final String KEY_SEMESTER_START = "semester_start_date";
    private static final String API_KEY_PREFS = "CourseApiKeyPrefs";
    private static final String API_KEY_CIPHERTEXT = "ciphertext";
    private static final String API_KEY_IV = "iv";
    private static final String API_KEY_ALIAS = "course_schedule_api_key";

    public AndroidWidgetBridge(Activity activity) {
        this.activity = activity;
        this.context = activity != null ? activity.getApplicationContext() : null;
    }

    public AndroidWidgetBridge(Context context) {
        this.activity = (context instanceof Activity) ? (Activity) context : null;
        this.context = context != null ? context.getApplicationContext() : null;
    }

    /** Android 6+：密文在应用私有存储中，AES 密钥保留在 AndroidKeyStore。 */
    @JavascriptInterface
    public synchronized boolean storeApiKey(String apiKey) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        try {
            SharedPreferences prefs = context.getSharedPreferences(API_KEY_PREFS, Context.MODE_PRIVATE);
            if (apiKey == null || apiKey.isEmpty()) {
                return prefs.edit().remove(API_KEY_CIPHERTEXT).remove(API_KEY_IV).commit();
            }
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            SecretKey key;
            if (keyStore.containsAlias(API_KEY_ALIAS)) {
                key = (SecretKey) keyStore.getKey(API_KEY_ALIAS, null);
            } else {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(API_KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
                key = generator.generateKey();
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            String ciphertext = Base64.encodeToString(cipher.doFinal(apiKey.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            return prefs.edit().putString(API_KEY_IV, iv).putString(API_KEY_CIPHERTEXT, ciphertext).commit();
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public synchronized String loadApiKey() {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "";
        try {
            SharedPreferences prefs = context.getSharedPreferences(API_KEY_PREFS, Context.MODE_PRIVATE);
            String iv = prefs.getString(API_KEY_IV, null);
            String ciphertext = prefs.getString(API_KEY_CIPHERTEXT, null);
            if (iv == null || ciphertext == null) return "";
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            SecretKey key = (SecretKey) keyStore.getKey(API_KEY_ALIAS, null);
            if (key == null) return "";
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key,
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plaintext = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public void updateWidgetData(String jsonCourses, String semesterStartDate) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            if (jsonCourses != null && !jsonCourses.isEmpty()) {
                editor.putString(KEY_COURSES, jsonCourses);
            }
            if (semesterStartDate != null && !semesterStartDate.isEmpty()) {
                editor.putString(KEY_SEMESTER_START, semesterStartDate);
            }
            editor.apply();

            // 触发小组件即时刷新
            CourseWidgetProvider.sendUpdateBroadcast(context);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public String getAppVersionName() {
        try {
            if (context != null) {
                PackageInfo pInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                return pInfo.versionName;
            }
        } catch (Exception ignored) {}
        return "2.0.0";
    }

    @JavascriptInterface
    public int getAppVersionCode() {
        try {
            if (context != null) {
                PackageInfo pInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return (int) pInfo.getLongVersionCode();
                } else {
                    return pInfo.versionCode;
                }
            }
        } catch (Exception ignored) {}
        return 20;
    }

    @JavascriptInterface
    public void minimizeApp() {
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        activity.moveTaskToBack(true);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }
    }

    @JavascriptInterface
    public void requestPinWidget() {
        if (context == null) return;
        final Handler mainHandler = new Handler(Looper.getMainLooper());
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AppWidgetManager appWidgetManager = context.getSystemService(AppWidgetManager.class);
                if (appWidgetManager != null) {
                    ComponentName myProvider = new ComponentName(context, CourseWidgetProvider.class);
                    boolean pinned = false;
                    try {
                        pinned = appWidgetManager.requestPinAppWidget(myProvider, null, null);
                    } catch (Exception ignored) {}

                    if (pinned) {
                        mainHandler.post(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(context, "已调起系统添加小组件弹窗，请点击【添加】", Toast.LENGTH_LONG).show();
                            }
                        });
                        return;
                    }
                }
            }
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(context, "若未弹出添加框，请在负一屏或桌面空白处长按/双指捏合，在小组件列表中选择【课程表】添加", Toast.LENGTH_LONG).show();
                }
            });
        } catch (final Exception e) {
            e.printStackTrace();
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(context, "添加小组件提示: 请在桌面或负一屏长按添加", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private WebView getMainWebView() {
        if (activity instanceof BridgeActivity) {
            Bridge bridge = ((BridgeActivity) activity).getBridge();
            if (bridge != null) return bridge.getWebView();
        }
        return null;
    }

    @JavascriptInterface
    public void verifyNjxzcCredentials(final String username, final String password) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String cleanUser = username != null ? username.trim() : "";
                    String cleanPass = password != null ? password.trim() : "";
                    if (cleanUser.isEmpty() || cleanPass.isEmpty()) {
                        postVerifyResult(false, "请输入学号与密码");
                        return;
                    }

                    String serviceUrl = "http://ehall.njxzc.edu.cn/jwapp/sys/wdkb/*default/index.do";
                    String loginUrl = "http://authserver.njxzc.edu.cn/authserver/login?service=" + Uri.encode(serviceUrl);

                    HttpURLConnection getConn = (HttpURLConnection) new URL(loginUrl).openConnection();
                    getConn.setRequestMethod("GET");
                    getConn.setConnectTimeout(8000);
                    getConn.setReadTimeout(8000);
                    getConn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36");

                    String cookieHeader = getConn.getHeaderField("Set-Cookie");
                    InputStream is = getConn.getInputStream();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int len;
                    while ((len = is.read(buf)) != -1) {
                        baos.write(buf, 0, len);
                    }
                    is.close();
                    String html = baos.toString("UTF-8");
                    getConn.disconnect();

                    String salt = extractVal(html, "pwdEncryptSalt");
                    String execution = extractVal(html, "execution");

                    if (salt == null || execution == null) {
                        postVerifyResult(false, "无法连接学校统一身份认证中心");
                        return;
                    }

                    String encPassword = encryptAesPassword(cleanPass, salt);
                    String postData = "username=" + Uri.encode(cleanUser) +
                            "&password=" + Uri.encode(encPassword) +
                            "&execution=" + Uri.encode(execution) +
                            "&_eventId=submit&cllt=userNameLogin&dllt=generalLogin&lt=";

                    HttpURLConnection postConn = (HttpURLConnection) new URL(loginUrl).openConnection();
                    postConn.setRequestMethod("POST");
                    postConn.setInstanceFollowRedirects(false);
                    postConn.setDoOutput(true);
                    postConn.setConnectTimeout(8000);
                    postConn.setReadTimeout(8000);
                    postConn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    postConn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36");
                    postConn.setRequestProperty("Referer", loginUrl);
                    if (cookieHeader != null) {
                        postConn.setRequestProperty("Cookie", cookieHeader);
                    }

                    OutputStream os = postConn.getOutputStream();
                    os.write(postData.getBytes("UTF-8"));
                    os.flush();
                    os.close();

                    int respCode = postConn.getResponseCode();
                    String loc = postConn.getHeaderField("Location");
                    postConn.disconnect();

                    if (respCode == 302 && loc != null && !loc.contains("/authserver/login") && !loc.contains("exception.message")) {
                        postVerifyResult(true, "");
                    } else {
                        postVerifyResult(false, "用户名或密码错误");
                    }
                } catch (Exception e) {
                    postVerifyResult(false, "认证检查异常: " + e.getMessage());
                }
            }
        }).start();
    }

    private void postVerifyResult(final boolean success, final String message) {
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                WebView mainWv = getMainWebView();
                if (mainWv != null) {
                    mainWv.evaluateJavascript(
                        "if (typeof window.onNjxzcVerifyResult === 'function') { window.onNjxzcVerifyResult(" + success + ", " + JSONObject.quote(message != null ? message : "") + "); }",
                        null
                    );
                }
            }
        });
    }

    private static String extractVal(String html, String idOrName) {
        if (html == null) return null;
        java.util.regex.Pattern p1 = java.util.regex.Pattern.compile("(?:id|name)=[\"']" + idOrName + "[\"'][^>]*?value=[\"']([^\"']*)[\"']", java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher m1 = p1.matcher(html);
        if (m1.find()) return m1.group(1);

        java.util.regex.Pattern p2 = java.util.regex.Pattern.compile("value=[\"']([^\"']*)[\"'][^>]*?(?:id|name)=[\"']" + idOrName + "[\"']", java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher m2 = p2.matcher(html);
        if (m2.find()) return m2.group(1);
        return null;
    }

    private static final String AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
    private static String randomString(int len) {
        StringBuilder sb = new StringBuilder(len);
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < len; i++) {
            sb.append(AES_CHARS.charAt(r.nextInt(AES_CHARS.length())));
        }
        return sb.toString();
    }

    private static String encryptAesPassword(String password, String salt) throws Exception {
        String cleanSalt = (salt != null ? salt.trim() : "");
        String iv = randomString(16);
        String data = randomString(64) + password;

        javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding");
        javax.crypto.spec.SecretKeySpec keySpec = new javax.crypto.spec.SecretKeySpec(cleanSalt.getBytes("UTF-8"), "AES");
        javax.crypto.spec.IvParameterSpec ivSpec = new javax.crypto.spec.IvParameterSpec(iv.getBytes("UTF-8"));
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, keySpec, ivSpec);
        byte[] encrypted = cipher.doFinal(data.getBytes("UTF-8"));
        return android.util.Base64.encodeToString(encrypted, android.util.Base64.NO_WRAP);
    }

    @JavascriptInterface
    public void startAutomatedSchoolImport(final String username, final String password, final String semester) {
        startAutomatedSchoolImport(username, password, semester, false);
    }

    @JavascriptInterface
    public void startAutomatedSchoolImport(final String username, final String password, final String semester, final boolean isManualMode) {
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    openSchoolAutomatedDialog(username, password, semester != null ? semester : "2026-2027-1", isManualMode);
                } catch (Exception e) {
                    Toast.makeText(activity, "无法启动自动化导入容器: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    private void openSchoolAutomatedDialog(final String username, final String password, final String semester, final boolean isManualMode) {
        final Dialog dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(true);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 顶部标题栏
        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setBackgroundColor(Color.parseColor("#10B981"));
        header.setGravity(Gravity.CENTER_VERTICAL);
        int padH = (int) (16 * activity.getResources().getDisplayMetrics().density);
        int padV = (int) (12 * activity.getResources().getDisplayMetrics().density);
        header.setPadding(padH, padV, padH, padV);

        TextView tvTitle = new TextView(activity);
        tvTitle.setText("南京晓庄学院 - 官方教务同步");
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTextSize(16f);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        header.addView(tvTitle, titleLp);

        Button btnExtractNow = new Button(activity);
        btnExtractNow.setText("⚡ 提取课表");
        btnExtractNow.setTextColor(Color.parseColor("#10B981"));
        btnExtractNow.setBackgroundColor(Color.WHITE);
        btnExtractNow.setTextSize(12f);
        btnExtractNow.setTypeface(null, android.graphics.Typeface.BOLD);
        int btnExW = (int) (85 * activity.getResources().getDisplayMetrics().density);
        int btnExH = (int) (32 * activity.getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams btnExLp = new LinearLayout.LayoutParams(btnExW, btnExH);
        btnExLp.rightMargin = (int) (8 * activity.getResources().getDisplayMetrics().density);
        btnExtractNow.setLayoutParams(btnExLp);

        Button btnClose = new Button(activity);
        btnClose.setText("✕");
        btnClose.setTextColor(Color.WHITE);
        btnClose.setTextSize(18f);
        btnClose.setBackgroundColor(Color.TRANSPARENT);
        int btnW = (int) (40 * activity.getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(btnW, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnClose.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                dialog.dismiss();
            }
        });
        header.addView(btnExtractNow);
        header.addView(btnClose, btnLp);
        root.addView(header);

        // 副标题提示条
        final TextView tvSubtitle = new TextView(activity);
        if (isManualMode) {
            tvSubtitle.setText("⚠️ 密码验证未通过，请在下方自行输入教务密码并点击【登录】，登录后系统将自动为您提取课表！");
            tvSubtitle.setTextColor(Color.parseColor("#B45309"));
            tvSubtitle.setBackgroundColor(Color.parseColor("#FEF3C7"));
        } else {
            tvSubtitle.setText("🔒 正在连接教务大厅，自动安全填入并提取您的个人排课...");
            tvSubtitle.setTextColor(Color.parseColor("#15803D"));
            tvSubtitle.setBackgroundColor(Color.parseColor("#F0FDF4"));
        }
        tvSubtitle.setTextSize(12f);
        int subPad = (int) (10 * activity.getResources().getDisplayMetrics().density);
        tvSubtitle.setPadding(padH, subPad, padH, subPad);
        root.addView(tvSubtitle);

        // 底部常驻引导提示条（仅在手动输入模式下显示，清晰指引用户在上方网页自行输入密码并点击登录）
        final TextView tvBottomGuide = new TextView(activity);
        if (isManualMode) {
            tvBottomGuide.setText("👉 请在上方页面输入您的教务密码并点击【登录】，登录成功后系统将自动为您提取并导入课表");
            tvBottomGuide.setTextColor(Color.parseColor("#92400E"));
            tvBottomGuide.setBackgroundColor(Color.parseColor("#FEF3C7"));
            tvBottomGuide.setTextSize(13f);
            tvBottomGuide.setTypeface(null, android.graphics.Typeface.BOLD);
            int bgPadH = (int) (16 * activity.getResources().getDisplayMetrics().density);
            int bgPadV = (int) (12 * activity.getResources().getDisplayMetrics().density);
            tvBottomGuide.setPadding(bgPadH, bgPadV, bgPadH, bgPadV);
            tvBottomGuide.setGravity(Gravity.CENTER);
            tvBottomGuide.setVisibility(View.VISIBLE);
        } else {
            tvBottomGuide.setVisibility(View.GONE);
        }

        // 细进度条
        ProgressBar pBar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        pBar.setIndeterminate(true);
        int pbH = (int) (3 * activity.getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams pbLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, pbH);
        root.addView(pBar, pbLp);

        // 官方页面 WebView
        final WebView schoolWv = new WebView(activity);
        LinearLayout.LayoutParams wvLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f);
        schoolWv.setLayoutParams(wvLp);

        schoolWv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                if (!isTrustedSchoolUrl(url) || message == null || !message.startsWith("cs_schedule:")) {
                    return super.onJsPrompt(view, url, message, defaultValue, result);
                }
                result.confirm("");
                if (message.startsWith("cs_schedule:extracted:")) {
                    final String jsonRows = message.substring("cs_schedule:extracted:".length());
                    if (dialog.isShowing()) dialog.dismiss();
                    WebView mainWv = getMainWebView();
                    if (mainWv != null) {
                        mainWv.evaluateJavascript("if (typeof window.onNativeSchoolScheduleReceived === 'function') { window.onNativeSchoolScheduleReceived(" + JSONObject.quote(jsonRows) + "); }", null);
                    }
                } else if (message.equals("cs_schedule:captcha:")) {
                    tvSubtitle.setText("📌 学校要求图形验证码，请在下方网页输入 4 位验证码继续");
                    tvSubtitle.setTextColor(Color.parseColor("#DC2626"));
                    tvSubtitle.setBackgroundColor(Color.parseColor("#FEF2F2"));
                } else if (message.startsWith("cs_schedule:error:")) {
                    final String msg = message.substring("cs_schedule:error:".length());
                    Toast.makeText(activity, "教务提示: " + msg, Toast.LENGTH_SHORT).show();
                    WebView mainWv = getMainWebView();
                    if (mainWv != null) {
                        mainWv.evaluateJavascript("if (typeof window.onNativeSchoolScheduleError === 'function') { window.onNativeSchoolScheduleError(" + JSONObject.quote(msg) + "); }", null);
                    }
                }
                return true;
            }
        });

        btnExtractNow.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                schoolWv.evaluateJavascript("if (typeof window.triggerManualExtract === 'function') { window.triggerManualExtract(); }", null);
            }
        });

        WebSettings ws = schoolWv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setUserAgentString("Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(null);
        cm.removeSessionCookies(null);
        cm.flush();
        schoolWv.clearCache(true);
        schoolWv.clearHistory();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(schoolWv, true);
        }

        dialog.setOnKeyListener(new android.content.DialogInterface.OnKeyListener() {
            @Override
            public boolean onKey(android.content.DialogInterface d, int keyCode, android.view.KeyEvent event) {
                if (keyCode == android.view.KeyEvent.KEYCODE_BACK && event.getAction() == android.view.KeyEvent.ACTION_UP) {
                    if (schoolWv.canGoBack()) {
                        schoolWv.goBack();
                    } else {
                        dialog.dismiss();
                    }
                    return true;
                }
                return false;
            }
        });

        dialog.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(android.content.DialogInterface d) {
                WebView mainWv = getMainWebView();
                if (mainWv != null) {
                    mainWv.evaluateJavascript("if (typeof window.onNativeSchoolScheduleCancelled === 'function') { window.onNativeSchoolScheduleCancelled(); }", null);
                }
            }
        });

        schoolWv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                return !isTrustedSchoolUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    return shouldOverrideUrlLoading(view, request.getUrl().toString());
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (tvSubtitle != null) {
                    tvSubtitle.setText("⚠️ 页面连接状态: " + description + "，正在尝试安全直连...");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!isTrustedSchoolUrl(url)) return;
                String lower = url.toLowerCase();

                // 1. 自愈保护：若页面呈现“非法的页面跳转”或“#E2140100001”，自动由官方门户门禁重新激活并直达
                String checkErrorJs = "(function() {" +
                    "if (document.body && (document.body.innerText.indexOf('非法的页面跳转') !== -1 || document.body.innerText.indexOf('E2140100001') !== -1)) {" +
                    "  var target = 'http://ehall.njxzc.edu.cn/jwapp/sys/wdkb/*default/index.do?EMAP_LANG=zh&THEME=golden#/xskcb';" +
                    "  window.location.href = 'http://ehall.njxzc.edu.cn/login?service=' + encodeURIComponent(target);" +
                    "}" +
                    "})();";
                view.evaluateJavascript(checkErrorJs, null);

                // 2. CAS 统一身份认证登录页：适配移动与桌面端模板，自动填入并提交
                if (lower.contains("authserver/login")) {
                    String js;
                    if (isManualMode) {
                        // 手动模式：仅填充学号，不填密码，不自动点击登录，聚焦密码输入框，引导用户自行输入
                        js = "(function() {" +
                            "try {" +
                            "  if (typeof showTabHeadAndDiv === 'function') {" +
                            "    showTabHeadAndDiv('userNameLogin', 1);" +
                            "  }" +
                            "} catch(e) {}" +
                            "setTimeout(function() {" +
                            "  var u = document.querySelector('.login-main .pwd_login #username') || document.querySelector('#loginViewDiv #username') || document.querySelector('.m-account #username') || document.getElementById('username');" +
                            "  var p = document.querySelector('.login-main .pwd_login #password') || document.querySelector('#loginViewDiv #password') || document.querySelector('.m-account #password') || document.getElementById('password');" +
                            "  if (u) {" +
                            "    u.value = " + JSONObject.quote(username) + ";" +
                            "    u.dispatchEvent(new Event('input', { bubbles: true }));" +
                            "    u.dispatchEvent(new Event('change', { bubbles: true }));" +
                            "  }" +
                            "  if (p) {" +
                            "    p.removeAttribute('readonly');" +
                            "    p.value = '';" +
                            "    p.focus();" +
                            "  }" +
                            "}, 400);" +
                            "})();";
                    } else {
                        // 自动模式：填充学号和密码，自动点击登录
                        js = "(function() {" +
                            "try {" +
                            "  if (typeof showTabHeadAndDiv === 'function') {" +
                            "    showTabHeadAndDiv('userNameLogin', 1);" +
                            "  }" +
                            "} catch(e) {}" +
                            "setTimeout(function() {" +
                            "  var errEl = document.getElementById('showErrorTip') || document.querySelector('.form-error') || document.getElementById('formErrorTip');" +
                            "  if (errEl && errEl.innerText && errEl.innerText.trim().length > 0) {" +
                            "    window.prompt('cs_schedule:error:' + errEl.innerText.trim());" +
                            "  }" +
                            "  var u = document.querySelector('.login-main .pwd_login #username') || document.querySelector('#loginViewDiv #username') || document.querySelector('.m-account #username') || document.getElementById('username');" +
                            "  var p = document.querySelector('.login-main .pwd_login #password') || document.querySelector('#loginViewDiv #password') || document.querySelector('.m-account #password') || document.getElementById('password');" +
                            "  var sub = document.querySelector('.login-main .pwd_login #login_submit') || document.querySelector('.login-main #login_submit') || document.getElementById('login_submit');" +
                            "  if (u && p) {" +
                            "    p.removeAttribute('readonly');" +
                            "    u.value = " + JSONObject.quote(username) + ";" +
                            "    p.value = " + JSONObject.quote(password) + ";" +
                            "    u.dispatchEvent(new Event('input', { bubbles: true }));" +
                            "    p.dispatchEvent(new Event('input', { bubbles: true }));" +
                            "    u.dispatchEvent(new Event('change', { bubbles: true }));" +
                            "    p.dispatchEvent(new Event('change', { bubbles: true }));" +
                            "    try {" +
                            "      if (typeof checkNeedCaptcha === 'function') { checkNeedCaptcha(); }" +
                            "      else if (typeof checkUserCaptcha === 'function') { checkUserCaptcha(); }" +
                            "    } catch(e) {}" +
                            "    setTimeout(function() {" +
                            "      var needCaptchaVal = (typeof needCaptcha !== 'undefined') ? needCaptcha : false;" +
                            "      var captchaDiv = document.querySelector('#loginViewDiv #captchaDiv') || document.querySelector('.pwd_login #captchaDiv') || document.querySelector('.m-account #captchaDiv') || document.getElementById('captchaDiv');" +
                            "      var isDivVisible = captchaDiv && captchaDiv.style.display !== 'none' && captchaDiv.style.visibility !== 'hidden';" +
                            "      if (!needCaptchaVal && !isDivVisible) {" +
                            "        if (typeof startLogin === 'function' && sub) {" +
                            "          startLogin(sub);" +
                            "        } else if (sub) {" +
                            "          sub.click();" +
                            "        }" +
                            "      } else {" +
                            "        window.prompt('cs_schedule:captcha:');" +
                            "        var cInput = document.querySelector('#loginViewDiv #captcha') || document.querySelector('.pwd_login #captcha') || document.querySelector('.m-account #captcha') || document.getElementById('captcha');" +
                            "        if (cInput) {" +
                            "          cInput.focus();" +
                            "          cInput.addEventListener('input', function() {" +
                            "            if (cInput.value.length >= 4) {" +
                            "              if (typeof startLogin === 'function' && sub) {" +
                            "                startLogin(sub);" +
                            "              } else if (sub) {" +
                            "                sub.click();" +
                            "              }" +
                            "            }" +
                            "          });" +
                            "        }" +
                            "      }" +
                            "    }, 700);" +
                            "  }" +
                            "}, 400);" +
                            "})();";
                    }
                    view.evaluateJavascript(js, null);
                }
                // 3. 成功进入教务大厅/我的课表：纯净 DOM 只读监听提取 + 手动快捷保底
                else if (lower.contains("wdkb") || lower.contains("xskcb")) {
                    activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            tvSubtitle.setText("✅ 已进入教务课表，正在自动同步您的排课（亦可点击右上角【⚡ 提取课表】）");
                            tvSubtitle.setTextColor(Color.parseColor("#15803D"));
                            tvSubtitle.setBackgroundColor(Color.parseColor("#F0FDF4"));
                            if (tvBottomGuide != null) {
                                tvBottomGuide.setVisibility(View.GONE);
                            }
                        }
                    });

                    String js = "(function() {" +
                        "if (window.__schoolScheduleSyncing) return;" +
                        "window.__schoolScheduleSyncing = true;" +
                        "var checkCount = 0;" +
                        "var maxChecks = 50;" +
                        "var finished = false;" +
                        "function reportSuccess(rows) {" +
                        "  if (finished) return;" +
                        "  finished = true;" +
                        "  window.prompt('cs_schedule:extracted:' + JSON.stringify(rows));" +
                        "}" +
                        "function reportError(msg) {" +
                        "  if (finished) return;" +
                        "  finished = true;" +
                        "  window.prompt('cs_schedule:error:' + msg);" +
                        "}" +
                        "function doExtract() {" +
                        "  var rows = [];" +
                        "  var seenKeys = {};" +
                        "  var bodyText = document.body ? (document.body.innerText || '') : '';" +
                        "  if (!bodyText) return rows;" +
                        "  var lines = bodyText.split(/\\r?\\n/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });" +
                        "  var xqMap = { '一': 1, '1': 1, '二': 2, '2': 2, '三': 3, '3': 3, '四': 4, '4': 4, '五': 5, '5': 5, '六': 6, '6': 6, '日': 7, '天': 7, '7': 7 };" +
                        "  for (var i = 0; i < lines.length; i++) {" +
                        "    var line = lines[i];" +
                        "    var schedMatch = line.match(/(\\d+[-0-9,单双周]*周[^\\n\\r,，]*)[,，]\\s*星期([一二三四五六日天1-7])[,，]\\s*第?(\\d+)节(?:[-~到至]第?(\\d+)节)?(?:[,，]\\s*([^\\n\\r]*))?/);" +
                        "    if (schedMatch) {" +
                        "      var weekStr = schedMatch[1] || '1-16周';" +
                        "      var dayNum = xqMap[schedMatch[2]] || 1;" +
                        "      var startSec = parseInt(schedMatch[3], 10) || 1;" +
                        "      var endSec = schedMatch[4] ? parseInt(schedMatch[4], 10) : startSec;" +
                        "      var location = (schedMatch[5] || '待定').trim();" +
                        "      var teacher = '';" +
                        "      var courseName = '';" +
                        "      var courseCode = '';" +
                        "      if (i >= 1) { teacher = lines[i - 1]; }" +
                        "      if (i >= 2) {" +
                        "        var rawCourseLine = lines[i - 2];" +
                        "        var cMatch = rawCourseLine.match(/^([A-Za-z0-9]+)\\s+([^\\n\\r\\[\\]]+)(?:\\[.*?\\])?/);" +
                        "        if (cMatch) {" +
                        "          courseCode = cMatch[1];" +
                        "          courseName = cMatch[2].trim();" +
                        "        } else {" +
                        "          courseName = rawCourseLine.replace(/\\[.*?\\]/g, '').trim();" +
                        "        }" +
                        "      }" +
                        "      if (courseName && courseName.indexOf('第') !== 0 && courseName.indexOf('星期') !== 0 && courseName.indexOf('切换') !== 0) {" +
                        "        var key = courseName + '_' + dayNum + '_' + startSec + '_' + endSec + '_' + weekStr;" +
                        "        if (!seenKeys[key]) {" +
                        "          seenKeys[key] = true;" +
                        "          rows.push({" +
                        "            KCM: courseName," +
                        "            KCH: courseCode," +
                        "            SKJS: teacher," +
                        "            JASMC: location," +
                        "            SKXQ: String(dayNum)," +
                        "            KSJC: String(startSec)," +
                        "            JSJC: String(endSec)," +
                        "            SKZC: weekStr," +
                        "            DSZ: weekStr.indexOf('单') !== -1 ? '1' : (weekStr.indexOf('双') !== -1 ? '2' : '0')" +
                        "          });" +
                        "        }" +
                        "      }" +
                        "    }" +
                        "  }" +
                        "  return rows;" +
                        "}" +
                        "window.triggerManualExtract = function() {" +
                        "  var r = doExtract();" +
                        "  if (r && r.length > 0) {" +
                        "    reportSuccess(r);" +
                        "  } else {" +
                        "    window.prompt('cs_schedule:error:课表排课卡片仍在加载中，请稍候点击');" +
                        "  }" +
                        "};" +
                        "function checkLoop() {" +
                        "  if (finished) return;" +
                        "  var domRows = doExtract();" +
                        "  if (domRows && domRows.length > 0) {" +
                        "    reportSuccess(domRows);" +
                        "    return;" +
                        "  }" +
                        "  checkCount++;" +
                        "  if (checkCount < maxChecks) {" +
                        "    setTimeout(checkLoop, 500);" +
                        "  } else {" +
                        "    var lastRows = doExtract();" +
                        "    if (lastRows && lastRows.length > 0) {" +
                        "      reportSuccess(lastRows);" +
                        "    } else {" +
                        "      reportError('课表界面加载超时，请确认教务系统有排课后重试');" +
                        "    }" +
                        "  }" +
                        "}" +
                        "setTimeout(checkLoop, 600);" +
                        "})();";
                    view.evaluateJavascript(js, null);
                }
            }
        });

        root.addView(schoolWv);
        root.addView(tvBottomGuide);

        dialog.setContentView(root);
        dialog.show();

        // 经由晓庄智慧校园大厅统一门禁换取主会话后直达学生课表系统 (学校教务大厅原生部署于 HTTP)
        String scheduleUrl = "http://ehall.njxzc.edu.cn/jwapp/sys/wdkb/*default/index.do?EMAP_LANG=zh&THEME=golden#/xskcb";
        String portalLoginUrl = "http://authserver.njxzc.edu.cn/authserver/login?service=" + Uri.encode(scheduleUrl);
        schoolWv.loadUrl(portalLoginUrl);
    }

    private static boolean isTrustedSchoolUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            String scheme = uri.getScheme();
            return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) && host != null &&
                (host.equalsIgnoreCase("njxzc.edu.cn") || host.toLowerCase(java.util.Locale.ROOT).endsWith(".njxzc.edu.cn"));
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * 原生安全 HTTPS 请求桥接：
     * 用于穿透浏览器 WebView CORS 跨域限制，直连用户自定义的大模型端点或反向代理网关。
     * 严格限制：仅允许 https 协议，禁止明文 http 与本地文件系统访问。
     */
    @JavascriptInterface
    public String executeHttpsRequest(String urlStr, String method, String headersJson, String body) {
        JSONObject result = new JSONObject();
        if (urlStr == null || !urlStr.toLowerCase(java.util.Locale.ROOT).startsWith("https://")) {
            try {
                result.put("status", 400);
                result.put("statusText", "Bad Request");
                result.put("body", "Only HTTPS URLs are allowed");
            } catch (Exception ignored) {}
            return result.toString();
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            String reqMethod = (method != null && !method.isEmpty()) ? method.toUpperCase(java.util.Locale.ROOT) : "GET";
            conn.setRequestMethod(reqMethod);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(true);

            // 解析并设置请求头
            if (headersJson != null && !headersJson.isEmpty()) {
                try {
                    JSONObject headersObj = new JSONObject(headersJson);
                    java.util.Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        conn.setRequestProperty(key, headersObj.optString(key));
                    }
                } catch (Exception ignored) {}
            }

            // 发送请求体
            if ("POST".equals(reqMethod) || "PUT".equals(reqMethod) || "PATCH".equals(reqMethod)) {
                conn.setDoOutput(true);
                if (body != null) {
                    byte[] input = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(input, 0, input.length);
                        os.flush();
                    }
                }
            }

            int responseCode = conn.getResponseCode();
            String responseMessage = conn.getResponseMessage();
            InputStream is = (responseCode >= 200 && responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
            String responseBody = "";
            if (is != null) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int len;
                while ((len = is.read(buffer)) != -1) {
                    baos.write(buffer, 0, len);
                }
                responseBody = baos.toString("UTF-8");
            }

            result.put("status", responseCode);
            result.put("statusText", responseMessage != null ? responseMessage : "");
            result.put("body", responseBody);
        } catch (Exception e) {
            try {
                result.put("status", 599);
                result.put("statusText", "Native Request Failed");
                result.put("body", e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (Exception ignored) {}
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
        return result.toString();
    }
}
