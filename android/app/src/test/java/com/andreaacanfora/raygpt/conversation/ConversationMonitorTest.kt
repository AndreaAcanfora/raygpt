package com.andreaacanfora.raygpt.conversation

import com.andreaacanfora.raygpt.conversation.ConversationMonitor.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ConversationMonitorTest {
    private val start = 1_000_000L
    private fun seconds(s: Int) = start + s * 1_000L
    private fun monitor(idleSeconds: Int = 120, maxMinutes: Int = 20) = ConversationMonitor(idleSeconds, maxMinutes, start)
    private fun task(id: String, status: String, finishedAt: Long? = null) =
        VpsTask(id, status, "do $id", "result $id", finishedAt?.let { Instant.ofEpochMilli(it) })

    // Idle warning and close (rule 2)

    @Test
    fun warnsFifteenSecondsBeforeIdleAndClosesTwentySecondsLater() {
        val monitor = monitor()
        assertNull(monitor.tick(seconds(104), muted = false))
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(105), muted = false))
        assertNull(monitor.tick(seconds(106), muted = false))
        assertNull(monitor.tick(seconds(124), muted = false))
        assertEquals(Action.Close("idle"), monitor.tick(seconds(125), muted = false))
    }

    @Test
    fun userSpeechCancelsTheWarning() {
        val monitor = monitor()
        monitor.tick(seconds(105), muted = false)
        monitor.onUserSpeech(seconds(110))
        assertNull(monitor.tick(seconds(130), muted = false))
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(215), muted = false))
    }

    @Test
    fun assistantSpeechCountsOnlyBeforeTheWarning() {
        val monitor = monitor()
        monitor.onAssistantSpeech(seconds(100))
        assertNull(monitor.tick(seconds(110), muted = false))
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(205), muted = false))
        // The warning itself is spoken by the assistant: it must not reset the timer.
        monitor.onAssistantSpeech(seconds(207))
        assertEquals(Action.Close("idle"), monitor.tick(seconds(225), muted = false))
    }

    @Test
    fun muteAndDelegationPauseTheIdleTimer() {
        val monitor = monitor()
        assertNull(monitor.tick(seconds(200), muted = true))
        assertNull(monitor.tick(seconds(300), muted = false))
        monitor.onDelegationStarted(seconds(301))
        assertNull(monitor.tick(seconds(600), muted = false))
        monitor.onDelegationFinished(seconds(601))
        assertNull(monitor.tick(seconds(700), muted = false))
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(706), muted = false))
    }

    @Test
    fun closesAtMaxDuration() {
        val monitor = monitor(maxMinutes = 5)
        monitor.onUserSpeech(seconds(299))
        assertNull(monitor.tick(seconds(299), muted = false))
        assertEquals(Action.Close("max_duration"), monitor.tick(seconds(300), muted = true))
    }

    // VPS tasks (rule 1)

    @Test
    fun runningVpsTaskKeepsTheConversationAliveAndClearsTheWarning() {
        val monitor = monitor()
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(105), muted = false))
        monitor.onVpsTasks(listOf(task("a", "running")), seconds(110))
        assertTrue(monitor.vpsBusy)
        assertNull(monitor.tick(seconds(400), muted = false))
        monitor.onVpsTasks(listOf(task("a", "queued")), seconds(401))
        assertTrue(monitor.vpsBusy)
    }

    @Test
    fun announcesTaskFinishedAfterTheDelegationEnded() {
        val monitor = monitor()
        monitor.onDelegationStarted(seconds(10))
        monitor.onDelegationFinished(seconds(12))
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(task("a", "running")), seconds(14)))
        val finished = task("a", "done", finishedAt = seconds(30))
        assertEquals(listOf(Prompts.vpsTaskFinished(finished)), monitor.onVpsTasks(listOf(finished), seconds(32)))
        assertFalse(monitor.vpsBusy)
        // Exactly once.
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(finished), seconds(36)))
    }

    @Test
    fun doesNotAnnounceWhatTheDelegateAlreadySaw() {
        val monitor = monitor()
        monitor.onDelegationStarted(seconds(10))
        monitor.onDelegationFinished(seconds(20))
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(task("a", "done", finishedAt = seconds(15))), seconds(24)))
    }

    @Test
    fun doesNotAnnounceWithoutADelegation() {
        val monitor = monitor()
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(task("a", "failed", finishedAt = seconds(15))), seconds(24)))
        monitor.onDelegationStarted(seconds(30))
        monitor.onDelegationFinished(seconds(31))
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(task("a", "failed", finishedAt = seconds(15))), seconds(32)))
    }

    @Test
    fun waitsWhileDelegating() {
        val monitor = monitor()
        monitor.onDelegationStarted(seconds(10))
        monitor.onDelegationFinished(seconds(12))
        monitor.onDelegationStarted(seconds(40))
        val finished = task("a", "done", finishedAt = seconds(30))
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(finished), seconds(44)))
        // The new delegation ended after the task: its delegate already saw the result.
        monitor.onDelegationFinished(seconds(46))
        assertEquals(emptyList<String>(), monitor.onVpsTasks(listOf(finished), seconds(48)))
    }

    @Test
    fun announcesOldestFirst() {
        val monitor = monitor()
        monitor.onDelegationStarted(seconds(1))
        monitor.onDelegationFinished(seconds(2))
        val newer = task("b", "done", finishedAt = seconds(20))
        val older = task("a", "failed", finishedAt = seconds(10))
        assertEquals(
            listOf(Prompts.vpsTaskFinished(older), Prompts.vpsTaskFinished(newer)),
            monitor.onVpsTasks(listOf(newer, older), seconds(22)),
        )
    }

    @Test
    fun announcementCountsAsActivity() {
        val monitor = monitor()
        monitor.onDelegationStarted(seconds(1))
        monitor.onDelegationFinished(seconds(2))
        monitor.onVpsTasks(listOf(task("a", "done", finishedAt = seconds(90))), seconds(100))
        assertNull(monitor.tick(seconds(110), muted = false))
        assertEquals(Action.Say(Prompts.IDLE_WARNING), monitor.tick(seconds(205), muted = false))
    }
}
