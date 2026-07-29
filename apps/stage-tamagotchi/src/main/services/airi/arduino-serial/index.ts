import type { SerialPort } from 'serialport'

import { errorMessageFrom } from '@moeru/std'

const LOG_PREFIX = '[ArduinoSerial]'

/** COM port to connect to. Reads from AIRI_ARDUINO_PORT env var, defaults to COM5. */
const DEFAULT_PORT = 'COM5'
const BAUD_RATE = 115200

/**
 * Arduino Leonardo R3 serial bridge for hardware-level keyboard/mouse injection.
 *
 * Sends JSON commands over Serial to an ATmega32U4 running the AIRI game control
 * firmware. The Arduino acts as a genuine USB HID device, sending keystrokes and
 * mouse events that are indistinguishable from physical hardware — bypassing
 * game anti-cheat systems that block software-level injection.
 *
 * Protocol (one JSON command per line, \\n delimited):
 *   {"type":"key","key":"w","action":"tap"}
 *   {"type":"key","key":"space","action":"press"}
 *   {"type":"mouse","action":"move","x":10,"y":0}
 *   {"type":"mouse","action":"click","btn":"left"}
 *
 * Call stack:
 *
 * renderer gameControl tool
 *   -> ipcMain.handle('arduino:key' / 'arduino:mouse-move' / ...)
 *     -> ArduinoSerialService.sendKey / sendMouseMove / sendMouseClick
 *       -> SerialPort.write(JSON + '\\n')
 *         -> Arduino firmware → USB HID → game receives input
 */
export class ArduinoSerialService {
  private port: SerialPort | null = null
  private connected = false
  private portPath: string

  constructor(portPath?: string) {
    this.portPath = portPath ?? process.env.AIRI_ARDUINO_PORT ?? DEFAULT_PORT
  }

  /**
   * Open the serial connection to the Arduino.
   * Resolves once the port is open and ready, or rejects with a descriptive error
   * if the port is unavailable.
   */
  async open(): Promise<void> {
    if (this.connected) {
      console.info(`${LOG_PREFIX} already connected to ${this.portPath}`)
      return
    }

    // Dynamic import so serialport's native module is only loaded when needed
    const { SerialPort } = await import('serialport')

    return new Promise((resolve, reject) => {
      try {
        this.port = new SerialPort({
          path: this.portPath,
          baudRate: BAUD_RATE,
          autoOpen: false,
        })

        this.port.on('error', (err) => {
          this.connected = false
          console.error(`${LOG_PREFIX} port error:`, errorMessageFrom(err))
        })

        this.port.on('close', () => {
          this.connected = false
          console.info(`${LOG_PREFIX} port closed: ${this.portPath}`)
        })

        this.port.open((err) => {
          if (err) {
            this.port = null
            this.connected = false
            reject(new Error(`Failed to open ${this.portPath}: ${errorMessageFrom(err)}`))
            return
          }
          this.connected = true
          console.info(`${LOG_PREFIX} connected to ${this.portPath} at ${BAUD_RATE} baud`)
          resolve()
        })
      }
      catch (err) {
        reject(new Error(`Failed to create serial port: ${errorMessageFrom(err)}`))
      }
    })
  }

  /**
   * Close the serial connection. Safe to call even if not connected.
   */
  async close(): Promise<void> {
    if (!this.port || !this.connected) {
      this.connected = false
      return
    }

    return new Promise((resolve) => {
      this.port!.close((err) => {
        if (err) {
          console.error(`${LOG_PREFIX} error closing port:`, errorMessageFrom(err))
        }
        this.port = null
        this.connected = false
        console.info(`${LOG_PREFIX} disconnected`)
        resolve()
      })
    })
  }

  /** Whether the serial port is currently open and connected. */
  get isConnected(): boolean {
    return this.connected && this.port !== null
  }

  /**
   * Send a key command to the Arduino.
   *
   * @param key - Key name (e.g. "w", "space", "enter", "esc", "up", "down", "left", "right", ...)
   * @param action - "tap" (press+release), "press" (hold), or "release"
   */
  sendKey(key: string, action: 'tap' | 'press' | 'release'): void {
    if (!this.isConnected || !this.port) {
      throw new Error('Arduino not connected')
    }
    const cmd = JSON.stringify({ type: 'key', key, action }) + '\n'
    this.port.write(cmd)
    console.info(`${LOG_PREFIX} key: ${key} ${action}`)
  }

  /**
   * Send a relative mouse move command to the Arduino.
   *
   * @param x - Horizontal delta in pixels
   * @param y - Vertical delta in pixels
   */
  sendMouseMove(x: number, y: number): void {
    if (!this.isConnected || !this.port) {
      throw new Error('Arduino not connected')
    }
    const cmd = JSON.stringify({ type: 'mouse', action: 'move', x, y }) + '\n'
    this.port.write(cmd)
    console.info(`${LOG_PREFIX} mouse move: (${x}, ${y})`)
  }

  /**
   * Send a mouse click command to the Arduino.
   *
   * @param button - "left", "right", or "middle"
   */
  sendMouseClick(button: 'left' | 'right' | 'middle'): void {
    if (!this.isConnected || !this.port) {
      throw new Error('Arduino not connected')
    }
    const cmd = JSON.stringify({ type: 'mouse', action: 'click', btn: button }) + '\n'
    this.port.write(cmd)
    console.info(`${LOG_PREFIX} mouse click: ${button}`)
  }
}

/** Singleton instance. Created lazily and reused across the app. */
let instance: ArduinoSerialService | null = null

/**
 * Get the singleton ArduinoSerialService instance.
 * The port is not opened until `open()` is called.
 */
export function getArduinoSerialService(): ArduinoSerialService {
  if (!instance) {
    instance = new ArduinoSerialService()
  }
  return instance
}
