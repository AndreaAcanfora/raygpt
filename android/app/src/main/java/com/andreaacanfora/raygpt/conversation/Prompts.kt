package com.andreaacanfora.raygpt.conversation

/** Texts sent to GPT-Live as context. Kept in sync with the other clients (client spec). */
object Prompts {
    const val IDLE_WARNING =
        "Tell the user, in one short Italian sentence, that you will close the conversation in a few " +
            "seconds because nobody is speaking, unless they say something."

    private const val MAX_INSTRUCTION_CHARS = 200
    private const val MAX_RESULT_CHARS = 1_200

    fun vpsTaskFinished(task: VpsTask): String {
        val result = task.result.orEmpty().take(MAX_RESULT_CHARS)
        val outcome = (if (task.status == "failed") "it failed: $result" else result).trimEnd('.', ' ', '\n')
        return "The VPS task the user asked for earlier has finished. " +
            "Request: \"${task.instruction.take(MAX_INSTRUCTION_CHARS)}\". Outcome: $outcome. " +
            "Tell the user the outcome now, briefly, in Italian."
    }

    fun position(address: String?, lat: Double, lon: Double): String {
        val place = address?.let { "$it " }.orEmpty()
        return "The user's position is now $place(lat $lat, lon $lon)."
    }
}

/** Why a conversation closed, as shown to the user ("Chiusa (silenzio)"). */
object CloseReasons {
    fun describe(reason: String?): String = when (reason) {
        null -> "interrotta"
        "close_requested" -> "chiusa da te"
        "idle" -> "silenzio"
        "max_duration" -> "durata massima"
        "voice_command" -> "comando vocale"
        "connection_lost" -> "connessione persa"
        "call_ended" -> "chiamata terminata"
        "error" -> "errore"
        "closed" -> "chiusa da GPT-Live"
        else -> reason
    }
}
