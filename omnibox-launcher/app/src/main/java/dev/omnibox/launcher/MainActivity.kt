package dev.omnibox.launcher

import android.Manifest
import android.app.Activity
import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.speech.RecognizerIntent
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.AbsListView
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.TextClock
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * The omnibox. It is the home screen (clock + frequent apps + all apps), and the moment you type it
 * becomes a universal search: answers, actions, apps, contacts, shortcuts, settings, history and the web.
 */
class MainActivity : Activity(), Host {

    override val activity: Activity get() = this
    override lateinit var prefs: Prefs

    private lateinit var repo: AppRepository
    private lateinit var torch: TorchController
    private lateinit var providers: List<Provider>

    private lateinit var root: LinearLayout
    private lateinit var header: LinearLayout
    private lateinit var input: EditText
    private lateinit var clearButton: ImageView
    private lateinit var settingsButton: ImageView
    private lateinit var chipScroll: HorizontalScrollView
    private lateinit var list: ListView
    private lateinit var adapter: ResultAdapter

    private val main = Handler(Looper.getMainLooper())
    private val localExecutor = Executors.newSingleThreadExecutor()
    private val networkExecutor = Executors.newFixedThreadPool(3)
    private val results = HashMap<String, List<Result>>()
    private var generation = 0
    private var networkTask: Runnable? = null
    private var pendingVoice = false
    private var resetOnResume = false
    private var clipText: String? = null
    private var clipStamp = 0L
    private var ownClip: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        repo = AppRepository(this)
        torch = TorchController(this)
        providers = listOf(
            AnswerProvider(),
            ActionProvider(this, torch),
            AppProvider(repo, prefs),
            ContactProvider(this, prefs),
            ShortcutProvider(repo),
            SettingsProvider(this),
            WebProvider(this, prefs),
            HistoryProvider(this, prefs),
            SuggestProvider(this, prefs),
            CurrencyProvider(),
            WeatherProvider(this, prefs),
        )
        setupWindow()
        setContentView(buildUi())

        repo.onChanged = { reloadApps() }
        repo.register(main)
        reloadApps()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (resetOnResume) {
            resetOnResume = false
            setQuery("")
            hideKeyboard()
        } else {
            refresh() // history, launch counts or permissions may have changed
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Android 10+ only lets the focused app read the clipboard.
        if (hasFocus && input.text.isEmpty() && readClipboard()) render(Query(""))
    }

    override fun onDestroy() {
        repo.unregister()
        torch.release()
        localExecutor.shutdownNow()
        networkExecutor.shutdownNow()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            input.text.isNotEmpty() -> setQuery("")
            input.hasFocus() -> hideKeyboard()
            !isDefaultHome() -> @Suppress("DEPRECATION") super.onBackPressed()
            else -> list.setSelection(0)
        }
    }

    // --- Intents ------------------------------------------------------------------------------

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val text = when (intent.action) {
            Intent.ACTION_WEB_SEARCH, Intent.ACTION_SEARCH -> intent.getStringExtra(SearchManager.QUERY)
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        }
        when {
            !text.isNullOrBlank() -> {
                setQuery(text.trim())
                showKeyboard()
            }
            intent.getBooleanExtra(EXTRA_VOICE, false) || intent.action == Intent.ACTION_SEARCH_LONG_PRESS -> startVoice()
            intent.getBooleanExtra(EXTRA_LENS, false) -> openLens()
            intent.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_HOME) -> goHome()
            else -> showKeyboard() // app icon, widget, quick settings tile, assist gesture
        }
    }

    private fun goHome() {
        if (input.text.isNotEmpty()) setQuery("")
        if (prefs.keyboardOnHome) showKeyboard() else hideKeyboard()
        list.setSelection(0)
    }

    private fun isDefaultHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName == packageName
    }

    // --- UI -----------------------------------------------------------------------------------

    private fun setupWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            setLegacyLayoutFlags()
        }
    }

    @Suppress("DEPRECATION")
    private fun setLegacyLayoutFlags() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    @Suppress("DEPRECATION")
    private fun insetsOf(insets: WindowInsets): Pair<Int, Int> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            bars.top to max(bars.bottom, ime.bottom)
        } else {
            insets.systemWindowInsetTop to insets.systemWindowInsetBottom
        }

    private fun buildUi(): View {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Palette.SCRIM_HOME)
            isFocusable = true
            isFocusableInTouchMode = true
            setOnApplyWindowInsetsListener { v, insets ->
                val (top, bottom) = insetsOf(insets)
                v.setPadding(0, top, 0, bottom)
                insets
            }
        }

        header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(40), dp(24), dp(20))
        }
        val clock = TextClock(this).apply {
            format12Hour = "h:mm"
            format24Hour = "HH:mm"
            textSize = 64f
            setTextColor(Palette.TEXT)
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setShadowLayer(8f, 0f, 2f, 0x66000000)
            setOnClickListener { launch(Intent(AlarmClock.ACTION_SHOW_ALARMS)) }
        }
        val date = TextClock(this).apply {
            format12Hour = "EEEE, MMMM d"
            format24Hour = "EEEE, MMMM d"
            textSize = 18f
            setTextColor(Palette.TEXT)
            setShadowLayer(6f, 0f, 1f, 0x66000000)
            setOnClickListener {
                val uri = CalendarContract.CONTENT_URI.buildUpon().appendPath("time")
                    .appendPath(System.currentTimeMillis().toString()).build()
                launch(Intent(Intent.ACTION_VIEW, uri))
            }
        }
        header.addView(clock)
        header.addView(date)
        root.addView(header)

        root.addView(buildSearchBar(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(buildChips())

        list = ListView(this).apply {
            divider = null
            dividerHeight = 0
            selector = ColorDrawable(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            clipToPadding = false
            setPadding(0, dp(4), 0, dp(24))
            setOnScrollListener(object : AbsListView.OnScrollListener {
                override fun onScrollStateChanged(view: AbsListView?, scrollState: Int) {
                    if (scrollState == AbsListView.OnScrollListener.SCROLL_STATE_TOUCH_SCROLL) hideKeyboard()
                }

                override fun onScroll(view: AbsListView?, first: Int, visible: Int, total: Int) = Unit
            })
        }
        val columns = (resources.displayMetrics.widthPixels / dp(84)).coerceIn(4, 7)
        adapter = ResultAdapter(this, columns)
        list.adapter = adapter
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        updateChrome()
        return root
    }

    private fun buildSearchBar(): View {
        val container = LinearLayout(this).apply { setPadding(dp(12), dp(8), dp(12), dp(8)) }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(Palette.BAR, dpf(28f))
            elevation = dpf(4f)
            setPadding(dp(16), 0, dp(4), 0)
            setOnClickListener { showKeyboard() }
        }
        bar.addView(ImageView(this).apply { setImageDrawable(tintedIcon(R.drawable.ic_search)) }, LinearLayout.LayoutParams(dp(22), dp(22)))

        input = EditText(this).apply {
            background = null
            hint = "Search, calculate, or type a URL"
            setHintTextColor(Palette.TEXT_FAINT)
            setTextColor(Palette.TEXT)
            textSize = 17f
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
            imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            setPadding(dp(12), 0, dp(4), 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) = onQueryChanged()
            })
            setOnEditorActionListener { _, actionId, event ->
                val enter = actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_SEARCH ||
                    actionId == EditorInfo.IME_ACTION_DONE ||
                    (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
                if (enter) submit()
                enter
            }
            setOnFocusChangeListener { _, _ -> updateChrome() }
        }
        bar.addView(input, LinearLayout.LayoutParams(0, dp(56), 1f))

        clearButton = barButton(R.drawable.ic_close, "Clear") {
            setQuery("")
            showKeyboard()
        }
        settingsButton = barButton(R.drawable.ic_settings, "Settings") {
            launch(Intent(this, SettingsActivity::class.java))
        }
        val mic = barButton(R.drawable.ic_mic, getString(R.string.voice_search)) { startVoice() }
        val lens = barButton(R.drawable.ic_lens, getString(R.string.lens_search)) { openLens() }
        for (b in listOf(clearButton, mic, lens, settingsButton)) bar.addView(b, LinearLayout.LayoutParams(dp(44), dp(44)))

        container.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return container
    }

    private fun barButton(icon: Int, description: String, onClick: () -> Unit) = ImageView(this).apply {
        setImageDrawable(tintedIcon(icon))
        contentDescription = description
        setPadding(dp(10), dp(10), dp(10), dp(10))
        setRippleBackground(dpf(22f))
        setOnClickListener { onClick() }
    }

    private fun buildChips(): View {
        chipScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            clipToPadding = false
            setPadding(dp(12), 0, dp(12), dp(6))
        }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (v in Vertical.entries) {
            val chip = TextView(this).apply {
                text = v.label
                textSize = 14f
                setTextColor(Palette.TEXT)
                setPadding(dp(14), dp(7), dp(14), dp(7))
                setRippleBackground(dpf(18f), rounded(Palette.CHIP, dpf(18f)))
                setOnClickListener { openVertical(v) }
            }
            row.addView(chip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
        }
        chipScroll.addView(row)
        return chipScroll
    }

    private fun updateChrome() {
        val empty = input.text.isEmpty()
        val idle = empty && !input.hasFocus()
        header.visibility = if (idle) View.VISIBLE else View.GONE
        chipScroll.visibility = if (empty) View.GONE else View.VISIBLE
        clearButton.visibility = if (empty) View.GONE else View.VISIBLE
        settingsButton.visibility = if (empty) View.VISIBLE else View.GONE
        root.setBackgroundColor(if (idle) Palette.SCRIM_HOME else Palette.SCRIM_SEARCH)
    }

    private fun showKeyboard() {
        input.requestFocus()
        input.post { getSystemService(InputMethodManager::class.java)?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT) }
    }

    private fun hideKeyboard() {
        getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(input.windowToken, 0)
        if (input.hasFocus()) root.requestFocus()
        updateChrome()
    }

    // --- Querying -----------------------------------------------------------------------------

    private fun onQueryChanged() {
        val q = Query(input.text.toString())
        val gen = ++generation
        updateChrome()
        if (q.isEmpty) providers.filter { it.network }.forEach { results.remove(it.id) }

        val local = providers.filter { !it.network }
        localExecutor.execute {
            val computed = local.associate { p -> p.id to runSafely(p, q) }
            main.post {
                if (gen == generation) {
                    results.putAll(computed)
                    render(q)
                    maybeRunVoiceCommand(q, computed.values.flatten())
                }
            }
        }

        networkTask?.let { main.removeCallbacks(it) }
        networkTask = null
        if (!q.isEmpty) {
            val task = Runnable {
                if (gen != generation) return@Runnable
                for (p in providers.filter { it.network }) {
                    networkExecutor.execute {
                        val r = runSafely(p, q)
                        main.post {
                            if (gen == generation) {
                                results[p.id] = r
                                render(q)
                            }
                        }
                    }
                }
            }
            networkTask = task
            main.postDelayed(task, NETWORK_DEBOUNCE_MS)
        }
    }

    private fun runSafely(p: Provider, q: Query): List<Result> = try {
        p.query(q)
    } catch (e: Exception) {
        Log.w(TAG, "Provider ${p.id} failed", e)
        emptyList()
    }

    private fun render(q: Query) {
        val all = ArrayList<Result>()
        results.values.forEach { all.addAll(it) }
        if (q.isEmpty) clipboardResult()?.let { all += it }

        val rows = ArrayList<Row>()
        val seenKeys = HashSet<String>()
        val shownQueries = HashSet<String>()
        for (section in if (q.isEmpty) EMPTY_ORDER else TYPED_ORDER) {
            val items = all.filter { it.section == section }
                .sortedByDescending { it.score }
                .filter { seenKeys.add(it.key) }
                .filter { section != Section.SUGGEST || it.title.toString().lowercase() !in shownQueries }
            if (items.isEmpty()) continue
            if (section == Section.WEB || section == Section.HISTORY) items.forEach { shownQueries += it.title.toString().lowercase() }
            sectionTitle(section, q)?.let { rows += Row.Header(it) }
            when (section) {
                Section.APPS, Section.FREQUENT -> items.chunked(adapter.columnsCount()).forEach { rows += Row.Apps(it) }
                else -> items.forEach { rows += if (it.style == Result.Style.ANSWER) Row.Answer(it) else Row.Item(it) }
            }
        }
        adapter.submit(rows)
    }

    private fun sectionTitle(section: Section, q: Query): String? = if (q.isEmpty) {
        when (section) {
            Section.HISTORY -> "Recent searches"
            Section.APPS -> "All apps"
            else -> null
        }
    } else {
        when (section) {
            Section.CONTACTS -> "Contacts"
            Section.SHORTCUTS -> "Shortcuts"
            else -> null
        }
    }

    private fun submit() {
        val q = Query(input.text.toString())
        if (q.isEmpty) return
        val url = Parsers.url(q.text)
        if (url != null && url.confident) {
            prefs.addHistory(q.text)
            openUrl(url.url)
        } else {
            webSearch(q.text)
        }
    }

    private fun openVertical(v: Vertical) {
        val q = Query(input.text.toString())
        if (q.isEmpty) return
        prefs.addHistory(q.text)
        val intents = v.uris(prefs.engine, q.text).map { Intent(Intent.ACTION_VIEW, it) }
        launch(intents.first(), *intents.drop(1).toTypedArray())
    }

    // --- Voice & Lens -------------------------------------------------------------------------

    private fun startVoice() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak now")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_VOICE)
        } catch (e: ActivityNotFoundException) {
            toast("Voice search isn't available on this device")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_VOICE || resultCode != RESULT_OK) return
        val spoken = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (spoken.isNullOrBlank()) return
        pendingVoice = true
        setQuery(spoken)
    }

    /** After a voice query: run a clear command ("set a timer for 5 minutes"), else search the web. */
    private fun maybeRunVoiceCommand(q: Query, local: List<Result>) {
        if (!pendingVoice || q.isEmpty) return
        pendingVoice = false
        val command = local.filter { it.voiceAuto }.maxByOrNull { it.score }
        when {
            command != null -> command.onClick(this)
            local.none { it.section == Section.ANSWER } -> webSearch(q.text)
            else -> Unit // an instant answer is on screen
        }
    }

    private fun openLens() {
        launch(ActionProvider.lensIntent(), *ActionProvider.lensFallbacks(this))
    }

    // --- Clipboard ----------------------------------------------------------------------------

    /** Returns true when the clipboard suggestion changed. */
    private fun readClipboard(): Boolean {
        if (!prefs.showClipboard) return false
        val cm = getSystemService(ClipboardManager::class.java) ?: return false
        val description = cm.primaryClipDescription
        val fresh = description != null && description.hasMimeType("text/*") &&
            System.currentTimeMillis() - description.timestamp < CLIP_FRESH_MS
        if (!fresh) {
            val changed = clipText != null
            clipText = null
            return changed
        }
        if (description!!.timestamp == clipStamp) return false
        clipStamp = description.timestamp
        val text = cm.primaryClip?.getItemAt(0)?.text?.toString()?.trim()?.take(300)
        clipText = text?.takeIf { it.isNotEmpty() && it != ownClip }
        return true
    }

    private fun clipboardResult(): Result? {
        val clip = clipText ?: return null
        return Result(
            section = Section.CLIPBOARD,
            key = "clipboard",
            title = clip,
            subtitle = "From your clipboard · long-press to dismiss",
            icon = glyph("📋"),
            fill = clip,
            onLongClick = { host, _ ->
                clipText = null
                host.refresh()
            },
            onClick = { host ->
                val url = Parsers.url(clip)
                if (url != null && url.confident) host.openUrl(url.url) else host.webSearch(clip)
            },
        )
    }

    // --- Host ---------------------------------------------------------------------------------

    override fun launch(intent: Intent, vararg fallbacks: Intent): Boolean {
        for (candidate in listOf(intent, *fallbacks)) {
            try {
                startActivity(candidate)
                resetOnResume = true
                return true
            } catch (e: ActivityNotFoundException) {
                // try the next one
            } catch (e: SecurityException) {
                // try the next one
            }
        }
        toast("No app can do that")
        return false
    }

    override fun launchApp(app: AppEntry) {
        try {
            repo.startApp(app)
            prefs.recordLaunch(app.key)
            resetOnResume = true
        } catch (e: Exception) {
            toast("Couldn't open ${app.label}")
        }
    }

    override fun showAppMenu(app: AppEntry, anchor: View) {
        val popup = PopupMenu(this, anchor)
        val shortcuts = repo.shortcutsFor(app).take(4)
        shortcuts.forEachIndexed { i, s -> popup.menu.add(0, MENU_SHORTCUT + i, i, s.shortLabel ?: s.id) }
        popup.menu.add(1, MENU_INFO, 10, "App info")
        popup.menu.add(1, MENU_UNINSTALL, 11, "Uninstall")
        popup.menu.add(1, MENU_STORE, 12, "View in Play Store")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_INFO -> try {
                    repo.showAppDetails(app)
                } catch (e: Exception) {
                    toast("Couldn't open app info")
                }
                MENU_UNINSTALL -> launch(Intent(Intent.ACTION_DELETE, Uri.fromParts("package", app.packageName, null)))
                MENU_STORE -> launch(
                    Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${app.packageName}")),
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${app.packageName}")),
                )
                else -> shortcuts.getOrNull(item.itemId - MENU_SHORTCUT)?.let { repo.startShortcut(it) }
            }
            true
        }
        popup.show()
    }

    override fun webSearch(query: String) {
        prefs.addHistory(query)
        openUrl(prefs.engine.searchUrl(query))
    }

    override fun openUrl(url: String) {
        launch(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    override fun setQuery(text: String) {
        input.setText(text)
        input.setSelection(input.text.length)
    }

    override fun refresh() = onQueryChanged()

    override fun copyToClipboard(text: String) {
        ownClip = text
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Omnibox", text))
        // Android 13+ shows its own copy confirmation.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) toast("Copied $text")
    }

    override fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    override fun requestPermission(permission: String) {
        requestPermissions(arrayOf(permission), REQ_PERMISSION)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PERMISSION) return
        permissions.forEachIndexed { i, p ->
            val granted = grantResults.getOrNull(i) == PackageManager.PERMISSION_GRANTED
            if (p == Manifest.permission.READ_CONTACTS && granted) prefs.contactsEnabled = true
            if (p == Manifest.permission.ACCESS_COARSE_LOCATION && granted) prefs.weatherEnabled = true
        }
        refresh()
    }

    private fun reloadApps() {
        localExecutor.execute {
            repo.load()
            main.post { refresh() }
        }
    }

    companion object {
        private const val TAG = "Omnibox"
        private const val REQ_VOICE = 1
        private const val REQ_PERMISSION = 2
        private const val NETWORK_DEBOUNCE_MS = 180L
        private const val CLIP_FRESH_MS = 3 * 60 * 1000L
        private const val MENU_INFO = 1
        private const val MENU_UNINSTALL = 2
        private const val MENU_STORE = 3
        private const val MENU_SHORTCUT = 100

        const val ACTION_OPEN_SEARCH = "dev.omnibox.launcher.action.OPEN_SEARCH"
        const val EXTRA_VOICE = "dev.omnibox.launcher.extra.VOICE"
        const val EXTRA_LENS = "dev.omnibox.launcher.extra.LENS"

        private val EMPTY_ORDER = listOf(Section.CLIPBOARD, Section.FREQUENT, Section.HISTORY, Section.APPS)
        private val TYPED_ORDER = listOf(
            Section.ANSWER, Section.ACTIONS, Section.APPS, Section.CONTACTS, Section.SETTINGS,
            Section.SHORTCUTS, Section.WEB, Section.HISTORY, Section.SUGGEST,
        )

        /** Intent used by the widget and quick settings tile to open the omnibox. */
        fun searchIntent(context: Context, voice: Boolean = false, lens: Boolean = false): Intent =
            Intent(context, MainActivity::class.java)
                .setAction(ACTION_OPEN_SEARCH)
                .putExtra(EXTRA_VOICE, voice)
                .putExtra(EXTRA_LENS, lens)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
