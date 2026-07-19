#!/usr/bin/env python3
import stat
import sys
import zipfile
from pathlib import Path


def iter_files(root: Path, entries: list[str]):
    for entry in entries:
        path = root / entry
        candidates = path.rglob("*") if path.is_dir() else [path]
        for candidate in candidates:
            if candidate.is_dir():
                continue
            relative = candidate.relative_to(root)
            if ".DS_Store" in relative.parts or "node_modules" in relative.parts:
                continue
            if candidate.is_symlink():
                raise RuntimeError(f"Refusing to package symlink: {relative}")
            yield relative


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: create_zip.py OUTPUT ENTRY [ENTRY ...]")
    root = Path.cwd().resolve()
    output = Path(sys.argv[1]).resolve()
    entries = sys.argv[2:]
    files = sorted(set(iter_files(root, entries)), key=lambda value: value.as_posix())
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            source = root / relative
            info = zipfile.ZipInfo(relative.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            mode = source.stat().st_mode
            info.external_attr = (stat.S_IMODE(mode) & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())


if __name__ == "__main__":
    main()
