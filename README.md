# action-gh-release

GitHub Action：创建 GitHub Release 并上传构建产物。功能对齐 [softprops/action-gh-release](https://github.com/softprops/action-gh-release)，
**零依赖**（Node 24 内置 fetch 实现，无 node_modules），可直接 `uses:` 引用。

## 功能

- ✅ 创建 / 更新 Release（tag 已存在时按策略更新 body）
- ✅ 上传多个产物（支持 glob：`**/*.img.gz`、`dist/*.tar.gz`）
- ✅ draft / prerelease / make_latest 标记
- ✅ 自动生成 Release Notes（`generate_release_notes`）
- ✅ body / body_path / append_body 文本处理
- ✅ fail_on_unmatched_files 严格模式
- ✅ 输出 url / id / upload_url / browser_download_url / assets
- ✅ 内置重试（限流 429 / 5xx 自动退避）

## 使用

```yaml
- name: Release
  uses: MinimaxFlora/action-gh-release@v1
  with:
    files: |
      dist/**/*.tar.gz
      dist/**/*.img.gz
    tag_name: v1.0.0        # 缺省时取当前 tag push 的 ref
    name: v1.0.0
    body: |
      ## 更新内容
      - 功能 A
      - 修复 B
    draft: false
    prerelease: false
```

## 输入参数

| 参数 | 必填 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `files` | ❌ | *(空)* | 要上传的产物，**换行分隔的 glob** |
| `name` | ❌ | tag 名 | Release 名称 |
| `body` | ❌ | *(空)* | Release 正文（Markdown） |
| `body_path` | ❌ | *(空)* | 从文件读取正文（优先级高于 `body`） |
| `tag_name` | ❌ | 当前 tag ref | Release 的 tag（`workflow_dispatch` 触发时必填） |
| `target_commitish` | ❌ | 当前 commit | tag 指向的 commit |
| `draft` | ❌ | `false` | 是否为草稿 |
| `prerelease` | ❌ | `false` | 是否为预发布 |
| `make_latest` | ❌ | `true` | 是否标记为最新：`true` / `false` / `legacy` |
| `generate_release_notes` | ❌ | `false` | 自动生成 Release Notes |
| `discussion_category_name` | ❌ | *(空)* | Release 讨论分类 |
| `append_body` | ❌ | `false` | 追加到已有 body（需开启更新策略） |
| `update_release_body` | ❌ | `false` | tag 已存在时更新 body |
| `update_release_body_if_draft` | ❌ | `false` | tag 已存在且为草稿时更新 body |
| `fail_on_unmatched_files` | ❌ | `false` | glob 无匹配文件时是否失败 |
| `replaces_artifacts` | ❌ | `true` | 上传前删除同名旧资产（重复构建不再 422） |
| `remove_artifacts` | ❌ | `false` | 上传前删除 release 全部旧资产 |
| `artifact_errors_fail_build` | ❌ | `false` | 资产上传失败时是否失败构建（默认仅警告） |
| `skip_if_release_exists` | ❌ | `false` | tag 已有 release 时直接跳过 |
| `token` | ❌ | `github.token` | GitHub Token（需 `contents: write` 权限） |
| `repository` | ❌ | 当前仓库 | 目标仓库 `owner/repo` |

## 输出

| 输出 | 说明 |
| ---- | ---- |
| `url` | Release 的 GitHub 页面 URL |
| `id` | Release ID |
| `upload_url` | 资产上传 URL |
| `browser_download_url` | 浏览器下载 URL |
| `assets` | 已上传资产 JSON 数组 |

## 与 softprops/action-gh-release 的差异

- 零依赖（原版使用 `@actions/core` / `@actions/glob` 并打包 `dist`）
- 使用 Node 24 内置 `fetch`，无需 `ncc` 打包步骤
- glob 支持 `*` / `**` / `?` / `[abc]`（覆盖常见用法）

## 开发与测试

```bash
node --check index.js     # 语法检查
# 本地模拟（需要真实 token 与目标仓库）：
INPUT_FILES='dist/*.tar.gz' INPUT_TAG_NAME=v1.0.0-test \
GITHUB_REPOSITORY=MinimaxFlora/action-gh-release \
GITHUB_TOKEN=xxx GITHUB_OUTPUT=/tmp/out.txt \
node index.js
```

## 许可

[MIT](LICENSE)
