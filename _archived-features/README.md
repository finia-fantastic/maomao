# Archived Features

暂存暂时不需要的功能模块。每个目录包含该功能的完整代码 + 恢复说明。

## 结构

```
_archived-features/
├── README.md           ← 本文件
├── game-control/       ← 示例
├── hand-props/         ← 示例
├── drawing-workstation/← 示例
└── ...
```

## 恢复方法

1. 把目录下的文件复制回原位置
2. 取消 `// ARCHIVED:` 注释的 import 和注册代码
3. 运行 `pnpm typecheck` 确认

## 当前暂存的功能

（你告诉我哪些功能暂时不需要，我帮你移到这里）
