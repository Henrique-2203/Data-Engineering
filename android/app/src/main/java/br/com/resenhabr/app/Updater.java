package br.com.resenhabr.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualização do próprio app: ao abrir, pergunta ao Resenha qual é a versão mais nova (/api/app/android).
 * Se for maior que a instalada, oferece "Atualizar": baixa o APK novo e abre a instalação. Como o APK novo
 * tem a mesma assinatura, o Android só troca a versão antiga pela nova (não precisa desinstalar e o login
 * e as configurações continuam).
 */
final class Updater {
    private static long downloadId = -1;
    private static BroadcastReceiver receiver;
    /** o Android pediu "permitir instalar apps desta fonte": ao voltar, tenta de novo */
    private static JSONObject waitingPermission;
    private static boolean asked;

    private Updater() {}

    static void check(Activity a, boolean manual) {
        if (!manual && asked) return;
        asked = true;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.UPDATE_URL).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/json");
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                JSONObject j = new JSONObject(sb.toString());
                int code = j.optInt("versionCode", 0);
                String url = j.optString("url", "");
                if (code > BuildConfig.VERSION_CODE && url.startsWith("https://")) {
                    a.runOnUiThread(() -> offer(a, j));
                } else if (manual) {
                    a.runOnUiThread(() -> Toast.makeText(a, "Você já está na versão mais nova (" + BuildConfig.VERSION_NAME + ").", Toast.LENGTH_SHORT).show());
                }
            } catch (Exception e) {
                if (manual) a.runOnUiThread(() -> Toast.makeText(a, "Não deu para procurar atualização agora.", Toast.LENGTH_SHORT).show());
            }
        }).start();
    }

    private static void offer(Activity a, JSONObject j) {
        if (a.isFinishing()) return;
        String notes = j.optString("notes", "");
        new AlertDialog.Builder(a, R.style.Dialogo)
            .setTitle("Nova versão do Resenha (" + j.optString("versionName", "") + ")")
            .setMessage((notes.isEmpty() ? "" : notes + "\n\n") + "O app baixa e instala sozinho. Seu login e suas configurações continuam.")
            .setPositiveButton("Atualizar", (d, w) -> start(a, j))
            .setNegativeButton("Depois", null)
            .show();
    }

    private static void start(Activity a, JSONObject j) {
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            waitingPermission = j;
            Toast.makeText(a, "Ative \"Permitir desta fonte\" para o Resenha poder se atualizar e volte para o app.", Toast.LENGTH_LONG).show();
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            return;
        }
        download(a, j);
    }

    static void onResume(Activity a) {
        if (waitingPermission == null) return;
        JSONObject j = waitingPermission;
        waitingPermission = null;
        if (Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls()) download(a, j);
    }

    private static void download(Activity a, JSONObject j) {
        try {
            String name = "Resenha-" + j.optString("versionName", "nova").replaceAll("[^0-9A-Za-z._-]", "") + ".apk";
            File old = new File(a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
            if (old.exists()) old.delete();
            DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(j.getString("url")));
            r.setTitle("Atualização do Resenha");
            r.setDescription("Versão " + j.optString("versionName", ""));
            r.setMimeType("application/vnd.android.package-archive");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            r.setDestinationInExternalFilesDir(a, Environment.DIRECTORY_DOWNLOADS, name);
            listen(a);
            downloadId = dm.enqueue(r);
            Toast.makeText(a, "Baixando a atualização…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(a, "Não deu para baixar a atualização.", Toast.LENGTH_SHORT).show();
        }
    }

    private static void listen(Activity a) {
        if (receiver != null) return;
        final Context app = a.getApplicationContext();
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
                Uri apk = dm.getUriForDownloadedFile(id);
                if (apk == null) {
                    Toast.makeText(c, "O download da atualização falhou. Tente de novo.", Toast.LENGTH_LONG).show();
                    return;
                }
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(apk, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    c.startActivity(install);
                } catch (Exception e) {
                    Toast.makeText(c, "Abra a atualização pela notificação de download.", Toast.LENGTH_LONG).show();
                }
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, f, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(receiver, f);
    }

    static void release(Activity a) {
        // o receptor fica no contexto do app: some sozinho quando o app fecha
    }
}
