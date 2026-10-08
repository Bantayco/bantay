package dev.omnibox.launcher

import android.content.ComponentName
import android.content.Context
import android.content.pm.LauncherActivityInfo
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import android.os.UserHandle
import android.os.UserManager

class AppEntry(
    val label: String,
    val component: ComponentName,
    val user: UserHandle,
    private val info: LauncherActivityInfo,
    private val packageManager: PackageManager,
) {
    val key: String = component.flattenToShortString() + "#" + user.hashCode()
    val packageName: String get() = component.packageName

    @Volatile
    private var cachedIcon: Drawable? = null

    @Volatile
    private var cachedStyle: Int = 0

    /** Loads (and caches) the icon, themed when [IconStyle] asks for it. Safe off the main thread. */
    fun icon(): Drawable {
        val style = IconStyle.signature()
        cachedIcon?.let { if (cachedStyle == style) return it }
        val icon = themedIcon() ?: info.getBadgedIcon(0)
        cachedIcon = icon
        cachedStyle = style
        return icon
    }

    private fun themedIcon(): Drawable? {
        if (!IconStyle.themed || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return null
        val base = info.getIcon(0) as? AdaptiveIconDrawable ?: return null
        val mono = base.monochrome ?: return null
        val themed = ThemedIconDrawable(mono, Palette.ICON_BG, Palette.ICON_FG)
        return packageManager.getUserBadgedIcon(themed, user)
    }
}

/** Whether app icons are drawn as themed (monochrome) icons. Set by [MainActivity] from prefs. */
object IconStyle {
    @Volatile
    var themed = false

    fun signature(): Int = if (themed) 31 * Palette.ICON_BG + Palette.ICON_FG else 1
}

/** Installed launchable apps and their shortcuts, across work/personal profiles. */
class AppRepository(private val context: Context) {
    private val launcherApps = context.getSystemService(LauncherApps::class.java)!!
    private val userManager = context.getSystemService(UserManager::class.java)!!

    @Volatile
    var apps: List<AppEntry> = emptyList()
        private set

    @Volatile
    var shortcuts: List<ShortcutInfo> = emptyList()
        private set

    var onChanged: (() -> Unit)? = null

    /** Blocking; call from a background thread. */
    fun load() {
        val list = ArrayList<AppEntry>()
        for (user in userManager.userProfiles) {
            val activities = try {
                launcherApps.getActivityList(null, user)
            } catch (e: SecurityException) {
                emptyList()
            }
            for (info in activities) {
                if (info.componentName.packageName == context.packageName) continue
                list += AppEntry(info.label.toString(), info.componentName, user, info, context.packageManager)
            }
        }
        list.sortWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label })
        apps = list
        shortcuts = loadShortcuts()
    }

    /** Shortcut access requires being the default home app. */
    fun hasShortcutAccess(): Boolean = try {
        launcherApps.hasShortcutHostPermission()
    } catch (e: Exception) {
        false
    }

    private fun loadShortcuts(): List<ShortcutInfo> {
        if (!hasShortcutAccess()) return emptyList()
        val query = LauncherApps.ShortcutQuery().setQueryFlags(
            LauncherApps.ShortcutQuery.FLAG_MATCH_DYNAMIC or
                LauncherApps.ShortcutQuery.FLAG_MATCH_MANIFEST or
                LauncherApps.ShortcutQuery.FLAG_MATCH_PINNED,
        )
        return userManager.userProfiles.flatMap { user ->
            try {
                launcherApps.getShortcuts(query, user) ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }

    fun shortcutsFor(app: AppEntry): List<ShortcutInfo> =
        shortcuts.filter { it.`package` == app.packageName && it.userHandle == app.user }
            .sortedBy { it.rank }

    fun shortcutIcon(info: ShortcutInfo): Drawable? = try {
        launcherApps.getShortcutIconDrawable(info, context.resources.displayMetrics.densityDpi)
    } catch (e: Exception) {
        null
    }

    fun startShortcut(info: ShortcutInfo): Boolean = try {
        launcherApps.startShortcut(info, null, null)
        true
    } catch (e: Exception) {
        false
    }

    fun startApp(app: AppEntry) {
        launcherApps.startMainActivity(app.component, app.user, null, null)
    }

    fun showAppDetails(app: AppEntry) {
        launcherApps.startAppDetailsActivity(app.component, app.user, null, null)
    }

    fun register(handler: Handler) = launcherApps.registerCallback(callback, handler)

    fun unregister() = launcherApps.unregisterCallback(callback)

    private fun changed() {
        onChanged?.invoke()
    }

    private val callback = object : LauncherApps.Callback() {
        override fun onPackageRemoved(packageName: String, user: UserHandle) = changed()
        override fun onPackageAdded(packageName: String, user: UserHandle) = changed()
        override fun onPackageChanged(packageName: String, user: UserHandle) = changed()
        override fun onPackagesAvailable(packageNames: Array<out String>, user: UserHandle, replacing: Boolean) =
            changed()

        override fun onPackagesUnavailable(packageNames: Array<out String>, user: UserHandle, replacing: Boolean) =
            changed()

        override fun onShortcutsChanged(packageName: String, shortcuts: MutableList<ShortcutInfo>, user: UserHandle) =
            changed()
    }
}
