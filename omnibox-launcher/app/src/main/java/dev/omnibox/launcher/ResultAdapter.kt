package dev.omnibox.launcher

import android.content.Context
import android.graphics.Typeface
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

sealed class Row {
    class Header(val title: String) : Row()
    class Item(val result: Result) : Row()
    class Answer(val result: Result) : Row()
    class Apps(val results: List<Result>) : Row()
}

/** Renders the omnibox results: section headers, rows, answer cards and app-icon grids. */
class ResultAdapter(private val host: Host, private val columns: Int) : BaseAdapter() {
    private var rows: List<Row> = emptyList()

    fun columnsCount() = columns

    fun submit(newRows: List<Row>) {
        rows = newRows
        notifyDataSetChanged()
    }

    override fun getCount() = rows.size
    override fun getItem(position: Int): Any = rows[position]
    override fun getItemId(position: Int) = position.toLong()
    override fun getViewTypeCount() = 4
    override fun areAllItemsEnabled() = false
    override fun isEnabled(position: Int) = false

    override fun getItemViewType(position: Int) = when (rows[position]) {
        is Row.Header -> 0
        is Row.Item -> 1
        is Row.Answer -> 2
        is Row.Apps -> 3
    }

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val ctx = parent.context
        return when (val row = rows[position]) {
            is Row.Header -> (convertView as? TextView ?: header(ctx)).also { it.text = row.title }
            is Row.Item -> (convertView ?: item(ctx)).also { bindItem(it.tag as ItemHolder, row.result) }
            is Row.Answer -> (convertView ?: answer(ctx)).also { bindAnswer(it.tag as AnswerHolder, row.result) }
            is Row.Apps -> (convertView ?: apps(ctx)).also { bindApps(it.tag as AppsHolder, row.results) }
        }
    }

    // --- Headers ------------------------------------------------------------------------------

    private fun header(ctx: Context) = TextView(ctx).apply {
        textSize = 13f
        setTextColor(Palette.ACCENT)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(ctx.dp(20), ctx.dp(16), ctx.dp(20), ctx.dp(6))
        setShadowLayer(4f, 0f, 1f, 0x66000000)
    }

    // --- Result rows --------------------------------------------------------------------------

    private class ItemHolder(
        val root: LinearLayout,
        val icon: ImageView,
        val title: TextView,
        val subtitle: TextView,
        val actions: LinearLayout,
        val fill: ImageView,
    )

    private fun item(ctx: Context): View {
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = ctx.dp(56)
            setPadding(ctx.dp(16), ctx.dp(6), ctx.dp(4), ctx.dp(6))
            setRippleBackground(ctx.dpf(12f))
        }
        val icon = ImageView(ctx).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        root.addView(icon, LinearLayout.LayoutParams(ctx.dp(32), ctx.dp(32)).apply { marginEnd = ctx.dp(16) })

        val texts = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val title = TextView(ctx).apply {
            textSize = 16f
            setTextColor(Palette.TEXT)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
        }
        val subtitle = TextView(ctx).apply {
            textSize = 13f
            setTextColor(Palette.TEXT_DIM)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        texts.addView(title)
        texts.addView(subtitle)
        root.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val actions = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        root.addView(actions)

        val fill = ImageView(ctx).apply {
            setImageDrawable(ctx.tintedIcon(R.drawable.ic_fill, Palette.TEXT_FAINT))
            setPadding(ctx.dp(10), ctx.dp(10), ctx.dp(10), ctx.dp(10))
            contentDescription = "Edit query"
            setRippleBackground(ctx.dpf(20f))
        }
        root.addView(fill, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        root.tag = ItemHolder(root, icon, title, subtitle, actions, fill)
        return root
    }

    private fun bindItem(h: ItemHolder, r: Result) {
        val ctx = h.root.context
        h.icon.setImageDrawable(r.icon)
        h.icon.visibility = if (r.icon == null) View.INVISIBLE else View.VISIBLE
        h.title.text = r.title
        h.subtitle.text = r.subtitle
        h.subtitle.visibility = if (r.subtitle.isNullOrEmpty()) View.GONE else View.VISIBLE
        h.actions.removeAllViews()
        for (a in r.actions) {
            val button = ImageView(ctx).apply {
                setImageDrawable(a.icon)
                contentDescription = a.description
                setPadding(ctx.dp(10), ctx.dp(10), ctx.dp(10), ctx.dp(10))
                setRippleBackground(ctx.dpf(22f))
                setOnClickListener { a.run(host) }
            }
            h.actions.addView(button, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        }
        val fill = r.fill
        h.fill.visibility = if (fill != null && r.actions.isEmpty()) View.VISIBLE else View.GONE
        h.fill.setOnClickListener { if (fill != null) host.setQuery(fill) }
        h.root.setOnClickListener { r.onClick(host) }
        bindLongClick(h.root, r)
    }

    private fun bindLongClick(view: View, r: Result) {
        val long = r.onLongClick
        if (long == null) {
            view.setOnLongClickListener(null)
            view.isLongClickable = false
        } else {
            view.setOnLongClickListener { v ->
                long(host, v)
                true
            }
        }
    }

    // --- Answer cards -------------------------------------------------------------------------

    private class AnswerHolder(val card: LinearLayout, val icon: ImageView, val title: TextView, val subtitle: TextView, val fill: ImageView)

    private fun answer(ctx: Context): View {
        val frame = FrameLayout(ctx).apply { setPadding(ctx.dp(12), ctx.dp(8), ctx.dp(12), ctx.dp(8)) }
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(ctx.dp(16), ctx.dp(14), ctx.dp(8), ctx.dp(14))
            setRippleBackground(ctx.dpf(20f), rounded(Palette.CARD, ctx.dpf(20f)))
        }
        val icon = ImageView(ctx)
        card.addView(icon, LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)).apply { marginEnd = ctx.dp(16) })
        val texts = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val subtitle = TextView(ctx).apply {
            textSize = 13f
            setTextColor(Palette.TEXT_DIM)
            maxLines = 3
            ellipsize = TextUtils.TruncateAt.END
        }
        val title = TextView(ctx).apply {
            textSize = 28f
            setTextColor(Palette.TEXT)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            setTextIsSelectable(false)
        }
        texts.addView(subtitle)
        texts.addView(title)
        card.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val fill = ImageView(ctx).apply {
            setImageDrawable(ctx.tintedIcon(R.drawable.ic_fill, Palette.TEXT_FAINT))
            setPadding(ctx.dp(10), ctx.dp(10), ctx.dp(10), ctx.dp(10))
            contentDescription = "Use result"
            setRippleBackground(ctx.dpf(20f))
        }
        card.addView(fill, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        frame.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        frame.tag = AnswerHolder(card, icon, title, subtitle, fill)
        return frame
    }

    private fun bindAnswer(h: AnswerHolder, r: Result) {
        h.icon.setImageDrawable(r.icon)
        h.title.text = r.title
        h.subtitle.text = r.subtitle
        h.subtitle.visibility = if (r.subtitle.isNullOrEmpty()) View.GONE else View.VISIBLE
        val fill = r.fill
        h.fill.visibility = if (fill != null) View.VISIBLE else View.GONE
        h.fill.setOnClickListener { if (fill != null) host.setQuery(fill) }
        h.card.setOnClickListener { r.onClick(host) }
        bindLongClick(h.card, r)
    }

    // --- App grid -----------------------------------------------------------------------------

    private class AppsHolder(val cells: List<LinearLayout>, val icons: List<ImageView>, val labels: List<TextView>)

    private fun apps(ctx: Context): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(ctx.dp(8), ctx.dp(2), ctx.dp(8), ctx.dp(2))
        }
        val cells = ArrayList<LinearLayout>()
        val icons = ArrayList<ImageView>()
        val labels = ArrayList<TextView>()
        repeat(columns) {
            val cell = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(ctx.dp(4), ctx.dp(8), ctx.dp(4), ctx.dp(8))
                setRippleBackground(ctx.dpf(16f))
            }
            val icon = ImageView(ctx)
            cell.addView(icon, LinearLayout.LayoutParams(ctx.dp(52), ctx.dp(52)))
            val label = TextView(ctx).apply {
                textSize = 12f
                setTextColor(Palette.TEXT)
                gravity = Gravity.CENTER_HORIZONTAL
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setShadowLayer(4f, 0f, 1f, 0x99000000.toInt())
                setPadding(0, ctx.dp(6), 0, 0)
            }
            cell.addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            row.addView(cell, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            cells += cell
            icons += icon
            labels += label
        }
        row.tag = AppsHolder(cells, icons, labels)
        return row
    }

    private fun bindApps(h: AppsHolder, results: List<Result>) {
        for (i in h.cells.indices) {
            val r = results.getOrNull(i)
            val cell = h.cells[i]
            if (r == null) {
                cell.visibility = View.INVISIBLE
                cell.setOnClickListener(null)
                cell.setOnLongClickListener(null)
                continue
            }
            cell.visibility = View.VISIBLE
            h.icons[i].setImageDrawable(r.icon)
            h.labels[i].text = r.title
            cell.contentDescription = r.title
            cell.setOnClickListener { r.onClick(host) }
            bindLongClick(cell, r)
        }
    }
}
