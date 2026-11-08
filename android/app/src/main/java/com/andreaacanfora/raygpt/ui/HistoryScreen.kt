package com.andreaacanfora.raygpt.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.activity.compose.BackHandler
import com.andreaacanfora.raygpt.conversation.CloseReasons
import com.andreaacanfora.raygpt.history.ConversationRecord
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "Conversazioni": saved conversations, newest first; tapping one opens its transcript. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    records: List<ConversationRecord>,
    activeId: String?,
    onClear: () -> Unit,
    onBack: () -> Unit,
) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmingClear by rememberSaveable { mutableStateOf(false) }
    val open = records.firstOrNull { it.id == openId }
    if (open != null) BackHandler { openId = null }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(open?.let { formatDate(it.startedAt) } ?: "Conversazioni") },
                navigationIcon = {
                    IconButton(onClick = { if (open != null) openId = null else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Indietro")
                    }
                },
                actions = {
                    if (open == null && records.isNotEmpty()) {
                        TextButton(onClick = { confirmingClear = true }) { Text("Elimina tutto") }
                    }
                },
            )
        },
    ) { padding ->
        val modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)
        when {
            open != null -> TranscriptList(open.lines, modifier)
            records.isEmpty() -> Box(modifier, contentAlignment = Alignment.Center) {
                Text("Nessuna conversazione salvata", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(modifier) {
                items(records, key = { it.id }) { record ->
                    RecordRow(record, isActive = record.id == activeId, onClick = { openId = record.id })
                    HorizontalDivider()
                }
            }
        }
    }

    if (confirmingClear) {
        AlertDialog(
            onDismissRequest = { confirmingClear = false },
            title = { Text("Eliminare tutte le conversazioni?") },
            text = { Text("Le trascrizioni salvate su questo telefono verranno cancellate.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingClear = false
                    onClear()
                }) { Text("Elimina") }
            },
            dismissButton = { TextButton(onClick = { confirmingClear = false }) { Text("Annulla") } },
        )
    }
}

@Composable
private fun RecordRow(record: ConversationRecord, isActive: Boolean, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp)) {
        Text(formatDate(record.startedAt), style = MaterialTheme.typography.titleSmall)
        val details = listOfNotNull(record.durationSeconds?.let(::formatDuration), if (isActive) "in corso" else CloseReasons.describe(record.reason))
        Text(
            details.joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        record.firstUserLine?.let {
            Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

private val dateFormatter = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ITALIAN)

private fun formatDate(iso: String): String =
    runCatching { dateFormatter.format(Instant.parse(iso).atZone(ZoneId.systemDefault())) }.getOrDefault(iso)

private fun formatDuration(seconds: Long): String =
    if (seconds < 60) "$seconds s" else "${seconds / 60} min ${seconds % 60} s"
