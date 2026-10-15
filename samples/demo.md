---
title: 演示文档
---

# SmartMdReader 演示

这是一个用来检查渲染效果的示例文件。支持 **粗体**、*斜体*、~~删除线~~、`行内代码` 和 :rocket: emoji。

## 图片（相对路径）

![图标](../src/SmartMdReader/assets/app.ico)

## 代码高亮

```powershell
Get-ChildItem -Path C:\logs -Filter *.log |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -WhatIf
```

```nginx
server {
    listen 80;
    server_name example.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

```python
def hello(name: str) -> str:
    return f"你好，{name}"
```

## 表格

| 项目 | 状态 | 备注 |
|---|:---:|---|
| 右键打开 | ✅ | HKCU 注册 |
| 自动刷新 | ✅ | FileSystemWatcher |
| 深色模式 | ✅ | 跟随系统 |

## 任务列表

- [x] 渲染 Markdown
- [x] 目录导航
- [ ] Mermaid 图表

## 链接

- [跳到「表格」](#表格)
- [打开另一个文档](./other.md#第二节)
- [外部链接](https://github.com)

> 引用块：修改这个文件并保存，阅览器会自动刷新。

### 三级标题 A

内容 A

### 三级标题 B

内容 B

## 图表与公式

行内公式：$E = mc^2$，以及 $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$。

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

```mermaid
flowchart LR
    A[打开 .md] --> B{有改动?}
    B -- 是 --> C[保存]
    B -- 否 --> D[阅读]
```

```mermaid
sequenceDiagram
    用户->>SmartMdReader: 右键打开
    SmartMdReader-->>用户: 显示预览
```