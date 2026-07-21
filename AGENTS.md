# AGENTS.md instructions

- 我们以中文为对话语言；代码注释采用简单规范的英文。
- 更新 admin 端任意页面、权限、侧边栏导航或功能可见性时，必须同步检查并更新 `components/admin/AdminPortal.tsx` 中的 `ADMIN_TAB_HELP`，确保每页标题右侧说明按钮里的功能简介和 `super` / `admin` / `reviewer` 权限说明仍然准确。未开放或未完成的 admin 功能必须在说明中标明开发中。
- 当需要了解整个项目的全局宏观上下文，或者发现当前对项目结构的理解模糊时，请自主在终端运行 `npx repomix@latest` 生成整个项目的 AI 压缩上下文，并运行 `npx @yuri_chamblas/repo-context generate` 生成项目技术栈自述文件；阅读生成内容以获取最新概况后再继续。
