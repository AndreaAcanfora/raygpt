package com.andreaacanfora.raygpt.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.andreaacanfora.raygpt.conversation.ConversationController
import com.andreaacanfora.raygpt.conversation.ConversationController.Phase
import com.andreaacanfora.raygpt.conversation.Line
import com.andreaacanfora.raygpt.conversation.Speaker
import java.util.Locale

@Composable
fun RaggioTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(LocalContext.current) else dynamicLightColorScheme(LocalContext.current)
        dark -> darkColorScheme()
        else -> lightColorScheme()
    }
    MaterialTheme(colorScheme = colors, content = content)
}

private enum class Screen { MAIN, SETTINGS, HISTORY }

/** Main screen plus the settings and history screens, switched without a navigation library. */
@Composable
fun RaggioApp(conversation: ConversationController, onStart: () -> Unit) {
    var screen by rememberSaveable { mutableStateOf(Screen.MAIN) }
    if (screen != Screen.MAIN) BackHandler { screen = Screen.MAIN }
    when (screen) {
        Screen.MAIN -> MainScreen(
            conversation,
            onStart = onStart,
            onSettings = { screen = Screen.SETTINGS },
            onHistory = { screen = Screen.HISTORY },
        )
        Screen.SETTINGS -> SettingsScreen(conversation.settings, onDone = { screen = Screen.MAIN })
        Screen.HISTORY -> HistoryScreen(
            conversation.history,
            activeId = conversation.activeRecordId,
            onClear = conversation::clearHistory,
            onBack = { screen = Screen.MAIN },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(
    conversation: ConversationController,
    onStart: () -> Unit,
    onSettings: () -> Unit,
    onHistory: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Raggio") },
                actions = {
                    IconButton(onClick = onHistory) {
                        Icon(Icons.AutoMirrored.Filled.List, contentDescription = "Conversazioni")
                    }
                    IconButton(onClick = onSettings, enabled = conversation.phase == Phase.IDLE) {
                        Icon(Icons.Filled.Settings, contentDescription = "Impostazioni")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                conversation.status,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                conversation.route,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            statsText(conversation)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(16.dp))
            Controls(conversation, onStart)
            Spacer(Modifier.height(8.dp))
            TranscriptList(conversation.lines, Modifier.weight(1f))
        }
    }
}

@Composable
private fun Controls(conversation: ConversationController, onStart: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        if (conversation.phase == Phase.IDLE) {
            Button(onClick = onStart, modifier = Modifier.weight(1f)) { Text("Avvia") }
        } else {
            OutlinedButton(
                onClick = conversation::toggleMute,
                enabled = conversation.phase == Phase.ACTIVE,
                modifier = Modifier.weight(1f),
            ) {
                Text(if (conversation.isMuted) "Riattiva" else "Silenzia")
            }
            Button(
                onClick = { conversation.stop() },
                enabled = conversation.phase != Phase.STOPPING,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.weight(1f),
            ) {
                Text("Chiudi")
            }
        }
    }
}

@Composable
fun TranscriptList(lines: List<Line>, modifier: Modifier = Modifier) {
    val state = rememberLazyListState()
    LaunchedEffect(lines.size, lines.lastOrNull()?.text) {
        if (lines.isNotEmpty()) state.animateScrollToItem(lines.lastIndex)
    }
    LazyColumn(state = state, modifier = modifier.fillMaxWidth()) {
        items(lines) { line ->
            Column(Modifier.padding(vertical = 6.dp)) {
                Text(
                    if (line.speaker == Speaker.USER) "Tu" else "Raggio",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (line.speaker == Speaker.USER) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                )
                Text(line.text, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

private fun statsText(conversation: ConversationController): String? {
    val parts = buildList {
        conversation.startLatencySeconds?.let { add(String.format(Locale.ITALIAN, "avvio %.1f s", it)) }
        if (conversation.billedSeconds > 0) {
            add(String.format(Locale.ITALIAN, "%.0f s ≈ %.3f $", conversation.billedSeconds, conversation.estimatedCostUSD))
        }
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
