package com.andreaacanfora.raygpt.conversation

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.util.UUID

/** GPT-Live server events received on the `oai-events` data channel (docs/PROJECT.md §3.6). */
sealed interface LiveEvent {
    data class Started(val sessionId: String) : LiveEvent
    data class InputTranscript(val text: String) : LiveEvent
    data class OutputTranscript(val text: String) : LiveEvent
    data class Usage(val seconds: Double) : LiveEvent
    data class Closed(val reason: String?, val seconds: Double?) : LiveEvent
    data class Error(val message: String) : LiveEvent
    /** GPT-Live handed a request to the backend model (web search, VPS). */
    data object DelegationStarted : LiveEvent
    /** The delegated backend work finished. */
    data object DelegationFinished : LiveEvent
    data class Other(val type: String) : LiveEvent

    companion object {
        private val finishedResponses = setOf("response.completed", "response.failed", "response.incomplete")

        fun parse(text: String): LiveEvent? {
            val json = runCatching { Json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
            return when (val type = json.string("type") ?: return null) {
                "session.started" -> Started(json.child("session")?.string("id") ?: "")
                "session.input_transcript.delta" -> InputTranscript(json.string("delta") ?: "")
                "session.output_transcript.delta" -> OutputTranscript(json.string("delta") ?: "")
                "session.usage.updated" -> Usage(json.child("usage")?.number("seconds") ?: 0.0)
                "session.closed" -> Closed(json.string("reason"), json.child("usage")?.number("seconds"))
                "error" -> Error(json.child("error")?.string("message") ?: "errore sconosciuto")
                "session.delegation.created" -> DelegationStarted
                "response.event" ->
                    if (json.child("event")?.string("type") in finishedResponses) DelegationFinished else Other(type)
                else -> Other(type)
            }
        }

        private fun JsonObject.child(key: String) = this[key] as? JsonObject

        private fun JsonObject.string(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun JsonObject.number(key: String) = (this[key] as? JsonPrimitive)?.doubleOrNull
    }
}

/** Client events sent on the data channel. */
sealed interface ClientEvent {
    data object Close : ClientEvent
    data object Mute : ClientEvent
    data object Unmute : ClientEvent
    /** Context for later replies, not spoken and not interrupting (e.g. the user's new position). */
    data class Thinking(val content: String) : ClientEvent
    /** Context the model says to the user right away (VPS results, idle warning). */
    data class Commentary(val content: String) : ClientEvent

    fun toJson(newEventId: () -> String = { "ctx_${UUID.randomUUID()}" }): String {
        val json = when (this) {
            Close -> buildJsonObject { put("type", "session.close") }
            Mute -> buildJsonObject { put("type", "session.input_audio.mute") }
            Unmute -> buildJsonObject { put("type", "session.input_audio.unmute") }
            is Thinking -> context("session.thinking.append", content, newEventId())
            is Commentary -> context("session.commentary.append", content, newEventId())
        }
        return json.toString()
    }

    private fun context(type: String, content: String, eventId: String) = buildJsonObject {
        put("type", type)
        put("event_id", eventId)
        put("delegation_id", JsonNull)
        put("content", content)
    }
}
