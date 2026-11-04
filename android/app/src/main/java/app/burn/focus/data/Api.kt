package app.burn.focus.data

import app.burn.focus.domain.Wire
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

sealed interface ApiResult {
  data class Ok(val code: Int, val body: JsonElement?) : ApiResult
  data class Http(val code: Int, val body: JsonElement?) : ApiResult {
    val message: String get() = Wire.errorMessage(body) ?: "HTTP $code"
  }
  data class Net(val message: String) : ApiResult
}

/**
 * Tiny JSON client for our own backend (never the Meta API: the key stays on the server).
 * The profile id goes in x-device-id; a signed-in phone also sends its session token.
 */
class Api(private val base: String, private val deviceId: String, private val token: String? = null) {

  suspend fun get(path: String, readTimeoutMs: Int = 8_000): ApiResult = call("GET", path, null, readTimeoutMs)

  suspend fun post(path: String, body: JsonObject, readTimeoutMs: Int = 8_000): ApiResult =
    call("POST", path, body.toString(), readTimeoutMs)

  suspend fun put(path: String, body: JsonObject, readTimeoutMs: Int = 8_000): ApiResult =
    call("PUT", path, body.toString(), readTimeoutMs)

  private suspend fun call(method: String, path: String, body: String?, readTimeoutMs: Int): ApiResult =
    withContext(Dispatchers.IO) {
      var conn: HttpURLConnection? = null
      try {
        conn = (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
          requestMethod = method
          connectTimeout = 3_500
          readTimeout = readTimeoutMs
          setRequestProperty("Accept", "application/json")
          setRequestProperty("x-device-id", deviceId)
          if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
          if (body != null) {
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
          }
        }
        if (body != null) conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val json = Wire.parse(text)
        if (code in 200..299) ApiResult.Ok(code, json) else ApiResult.Http(code, json)
      } catch (e: IOException) {
        ApiResult.Net(e.message ?: e.javaClass.simpleName)
      } catch (e: IllegalArgumentException) {
        ApiResult.Net("Bad backend URL")
      } catch (e: SecurityException) {
        ApiResult.Net("No network permission")
      } finally {
        conn?.disconnect()
      }
    }
}
