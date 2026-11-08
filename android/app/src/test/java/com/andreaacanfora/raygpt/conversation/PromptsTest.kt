package com.andreaacanfora.raygpt.conversation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptsTest {
    @Test
    fun announcesFinishedTask() {
        val text = Prompts.vpsTaskFinished(VpsTask("t1", "done", "riavvia il bot", "Riavviato.", null))
        assertEquals(
            "The VPS task the user asked for earlier has finished. Request: \"riavvia il bot\". " +
                "Outcome: Riavviato. Tell the user the outcome now, briefly, in Italian.",
            text,
        )
    }

    @Test
    fun announcesFailedTaskAndTruncates() {
        val text = Prompts.vpsTaskFinished(VpsTask("t1", "failed", "x".repeat(500), "y".repeat(5_000), null))
        assertTrue(text.contains("Request: \"${"x".repeat(200)}\"."))
        assertTrue(text.contains("Outcome: it failed: ${"y".repeat(1_200)}. Tell"))
        assertTrue(text.length < 1_600)
    }

    @Test
    fun describesPosition() {
        assertEquals(
            "The user's position is now Via Roma 1, Milano (lat 45.46, lon 9.19).",
            Prompts.position("Via Roma 1, Milano", 45.46, 9.19),
        )
        assertEquals("The user's position is now (lat 1.5, lon 2.0).", Prompts.position(null, 1.5, 2.0))
    }

    @Test
    fun describesCloseReasons() {
        assertEquals("chiusa da te", CloseReasons.describe("close_requested"))
        assertEquals("silenzio", CloseReasons.describe("idle"))
        assertEquals("durata massima", CloseReasons.describe("max_duration"))
        assertEquals("comando vocale", CloseReasons.describe("voice_command"))
        assertEquals("connessione persa", CloseReasons.describe("connection_lost"))
        assertEquals("chiusa da GPT-Live", CloseReasons.describe("closed"))
        assertEquals("errore", CloseReasons.describe("error"))
        assertEquals("expired", CloseReasons.describe("expired"))
    }
}
