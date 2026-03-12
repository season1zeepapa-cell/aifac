#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF 로더 통합 Python 브릿지

Node.js에서 stdin으로 JSON 요청을 받아 해당 로더로 PDF를 처리하고
stdout으로 JSON 결과를 반환한다.

요청 형식: { "loader": "pymupdf", "pdfPath": "/tmp/xxx.pdf" }
응답 형식: { "pages": [...], "totalPages": N, "fullText": "..." }
에러 형식: { "error": "에러 메시지" }
"""

import sys
import json
import traceback


def extract_pymupdf(pdf_path):
    """PyMuPDF(fitz) — 가장 빠른 PDF 텍스트 추출"""
    import pymupdf  # pymupdf >= 1.24.0 에서는 import pymupdf
    doc = pymupdf.open(pdf_path)
    pages = []
    all_text = []

    for i, page in enumerate(doc):
        text = page.get_text("text")
        pages.append({
            "pageNumber": i + 1,
            "text": text.strip(),
        })
        all_text.append(text)

    doc.close()
    return {
        "pages": pages,
        "totalPages": len(pages),
        "fullText": "\n\n".join(all_text),
    }


def extract_pypdf(pdf_path):
    """PyPDF — 가볍고 표준적인 텍스트 추출"""
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    pages = []
    all_text = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append({
            "pageNumber": i + 1,
            "text": text.strip(),
        })
        all_text.append(text)

    return {
        "pages": pages,
        "totalPages": len(pages),
        "fullText": "\n\n".join(all_text),
    }


def extract_pdfplumber(pdf_path):
    """PDFPlumber — 표 추출 최강, 한글 최적화"""
    import pdfplumber
    pages = []
    all_text = []

    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            # 표가 있으면 표 추출, 없으면 일반 텍스트
            tables = page.extract_tables()
            if tables:
                # 표를 마크다운 형식으로 변환
                table_texts = []
                for table in tables:
                    if not table:
                        continue
                    # 첫 행을 헤더로
                    header = table[0] if table else []
                    rows = table[1:] if len(table) > 1 else []

                    md = "| " + " | ".join(str(c or "") for c in header) + " |"
                    md += "\n| " + " | ".join("---" for _ in header) + " |"
                    for row in rows:
                        md += "\n| " + " | ".join(str(c or "") for c in row) + " |"
                    table_texts.append(md)

                # 표 외 텍스트도 추출
                plain_text = page.extract_text() or ""
                text = plain_text + "\n\n" + "\n\n".join(table_texts)
            else:
                text = page.extract_text() or ""

            pages.append({
                "pageNumber": i + 1,
                "text": text.strip(),
            })
            all_text.append(text)

    return {
        "pages": pages,
        "totalPages": len(pages),
        "fullText": "\n\n".join(all_text),
    }


# 로더 매핑
LOADERS = {
    "pymupdf": extract_pymupdf,
    "pypdf": extract_pypdf,
    "pdfplumber": extract_pdfplumber,
}


def main():
    """메인 — stdin에서 JSON 읽고 결과를 stdout으로 출력"""
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"JSON 파싱 실패: {str(e)}"}))
        sys.exit(1)

    loader_id = request.get("loader")
    pdf_path = request.get("pdfPath")

    if not loader_id or loader_id not in LOADERS:
        print(json.dumps({"error": f"알 수 없는 로더: {loader_id}. 지원: {list(LOADERS.keys())}"}))
        sys.exit(1)

    if not pdf_path:
        print(json.dumps({"error": "pdfPath가 필요합니다."}))
        sys.exit(1)

    try:
        result = LOADERS[loader_id](pdf_path)
        print(json.dumps(result, ensure_ascii=False))
    except ImportError as e:
        print(json.dumps({"error": f"패키지 미설치: {str(e)}. pip install 필요."}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"{loader_id} 실행 오류: {str(e)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
