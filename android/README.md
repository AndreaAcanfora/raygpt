# Raggio for Android

Native Android client for RayGPT ("Raggio"), the voice assistant that talks to OpenAI GPT-Live
through the RayGPT backend. It mirrors the iOS app (`ios/RayGPT`) and follows the shared client
behaviour spec (VPS task announcements, idle warning, local history, closing reasons).

- **GPT-Live over WebRTC**: the app sends its SDP offer to the backend (`POST /api/session`) and
  applies the answer; the OpenAI key stays on the backend. Microphone track plus the `oai-events`
  data channel, created before the offer; the offer is sent once ICE gathering completes (10 s max).
- **Audio in communication mode** (`MODE_IN_COMMUNICATION`, hardware and WebRTC echo cancellation),
  routed to a Bluetooth headset such as the glasses when one is connected (`setCommunicationDevice`
  on Android 12+, Bluetooth SCO below), else a wired headset, else the loudspeaker.
- **Screen off**: each conversation runs in a foreground service (type microphone, plus location
  when allowed) with an ongoing notification and a **Chiudi** action.
- **Hands-free start**: launcher shortcuts **Avvia Raggio** / **Chiudi Raggio**, the intent actions
  `com.andreaacanfora.raygpt.action.START` / `.STOP` and the links `raygpt://start` / `raygpt://stop`.
- Transcript, mute, stop voice command ("stop Raggio", "chiudi Raggio", ...), idle warning and
  close, maximum duration, cost estimate (billed seconds / 60 x 0.05 USD).
- **VPS tasks**: while a conversation is active the app polls `GET /api/vps/tasks` every 4 s, shows
  "Il VPS sta lavorando…", keeps the conversation open, and has GPT-Live announce a task that
  finished after the model was told it was still running.
- **Position**: sent with the session request and again after moves of 250 m or more (at most once
  a minute), through the platform `LocationManager` (no Google Play services).
- **History** ("Conversazioni"): the last 50 conversations with date, duration, closing reason and
  transcript, saved on the phone while they run. The closing reason is also sent to the backend
  (`POST /api/session/end`).

## Requirements

- JDK 17 (`java -version`)
- Android SDK with platform `android-34` and build-tools `34.0.0`
- A phone with Android 10 (API 29) or later
- The backend reachable over HTTPS, e.g. on Cloudflare Workers (`backend/README.md`)

Toolchain: Gradle 8.7 (wrapper), Android Gradle Plugin 8.5.2, Kotlin 2.0.21, Jetpack Compose
(BOM 2024.09.03), WebRTC `io.getstream:stream-webrtc-android` 1.3.10, OkHttp 4.12,
kotlinx.serialization 1.7. Newer AndroidX releases need compile SDK 35, so they are not used.

## Build

```bash
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # not committed
./gradlew assembleDebug testDebugUnitTest
```

The APK is `app/build/outputs/apk/debug/app-debug.apk` (arm64-v8a and x86_64 only).

## Install

Enable USB debugging on the phone (Settings → About phone → tap Build number 7 times, then
Developer options → USB debugging), connect it and run:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Configure

In the app, gear icon:

1. backend address, e.g. `https://raygpt-backend.<account>.workers.dev`;
2. token (`APP_TOKEN` of the backend, at least 32 characters);
3. voice (loaded from `GET /api/voices`, with the built-in list as fallback), idle seconds
   (30-900, default 120) and maximum minutes (5-120, default 20).

At the first conversation the app asks for the microphone (required), notifications and location
(both optional).

## Starting without touching the app

- Long-press the launcher icon → **Avvia Raggio** (drag it to the home screen to pin it).
- Any automation that can open a link or send an intent: `raygpt://start`, or the action
  `com.andreaacanfora.raygpt.action.START`. For example from a computer:
  `adb shell am start -a android.intent.action.VIEW -d raygpt://start`.
- "Hey Google, open Raggio" only opens the app. Google Assistant routines and Samsung Routines can
  start a conversation through the shortcut or the link where the launcher or routine app lets you
  pick one; App Actions (built-in intents) are not set up.

## What differs from iOS

- **No CallKit**: the conversation is a foreground service with a notification instead of a call
  on the lock screen. Closing reason `call_ended` therefore never happens on Android.
- **No Meta glasses voice invocation**: "Ehi Meta, apri l'app Raggio" (iOS `MetaVoiceInvocations`,
  Meta Wearables toolkit) is iOS only. On Android the glasses work as a plain Bluetooth headset.
- **No Siri / Action button**: replaced by launcher shortcuts, intent actions and `raygpt://` links.
- **Token storage**: the token is in the app's private SharedPreferences (iOS: Keychain); the app
  opts out of Android backup and device transfer, so it never leaves the phone.
- **No headset**: the audio goes to the loudspeaker (iOS uses the receiver).
- **Cleartext HTTP** is allowed so a backend on the local network works, as with iOS
  `NSAllowsLocalNetworking`; use HTTPS for anything else.

## Code layout

`app/src/main/java/com/andreaacanfora/raygpt/`

- `conversation/`: `ConversationController` (orchestration, Compose state), plus pure logic with
  JVM unit tests: `LiveEvent` / `ClientEvent`, `VoiceCommands`, `Transcript`, `ConversationMonitor`
  (idle warning, maximum duration, VPS announcements), `Prompts` and `CloseReasons`.
- `services/`: `RealtimeService` (WebRTC), `BackendClient`, `AudioRouter`, `LocationService`,
  `ConversationService` (foreground service).
- `history/HistoryStore`: conversation history in one JSON file.
- `settings/AppSettings`, `ui/` (Compose screens), `MainActivity` (permissions, shortcuts, links).
