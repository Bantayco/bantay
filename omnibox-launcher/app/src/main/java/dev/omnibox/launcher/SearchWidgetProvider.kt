package dev.omnibox.launcher

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home-screen search bar widget: tap to search, ♪ for song search, mic for voice, camera for Lens. */
class SearchWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_search)
            views.setOnClickPendingIntent(R.id.widget_bar, pending(context, 0, MainActivity.searchIntent(context)))
            views.setOnClickPendingIntent(R.id.widget_mic, pending(context, 1, MainActivity.searchIntent(context, voice = true)))
            views.setOnClickPendingIntent(R.id.widget_lens, pending(context, 2, MainActivity.searchIntent(context, lens = true)))
            views.setOnClickPendingIntent(R.id.widget_song, pending(context, 3, MainActivity.searchIntent(context, song = true)))
            manager.updateAppWidget(id, views)
        }
    }

    private fun pending(context: Context, requestCode: Int, intent: Intent): PendingIntent =
        PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
