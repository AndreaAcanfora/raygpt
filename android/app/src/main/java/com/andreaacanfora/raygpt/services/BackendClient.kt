package com.andreaacanfora.raygpt.services

import com.andreaacanfora.raygpt.conversation.VpsTask
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

/** A position sent to the backend (`location` in `/api/session` and `/api/place`). */
data class GeoPoint(val lat: Double, val lon: Double, val accuracy: Double? = null)

/**
 * Talks to the RayGPT backend (backend/README.md). The OpenAI key never reaches the app:
 * the backend forwards the SDP offer to GPT-Live and returns the answer.
 */
class BackendClient(private val baseUrl: HttpUrl, private val token: String) {
    @Serializable
    data class Session(val sessionId: String, val sdp: String)

    @Serializable
    data class Place(val address: String? = null, val lat: Double, val lon: Double)

    @Serializable
    data class Voices(val voices: List<String>, val default: String? = null)

    /** Result of a VPS poll. */
    sealed interface VpsPoll {
        data class Tasks(val tasks: List<VpsTask>) : VpsPoll
        /** The backend has no VPS: stop polling for this conversation. */
        data object NotConfigured : VpsPoll
        data object Failed : VpsPoll
    }

    suspend fun createSession(offerSdp: String, voice: String, location: GeoPoint?): Session {
        val body = buildJsonObject {
            put("sdp", offerSdp)
            put("voice", voice)
            if (location != null) put("location", location.toJson())
        }
        return json.decodeFromString(Session.serializer(), call(post("api/session", body), 20))
    }

    /** Street address of a new position, to tell GPT-Live where the user is now. */
    suspend fun place(location: GeoPoint): Place {
        val body = buildJsonObject { put("location", location.toJson()) }
        return json.decodeFromString(Place.serializer(), call(post("api/place", body), 8))
    }

    /** Tasks created at or after [since], newest first. */
    suspend fun vpsTasks(since: Instant): VpsPoll {
        val url = baseUrl.newBuilder().addPathSegments("api/vps/tasks")
            .addQueryParameter("since", since.toString()).build()
        return try {
            VpsPoll.Tasks(parseTasks(call(authorized(url).get().build(), 10)))
        } catch (error: BackendError) {
            if (error.status == 404 && error.code == "vps_not_configured") VpsPoll.NotConfigured else VpsPoll.Failed
        } catch (_: Exception) {
            VpsPoll.Failed
        }
    }

    /** Tells the backend why a conversation closed. Fire-and-forget: failures are ignored. */
    suspend fun endSession(sessionId: String?, reason: String, seconds: Double?) {
        val body = buildJsonObject {
            if (sessionId != null) put("sessionId", sessionId)
            put("reason", reason)
            if (seconds != null) put("seconds", seconds)
        }
        runCatching { call(post("api/session/end", body), 5) }
    }

    private fun post(path: String, body: JsonObject): Request =
        authorized(baseUrl.newBuilder().addPathSegments(path).build())
            .post(body.toString().toRequestBody(jsonType))
            .build()

    private fun authorized(url: HttpUrl) = Request.Builder().url(url).header("Authorization", "Bearer $token")

    private suspend fun call(request: Request, timeoutSeconds: Long): String = withContext(Dispatchers.IO) {
        http.newBuilder().callTimeout(timeoutSeconds, TimeUnit.SECONDS).build()
            .newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw BackendError.from(response.code, text)
                text
            }
    }

    companion object {
        private val http = OkHttpClient()
        private val jsonType = "application/json".toMediaType()
        private val json = Json { ignoreUnknownKeys = true }
        private const val MIN_TOKEN_LENGTH = 32

        /** A client for valid settings (http(s) URL with a host, token of 32+ characters), else null. */
        fun create(url: String, token: String): BackendClient? {
            val base = baseUrl(url) ?: return null
            return if (token.length >= MIN_TOKEN_LENGTH) BackendClient(base, token) else null
        }

        fun baseUrl(url: String): HttpUrl? = url.trim().toHttpUrlOrNull()?.takeIf { it.host.isNotEmpty() }

        /** The voices offered by the backend (`GET /api/voices`, no token needed), or null. */
        suspend fun fetchVoices(url: String): Voices? {
            val base = baseUrl(url) ?: return null
            val request = Request.Builder().url(base.newBuilder().addPathSegments("api/voices").build()).build()
            return withContext(Dispatchers.IO) {
                runCatching {
                    http.newBuilder().callTimeout(8, TimeUnit.SECONDS).build().newCall(request).execute().use {
                        if (!it.isSuccessful) throw IOException("HTTP ${it.code}")
                        json.decodeFromString(Voices.serializer(), it.body?.string().orEmpty())
                    }
                }.getOrNull()
            }
        }

        @Serializable
        private data class TaskJson(
            val id: String,
            val status: String,
            val instruction: String = "",
            val result: String? = null,
            val finishedAt: String? = null,
        )

        @Serializable
        private data class TasksJson(val tasks: List<TaskJson> = emptyList())

        fun parseTasks(text: String): List<VpsTask> =
            json.decodeFromString(TasksJson.serializer(), text).tasks.map {
                VpsTask(
                    id = it.id,
                    status = it.status,
                    instruction = it.instruction,
                    result = it.result,
                    finishedAt = it.finishedAt?.let { date -> runCatching { Instant.parse(date) }.getOrNull() },
                )
            }

        private fun GeoPoint.toJson() = buildJsonObject {
            put("lat", lat)
            put("lon", lon)
            if (accuracy != null) put("accuracy", accuracy)
        }
    }
}

class BackendError(val status: Int, val code: String?, val detail: String?) : Exception() {
    override val message: String
        get() = when (code) {
            "unauthorized" -> "Token del backend non valido"
            "daily_session_limit" -> "Limite giornaliero di sessioni raggiunto"
            "invalid_voice" -> "Voce non valida"
            "invalid_location" -> "Posizione non valida"
            "openai_error" -> "Errore OpenAI: ${detail ?: "HTTP $status"}"
            else -> detail ?: "Errore del backend (HTTP $status)"
        }

    companion object {
        @Serializable
        private data class Body(val error: String? = null, val message: String? = null)

        private val json = Json { ignoreUnknownKeys = true }

        fun from(status: Int, text: String): BackendError {
            val body = runCatching { json.decodeFromString(Body.serializer(), text) }.getOrNull()
            return BackendError(status, body?.error, body?.message)
        }
    }
}
