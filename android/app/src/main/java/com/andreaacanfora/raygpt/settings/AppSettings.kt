package com.andreaacanfora.raygpt.settings

import android.content.Context
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import com.andreaacanfora.raygpt.services.BackendClient
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/**
 * User settings in the app's private SharedPreferences, observable by Compose. The token stays
 * on the device: the app opts out of Android backups (AndroidManifest.xml).
 */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var backendUrl by stringPref("backendURL", "")
    var token by stringPref("appToken", "")
    var voice by stringPref("voice", DEFAULT_VOICE)
    /** Close the conversation after this many seconds without anyone speaking. */
    var idleSeconds by intPref("idleSeconds", 120)
    /** Hard limit on a single conversation. */
    var maxMinutes by intPref("maxMinutes", 20)

    val isConfigured: Boolean get() = backendClient() != null

    fun backendClient(): BackendClient? = BackendClient.create(backendUrl, token)

    private fun stringPref(key: String, default: String) = object : ReadWriteProperty<Any?, String> {
        private val state = mutableStateOf(prefs.getString(key, default) ?: default)
        override fun getValue(thisRef: Any?, property: KProperty<*>) = state.value
        override fun setValue(thisRef: Any?, property: KProperty<*>, value: String) {
            state.value = value
            prefs.edit().putString(key, value).apply()
        }
    }

    private fun intPref(key: String, default: Int) = object : ReadWriteProperty<Any?, Int> {
        private val state = mutableIntStateOf(prefs.getInt(key, default))
        override fun getValue(thisRef: Any?, property: KProperty<*>) = state.intValue
        override fun setValue(thisRef: Any?, property: KProperty<*>, value: Int) {
            state.intValue = value
            prefs.edit().putInt(key, value).apply()
        }
    }

    companion object {
        const val DEFAULT_VOICE = "marin"
        val IDLE_SECONDS_RANGE = 30..900
        const val IDLE_SECONDS_STEP = 30
        val MAX_MINUTES_RANGE = 5..120
        const val MAX_MINUTES_STEP = 5

        /** GPT-Live voices, kept in sync with backend/src/voices.ts; used when GET /api/voices fails. */
        val FALLBACK_VOICES = listOf(
            "alloy", "ash", "ballad", "beacon", "bossa", "brise", "cedar", "cinder",
            "coral", "delta", "echo", "flitz", "gleam", "harema", "juni", "marin",
            "meridian", "nira", "noeul", "nuri", "quartz", "ripple", "sage", "shida",
            "shimmer", "sillage", "stone", "tempo", "verse", "vesper", "willow",
        )
    }
}
