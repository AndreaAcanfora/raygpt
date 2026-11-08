package com.andreaacanfora.raygpt.conversation

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Speaker {
    @SerialName("user") USER,
    @SerialName("assistant") ASSISTANT,
}

@Serializable
data class Line(val speaker: Speaker, val text: String)

/**
 * Transcript built from GPT-Live deltas: consecutive deltas of the same speaker, close in time,
 * extend the current line; anything else starts a new one.
 */
class Transcript {
    private val _lines = mutableListOf<Line>()
    private var lastDeltaAt = Long.MIN_VALUE

    val lines: List<Line> get() = _lines.toList()

    /** Appends a delta received at [nowMillis]; returns false for an empty delta. */
    fun append(speaker: Speaker, text: String, nowMillis: Long): Boolean {
        if (text.isEmpty()) return false
        val last = _lines.lastOrNull()
        if (last != null && last.speaker == speaker && nowMillis - lastDeltaAt < NEW_LINE_GAP_MS) {
            _lines[_lines.lastIndex] = last.copy(text = last.text + text)
        } else {
            _lines += Line(speaker, text)
        }
        lastDeltaAt = nowMillis
        return true
    }

    private companion object {
        const val NEW_LINE_GAP_MS = 1_500L
    }
}
