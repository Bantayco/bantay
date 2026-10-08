package dev.omnibox.launcher

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Path
import android.graphics.Rect
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.view.View
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Colors for the omnibox UI. Defaults are neutral greys; on Android 12+ [apply] swaps in the
 * wallpaper-based Material You palette so the bar matches the system (like the Pixel search bar).
 */
object Palette {
    var SCRIM_HOME = 0x33000000
    var SCRIM_SEARCH = 0xF0151719.toInt()
    var TEXT = 0xFFFFFFFF.toInt()
    var TEXT_DIM = 0xB3FFFFFF.toInt()
    var TEXT_FAINT = 0x80FFFFFF.toInt()
    var ACCENT = 0xFF8AB4F8.toInt()
    var BAR = 0xF0303134.toInt()
    var BAR_ICON = 0xFFE8EAED.toInt()
    var CHIP = 0xFF3C4043.toInt()
    var CARD = 0x1AFFFFFF
    var RIPPLE = 0x33FFFFFF
    var GLYPH_BG = 0xFF3C4043.toInt()

    /** Themed (monochrome) app icon colors, following the system light/dark mode like Pixel Launcher. */
    var ICON_BG = 0xFF303134.toInt()
    var ICON_FG = 0xFFE8EAED.toInt()

    val dynamic: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    fun apply(context: Context) {
        if (!dynamic) return
        fun c(id: Int) = context.getColor(id)
        BAR = withAlpha(c(android.R.color.system_accent2_800), 0xF0)
        BAR_ICON = c(android.R.color.system_accent1_100)
        ACCENT = c(android.R.color.system_accent1_200)
        CHIP = c(android.R.color.system_accent2_700)
        GLYPH_BG = c(android.R.color.system_accent2_700)
        SCRIM_SEARCH = withAlpha(c(android.R.color.system_neutral1_900), 0xF2)
        TEXT = c(android.R.color.system_neutral1_50)
        TEXT_DIM = withAlpha(TEXT, 0xB3)
        TEXT_FAINT = withAlpha(TEXT, 0x80)
        val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        if (night) {
            ICON_BG = c(android.R.color.system_neutral1_800)
            ICON_FG = c(android.R.color.system_accent1_100)
        } else {
            ICON_BG = c(android.R.color.system_accent1_100)
            ICON_FG = c(android.R.color.system_neutral2_700)
        }
    }

    fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()
fun Context.dpf(value: Float): Float = value * resources.displayMetrics.density

fun rounded(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
}

/** Ripple feedback over an optional background, clipped to a rounded rect. */
fun View.setRippleBackground(radius: Float, content: Drawable? = null) {
    background = RippleDrawable(ColorStateList.valueOf(Palette.RIPPLE), content, rounded(Color.WHITE, radius))
}

fun Context.tintedIcon(resId: Int, color: Int = Palette.TEXT_DIM): Drawable? =
    getDrawable(resId)?.mutate()?.apply { setTint(color) }

/** A round icon showing a glyph or emoji, used where there is no bitmap icon. */
class GlyphDrawable(
    private val glyph: String,
    background: Int = Palette.GLYPH_BG,
    foreground: Int = Palette.TEXT,
    private val textScale: Float = 1.0f,
) : Drawable() {
    private val hasBackground = Color.alpha(background) > 0
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = background }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = foreground
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }

    override fun draw(canvas: Canvas) {
        val b = bounds
        val r = min(b.width(), b.height()) / 2f
        if (hasBackground) canvas.drawCircle(b.exactCenterX(), b.exactCenterY(), r, bgPaint)
        textPaint.textSize = r * textScale
        val y = b.exactCenterY() - (textPaint.descent() + textPaint.ascent()) / 2
        canvas.drawText(glyph, b.exactCenterX(), y, textPaint)
    }

    override fun setAlpha(alpha: Int) {
        bgPaint.alpha = alpha
        textPaint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        bgPaint.colorFilter = colorFilter
        textPaint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    override fun getIntrinsicWidth(): Int = 96
    override fun getIntrinsicHeight(): Int = 96
}

/**
 * A Pixel-style themed icon: the app's monochrome layer, tinted, on a circle — what Android 13+
 * launchers draw when "Themed icons" is on.
 */
class ThemedIconDrawable(private val mono: Drawable, private val bg: Int, fg: Int) : Drawable() {
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg }
    private val clip = Path()

    init {
        mono.mutate().setTint(fg)
    }

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        // Adaptive icon layers are 108dp with a 72dp visible area: inflate by 25% on each side.
        val inset = (bounds.width() * 0.25f).toInt()
        mono.setBounds(bounds.left - inset, bounds.top - inset, bounds.right + inset, bounds.bottom + inset)
        clip.reset()
        clip.addCircle(bounds.exactCenterX(), bounds.exactCenterY(), min(bounds.width(), bounds.height()) / 2f, Path.Direction.CW)
    }

    override fun draw(canvas: Canvas) {
        val b = bounds
        canvas.drawCircle(b.exactCenterX(), b.exactCenterY(), min(b.width(), b.height()) / 2f, bgPaint)
        val save = canvas.save()
        canvas.clipPath(clip)
        mono.draw(canvas)
        canvas.restoreToCount(save)
    }

    override fun setAlpha(alpha: Int) {
        bgPaint.alpha = alpha
        mono.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        bgPaint.colorFilter = colorFilter
        mono.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    override fun getIntrinsicWidth(): Int = mono.intrinsicWidth.takeIf { it > 0 }?.let { it * 2 / 3 } ?: 144
    override fun getIntrinsicHeight(): Int = mono.intrinsicHeight.takeIf { it > 0 }?.let { it * 2 / 3 } ?: 144
}
