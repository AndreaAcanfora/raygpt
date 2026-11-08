package com.andreaacanfora.raygpt.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class BackendClientTest {
    private val token = "t".repeat(32)

    @Test
    fun validatesSettings() {
        assertNotNull(BackendClient.create("https://raygpt.example.workers.dev", token))
        assertNotNull(BackendClient.create(" http://192.168.1.10:8787/ ", token))
        assertNull(BackendClient.create("https://raygpt.example.workers.dev", "short"))
        assertNull(BackendClient.create("raygpt.example.workers.dev", token))
        assertNull(BackendClient.create("ftp://example.com", token))
        assertNull(BackendClient.create("", token))
    }

    @Test
    fun parsesVpsTasks() {
        val tasks = BackendClient.parseTasks(
            """{"tasks":[
              {"id":"2","status":"running","instruction":"deploy","result":null,"createdAt":"2026-11-08T10:00:05Z","finishedAt":null},
              {"id":"1","status":"done","instruction":"df -h","result":"ok","createdAt":"2026-11-08T10:00:00Z","finishedAt":"2026-11-08T10:00:03.250Z"}
            ]}""",
        )
        assertEquals(listOf("2", "1"), tasks.map { it.id })
        assertEquals(true, tasks[0].isRunning)
        assertNull(tasks[0].finishedAt)
        assertEquals(true, tasks[1].isFinished)
        assertEquals("ok", tasks[1].result)
        assertEquals(Instant.parse("2026-11-08T10:00:03.250Z"), tasks[1].finishedAt)
    }

    @Test
    fun mapsBackendErrors() {
        assertEquals("Token del backend non valido", BackendError.from(401, """{"error":"unauthorized"}""").message)
        assertEquals("Limite giornaliero di sessioni raggiunto", BackendError.from(429, """{"error":"daily_session_limit"}""").message)
        assertEquals("Errore OpenAI: bad sdp", BackendError.from(502, """{"error":"openai_error","message":"bad sdp"}""").message)
        assertEquals("Errore del backend (HTTP 500)", BackendError.from(500, "<html>").message)
        assertEquals("vps_not_configured", BackendError.from(404, """{"error":"vps_not_configured"}""").code)
    }
}
