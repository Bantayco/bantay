package dev.omnibox.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CalculatorTest {
    private fun eval(s: String) = Calculator.evaluate(s)?.let { Calculator.format(it) }

    @Test fun arithmetic() {
        assertEquals("4", eval("2+2"))
        assertEquals("14", eval("2 + 3 * 4"))
        assertEquals("20", eval("(2 + 3) * 4"))
        assertEquals("0.3", eval("0.1+0.2"))
        assertEquals("3.33333333333", eval("10/3"))
        assertEquals("-4", eval("-2^2"))
        assertEquals("512", eval("2^3^2"))
        assertEquals("0.5", eval("2^-1"))
    }

    @Test fun percentAndWords() {
        assertEquals("12", eval("15% of 80"))
        assertEquals("0.2", eval("20%"))
        assertEquals("1", eval("10 mod 3"))
        assertEquals("12", eval("3 x 4"))
        assertEquals("12", eval("3×4"))
        assertEquals("2", eval("6÷3"))
        assertEquals("2000", eval("1,000 * 2"))
    }

    @Test fun functionsAndConstants() {
        assertEquals("1.41421356237", eval("sqrt(2)"))
        assertEquals("3", eval("√9"))
        assertEquals("6.28318530718", eval("2pi"))
        assertEquals("120", eval("5!"))
        assertEquals("3", eval("log2(8)"))
        assertEquals("2", eval("log(100)"))
        assertEquals("1", eval("cos(0)"))
        assertEquals("3", eval("(1+2"))
    }

    @Test fun rejectsNonMath() {
        assertNull(eval("hello"))
        assertNull(eval("1/0"))
        assertNull(eval("2 +"))
        assertFalse(Calculator.looksLikeMath("42"))
        assertFalse(Calculator.looksLikeMath("weather today"))
        assertFalse(Calculator.looksLikeMath("iphone 15 pro"))
        assertTrue(Calculator.looksLikeMath("2+2"))
        assertTrue(Calculator.looksLikeMath("sqrt 16"))
        assertTrue(Calculator.looksLikeMath("15% of 80"))
    }
}
