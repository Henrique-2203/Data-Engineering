package br.com.resenhabr.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Enquanto a pessoa está numa call: notificação fixa "Você está numa call", com os botões Microfone, Áudio e
 * Sair. É isso que faz o Android manter o microfone, o som e a internet do app vivos com a tela bloqueada ou
 * em outro app, como no WhatsApp e no Discord.
 */
public class CallService extends Service {
    // canal novo (o "call" da primeira versão de teste era silencioso demais e ficava escondido)
    private static final String CHANNEL = "call2";
    private static final String ACTION_LEAVE = "br.com.resenhabr.app.LEAVE";
    private static final String ACTION_MUTE = "br.com.resenhabr.app.MUTE";
    private static final String ACTION_DEAFEN = "br.com.resenhabr.app.DEAFEN";
    /** a pessoa apagou a notificação: ela volta na hora (a call continua, então o aviso também) */
    private static final String ACTION_REPOST = "br.com.resenhabr.app.REPOST";
    private static final int ID = 1;
    static boolean running;
    private static String title = "";
    private static boolean muted;
    private static boolean deafened;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void start(Context c, String t, boolean m, boolean d) {
        title = t == null ? "" : t;
        muted = m;
        deafened = d;
        Intent i = new Intent(c, CallService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception e) {
            if (MainActivity.instance != null) MainActivity.instance.callServiceFailed(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** as notificações foram liberadas agora: mostra de novo */
    static void refresh(Context c) {
        start(c, title, muted, deafened);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, CallService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_LEAVE.equals(action)) {
            if (MainActivity.instance != null) MainActivity.instance.fromNotification("leave");
            running = false;
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_REPOST.equals(action)) {
            if (running) {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    nm.notify(ID, build());
                } catch (Exception ignored) {
                    // se o sistema recusar, a call continua do mesmo jeito; a notificação volta no próximo estado
                }
            }
            return START_NOT_STICKY;
        }
        if (ACTION_MUTE.equals(action) || ACTION_DEAFEN.equals(action)) {
            // o site muda e devolve o estado novo por callState(), que redesenha a notificação
            if (MainActivity.instance != null) MainActivity.instance.fromNotification(ACTION_MUTE.equals(action) ? "mute" : "deafen");
            return START_NOT_STICKY;
        }
        Notification n = build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, n);
            running = true;
        } catch (Exception e) {
            running = false;
            if (MainActivity.instance != null) MainActivity.instance.callServiceFailed(e.getClass().getSimpleName() + ": " + e.getMessage());
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

    private PendingIntent action(String a, int code, int flags) {
        return PendingIntent.getService(this, code, new Intent(this, CallService.class).setAction(a), flags);
    }

    private Notification build() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel old = nm.getNotificationChannel("call");
            if (old != null) nm.deleteNotificationChannel("call");
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Call em andamento", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Mantém a call viva com o celular bloqueado ou em outro app, com os botões de microfone, áudio e sair");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        String state = deafened ? "Áudio desativado" : muted ? "Microfone silenciado" : "Microfone ligado";
        PendingIntent leave = action(ACTION_LEAVE, 1, flags);
        Notification.Action muteAction = new Notification.Action.Builder((Icon) null, muted ? "Ativar microfone" : "Silenciar", action(ACTION_MUTE, 2, flags)).build();
        Notification.Action deafAction = new Notification.Action.Builder((Icon) null, deafened ? "Ativar áudio" : "Desativar áudio", action(ACTION_DEAFEN, 3, flags)).build();
        b.setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle("Você está numa call")
            .setContentText((title.isEmpty() ? "" : title + " · ") + state)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setColor(0xff3ddc97)
            .setColorized(true)
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .setDeleteIntent(action(ACTION_REPOST, 4, flags))
            .addAction(muteAction)
            .addAction(deafAction);
        if (Build.VERSION.SDK_INT >= 31) {
            // estilo "chamada em andamento" (como WhatsApp e Discord): o Android não deixa apagar e mostra no topo
            Person p = new Person.Builder()
                .setName(title.isEmpty() ? "Resenha" : title)
                .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                .setImportant(true)
                .build();
            b.setStyle(Notification.CallStyle.forOngoingCall(p, leave));
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        } else {
            b.addAction(new Notification.Action.Builder((Icon) null, "Sair da call", leave).build());
            b.setPriority(Notification.PRIORITY_HIGH);
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
        return n;
    }

    @Override
    public void onDestroy() {
        running = false;
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
