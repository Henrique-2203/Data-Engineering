package br.com.resenhabr.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Enquanto a pessoa está numa call: notificação fixa "Você está numa call" (com "Sair da call"). É isso que
 * faz o Android manter o microfone, o som e a internet do app vivos com a tela bloqueada ou em outro app,
 * como no WhatsApp e no Discord.
 */
public class CallService extends Service {
    private static final String CHANNEL = "call";
    private static final String ACTION_LEAVE = "br.com.resenhabr.app.LEAVE";
    private static final int ID = 1;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void start(Context c, String title) {
        Intent i = new Intent(c, CallService.class).putExtra("title", title == null ? "" : title);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // sem permissão do microfone ainda: a call segue enquanto o app estiver aberto
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, CallService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_LEAVE.equals(intent.getAction())) {
            if (MainActivity.instance != null) MainActivity.instance.leaveCallFromNotification();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent != null ? intent.getStringExtra("title") : null;
        Notification n = build(title == null || title.isEmpty() ? "Toque para voltar à call" : title);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Resenha:call");
            wake.setReferenceCounted(false);
            wake.acquire(6 * 60 * 60 * 1000L); // no máximo 6 h por call
        }
        if (wifi == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Resenha:call");
                wifi.setReferenceCounted(false);
                wifi.acquire();
            }
        }
        return START_NOT_STICKY;
    }

    private Notification build(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Call em andamento", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Mantém a call viva com o celular bloqueado ou em outro app");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent leave = PendingIntent.getService(this, 1, new Intent(this, CallService.class).setAction(ACTION_LEAVE), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle("Você está numa call")
            .setContentText(text)
            .setOngoing(true)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setColor(0xff3ddc97)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(open)
            .addAction(new Notification.Action.Builder(null, "Sair da call", leave).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        wake = null;
        wifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
