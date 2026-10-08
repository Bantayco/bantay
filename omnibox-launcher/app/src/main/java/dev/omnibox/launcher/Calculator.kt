package dev.omnibox.launcher

import java.math.BigDecimal
import java.math.MathContext
import kotlin.math.E
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.cbrt
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Inline calculator: a small recursive-descent parser for the kind of
 * expressions people type into a search bar ("2+2", "15% of 80", "sqrt(2)*pi").
 */
object Calculator {

    private val FUNCTIONS: Map<String, (Double) -> Double> = mapOf(
        "sqrt" to { x -> sqrt(x) },
        "cbrt" to { x -> cbrt(x) },
        "sin" to { x -> sin(x) },
        "cos" to { x -> cos(x) },
        "tan" to { x -> tan(x) },
        "asin" to { x -> asin(x) },
        "acos" to { x -> acos(x) },
        "atan" to { x -> atan(x) },
        "ln" to { x -> ln(x) },
        "log" to { x -> log10(x) },
        "log10" to { x -> log10(x) },
        "log2" to { x -> log2(x) },
        "abs" to { x -> abs(x) },
        "exp" to { x -> exp(x) },
        "floor" to { x -> floor(x) },
        "ceil" to { x -> ceil(x) },
        "round" to { x -> round(x) },
    )

    private val CONSTANTS: Map<String, Double> = mapOf(
        "pi" to PI,
        "e" to E,
        "tau" to 2 * PI,
        "phi" to (1 + sqrt(5.0)) / 2,
    )

    private val OPERATOR_HINT = Regex("""[-+*/^%!()]|\bmod\b|\bof\b""")
    private val WORD = Regex("""[a-z][a-z0-9]*""")
    private val THOUSANDS = Regex("""(?<=\d),(?=\d{3}(?!\d))""")
    private val TIMES_X = Regex("""(?<=[\d)])\s*x\s*(?=[\d(])""")

    /** True when [input] plausibly is an arithmetic expression (not just a number or a word). */
    fun looksLikeMath(input: String): Boolean {
        val s = normalize(input)
        if (s.isEmpty() || s.toDoubleOrNull() != null) return false
        val hasNumber = s.any { it.isDigit() } || WORD.findAll(s).any { it.value in CONSTANTS }
        if (!hasNumber) return false
        val hasOperator = OPERATOR_HINT.containsMatchIn(s) || WORD.findAll(s).any { it.value in FUNCTIONS }
        if (!hasOperator) return false
        return WORD.findAll(s).all { it.value in FUNCTIONS || it.value in CONSTANTS || it.value == "mod" || it.value == "of" }
    }

    /** Evaluates [input], returning null when it is not a valid, finite expression. */
    fun evaluate(input: String): Double? {
        val s = normalize(input)
        if (s.isEmpty()) return null
        return try {
            val parser = Parser(s)
            val value = parser.expression()
            if (!parser.atEnd() || value.isNaN() || value.isInfinite()) null else value
        } catch (e: RuntimeException) {
            null
        }
    }

    fun format(value: Double): String {
        if (value == 0.0) return "0"
        val a = abs(value)
        val bd = BigDecimal(value)
        return if (a >= 1e15 || a < 1e-9) {
            bd.round(MathContext(10)).stripTrailingZeros().toString()
        } else {
            bd.round(MathContext(12)).stripTrailingZeros().toPlainString()
        }
    }

    internal fun normalize(input: String): String {
        var s = input.trim().lowercase()
        s = s.removePrefix("=").removeSuffix("=").trim()
        s = s.replace('×', '*').replace('÷', '/').replace('−', '-').replace('–', '-')
            .replace("√", "sqrt").replace("π", "pi").replace("**", "^")
        s = THOUSANDS.replace(s, "")
        s = TIMES_X.replace(s, "*")
        return s
    }

    private class Parser(private val s: String) {
        private var pos = 0

        private fun skipSpaces() {
            while (pos < s.length && s[pos].isWhitespace()) pos++
        }

        private fun peek(): Char {
            skipSpaces()
            return if (pos < s.length) s[pos] else '\u0000'
        }

        private fun eat(c: Char): Boolean {
            if (peek() == c) {
                pos++
                return true
            }
            return false
        }

        private fun eatWord(word: String): Boolean {
            skipSpaces()
            if (!s.startsWith(word, pos)) return false
            val end = pos + word.length
            if (end < s.length && s[end].isLetterOrDigit()) return false
            pos = end
            return true
        }

        fun atEnd(): Boolean = peek() == '\u0000'

        fun expression(): Double {
            var v = term()
            while (true) {
                v = when {
                    eat('+') -> v + term()
                    eat('-') -> v - term()
                    else -> return v
                }
            }
        }

        private fun term(): Double {
            var v = unary()
            while (true) {
                v = when {
                    eat('*') -> v * unary()
                    eat('/') -> v / unary()
                    eatWord("mod") -> {
                        val d = unary()
                        v - d * floor(v / d)
                    }
                    // Implicit multiplication: 2pi, 3(4+1), 2sqrt(9)
                    peek() == '(' || (peek().isLetter() && !lookingAtWord("of")) -> v * unary()
                    else -> return v
                }
            }
        }

        private fun lookingAtWord(word: String): Boolean {
            skipSpaces()
            return s.startsWith(word, pos)
        }

        private fun unary(): Double = when {
            eat('-') -> -unary()
            eat('+') -> unary()
            else -> power()
        }

        private fun power(): Double {
            val base = postfix()
            return if (eat('^')) base.pow(unary()) else base
        }

        private fun postfix(): Double {
            var v = primary()
            while (true) {
                v = when {
                    eat('!') -> factorial(v)
                    eat('%') -> if (eatWord("of")) v / 100 * unary() else v / 100
                    else -> return v
                }
            }
        }

        private fun primary(): Double {
            val c = peek()
            if (eat('(')) {
                val v = expression()
                // Be forgiving about a missing closing parenthesis at the very end.
                if (!eat(')') && !atEnd()) throw IllegalArgumentException("Expected )")
                return v
            }
            if (c.isDigit() || c == '.') return number()
            if (c.isLetter()) {
                val name = identifier()
                CONSTANTS[name]?.let { return it }
                val fn = FUNCTIONS[name] ?: throw IllegalArgumentException("Unknown: $name")
                return fn(if (peek() == '(') primary() else power())
            }
            throw IllegalArgumentException("Unexpected '$c'")
        }

        private fun identifier(): String {
            val start = pos
            while (pos < s.length && s[pos].isLetter()) pos++
            // Allow trailing digits only for known names such as log2 / log10.
            val letters = s.substring(start, pos)
            var end = pos
            while (end < s.length && s[end].isDigit()) end++
            val withDigits = s.substring(start, end)
            if (end > pos && withDigits in FUNCTIONS) {
                pos = end
                return withDigits
            }
            return letters
        }

        private fun number(): Double {
            val start = pos
            while (pos < s.length && (s[pos].isDigit() || s[pos] == '.')) pos++
            if (pos + 1 < s.length && s[pos] == 'e') {
                val next = s[pos + 1]
                val signed = (next == '-' || next == '+') && pos + 2 < s.length && s[pos + 2].isDigit()
                if (next.isDigit() || signed) {
                    pos += if (signed) 3 else 2
                    while (pos < s.length && s[pos].isDigit()) pos++
                }
            }
            return s.substring(start, pos).toDouble()
        }

        private fun factorial(v: Double): Double {
            if (v < 0 || v != floor(v) || v > 170) return Double.NaN
            var r = 1.0
            for (i in 2..v.toInt()) r *= i
            return r
        }
    }
}
