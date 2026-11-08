package com.andreaacanfora.raygpt.conversation

import java.time.Instant

/** A task the VPS agent runs for the user (`GET /api/vps/tasks`). */
data class VpsTask(
    val id: String,
    val status: String,
    val instruction: String,
    val result: String?,
    val finishedAt: Instant?,
) {
    val isRunning: Boolean get() = status == "queued" || status == "running"
    val isFinished: Boolean get() = status == "done" || status == "failed"
}

/**
 * Idle timer, idle warning, maximum duration and VPS task announcements for one conversation
 * (client spec, rules 1, 2 and 7). Pure logic: the controller feeds it events and wall-clock
 * milliseconds, and executes what it returns.
 */
class ConversationMonitor(
    private val idleSeconds: Int,
    maxMinutes: Int,
    private val startedAt: Long,
) {
    sealed interface Action {
        /** Say this through GPT-Live (`session.commentary.append`). */
        data class Say(val text: String) : Action
        data class Close(val reason: String) : Action
    }

    private val maxMillis = maxMinutes * 60_000L
    private var lastActivity = startedAt
    private var idleWarnedAt: Long? = null
    private var lastDelegationEndAt: Long? = null
    private val handledTasks = mutableSetOf<String>()

    /** Some VPS task in the last poll is queued or running. */
    var vpsBusy = false
        private set
    /** GPT-Live is waiting for the backend model. */
    var delegating = false
        private set

    fun onUserSpeech(now: Long) = markActive(now)

    /** The assistant's own speech keeps the conversation alive, except after the idle warning. */
    fun onAssistantSpeech(now: Long) {
        if (idleWarnedAt == null) lastActivity = now
    }

    fun onDelegationStarted(now: Long) {
        delegating = true
        markActive(now)
    }

    fun onDelegationFinished(now: Long) {
        delegating = false
        lastDelegationEndAt = now
        markActive(now)
    }

    /**
     * Updates [vpsBusy] from a poll (newest task first) and returns the announcements to say,
     * oldest first. A finished task is announced only when the delegation that started it ended
     * before the task did (the model only heard "still running"); otherwise it is just marked handled.
     */
    fun onVpsTasks(tasks: List<VpsTask>, now: Long): List<String> {
        vpsBusy = tasks.any { it.isRunning }
        if (vpsBusy) markActive(now)
        if (delegating) return emptyList()

        val announcements = mutableListOf<String>()
        for (task in tasks.asReversed()) {
            if (!task.isFinished || !handledTasks.add(task.id)) continue
            val delegationEnd = lastDelegationEndAt ?: continue
            val finishedAt = task.finishedAt?.toEpochMilli() ?: continue
            if (finishedAt > delegationEnd) {
                announcements += Prompts.vpsTaskFinished(task)
                lastActivity = now
            }
        }
        return announcements
    }

    /** Called every second. Muting pauses the idle timer. */
    fun tick(now: Long, muted: Boolean): Action? {
        if (now - startedAt >= maxMillis) return Action.Close("max_duration")
        if (muted || vpsBusy || delegating) {
            markActive(now)
            return null
        }
        val warnedAt = idleWarnedAt
        if (warnedAt != null) {
            return if (now - warnedAt >= IDLE_CLOSE_AFTER_WARNING_MS) Action.Close("idle") else null
        }
        if (now - lastActivity >= (idleSeconds - IDLE_WARNING_LEAD_SECONDS) * 1_000L) {
            idleWarnedAt = now
            return Action.Say(Prompts.IDLE_WARNING)
        }
        return null
    }

    private fun markActive(now: Long) {
        lastActivity = now
        idleWarnedAt = null
    }

    private companion object {
        const val IDLE_WARNING_LEAD_SECONDS = 15
        const val IDLE_CLOSE_AFTER_WARNING_MS = 20_000L
    }
}
