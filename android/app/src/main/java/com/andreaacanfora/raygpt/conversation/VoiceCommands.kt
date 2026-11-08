package com.andreaacanfora.raygpt.conversation

import java.text.Normalizer
import java.util.Locale

/** Local voice commands recognized in the user's transcript, without involving the model. */
object VoiceCommands {
    /**
     * "Stop Raggio" / "Chiudi Raggio" (also "ferma", "termina", "spegni", in either order), and the
     * old name "RayGPT". Transcripts spell names in many ways ("Ray GPT", "rei gpt", "ragio"), so
     * the text is folded to lowercase letters and digits first; "(?!n)" keeps "ragionare" out.
     * Kept in sync with backend/public/client.js and the iOS app.
     */
    private const val NAME = "(?:r[aeiy]+(?:g|j)[ie]?(?:p|b)[ie]?t|ra[gj]+i?o(?!n))"
    private const val VERB = "(?:stop+|chiudi|ferma|termina|spegni)"
    private val stopPattern = Regex("$VERB$NAME|$NAME$VERB")
    private val diacritics = Regex("\\p{Mn}+")

    fun isStop(text: String): Boolean {
        val folded = Normalizer.normalize(text, Normalizer.Form.NFD)
            .replace(diacritics, "")
            .lowercase(Locale.ITALIAN)
            .filter { it in 'a'..'z' || it in '0'..'9' }
        return stopPattern.containsMatchIn(folded)
    }
}
