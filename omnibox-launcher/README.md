# Omnibox — a search-first Android launcher

Omnibox replaces your home screen with one search bar that does what the Google search bar does,
and a bit more. Type (or speak) and it answers, acts, or searches — no switching apps first.

Kotlin, framework APIs only (no AndroidX, no third-party libraries). Min Android 8.0 (API 26), targets API 35.

## What it does

| Google search bar | Omnibox |
| --- | --- |
| Web search with live suggestions | ✅ Google, DuckDuckGo, Bing, Brave or Ecosia; suggestions as you type, tap ↖ to refine |
| Images / Videos / News / Shopping / Maps tabs | ✅ Chips under the bar, plus YouTube, Play Store, Wikipedia, Translate |
| Song search (♪) | ✅ "Search a song" / hum to search via the Google app, falling back to Shazam or SoundHound; also `what's this song` |
| Voice search | ✅ Mic button. Commands like "set a timer for 10 minutes" run directly |
| Google Lens | ✅ Camera button opens Lens (falls back to lens.google.com) |
| Find apps | ✅ Fuzzy matching ("gm" → Google Maps), ranked by how often you open them |
| Contacts | ✅ Name search with call / message buttons; "call mom", "text alex", "email sam" |
| App shortcuts | ✅ When Omnibox is your home app ("new message", "navigate home"…) |
| Settings | ✅ "wifi", "bluetooth", "battery", "dark mode", "dnd", "developer"… |
| Calculator | ✅ `2+2`, `15% of 80`, `sqrt(2)*pi`, `5!`, `log2(8)`, `3x4` |
| Unit conversion | ✅ `10 km to miles`, `72 f in c`, `1 GiB to MiB`, or just `5 lb` |
| Currency | ✅ `100 usd to eur`, `€20 in pounds`, `50 gbp` (ECB rates via frankfurter.app) |
| Weather | ✅ `weather`, `weather in paris`, `tokyo forecast` (Open-Meteo, no API key) |
| World clock | ✅ `time in tokyo`, `london time`, `what time is it in pst` |
| Timers & alarms | ✅ `timer 5 min`, `alarm 6:30am`, `wake me up at 7` |
| Directions & places | ✅ `directions to the airport`, `coffee near me` |
| Calendar | ✅ `remind me to buy milk`, `add event dinner with sam` |
| Music | ✅ `play lofi beats` |
| Translate / define | ✅ `translate good morning to spanish`, `define serendipity` |
| Coin / dice / random | ✅ `flip a coin`, `roll a d20`, `random number between 1 and 50` |
| Open websites | ✅ Type `example.com` and press Enter |
| Phone numbers & email | ✅ Call, message or add a typed number; compose to a typed email |
| Flashlight | ✅ `flashlight on` / `torch` (no permission needed) |
| Recent searches | ✅ Shown on home; long-press to delete; can be turned off |
| Clipboard suggestion | ✅ Offers to search what you just copied |
| Home-screen widget | ✅ Search bar widget with mic and Lens buttons |
| Search from anywhere | ✅ Quick Settings tile, "Omnibox" in the text-selection menu, share-to-search, assistant gesture, `WEB_SEARCH` handler |

### Replacing the Pixel Launcher search bar

The Pixel Launcher's bottom search bar is part of that launcher, and no other app can remove or
replace it. To get rid of it, make Omnibox your home app (*Settings › Apps › Default apps › Home app*).
By default Omnibox then looks like the Pixel home screen:

- a dock of up to 5 pinned apps (long-press an app › *Add to dock*; until you pin any, it shows your most-used apps)
- a search bar at the bottom with **♪ song search**, **mic** and **Lens**, colored from your wallpaper (Material You, Android 12+)
- themed icons (Android 13+) using the same colors Pixel Launcher uses
- swipe up for all apps; long-press the wallpaper for *Wallpaper & style*

When you tap the bar, it moves to the top with results underneath, like Pixel's search.
Settings has *Search bar at the bottom* and *Themed icons* switches if you prefer the original top-bar layout.
Omnibox doesn't host home-screen widgets or folders yet.

The home screen shows the time and date (tap for alarms / calendar), your most-used apps, recent
searches, and every installed app (work profile included). Long-press an app for its shortcuts,
App info, Uninstall and Play Store.

## Build and install

```bash
cd omnibox-launcher
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # calculator, unit, command-parser tests
adb install app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17+ and the Android SDK (platform 35). The CI workflow
`.github/workflows/omnibox-android.yml` builds debug and release APKs and uploads them as artifacts.
The release build is minified and signed with the debug key so it installs as-is — set up your own
`signingConfig` before publishing.

After installing, press Home and pick **Omnibox**, or go to *Omnibox settings › Set as default home app*.

## Permissions and privacy

| Permission | Why | When it's asked |
| --- | --- | --- |
| Internet | Suggestions, weather, currency | — |
| Contacts | Contact search | First time a query could match a contact (long-press the prompt to hide it) |
| Approximate location | Local weather | First time you search "weather" without a city |
| Set alarm | Timers and alarms via the Clock app | — |
| Request delete packages | "Uninstall" in the app menu | — |

Network requests happen only for what you're doing: suggestions go to the search engine you picked
(turn them off in settings), weather goes to open-meteo.com when you ask for weather, and currency
rates come from api.frankfurter.app when you type a currency conversion. Everything else
(calculator, units, apps, contacts, settings, time zones, commands) runs on the device.

## Code map

```
app/src/main/java/dev/omnibox/launcher/
  MainActivity.kt         Home screen + search UI, query pipeline, intents (Host implementation)
  ResultAdapter.kt        Rows, answer cards and app grids
  Model.kt                Result / Section / Provider / Host
  LocalProviders.kt       Apps, shortcuts, settings, history, "search the web" row
  ContactProvider.kt      Contacts and call/text/email commands
  AnswerProvider.kt       Calculator, units, world clock, coin/dice/random
  ActionProvider.kt       URLs, phone, email, timers, alarms, maps, calendar, play, translate, flashlight, Lens
  NetworkProviders.kt     Suggestions, currency, weather
  Calculator.kt, UnitConverter.kt, Parsers.kt, Currency.kt, TimeZones.kt, Fuzzy.kt   Pure, unit-tested logic
  SearchWidgetProvider.kt, OmniboxTileService.kt, SettingsActivity.kt
```

Add a new kind of result by implementing `Provider` and adding it to the list in `MainActivity.onCreate`.
