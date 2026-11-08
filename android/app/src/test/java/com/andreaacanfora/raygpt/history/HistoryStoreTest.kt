package com.andreaacanfora.raygpt.history

import com.andreaacanfora.raygpt.conversation.Line
import com.andreaacanfora.raygpt.conversation.Speaker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class HistoryStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun record(id: String, endedAt: String? = null) = ConversationRecord(
        id = id,
        startedAt = "2026-11-08T10:00:00Z",
        endedAt = endedAt,
        reason = endedAt?.let { "idle" },
        billedSeconds = 42.0,
        lines = listOf(Line(Speaker.ASSISTANT, "Ciao"), Line(Speaker.USER, "Che ore sono?")),
    )

    @Test
    fun serializesTheSpecFormat() {
        val json = HistoryStore.encode(listOf(record("a", "2026-11-08T10:02:05Z")))
        assertEquals(
            """[{"id":"a","startedAt":"2026-11-08T10:00:00Z","endedAt":"2026-11-08T10:02:05Z","reason":"idle",""" +
                """"billedSeconds":42.0,"lines":[{"speaker":"assistant","text":"Ciao"},{"speaker":"user","text":"Che ore sono?"}]}]""",
            json,
        )
        assertEquals(listOf(record("a", "2026-11-08T10:02:05Z")), HistoryStore.decode(json))
    }

    @Test
    fun upsertKeepsNewestFirstAndAtMostFifty() {
        var records = emptyList<ConversationRecord>()
        repeat(55) { records = HistoryStore.upsert(records, record("r$it")) }
        assertEquals(HistoryStore.LIMIT, records.size)
        assertEquals("r54", records.first().id)
        assertEquals("r5", records.last().id)

        records = HistoryStore.upsert(records, record("r30", "2026-11-08T10:01:00Z"))
        assertEquals("r30", records.first().id)
        assertEquals(1, records.count { it.id == "r30" })
    }

    @Test
    fun savesLoadsAndClearsAFile() {
        val store = HistoryStore(folder.root.resolve("history.json"))
        assertEquals(emptyList<ConversationRecord>(), store.load())
        store.save(record("a"))
        store.save(record("a", "2026-11-08T10:00:30Z"))
        store.save(record("b"))
        assertEquals(listOf("b", "a"), store.load().map { it.id })
        assertEquals("2026-11-08T10:00:30Z", store.load()[1].endedAt)
        store.clear()
        assertTrue(store.load().isEmpty())
    }

    @Test
    fun corruptFileLoadsAsEmpty() {
        val file = folder.root.resolve("history.json").apply { writeText("{not json") }
        assertEquals(emptyList<ConversationRecord>(), HistoryStore(file).load())
    }

    @Test
    fun derivedFields() {
        assertEquals(125L, record("a", "2026-11-08T10:02:05Z").durationSeconds)
        assertNull(record("a").durationSeconds)
        assertEquals("Che ore sono?", record("a").firstUserLine)
    }
}
