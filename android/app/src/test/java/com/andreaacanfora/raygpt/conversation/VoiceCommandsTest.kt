package com.andreaacanfora.raygpt.conversation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceCommandsTest {
    @Test
    fun recognizesStopCommands() {
        listOf(
            "Stop Raggio",
            "Chiudi Raggio.",
            "termina raggio",
            "Raggio, ferma!",
            "spegni ragio",
            "Stop RayGPT",
            "chiudi Ray GPT",
            "rei gpt stop",
            "Stoppp Raggio",
            "ok grazie, chiudi raggio",
        ).forEach { assertTrue(it, VoiceCommands.isStop(it)) }
    }

    @Test
    fun ignoresOrdinarySpeech() {
        listOf(
            "Raggio, che tempo fa?",
            "ferma la macchina",
            "chiudi la porta",
            "stop ragionare troppo",
            "devo ragionare, stop",
            "",
        ).forEach { assertFalse(it, VoiceCommands.isStop(it)) }
    }

    @Test
    fun foldsAccentsAndCase() {
        assertTrue(VoiceCommands.isStop("STOP RÀGGIO"))
    }
}
