package dev.omnibox.launcher

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.net.Uri
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.Contacts

/** Contacts by name, plus "call mom" / "text alex" / "email sam" commands. */
class ContactProvider(private val context: Context, private val prefs: Prefs) : Provider {
    override val id = "contacts"

    private enum class Mode { OPEN, CALL, SMS, EMAIL }

    private val commands = listOf(
        "call " to Mode.CALL, "phone " to Mode.CALL, "dial " to Mode.CALL, "ring " to Mode.CALL,
        "text " to Mode.SMS, "sms " to Mode.SMS, "message " to Mode.SMS, "msg " to Mode.SMS,
        "email " to Mode.EMAIL, "mail " to Mode.EMAIL, "e-mail " to Mode.EMAIL,
    )

    override fun query(q: Query): List<Result> {
        if (q.text.length < 2 || !prefs.contactsEnabled) return emptyList()
        var mode = Mode.OPEN
        var term = q.text
        for ((prefix, m) in commands) {
            if (q.lower.startsWith(prefix)) {
                mode = m
                term = q.text.substring(prefix.length).trim()
                break
            }
        }
        if (term.isEmpty()) return emptyList()

        if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            if (prefs.contactsPromptDismissed) return emptyList()
            return listOf(
                Result(
                    section = if (mode == Mode.OPEN) Section.CONTACTS else Section.ACTIONS,
                    key = "contacts:permission",
                    title = "Search your contacts",
                    subtitle = "Tap to allow · long-press to hide",
                    icon = glyph("👤"),
                    onLongClick = { host, _ ->
                        prefs.contactsPromptDismissed = true
                        host.refresh()
                    },
                    onClick = { host -> host.requestPermission(Manifest.permission.READ_CONTACTS) },
                ),
            )
        }

        val found = try {
            search(term)
        } catch (e: Exception) {
            emptyList()
        }
        val section = if (mode == Mode.OPEN) Section.CONTACTS else Section.ACTIONS
        return found.mapIndexed { i, c -> toResult(c, mode, section, 500 - i, found.size == 1 && mode != Mode.OPEN) }
    }

    private class Contact(
        val id: Long,
        val lookupKey: String,
        val name: String,
        val photo: Drawable?,
        val phone: String?,
        val email: String?,
    )

    private fun search(term: String): List<Contact> {
        val uri = Uri.withAppendedPath(Contacts.CONTENT_FILTER_URI, Uri.encode(term))
        val projection = arrayOf(
            Contacts._ID,
            Contacts.LOOKUP_KEY,
            Contacts.DISPLAY_NAME_PRIMARY,
            Contacts.PHOTO_THUMBNAIL_URI,
            Contacts.HAS_PHONE_NUMBER,
        )
        val out = ArrayList<Contact>()
        context.contentResolver.query(uri, projection, null, null, null)?.use { c ->
            while (c.moveToNext() && out.size < MAX) {
                val id = c.getLong(0)
                val name = c.getString(2) ?: continue
                val photo = c.getString(3)?.let { loadPhoto(it) }
                val phone = if (c.getInt(4) > 0) firstValue(Phone.CONTENT_URI, Phone.NUMBER, Phone.CONTACT_ID, Phone.IS_SUPER_PRIMARY, Phone.IS_PRIMARY, id) else null
                val email = firstValue(Email.CONTENT_URI, Email.ADDRESS, Email.CONTACT_ID, Email.IS_SUPER_PRIMARY, Email.IS_PRIMARY, id)
                out += Contact(id, c.getString(1) ?: "", name, photo, phone, email)
            }
        }
        return out
    }

    private fun firstValue(uri: Uri, column: String, idColumn: String, superPrimary: String, primary: String, id: Long): String? =
        context.contentResolver.query(
            uri, arrayOf(column), "$idColumn = ?", arrayOf(id.toString()), "$superPrimary DESC, $primary DESC",
        )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }

    private fun loadPhoto(uri: String): Drawable? = try {
        context.contentResolver.openInputStream(Uri.parse(uri))?.use { Drawable.createFromStream(it, uri) }
    } catch (e: Exception) {
        null
    }

    private fun toResult(c: Contact, mode: Mode, section: Section, score: Int, voiceAuto: Boolean): Result {
        val dial = c.phone?.let { Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(it))) }
        val sms = c.phone?.let { Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(it))) }
        val mail = c.email?.let { Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + it)) }
        val open = Intent(Intent.ACTION_VIEW, Contacts.getLookupUri(c.id, c.lookupKey))

        val primary = when (mode) {
            Mode.OPEN -> open
            Mode.CALL -> dial ?: open
            Mode.SMS -> sms ?: open
            Mode.EMAIL -> mail ?: open
        }
        val verb = when (mode) {
            Mode.OPEN -> null
            Mode.CALL -> if (dial != null) "Call" else null
            Mode.SMS -> if (sms != null) "Message" else null
            Mode.EMAIL -> if (mail != null) "Email" else null
        }
        val actions = buildList {
            if (dial != null) add(RowAction(glyph("📞"), "Call") { h -> h.launch(dial) })
            if (sms != null) add(RowAction(glyph("💬"), "Message") { h -> h.launch(sms) })
            if (mail != null && mode == Mode.EMAIL) add(RowAction(glyph("✉️"), "Email") { h -> h.launch(mail) })
        }
        return Result(
            section = section,
            key = "contact:${c.id}:$mode",
            title = if (verb != null) "$verb ${c.name}" else c.name,
            subtitle = if (mode == Mode.EMAIL) c.email else c.phone ?: c.email,
            icon = c.photo ?: glyph(c.name.take(1).uppercase()),
            score = score,
            actions = actions,
            voiceAuto = voiceAuto,
            onClick = { host -> host.launch(primary, open) },
        )
    }

    companion object {
        private const val MAX = 4
    }
}
