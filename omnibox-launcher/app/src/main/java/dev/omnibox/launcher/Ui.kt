package dev.omnibox.launcher

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.View
import kotlin.math.min
import kotlin.math.roundToInt

object Palette {
    const val SCRIM_HOME = 0x66000000
    const val SCRIM_SEARCH = 0xF0151719.toInt()
    const val TEXT = 0xFFFFFFFF.toInt()
    const val TEXT_DIM = 0xB3FFFFFF.toInt()
    const val TEXT_FAINT = 0x80FFFFFF.toInt()
    const val ACCENT = 0xFF8AB4F8.toInt()
    const val BAR = 0xFF303134.toInt()
    const val CHIP = 0xFF3C4043.toInt()
    const val CARD = 0x1AFFFFFF
    const val RIPPLE = 0x33FFFFFF
    const val GLYPH_BG = 0xFF3C4043.toInt()
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
