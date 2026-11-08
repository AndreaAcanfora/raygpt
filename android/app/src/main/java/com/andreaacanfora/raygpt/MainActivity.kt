package com.andreaacanfora.raygpt

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.andreaacanfora.raygpt.services.LocationService
import com.andreaacanfora.raygpt.ui.RaggioApp
import com.andreaacanfora.raygpt.ui.RaggioTheme

/**
 * Single activity. Besides the UI it handles the hands-free triggers: the launcher shortcuts
 * ("Avvia Raggio", "Chiudi Raggio"), their intent actions and the `raygpt://start` /
 * `raygpt://stop` links, usable from Assistant routines and automation apps.
 */
class MainActivity : ComponentActivity() {
    private val conversation get() = (application as RaggioApplication).conversation

    /** Microphone is required; notifications and location are asked once, at the first conversation. */
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        conversation.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RaggioTheme {
                RaggioApp(conversation, onStart = ::startConversation)
            }
        }
        if (savedInstanceState == null) handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        when {
            intent.action == ACTION_START || intent.data?.let { it.scheme == "raygpt" && it.host == "start" } == true ->
                startConversation()
            intent.action == ACTION_STOP || intent.data?.let { it.scheme == "raygpt" && it.host == "stop" } == true ->
                conversation.stop()
        }
    }

    private fun startConversation() {
        val missing = requiredPermissions().filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        val prefs = getSharedPreferences("permissions", MODE_PRIVATE)
        val toAsk = if (prefs.getBoolean(ASKED_KEY, false)) missing.filter { it == Manifest.permission.RECORD_AUDIO } else missing
        if (toAsk.isEmpty()) {
            conversation.start()
        } else {
            prefs.edit().putBoolean(ASKED_KEY, true).apply()
            permissions.launch(toAsk.toTypedArray())
        }
    }

    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        addAll(LocationService.PERMISSIONS)
    }

    private companion object {
        const val ACTION_START = "com.andreaacanfora.raygpt.action.START"
        const val ACTION_STOP = "com.andreaacanfora.raygpt.action.STOP"
        const val ASKED_KEY = "askedOptionalPermissions"
    }
}
