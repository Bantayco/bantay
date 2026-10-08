package dev.omnibox.launcher

/** Ranks how well a typed term matches a label. 0 means "no match". */
object Fuzzy {
    private val SEPARATORS = Regex("[\\s\\-_.:/()]+")

    fun score(label: String, term: String): Int {
        if (term.isEmpty()) return 0
        val l = label.lowercase()
        val t = term.lowercase()
        if (l == t) return 1000
        if (l.startsWith(t)) return 800 - minOf(l.length - t.length, 100)
        val words = l.split(SEPARATORS).filter { it.isNotEmpty() }
        if (words.any { it.startsWith(t) }) return 600
        if (l.contains(t)) return 400
        if (t.length >= 2) {
            val initials = words.joinToString("") { it.take(1) }
            if (initials.startsWith(t)) return 350
        }
        if (t.length >= 3 && isSubsequence(t, l)) return 100
        return 0
    }

    private fun isSubsequence(needle: String, hay: String): Boolean {
        var i = 0
        for (c in hay) {
            if (i < needle.length && needle[i] == c) i++
        }
        return i == needle.length
    }
}
