# Build

Markdown in the parent folder is the source of truth. Run the build when you need fresh publishing files.

## Commands

From the repository root:

```sh
make build
```

Outputs go to `../dist/`:

- `guide.md` — combined Markdown (question and answer on separate lines)
- `guide.json` — structured document with intro, categories, questions, and answers
- `guide.html` — web / Yandex Disk (requires Pandoc)
- `guide.pdf` — PDF with Cyrillic fonts (requires Pandoc + XeLaTeX)
- `guide.docx` — Google Docs upload (requires Pandoc)

Install tooling on macOS:

```sh
brew install pandoc
brew install --cask basictex
```

After installing BasicTeX, restart the terminal so `xelatex` is on your PATH.

## Source format

Category files use numbered questions. Put the answer on the next line:

```markdown
1. Где обменять деньги с хорошим курсом

Ответ: В Хойане и Дананге выгоднее всего обычно обмен в ювелирных лавках...
```

You can also write `Ответ:` on the same line as the question; the build normalizes both forms.

## Publishing

1. Run `make build`.
2. Google Docs: upload `../dist/guide.docx`.
3. PDF / Yandex Disk: publish `../dist/guide.pdf`, `../dist/guide.docx`, or `../dist/guide.html`.
4. Apps and scripts: use `../dist/guide.json`.

## Manifest

Section order is defined in `build.yml`. Paths are relative to the guide folder.

Do not edit files in `../dist/` by hand; fix the source Markdown and rebuild.
