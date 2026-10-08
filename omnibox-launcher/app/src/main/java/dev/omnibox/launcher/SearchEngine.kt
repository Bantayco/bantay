package dev.omnibox.launcher

import android.net.Uri
import java.net.URLEncoder
import java.util.Locale

enum class SearchEngine(
    val id: String,
    val label: String,
    private val search: String,
    val suggestUrl: String?,
    private val images: String?,
    private val videos: String?,
    private val news: String?,
    private val shopping: String?,
) {
    GOOGLE(
        "google", "Google",
        "https://www.google.com/search?q=%s",
        "https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=%s",
        "https://www.google.com/search?tbm=isch&q=%s",
        "https://www.google.com/search?tbm=vid&q=%s",
        "https://www.google.com/search?tbm=nws&q=%s",
        "https://www.google.com/search?tbm=shop&q=%s",
    ),
    DUCKDUCKGO(
        "ddg", "DuckDuckGo",
        "https://duckduckgo.com/?q=%s",
        "https://duckduckgo.com/ac/?type=list&q=%s",
        "https://duckduckgo.com/?ia=images&iax=images&q=%s",
        "https://duckduckgo.com/?ia=videos&iax=videos&q=%s",
        "https://duckduckgo.com/?ia=news&iar=news&q=%s",
        "https://duckduckgo.com/?ia=shopping&iax=shopping&q=%s",
    ),
    BING(
        "bing", "Bing",
        "https://www.bing.com/search?q=%s",
        "https://www.bing.com/osjson.aspx?query=%s",
        "https://www.bing.com/images/search?q=%s",
        "https://www.bing.com/videos/search?q=%s",
        "https://www.bing.com/news/search?q=%s",
        "https://www.bing.com/shop?q=%s",
    ),
    BRAVE(
        "brave", "Brave Search",
        "https://search.brave.com/search?q=%s",
        "https://search.brave.com/api/suggest?q=%s",
        "https://search.brave.com/images?q=%s",
        "https://search.brave.com/videos?q=%s",
        "https://search.brave.com/news?q=%s",
        null,
    ),
    ECOSIA(
        "ecosia", "Ecosia",
        "https://www.ecosia.org/search?q=%s",
        "https://ac.ecosia.org/autocomplete?type=list&q=%s",
        "https://www.ecosia.org/images?q=%s",
        "https://www.ecosia.org/videos?q=%s",
        "https://www.ecosia.org/news?q=%s",
        null,
    );

    fun searchUrl(q: String) = fill(search, q)
    fun suggestUrl(q: String) = suggestUrl?.let { fill(it, q) }
    fun imagesUrl(q: String) = fill(images ?: GOOGLE.images!!, q)
    fun videosUrl(q: String) = fill(videos ?: GOOGLE.videos!!, q)
    fun newsUrl(q: String) = fill(news ?: GOOGLE.news!!, q)
    fun shoppingUrl(q: String) = fill(shopping ?: GOOGLE.shopping!!, q)

    companion object {
        fun fromId(id: String?): SearchEngine = entries.firstOrNull { it.id == id } ?: GOOGLE

        fun encode(q: String): String = URLEncoder.encode(q, "UTF-8")

        private fun fill(template: String, q: String) = template.replace("%s", encode(q))
    }
}

/** The scoped searches shown as chips under the search bar, like Google's Images / News / Maps tabs. */
enum class Vertical(val label: String) {
    IMAGES("Images"),
    VIDEOS("Videos"),
    NEWS("News"),
    MAPS("Maps"),
    SHOPPING("Shopping"),
    YOUTUBE("YouTube"),
    PLAY("Play Store"),
    WIKIPEDIA("Wikipedia"),
    TRANSLATE("Translate");

    /** Primary URI to open, plus web fallbacks. */
    fun uris(engine: SearchEngine, q: String): List<Uri> {
        val e = SearchEngine.encode(q)
        return when (this) {
            IMAGES -> listOf(Uri.parse(engine.imagesUrl(q)))
            VIDEOS -> listOf(Uri.parse(engine.videosUrl(q)))
            NEWS -> listOf(Uri.parse(engine.newsUrl(q)))
            SHOPPING -> listOf(Uri.parse(engine.shoppingUrl(q)))
            MAPS -> listOf(Uri.parse("geo:0,0?q=$e"), Uri.parse("https://www.google.com/maps/search/?api=1&query=$e"))
            YOUTUBE -> listOf(Uri.parse("https://www.youtube.com/results?search_query=$e"))
            PLAY -> listOf(Uri.parse("market://search?q=$e"), Uri.parse("https://play.google.com/store/search?q=$e"))
            WIKIPEDIA -> {
                val lang = Locale.getDefault().language.ifEmpty { "en" }
                listOf(Uri.parse("https://$lang.wikipedia.org/wiki/Special:Search?search=$e"))
            }
            TRANSLATE -> listOf(Uri.parse("https://translate.google.com/?sl=auto&op=translate&text=$e"))
        }
    }
}
