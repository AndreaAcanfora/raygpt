package com.andreaacanfora.raygpt.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.andreaacanfora.raygpt.services.BackendClient
import com.andreaacanfora.raygpt.settings.AppSettings
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(settings: AppSettings, onDone: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Impostazioni") },
                actions = { TextButton(onClick = onDone) { Text("Fine") } },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionTitle("Backend")
            OutlinedTextField(
                value = settings.backendUrl,
                onValueChange = { settings.backendUrl = it },
                label = { Text("Indirizzo") },
                placeholder = { Text("https://raygpt-backend.…workers.dev") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = settings.token,
                onValueChange = { settings.token = it.trim() },
                label = { Text("Token (APP_TOKEN)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(),
            )
            Footnote(
                if (settings.isConfigured) {
                    "Configurazione valida. Il token resta solo su questo telefono."
                } else {
                    "Serve l'indirizzo del backend (https://…) e il token di almeno 32 caratteri."
                },
            )

            SectionTitle("Voce")
            VoicePicker(settings)

            SectionTitle("Limiti")
            Stepper(
                "Chiudi dopo ${settings.idleSeconds} s di silenzio",
                value = settings.idleSeconds,
                range = AppSettings.IDLE_SECONDS_RANGE,
                step = AppSettings.IDLE_SECONDS_STEP,
                onChange = { settings.idleSeconds = it },
            )
            Stepper(
                "Durata massima ${settings.maxMinutes} min",
                value = settings.maxMinutes,
                range = AppSettings.MAX_MINUTES_RANGE,
                step = AppSettings.MAX_MINUTES_STEP,
                onChange = { settings.maxMinutes = it },
            )
            Footnote("GPT-Live costa circa 0,05 $ al minuto e OpenAI non chiude da solo le sessioni inattive.")
        }
    }
}

/** Voices from GET /api/voices, falling back to the built-in list when the backend is unreachable. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VoicePicker(settings: AppSettings) {
    var voices by remember { mutableStateOf(AppSettings.FALLBACK_VOICES) }
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(settings.backendUrl) {
        delay(500)
        BackendClient.fetchVoices(settings.backendUrl)?.voices?.takeIf { it.isNotEmpty() }?.let { voices = it }
    }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = settings.voice,
            onValueChange = {},
            readOnly = true,
            label = { Text("Voce") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            voices.forEach { voice ->
                DropdownMenuItem(
                    text = { Text(voice) },
                    onClick = {
                        settings.voice = voice
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun Stepper(label: String, value: Int, range: IntRange, step: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = { onChange(value - step) }, enabled = value - step >= range.first) { Text("−") }
        OutlinedButton(onClick = { onChange(value + step) }, enabled = value + step <= range.last) { Text("+") }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun Footnote(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
