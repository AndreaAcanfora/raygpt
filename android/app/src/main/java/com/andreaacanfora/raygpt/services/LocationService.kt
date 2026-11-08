package com.andreaacanfora.raygpt.services

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * The user's position for "near me" questions (backend/README.md, location), from the platform
 * LocationManager (no Google Play services). Sent once when a conversation starts and again when
 * the user moves; never stored.
 */
class LocationService(private val context: Context) {
    /** A new position, delivered after a move of at least [MIN_MOVE_METERS]. */
    var onMove: ((Location) -> Unit)? = null

    private val manager = context.getSystemService(LocationManager::class.java)
    private val listener = LocationListenerCompat { location -> onMove?.invoke(location) }
    private var updating = false

    val hasPermission: Boolean
        get() = PERMISSIONS.any {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    /** The current position, or null if permission is denied or no fix arrives within [timeoutMillis]. */
    @SuppressLint("MissingPermission")
    suspend fun current(timeoutMillis: Long = 5_000): Location? {
        if (!hasPermission) return null
        val provider = provider() ?: return null
        manager.getLastKnownLocation(provider)
            ?.takeIf { System.currentTimeMillis() - it.time < RECENT_FIX_MILLIS }
            ?.let { return it }

        return withTimeoutOrNull(timeoutMillis) {
            suspendCancellableCoroutine { continuation ->
                val signal = CancellationSignal()
                continuation.invokeOnCancellation { signal.cancel() }
                LocationManagerCompat.getCurrentLocation(manager, provider, signal, ContextCompat.getMainExecutor(context)) {
                    if (continuation.isActive) continuation.resume(it)
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun startUpdates() {
        if (updating || !hasPermission) return
        val provider = provider() ?: return
        val request = LocationRequestCompat.Builder(UPDATE_INTERVAL_MILLIS)
            .setMinUpdateDistanceMeters(MIN_MOVE_METERS)
            .setQuality(LocationRequestCompat.QUALITY_BALANCED_POWER_ACCURACY)
            .build()
        LocationManagerCompat.requestLocationUpdates(manager, provider, request, ContextCompat.getMainExecutor(context), listener)
        updating = true
    }

    @SuppressLint("MissingPermission")
    fun stopUpdates() {
        if (!updating) return
        LocationManagerCompat.removeUpdates(manager, listener)
        updating = false
    }

    /** The fused provider when the device has one (Android 12+), else network, else GPS. */
    private fun provider(): String? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER) ->
            LocationManager.FUSED_PROVIDER
        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        else -> null
    }

    companion object {
        const val MIN_MOVE_METERS = 250f
        val PERMISSIONS = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        private const val RECENT_FIX_MILLIS = 120_000L
        private const val UPDATE_INTERVAL_MILLIS = 15_000L
    }
}
