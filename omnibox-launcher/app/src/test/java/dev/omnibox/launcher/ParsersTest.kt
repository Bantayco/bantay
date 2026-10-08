package dev.omnibox.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class ParsersTest {
    @Test fun urls() {
        assertEquals("https://example.com", Parsers.url("example.com")!!.url)
        assertTrue(Parsers.url("example.com")!!.confident)
        assertTrue(Parsers.url("http://localhost:8080/x")!!.confident)
        assertTrue(Parsers.url("www.example.zz")!!.confident)
        assertFalse(Parsers.url("node.js")!!.confident)
        assertNull(Parsers.url("hello world.com"))
        assertNull(Parsers.url("3.14"))
    }

    @Test fun contactsInfo() {
        assertEquals("+1 555 123 4567", Parsers.phone("+1 555 123 4567"))
        assertNull(Parsers.phone("3.14159"))
        assertNull(Parsers.phone("123"))
        assertEquals("a.b@c.io", Parsers.email("a.b@c.io"))
        assertNull(Parsers.email("not an email"))
    }

    @Test fun timers() {
        assertEquals(300, Parsers.timerSeconds("set a timer for 5 minutes"))
        assertEquals(5400, Parsers.timerSeconds("timer 1h 30m"))
        assertEquals(600, Parsers.timerSeconds("10 min timer"))
        assertEquals(5400, Parsers.timerSeconds("timer for 1 hour and 30 minutes"))
        assertEquals(45, Parsers.timerSeconds("timer 45 seconds"))
        assertNull(Parsers.timerSeconds("timer"))
        assertNull(Parsers.timerSeconds("egg timer"))
    }

    @Test fun alarms() {
        assertEquals(7 to 0, Parsers.alarmTime("alarm 7am"))
        assertEquals(18 to 30, Parsers.alarmTime("set an alarm for 6:30 pm"))
        assertEquals(0 to 15, Parsers.alarmTime("wake me up at 12:15 am"))
        assertEquals(21 to 0, Parsers.alarmTime("alarm 21:00"))
        assertNull(Parsers.alarmTime("alarm 25"))
    }

    @Test fun commands() {
        assertEquals("the airport", Parsers.navigateTo("directions to the airport"))
        assertEquals("coffee", Parsers.nearMe("coffee near me"))
        assertEquals("buy milk", Parsers.calendarEvent("remind me to buy milk"))
        assertEquals("jazz", Parsers.play("play jazz"))
        assertEquals("serendipity", Parsers.define("define serendipity"))
        assertEquals("yeet", Parsers.define("what does yeet mean"))
        assertNull(Parsers.define("defined"))
        val t = Parsers.translate("translate good morning to spanish")!!
        assertEquals("good morning", t.text)
        assertEquals("es", t.languageCode)
        assertEquals("fr", Parsers.translate("how do you say cat in french")!!.languageCode)
        assertTrue(Parsers.coinFlip("flip a coin"))
        assertEquals(20, Parsers.dice("roll a d20")!!.sides)
        assertEquals(2, Parsers.dice("roll 2 dice")!!.count)
        assertEquals(1L to 10L, Parsers.randomRange("random number between 10 and 1"))
        assertEquals("on", Parsers.torch("turn on flashlight"))
        assertEquals("off", Parsers.torch("flashlight off"))
        assertEquals("toggle", Parsers.torch("torch"))
    }

    @Test fun fuzzy() {
        assertEquals(1000, Fuzzy.score("Maps", "maps"))
        assertTrue(Fuzzy.score("Google Maps", "maps") > Fuzzy.score("Google Maps", "gle"))
        assertTrue(Fuzzy.score("Google Maps", "gm") > 0)
        assertEquals(0, Fuzzy.score("Camera", "xyz"))
    }

    @Test fun currency() {
        val r = CurrencyParser.parse("100 usd to eur", "USD")!!
        assertEquals(100.0, r.amount, 0.0)
        assertEquals("USD", r.from)
        assertEquals("EUR", r.to)
        assertEquals("GBP", CurrencyParser.parse("€20 in pounds", "USD")!!.to)
        assertEquals("JPY", CurrencyParser.parse("50 usd", "JPY")!!.to)
        assertNull(CurrencyParser.parse("10 km", "USD"))
        assertNull(CurrencyParser.parse("5 min", "USD"))
    }

    @Test fun timeZones() {
        assertEquals(ZoneId.of("Asia/Tokyo"), TimeZones.parse("time in tokyo"))
        assertEquals(ZoneId.of("Europe/London"), TimeZones.parse("london time"))
        assertEquals(ZoneId.of("America/Los_Angeles"), TimeZones.parse("what time is it in pst"))
        assertNotNull(TimeZones.parse("time"))
        assertNull(TimeZones.parse("screen time"))
    }
}
