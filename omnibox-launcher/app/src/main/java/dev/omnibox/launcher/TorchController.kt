package dev.omnibox.launcher

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper

/** Flashlight on/off without any permission, via CameraManager torch mode. */
class TorchController(context: Context) {
    private val cameraManager = context.getSystemService(CameraManager::class.java)
    private val cameraId: String? = try {
        cameraManager?.cameraIdList?.firstOrNull { id ->
            cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        }
    } catch (e: Exception) {
        null
    }

    @Volatile
    var isOn = false
        private set

    private val callback = object : CameraManager.TorchCallback() {
        override fun onTorchModeChanged(id: String, enabled: Boolean) {
            if (id == cameraId) isOn = enabled
        }
    }

    val available: Boolean get() = cameraId != null

    init {
        if (cameraId != null) cameraManager?.registerTorchCallback(callback, Handler(Looper.getMainLooper()))
    }

    fun set(on: Boolean): Boolean = try {
        val id = cameraId ?: return false
        cameraManager?.setTorchMode(id, on)
        true
    } catch (e: Exception) {
        false
    }

    fun release() {
        cameraManager?.unregisterTorchCallback(callback)
    }
}
