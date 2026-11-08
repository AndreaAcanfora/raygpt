package com.andreaacanfora.raygpt.conversation

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveEventTest {
    @Test
    fun parsesSessionEvents() {
        assertEquals(LiveEvent.Started("sess_1"), LiveEvent.parse("""{"type":"session.started","session":{"id":"sess_1"}}"""))
        assertEquals(LiveEvent.InputTranscript("ciao"), LiveEvent.parse("""{"type":"session.input_transcript.delta","delta":"ciao"}"""))
        assertEquals(LiveEvent.OutputTranscript("salve"), LiveEvent.parse("""{"type":"session.output_transcript.delta","delta":"salve"}"""))
        assertEquals(LiveEvent.Usage(12.5), LiveEvent.parse("""{"type":"session.usage.updated","usage":{"seconds":12.5}}"""))
        assertEquals(LiveEvent.Usage(30.0), LiveEvent.parse("""{"type":"session.usage.updated","usage":{"seconds":30}}"""))
    }

    @Test
    fun parsesClosedWithAndWithoutUsage() {
        assertEquals(LiveEvent.Closed("idle", 40.0), LiveEvent.parse("""{"type":"session.closed","reason":"idle","usage":{"seconds":40}}"""))
        assertEquals(LiveEvent.Closed(null, null), LiveEvent.parse("""{"type":"session.closed"}"""))
    }

    @Test
    fun parsesErrors() {
        assertEquals(LiveEvent.Error("boom"), LiveEvent.parse("""{"type":"error","error":{"message":"boom"}}"""))
        assertEquals(LiveEvent.Error("errore sconosciuto"), LiveEvent.parse("""{"type":"error"}"""))
    }

    @Test
    fun parsesDelegations() {
        assertEquals(LiveEvent.DelegationStarted, LiveEvent.parse("""{"type":"session.delegation.created"}"""))
        for (type in listOf("response.completed", "response.failed", "response.incomplete")) {
            assertEquals(LiveEvent.DelegationFinished, LiveEvent.parse("""{"type":"response.event","event":{"type":"$type"}}"""))
        }
        assertEquals(LiveEvent.Other("response.event"), LiveEvent.parse("""{"type":"response.event","event":{"type":"response.output_text.delta"}}"""))
    }

    @Test
    fun ignoresInvalidMessages() {
        assertNull(LiveEvent.parse("not json"))
        assertNull(LiveEvent.parse("[1,2]"))
        assertNull(LiveEvent.parse("""{"delta":"x"}"""))
        assertEquals(LiveEvent.Other("session.updated"), LiveEvent.parse("""{"type":"session.updated"}"""))
    }

    @Test
    fun encodesClientEvents() {
        assertEquals("""{"type":"session.close"}""", ClientEvent.Close.toJson())
        assertEquals("""{"type":"session.input_audio.mute"}""", ClientEvent.Mute.toJson())
        assertEquals("""{"type":"session.input_audio.unmute"}""", ClientEvent.Unmute.toJson())

        val thinking = Json.parseToJsonElement(ClientEvent.Thinking("pos").toJson { "ctx_1" }).jsonObject
        assertEquals("session.thinking.append", thinking["type"]!!.jsonPrimitive.content)
        assertEquals("ctx_1", thinking["event_id"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, thinking["delegation_id"])
        assertEquals("pos", thinking["content"]!!.jsonPrimitive.content)

        val commentary = Json.parseToJsonElement(ClientEvent.Commentary("di' \"ciao\"").toJson { "ctx_2" }).jsonObject
        assertEquals("session.commentary.append", commentary["type"]!!.jsonPrimitive.content)
        assertEquals("di' \"ciao\"", commentary["content"]!!.jsonPrimitive.content)
    }
}
