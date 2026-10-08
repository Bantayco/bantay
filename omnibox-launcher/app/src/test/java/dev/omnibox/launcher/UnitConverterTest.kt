package dev.omnibox.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UnitConverterTest {
    private fun convert(s: String) = UnitConverter.parse(s)?.resultText

    @Test fun explicitTargets() {
        assertEquals("16.0934 km", convert("10 miles to km"))
        assertEquals("6.21371 mi", convert("10 km in mi"))
        assertEquals("22.2222 °C", convert("72 f to c"))
        assertEquals("212 °F", convert("100 °C to fahrenheit"))
        assertEquals("2.54 cm", convert("1 in to cm"))
        assertEquals("2.20462 lb", convert("1 kg to pounds"))
        assertEquals("1.5 h", convert("90 minutes in hours"))
        assertEquals("1024 MiB", convert("1 GiB to MiB"))
        assertEquals("29.5735 mL", convert("1 fl oz to ml"))
        assertEquals("96.5606 km/h", convert("60 mph to km/h"))
        assertEquals("10.7639 ft²", convert("1 square meter to square feet"))
    }

    @Test fun defaultTargets() {
        assertEquals("8.04672 km", convert("5 miles"))
        assertEquals("98.6 °F", convert("37 c"))
        assertEquals("4.53592 kg", convert("10 lb"))
    }

    @Test fun rejects() {
        assertNull(convert("10 km to kg"))
        assertNull(convert("5 guys"))
        assertNull(convert("hello world"))
        assertNull(convert("100 usd to eur"))
    }
}
