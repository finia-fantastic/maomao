/**
 * AIRI Game Control — Arduino HID Firmware
 * =========================================
 * Receives commands over Serial (115200 baud) and translates them
 * into real USB keyboard/mouse events. The host PC sees this as a
 * genuine HID device — indistinguishable from a physical keyboard.
 *
 * Board: Arduino Pro Micro / Leonardo (ATmega32U4 with native USB HID)
 *
 * Protocol (one JSON command per line):
 *   {"type":"key","key":"w","action":"press"}      // press W
 *   {"type":"key","key":"w","action":"release"}    // release W
 *   {"type":"key","key":"w","action":"tap"}        // tap W once
 *   {"type":"mouse","action":"move","x":10,"y":0}  // move right 10px
 *   {"type":"mouse","action":"click","btn":"left"}  // left click
 *   {"type":"mouse","action":"click","btn":"right"} // right click
 *   {"type":"ping"}  → responds with {"status":"ok"}
 *
 * Upload: Arduino IDE → Select "Arduino Leonardo" or "Pro Micro" → Upload
 */

#include <Keyboard.h>
#include <Mouse.h>

void setup() {
  Serial.begin(115200);
  // Wait for Serial to be ready (important — don't start sending keys immediately)
  while (!Serial) { delay(10); }
  Keyboard.begin();
  Mouse.begin();
  Serial.println("{\"status\":\"ready\"}");
}

void loop() {
  if (Serial.available() > 0) {
    String raw = Serial.readStringUntil('\n');
    raw.trim();
    if (raw.length() == 0) return;

    // Parse simple JSON-like commands
    if (raw.indexOf("\"type\":\"ping\"") >= 0) {
      Serial.println("{\"status\":\"ok\"}");
      return;
    }

    if (raw.indexOf("\"type\":\"key\"") >= 0) {
      handleKeyCommand(raw);
      return;
    }

    if (raw.indexOf("\"type\":\"mouse\"") >= 0) {
      handleMouseCommand(raw);
      return;
    }
  }
}

void handleKeyCommand(String &cmd) {
  char key = 0;
  int kp = cmd.indexOf("\"key\":\"");
  if (kp >= 0) {
    key = cmd.charAt(kp + 7);
  }

  bool isPress = cmd.indexOf("\"action\":\"press\"") >= 0;
  bool isRelease = cmd.indexOf("\"action\":\"release\"") >= 0;
  bool isTap = cmd.indexOf("\"action\":\"tap\"") >= 0;

  // Map to special keys
  if (key == ' ') key = ' ';

  // Check for named keys
  String keyName = "";
  int knp = cmd.indexOf("\"key\":\"");
  if (knp >= 0) {
    int knEnd = cmd.indexOf("\"", knp + 7);
    keyName = cmd.substring(knp + 7, knEnd);
  }

  if (keyName == "space") { pressKey(' ', isPress, isRelease, isTap); return; }
  if (keyName == "enter") { pressKey(KEY_RETURN, isPress, isRelease, isTap); return; }
  if (keyName == "esc") { pressKey(KEY_ESC, isPress, isRelease, isTap); return; }
  if (keyName == "tab") { pressKey(KEY_TAB, isPress, isRelease, isTap); return; }
  if (keyName == "shift") { pressKey(KEY_LEFT_SHIFT, isPress, isRelease, isTap); return; }
  if (keyName == "ctrl") { pressKey(KEY_LEFT_CTRL, isPress, isRelease, isTap); return; }
  if (keyName == "alt") { pressKey(KEY_LEFT_ALT, isPress, isRelease, isTap); return; }
  if (keyName == "up") { pressKey(KEY_UP_ARROW, isPress, isRelease, isTap); return; }
  if (keyName == "down") { pressKey(KEY_DOWN_ARROW, isPress, isRelease, isTap); return; }
  if (keyName == "left") { pressKey(KEY_LEFT_ARROW, isPress, isRelease, isTap); return; }
  if (keyName == "right") { pressKey(KEY_RIGHT_ARROW, isPress, isRelease, isTap); return; }

  // Default: single character keys
  if (key != 0) {
    if (isPress || isTap) Keyboard.press(key);
    if (isTap) { delay(60); Keyboard.release(key); }
    if (isRelease) Keyboard.release(key);
  }
}

void pressKey(char k, bool press, bool release, bool tap) {
  if (press || tap) Keyboard.press(k);
  if (tap) { delay(60); Keyboard.release(k); }
  if (release) Keyboard.release(k);
}

void handleMouseCommand(String &cmd) {
  bool isMove = cmd.indexOf("\"action\":\"move\"") >= 0;
  bool isClick = cmd.indexOf("\"action\":\"click\"") >= 0;

  if (isMove) {
    int x = extractInt(cmd, "\"x\":");
    int y = extractInt(cmd, "\"y\":");
    Mouse.move(x, y);
  }

  if (isClick) {
    if (cmd.indexOf("\"left\"") >= 0) Mouse.click(MOUSE_LEFT);
    if (cmd.indexOf("\"right\"") >= 0) Mouse.click(MOUSE_RIGHT);
    if (cmd.indexOf("\"middle\"") >= 0) Mouse.click(MOUSE_MIDDLE);
  }
}

int extractInt(String &s, const char *key) {
  int pos = s.indexOf(key);
  if (pos < 0) return 0;
  pos += strlen(key);
  int end = s.indexOf(',', pos);
  if (end < 0) end = s.indexOf('}', pos);
  return s.substring(pos, end).toInt();
}
