# AIRI 猫猫配置备份

> 自动备份时间: 2026-07-14
> 原始数据: `C:\Users\Administrator\AppData\Roaming\@proj-airi\stage-tamagotchi\`
> 本地备份: `airi-config-backup\`

## LLM (大语言模型)

| 设置 | 值 |
|------|-----|
| Provider | **DeepSeek** |
| Model | **deepseek-v4-flash** |

## 语音 (TTS)

| 设置 | 值 |
|------|-----|
| Provider | **OpenAI-compatible TTS** |
| Base URL | `http://127.0.0.1:9881/v1/` |
| Voice | `ja` (小野寺小咲) |
| 后端 | GPT-SoVITS v2ProPlus @ `I:\GPT-SoVITS\` |

## 视觉 (Vision)

| 设置 | 值 |
|------|-----|
| Provider | **豆包 (Volcengine ARK)** |
| API Key | `ark-xxx` (从火山方舟控制台获取) |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| Endpoint ID (视觉/对话) | `ep-20260715012304-n6p8t` |
| Seedream Endpoint (画图) | `ep-20260715013539-k65t4` |

## 角色模型

| 设置 | 值 |
|------|-----|
| 模型 | VRM (通过 IndexedDB 存储) |
| 模型 UUID | `54024c2f-9817-4ee1-a753-bb7615f92b8c` (最新) |

## 服务器

| 设置 | 值 |
|------|-----|
| Hostname | `127.0.0.1` |
| Auth Token | `790ff0ef-4592-4310-902f-cbf8aa2deca8` |

## 恢复方法

如果设置丢失，关闭桌宠后运行：

```bash
cp -r airi-config-backup/* "$APPDATA/@proj-airi/stage-tamagotchi/"
```

然后重启桌宠。

## 启动命令

```bash
# 终端启动
bash run_pet.bat

# 或双击
C:\Users\Administrator\airi-app\run_pet.bat
```
