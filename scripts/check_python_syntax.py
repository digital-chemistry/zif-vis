from pathlib import Path


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    python_files = sorted(project_root.joinpath("project").rglob("*.py"))

    for path in python_files:
        source = path.read_text(encoding="utf-8")
        compile(source, str(path), "exec")

    print(f"Syntax OK for {len(python_files)} Python files.")


if __name__ == "__main__":
    main()
