
*本插件源自于github.com/dp24678/WebPageCatcher，由AutoClaw改写，纯Chrome插件离线可用。
在此向上游插件作者致以敬意

# 网页长截图 & PDF — Chrome 扩展

把 github.com/dp24678/WebPageCatcher 的核心功能（网页整页截图、网页转 PDF）
做成浏览器扩展，不需要任何服务器，也不发任何网络请求。

## 安装（Load unpacked）

1. 解压（如果拿到的是 zip）或直接使用 `webpage-catcher-ext` 文件夹
2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 右上角打开「开发者模式」
4. 点左上角「加载已解压的扩展程序」，选中 `webpage-catcher-ext` 文件夹
5. 工具栏出现图标，点开即可用

- 想截 `file://` 本地网页：在扩展管理页给本扩展开启「允许访问文件网址」
- 图标上右键 →「固定」可以一直显示在工具栏

## 使用

- 打开任意网页 → 点扩展图标
- 「📷 整页长截图（PNG）」：滚动触发懒加载后，整页（含视口外部分）截成一张 PNG
- 「📄 导出 PDF」：整页打印为 PDF（带背景色）
- 保存对话框里自动填好 `网页标题_时间戳` 文件名
- 超长页面（>16000px）会自动等比缩小，避免超出 Chrome 截图上限而失败
- 截图/导 PDF 前会自动临时隐藏 `position: fixed / sticky` 的悬浮元素
  （如公众号文章底部“赞/分享/在看”栏），避免它们横在正文中间，截完自动还原

## 工作原理

通过 `chrome.debugger`（Chrome DevTools Protocol）调用 Chrome 内置的
`Page.captureScreenshot`（captureBeyondViewport）和 `Page.printToPDF`。
附加调试器时会短暂出现「正在调试此浏览器」提示条，命令完成后立即分离。

## 隐私声明

- 无任何网络请求、无远程脚本、无数据上报，可断网使用
- 生成的文件只经过你的本地保存对话框
- 权限用途：`activeTab`（当前标签页）、`debugger`（调用整页截图/打印接口）、`downloads`（弹保存框）

## 与 WebPageCatcher 对比

|-------|     WebPageCatcher（Flask 服务）     |     本扩展    |
|-------|--------------------------------------|---------------|
| 依赖   | Python + pyppeteer + 自建服务        | 无            |
| 暴露面 | 0.0.0.0 端口、/runcode 可执行任意代码 | 无端口、无服务  |
| 联网   | 目标站 + 可选第三方代理               | 无             |
