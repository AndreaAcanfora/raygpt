package com.andreaacanfora.raygpt.services

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.andreaacanfora.raygpt.MainActivity
import com.andreaacanfora.raygpt.R
import com.andreaacanfora.raygpt.RaggioApplication

/**
 * Keeps the conversation alive with the screen off or the app in the background (the role CallKit
 * plays on iOS): a foreground service of type microphone (plus location, when allowed) with an
 * ongoing notification whose "Chiudi" action closes the conversation.
 */
class ConversationService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    // The microphone type is new in Android 11; Android 10 ignores it (no while-in-use limits there).
    @SuppressLint("InlinedApi")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CLOSE) {
            (application as RaggioApplication).conversation.stop("close_requested")
            return START_NOT_STICKY
        }
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (intent?.getBooleanExtra(EXTRA_LOCATION, false) == true) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), types)
        if (wakeLock == null) {
            // Timers (idle, VPS polling) must keep running with the screen off; bounded by the
            // longest conversation the settings allow.
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Raggio:conversation")
                .apply { acquire(WAKE_LOCK_TIMEOUT_MS) }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val close = PendingIntent.getService(
            this, 1, Intent(this, ConversationService::class.java).setAction(ACTION_CLOSE), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.notification_close), close)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "conversation"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_CLOSE = "com.andreaacanfora.raygpt.action.CLOSE_CONVERSATION"
        private const val EXTRA_LOCATION = "location"
        private const val WAKE_LOCK_TIMEOUT_MS = 125 * 60_000L

        fun start(context: Context, withLocation: Boolean) {
            val intent = Intent(context, ConversationService::class.java).putExtra(EXTRA_LOCATION, withLocation)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ConversationService::class.java))
        }
    }
}
