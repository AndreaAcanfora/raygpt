package com.andreaacanfora.raygpt.conversation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TranscriptTest {
    @Test
    fun mergesCloseDeltasOfTheSameSpeaker() {
        val transcript = Transcript()
        transcript.append(Speaker.USER, "Ciao ", 0)
        transcript.append(Speaker.USER, "Raggio", 1_000)
        assertEquals(listOf(Line(Speaker.USER, "Ciao Raggio")), transcript.lines)
    }

    @Test
    fun startsANewLineOnSpeakerChangeOrPause() {
        val transcript = Transcript()
        transcript.append(Speaker.USER, "Ciao", 0)
        transcript.append(Speaker.ASSISTANT, "Salve", 100)
        transcript.append(Speaker.ASSISTANT, "Altro", 2_000)
        assertEquals(
            listOf(Line(Speaker.USER, "Ciao"), Line(Speaker.ASSISTANT, "Salve"), Line(Speaker.ASSISTANT, "Altro")),
            transcript.lines,
        )
    }

    @Test
    fun ignoresEmptyDeltas() {
        val transcript = Transcript()
        assertFalse(transcript.append(Speaker.USER, "", 0))
        assertEquals(emptyList<Line>(), transcript.lines)
    }
}
