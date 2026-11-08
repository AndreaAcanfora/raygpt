package com.andreaacanfora.raygpt.history

import com.andreaacanfora.raygpt.conversation.Line
import com.andreaacanfora.raygpt.conversation.Speaker
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Duration
import java.time.Instant

/** One saved conversation. Dates are ISO 8601; `endedAt` and `reason` are null while it runs. */
@Serializable
data class ConversationRecord(
    val id: String,
    val startedAt: String,
    val endedAt: String? = null,
    val reason: String? = null,
    val billedSeconds: Double = 0.0,
    val lines: List<Line> = emptyList(),
) {
    val firstUserLine: String? get() = lines.firstOrNull { it.speaker == Speaker.USER }?.text

    /** Wall-clock length, or null for a conversation that never ended (app killed). */
    val durationSeconds: Long?
        get() = endedAt?.let { Duration.between(Instant.parse(startedAt), Instant.parse(it)).seconds }
}

/**
 * Local conversation history (client spec, rule 3): newest first, at most [LIMIT] records,
 * in one JSON file written atomically. Nothing leaves the phone.
 */
class HistoryStore(private val file: File) {
    @Synchronized
    fun load(): List<ConversationRecord> =
        runCatching { decode(file.readText()) }.getOrDefault(emptyList())

    /** Inserts or replaces [record] (same id) at the top and returns the new history. */
    @Synchronized
    fun save(record: ConversationRecord): List<ConversationRecord> {
        val records = upsert(load(), record)
        write(encode(records))
        return records
    }

    @Synchronized
    fun clear() {
        file.delete()
    }

    private fun write(text: String) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.writeText(text)
        if (!temp.renameTo(file)) {
            file.writeText(text)
            temp.delete()
        }
    }

    companion object {
        const val LIMIT = 50

        private val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }
        private val serializer = ListSerializer(ConversationRecord.serializer())

        fun upsert(records: List<ConversationRecord>, record: ConversationRecord): List<ConversationRecord> =
            (listOf(record) + records.filter { it.id != record.id }).take(LIMIT)

        fun encode(records: List<ConversationRecord>): String = json.encodeToString(serializer, records)

        fun decode(text: String): List<ConversationRecord> = json.decodeFromString(serializer, text)
    }
}
