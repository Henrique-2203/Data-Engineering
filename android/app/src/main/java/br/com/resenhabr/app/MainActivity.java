package br.com.resenhabr.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * App Android do Resenha: abre o Resenha (resenhabr.com.br/app) dentro do app, então toda novidade do
 * site chega aqui na hora. O que só o app faz:
 *  - mantém a call viva com o celular bloqueado ou em outro app (CallService, com a notificação da call);
 *  - pede microfone e câmera do jeito do Android;
 *  - baixa e instala as atualizações do próprio app (Updater).
 */
public class MainActivity extends Activity {
    static MainActivity instance;
    private static final String HOST = "resenhabr.com.br";
    private static final int REQ_MEDIA = 1;
    private static final int REQ_FILE = 2;
    private static final int REQ_NOTIF = 3;

    WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCb;
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingMedia;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        instance = this;
        root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.setBackgroundColor(Color.parseColor("#0b0d11"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0d11"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        // o site sabe que está no app (esconde "instalar no celular", liga a notificação da call etc.)
        s.setUserAgentString(s.getUserAgentString() + " ResenhaAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "ResenhaAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost();
                if (host != null && (host.equals(HOST) || host.equals("www." + HOST))) return false;
                // links de fora (YouTube, Spotify, sites) abrem no app/navegador do celular
                openExternal(u);
                return true;
            }
        });
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mime, length) -> download(url, userAgent, contentDisposition, mime));

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(startUrl(getIntent()));

        Updater.check(this, false);
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && HOST.equals(data.getHost())) return data.toString();
        return BuildConfig.APP_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && HOST.equals(data.getHost())) web.loadUrl(data.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        Updater.onResume(this);
    }

    // De propósito NÃO chamamos web.onPause() ao sair do app: a call continua tocando em segundo plano.

    @Override
    public void onBackPressed() {
        if (fullscreen != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            // não fecha o app (fecharia a call): só manda para trás, como o botão de início
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (instance == this) instance = null;
        CallService.stop(this);
        Updater.release(this);
        web.destroy();
        super.onDestroy();
    }

    void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nenhum app para abrir este link.", Toast.LENGTH_SHORT).show();
        }
    }

    /** anexos baixados vão para a pasta Downloads, com a notificação do Android */
    private void download(String url, String userAgent, String contentDisposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String name = URLUtil.guessFileName(url, contentDisposition, mime);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            r.addRequestHeader("User-Agent", userAgent);
            r.setMimeType(mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Baixando " + name + "…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openExternal(Uri.parse(url));
        }
    }

    // ---------------- microfone, câmera, arquivos e tela cheia ----------------

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest req) {
            runOnUiThread(() -> {
                List<String> need = new ArrayList<>();
                for (String r : req.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !granted(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !granted(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                }
                if (need.isEmpty()) {
                    req.grant(req.getResources());
                } else {
                    if (pendingMedia != null) pendingMedia.deny();
                    pendingMedia = req;
                    requestPermissions(need.toArray(new String[0]), REQ_MEDIA);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            Intent i = params.createIntent();
            i.addCategory(Intent.CATEGORY_OPENABLE);
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "Escolher arquivo"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCb = null;
                return false;
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback cb) {
            if (fullscreen != null) {
                cb.onCustomViewHidden();
                return;
            }
            fullscreen = view;
            fullscreenCb = cb;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }

    private void exitFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        web.setVisibility(View.VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (fullscreenCb != null) fullscreenCb.onCustomViewHidden();
        fullscreenCb = null;
    }

    boolean granted(String p) {
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_MEDIA || pendingMedia == null) return;
        List<String> ok = new ArrayList<>();
        for (String r : pendingMedia.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && granted(Manifest.permission.RECORD_AUDIO)) ok.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && granted(Manifest.permission.CAMERA)) ok.add(r);
        }
        if (ok.isEmpty()) {
            pendingMedia.deny();
            Toast.makeText(this, "Sem a permissão, o Resenha não consegue usar o microfone/câmera.", Toast.LENGTH_LONG).show();
        } else {
            pendingMedia.grant(ok.toArray(new String[0]));
        }
        pendingMedia = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || fileCb == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                uris = new Uri[n];
                for (int k = 0; k < n; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[] { data.getData() };
            }
        }
        fileCb.onReceiveValue(uris);
        fileCb = null;
    }

    /** chamado pela notificação da call ("Sair da call") */
    void leaveCallFromNotification() {
        runOnUiThread(() -> web.evaluateJavascript("window.dispatchEvent(new Event('resenha:native-leave'))", null));
    }

    // ---------------- ponte com o site (window.ResenhaAndroid) ----------------

    private class Bridge {
        /** entrou numa call: liga a notificação que mantém o microfone e o som vivos em segundo plano */
        @JavascriptInterface
        public void callStarted(String title) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
                    requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIF);
                }
                CallService.start(MainActivity.this, title);
            });
        }

        @JavascriptInterface
        public void callEnded() {
            runOnUiThread(() -> CallService.stop(MainActivity.this));
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        /** "Procurar atualização" (Configurações do site, dentro do app) */
        @JavascriptInterface
        public void checkUpdate() {
            runOnUiThread(() -> Updater.check(MainActivity.this, true));
        }
    }
}
