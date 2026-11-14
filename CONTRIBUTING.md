# Contributing to RasoiLink

Thank you for your interest in contributing to **RasoiLink**!

This project is built and maintained by **Team TrueAddams**:
- [**Akshdeep Singh**](https://github.com/akshdeepsingh7) (Team Leader)
- **Paras Gupta**
- **Prince Pratik**
- **Akashdeep Singh**

Local restaurants and cafes rely on fast, commission-free, reliable software to thrive.

## Getting Started

1. **Fork the repository** on GitHub: [https://github.com/akshdeepsingh7/RasoiLink](https://github.com/akshdeepsingh7/RasoiLink)
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/RasoiLink.git
   cd RasoiLink
   git remote add upstream https://github.com/akshdeepsingh7/RasoiLink.git
   ```
3. **Set up virtual environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
4. **Copy `.env.example`**:
   ```bash
   cp .env.example .env
   ```
5. **Run tests**:
   ```bash
   python verify_system.py
   ```
6. **Start local server**:
   ```bash
   uvicorn main:app --reload --port 8000
   ```

## Guidelines

- Keep the frontend **zero-build** (Vanilla HTML5, CSS3, ES6+ JavaScript) without bundling pipelines so any cafe owner can deploy and inspect it without complex build chains.
- Ensure all SQLite queries preserve **WAL mode** and foreign key constraints.
- Make sure all new endpoints are covered in `verify_system.py`.
- Adhere to semantic commit messages (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
