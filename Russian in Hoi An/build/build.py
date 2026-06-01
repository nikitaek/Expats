#!/usr/bin/env python3
"""Build the Hoi An guide from Markdown source files."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


BUILD_DIR = Path(__file__).resolve().parent
GUIDE_DIR = BUILD_DIR.parent
MANIFEST = BUILD_DIR / "build.yml"

QUESTION_START_RE = re.compile(r"^(\d+)\.\s+(.*)$")
ANSWER_LINE_RE = re.compile(r"^\s*Ответ:\s*(.*)$", re.IGNORECASE)


def parse_manifest(path: Path) -> Dict[str, object]:
    data: Dict[str, object] = {}
    current_list: str | None = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue

        if line.startswith("  - "):
            if current_list is None:
                raise ValueError(f"List item without a key in {path}: {line}")
            data.setdefault(current_list, [])
            data[current_list].append(line[4:].strip())  # type: ignore[union-attr]
            continue

        if ":" not in line:
            raise ValueError(f"Unsupported manifest line in {path}: {line}")

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not value:
            data[key] = []
            current_list = key
        else:
            data[key] = value
            current_list = None

    if "title" not in data:
        raise ValueError("build.yml must define a title.")
    if "source" not in data or not data["source"]:
        raise ValueError("build.yml must define at least one source file.")

    return data


def strip_source_only_lines(lines: List[str]) -> List[str]:
    result: List[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[←"):
            continue
        if "categories.md" in stripped and stripped.startswith("Рабочие материалы"):
            continue
        result.append(line)
    return result


def keep_intro_only(lines: List[str]) -> List[str]:
    heading_count = 0
    result: List[str] = []

    for line in lines:
        if line.startswith("## "):
            heading_count += 1
            if heading_count > 1:
                break
        result.append(line)

    return result


def parse_questions(body: str) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for line in body.splitlines():
        match = QUESTION_START_RE.match(line)
        if match:
            if current is not None:
                questions.append(current)
            number = int(match.group(1))
            rest = match.group(2).strip()
            if "Ответ:" in rest:
                question_text, _, answer_text = rest.partition("Ответ:")
                current = {
                    "number": number,
                    "question": question_text.strip(),
                    "answer": answer_text.strip(),
                }
            else:
                current = {"number": number, "question": rest, "answer": ""}
            continue

        answer_match = ANSWER_LINE_RE.match(line)
        if answer_match and current is not None:
            current["answer"] = answer_match.group(1).strip()
            continue

        if current is not None and line.strip() and current["answer"]:
            current["answer"] = f"{current['answer']} {line.strip()}"

    if current is not None:
        questions.append(current)

    return questions


def parse_category_source(path: Path) -> Dict[str, Any]:
    lines = strip_source_only_lines(path.read_text(encoding="utf-8").splitlines())
    title = path.stem.replace("-", " ")
    body_lines: List[str] = []

    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        lines = lines[1:]

    for line in lines:
        if line.strip():
            body_lines.append(line)

    return {
        "slug": path.stem,
        "title": title,
        "source": str(path.relative_to(GUIDE_DIR)),
        "questions": parse_questions("\n".join(body_lines)),
    }


def parse_intro_source(path: Path, guide_title: str) -> Dict[str, Any]:
    lines = strip_source_only_lines(path.read_text(encoding="utf-8").splitlines())
    lines = keep_intro_only(lines)

    if lines and lines[0].startswith("# "):
        heading = lines[0][2:].strip()
        if heading == guide_title:
            lines = lines[1:]

    intro_title = "О проекте"
    paragraphs: List[str] = []
    current_heading: Optional[str] = None
    buffer: List[str] = []

    def flush_paragraph() -> None:
        nonlocal buffer
        if buffer:
            paragraphs.append("\n".join(buffer).strip())
            buffer = []

    for line in lines:
        if line.startswith("## "):
            flush_paragraph()
            current_heading = line[3:].strip()
            intro_title = current_heading or intro_title
            continue
        if line.strip() == "---":
            flush_paragraph()
            continue
        if line.strip():
            buffer.append(line.strip())
        else:
            flush_paragraph()

    flush_paragraph()

    return {
        "title": intro_title,
        "paragraphs": paragraphs,
    }


def build_document(manifest: Dict[str, object]) -> Dict[str, Any]:
    title = str(manifest["title"])
    sources = [GUIDE_DIR / source for source in manifest["source"]]  # type: ignore[index]

    missing = [source for source in sources if not source.exists()]
    if missing:
        missing_text = "\n".join(f"- {path.relative_to(GUIDE_DIR)}" for path in missing)
        raise FileNotFoundError(f"Manifest references missing files:\n{missing_text}")

    intro: Optional[Dict[str, Any]] = None
    categories: List[Dict[str, Any]] = []

    for source in sources:
        if source.name == "overview.md":
            intro = parse_intro_source(source, title)
            continue
        if source.parent.name == "categories":
            categories.append(parse_category_source(source))
            continue
        raise ValueError(f"Unsupported source file in manifest: {source}")

    if intro is None:
        intro = {"title": "О проекте", "paragraphs": []}

    return {
        "title": title,
        "language": manifest.get("language", "ru"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "intro": intro,
        "categories": categories,
    }


def format_question_markdown(question: Dict[str, Any]) -> str:
    lines = [f"{question['number']}. {question['question']}", ""]
    answer = str(question.get("answer", "")).strip()
    if answer:
        lines.append(f"Ответ: {answer}")
        lines.append("")
    return "\n".join(lines)


def render_markdown(document: Dict[str, Any]) -> str:
    parts = [f"# {document['title']}", ""]

    intro = document["intro"]
    parts.append(f"## {intro['title']}")
    parts.append("")
    for paragraph in intro["paragraphs"]:
        parts.append(paragraph)
        parts.append("")

    for category in document["categories"]:
        parts.append("---")
        parts.append("")
        parts.append(f"## {category['title']}")
        parts.append("")
        for question in category["questions"]:
            parts.append(format_question_markdown(question))

    return "\n".join(parts).strip() + "\n"


def resolve_output_dir(manifest: Dict[str, object]) -> Path:
    return GUIDE_DIR / str(manifest.get("output_dir", "dist"))


def pick_cyrillic_font_name() -> str:
    font_files = {
        "Arial": [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
        ],
        "Arial Unicode MS": [
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
        ],
        "DejaVu Sans": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    }
    for font_name, paths in font_files.items():
        if any(Path(path).exists() for path in paths):
            return font_name
    return "Arial"


def write_pdf_header() -> Path:
    font_name = pick_cyrillic_font_name()
    header_path = BUILD_DIR / ".pdf-header.generated.tex"
    header_path.write_text(
        "\\usepackage{fontspec}\n"
        "\\usepackage{polyglossia}\n"
        "\\setdefaultlanguage{russian}\n"
        f"\\setmainfont{{{font_name}}}[Scale=0.95]\n",
        encoding="utf-8",
    )
    return header_path


def run_pandoc(
    pandoc: str,
    input_md: Path,
    output_path: Path,
    language: str,
    extra_args: List[str],
) -> None:
    command = [
        pandoc,
        str(input_md),
        "--metadata",
        f"lang={language}",
        "--output",
        str(output_path),
        *extra_args,
    ]
    print(" ".join(command))
    subprocess.run(command, check=True)


def export_pdf(pandoc: str, input_md: Path, output_path: Path, language: str) -> None:
    header = write_pdf_header()
    engines = ["xelatex", "lualatex"]
    if shutil.which("tectonic"):
        engines.append("tectonic")
    last_error: Optional[subprocess.CalledProcessError] = None

    for engine in engines:
        if shutil.which(engine) is None and engine != "tectonic":
            continue
        args = [
            "--to",
            "pdf",
            "--pdf-engine",
            engine,
            "--include-in-header",
            str(header),
        ]
        try:
            run_pandoc(pandoc, input_md, output_path, language, args)
            return
        except subprocess.CalledProcessError as error:
            last_error = error

    raise RuntimeError(
        "PDF export failed. Install a LaTeX engine with Cyrillic support:\n"
        "  brew install pandoc\n"
        "  brew install --cask basictex\n"
        "Then rerun: make build"
    ) from last_error


def export_publish_formats(
    manifest: Dict[str, object],
    guide_md: Path,
    output_dir: Path,
    require_pandoc: bool,
) -> None:
    language = str(manifest.get("language", "ru"))
    pandoc = shutil.which("pandoc")

    if pandoc is None:
        message = "Pandoc is not installed. Install it with: brew install pandoc"
        if require_pandoc:
            raise RuntimeError(message)
        print(message, file=sys.stderr)
        return

    run_pandoc(
        pandoc,
        guide_md,
        output_dir / "guide.html",
        language,
        ["--to", "html5", "--standalone"],
    )
    run_pandoc(
        pandoc,
        guide_md,
        output_dir / "guide.docx",
        language,
        ["--to", "docx"],
    )
    export_pdf(pandoc, guide_md, output_dir / "guide.pdf", language)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Markdown guide outputs.")
    parser.add_argument(
        "--require-pandoc",
        action="store_true",
        help="Fail if Pandoc is missing instead of only building Markdown and JSON.",
    )
    args = parser.parse_args()

    manifest = parse_manifest(MANIFEST)
    output_dir = resolve_output_dir(manifest)
    output_dir.mkdir(parents=True, exist_ok=True)

    document = build_document(manifest)
    guide_md = output_dir / "guide.md"
    guide_md.write_text(render_markdown(document), encoding="utf-8")

    guide_json = output_dir / "guide.json"
    guide_json.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    export_publish_formats(manifest, guide_md, output_dir, require_pandoc=args.require_pandoc)

    print(f"Built {output_dir.relative_to(GUIDE_DIR)}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
