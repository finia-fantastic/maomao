# Arduino 硬件游戏控制

AI 通过 Arduino Pro Micro 发送真实 USB 键盘/鼠标信号，绕过游戏反作弊。

## 硬件
- **Arduino Pro Micro**（ATmega32U4，带原生 USB HID）~20 元
- Micro USB 数据线

## 安装步骤

### 1. 烧录固件
1. 安装 [Arduino IDE](https://www.arduino.cc/en/software)
2. 打开 `arduino_firmware.ino`
3. 选择开发板：Tools → Board → Arduino Leonardo (或 Pro Micro)
4. 选择端口：Tools → Port → COMx
5. 点击 Upload

### 2. 安装 AIRI 串口模块
```bash
cd C:\Users\Administrator\airi-app
pnpm -F @proj-airi/stage-tamagotchi add serialport
```

### 3. 连接
1. 插上 Arduino
2. 在设备管理器里找到 COM 端口号（如 COM3）
3. 告诉 AIRI COM 端口号

### 4. 使用
对猫猫说 "用硬件按W" → AI → AIRI → 串口 → Arduino → 按键 → 游戏收到

## 协议
串口 115200 baud, JSON 格式，每行一条命令：
```json
{"type":"key","key":"w","action":"tap"}
{"type":"key","key":"space","action":"press"}
{"type":"mouse","action":"move","x":10,"y":0}
{"type":"mouse","action":"click","btn":"left"}
```

## 延迟
串口→Arduino→按键：~3ms（硬件层，几乎为 0）
总延迟取决于 AI 思考时间（3-5 秒）
